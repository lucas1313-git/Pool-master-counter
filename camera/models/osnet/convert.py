# Converts Qualcomm's OSNet ONNX export into the camera page's own small format:
#   osnet.json - the graph as a flat list of ops (NHWC layout, weights pre-transposed)
#   osnet.bin  - every weight as float16, concatenated
# and writes a reference input/output (from onnxruntime) for checking the browser version.
# usage: python osnet_convert.py <osnet.onnx> <out_dir> <reference.json>
import json, sys, os
import numpy as np
import onnx
from onnx import numpy_helper
import onnxruntime as ort

src, out_dir, ref_path = sys.argv[1], sys.argv[2], sys.argv[3]
m = onnx.load(src, load_external_data=True)
g = m.graph
inits = {i.name: numpy_helper.to_array(i) for i in g.initializer}

weights = []          # (name, float32 array)
weight_index = {}
def add_weight(name, arr):
    arr = np.ascontiguousarray(arr.astype(np.float32))
    weight_index[name] = len(weights)
    weights.append((name, arr))
    return name

def attr(n, name, default=None):
    for a in n.attribute:
        if a.name == name:
            return onnx.helper.get_attribute_value(a)
    return default

def nhwc_const(name):
    a = inits[name]
    if a.ndim == 4 and a.shape[0] == 1 and a.shape[2] == 1 and a.shape[3] == 1:
        a = a.reshape(1, 1, 1, a.shape[1])
    return add_weight(name, a)

ops = []
for n in g.node:
    t = n.op_type
    ins, outs = list(n.input), list(n.output)
    if t == "Conv":
        w = inits[ins[1]]
        group = attr(n, "group", 1)
        pads = list(attr(n, "pads", [0, 0, 0, 0])); strides = list(attr(n, "strides", [1, 1]))
        assert pads[0] == pads[1] == pads[2] == pads[3] and strides[0] == strides[1]
        assert list(attr(n, "dilations", [1, 1])) == [1, 1]
        cin = w.shape[1] * group
        if group == 1:
            wt = w.transpose(2, 3, 1, 0)                     # [O,I,kh,kw] -> [kh,kw,I,O]
            depthwise = False
        else:
            assert group == cin and w.shape[1] == 1, (group, w.shape)
            mult = w.shape[0] // cin
            wt = w.reshape(cin, mult, w.shape[2], w.shape[3]).transpose(2, 3, 0, 1)  # -> [kh,kw,I,mult]
            depthwise = True
        op = {"op": "conv", "in": ins[0], "out": outs[0], "w": add_weight(ins[1], wt), "stride": strides[0], "pad": pads[0], "depthwise": depthwise}
        if len(ins) > 2 and ins[2]:
            op["b"] = add_weight(ins[2], inits[ins[2]])
        ops.append(op)
    elif t in ("Relu", "Sigmoid"):
        ops.append({"op": t.lower(), "in": ins[0], "out": outs[0]})
    elif t in ("Add", "Mul", "Sub", "Div"):
        args = [nhwc_const(x) if x in inits else x for x in ins]
        ops.append({"op": t.lower(), "a": args[0], "b": args[1], "aConst": ins[0] in inits, "bConst": ins[1] in inits, "out": outs[0]})
    elif t == "GlobalAveragePool":
        ops.append({"op": "gap", "in": ins[0], "out": outs[0]})
    elif t in ("MaxPool", "AveragePool"):
        k = list(attr(n, "kernel_shape")); s = list(attr(n, "strides")); p = list(attr(n, "pads", [0, 0, 0, 0]))
        assert k[0] == k[1] and s[0] == s[1] and p[0] == p[1] == p[2] == p[3] and attr(n, "ceil_mode", 0) == 0
        if t == "AveragePool": assert p[0] == 0
        ops.append({"op": "maxpool" if t == "MaxPool" else "avgpool", "in": ins[0], "out": outs[0], "k": k[0], "stride": s[0], "pad": p[0]})
    elif t == "Reshape":
        ops.append({"op": "flatten", "in": ins[0], "out": outs[0]})   # only after the global pool: [1,1,1,C] -> [1,C]
    elif t == "Gemm":
        assert attr(n, "transB", 0) == 1 and attr(n, "transA", 0) == 0
        ops.append({"op": "dense", "in": ins[0], "out": outs[0], "w": add_weight(ins[1], inits[ins[1]].T), "b": add_weight(ins[2], inits[ins[2]])})
    elif t == "ReduceL2":
        axes = inits[ins[1]].tolist()
        assert axes == [1]
        ops.append({"op": "l2norm", "in": ins[0], "out": outs[0]})
    elif t == "Clip":
        ops.append({"op": "clipmin", "in": ins[0], "out": outs[0], "min": float(inits[ins[1]])})
    elif t == "Expand":
        ops.append({"op": "identity", "in": ins[0], "out": outs[0]})
    else:
        raise SystemExit("unsupported op " + t)

os.makedirs(out_dir, exist_ok=True)
offset = 0
meta = []
blob = []
for name, arr in weights:
    meta.append({"name": name, "shape": list(arr.shape), "offset": offset})
    h = arr.astype(np.float16)
    blob.append(h.tobytes())
    offset += arr.size
open(os.path.join(out_dir, "osnet.bin"), "wb").write(b"".join(blob))
graph = {
    "format": "pmc-osnet-1",
    "source": "Qualcomm AI Hub OSNet v0.64.0 (osnet_x1_0, Market-1501, MIT export) - converted for camera.html",
    "input": g.input[0].name, "inputShape": [1, 256, 128, 3], "output": g.output[0].name,
    "weights": meta, "ops": ops,
}
json.dump(graph, open(os.path.join(out_dir, "osnet.json"), "w"), separators=(",", ":"))

# reference: a deterministic pattern the browser test regenerates exactly
H, W = 256, 128
x = np.zeros((1, 3, H, W), np.float32)
for c in range(3):
    for h in range(H):
        for w_ in range(W):
            x[0, c, h, w_] = ((h * 7 + w_ * 13 + c * 29) % 97) / 96.0
sess = ort.InferenceSession(src, providers=["CPUExecutionProvider"])
y = sess.run(None, {g.input[0].name: x})[0][0]
json.dump({"pattern": "((h*7+w*13+c*29)%97)/96", "embedding": [round(float(v), 6) for v in y]}, open(ref_path, "w"))
print("ops", len(ops), "weights", len(weights), "floats", offset, "bin bytes", offset * 2, "json bytes", os.path.getsize(os.path.join(out_dir, "osnet.json")))
print("ref norm", float(np.linalg.norm(y)), "nonzero", int((y > 0).sum()))
