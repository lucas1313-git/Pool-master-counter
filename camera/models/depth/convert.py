# Converts Depth Anything V2 Small (depth-anything/Depth-Anything-V2-Small-hf, Apache-2.0) into
# the camera page's own small format, run by camera/depth.js:
#   depth.json - shapes, where each weight sits in depth.bin and how it's stored
#   depth.bin  - the big matrices and convolutions as int8 (one scale per last-axis column),
#                everything else float32
# The model is a DINOv2 ViT-S/14 (the same as camera/models/dinov2, with its own weights) whose
# layers 3, 6, 9 and 12 feed a DPT head: each is turned back into a picture-shaped grid, brought
# to 4x, 2x, 1x and 1/2 of the patch grid, then fused from the coarsest up into one map of how
# near each pixel is (bigger = nearer, in no particular unit).
# The position table is kept at the model's own 37x37 - camera/depth.js resizes it (bicubic) to
# whatever patch grid it's given, so any picture size works.
# Also checks this script's own numpy run of the converted weights against onnxruntime on the
# official ONNX export (onnx-community/depth-anything-v2-small) and writes a reference
# input/output for checking the browser version.
# usage: python convert.py <model.safetensors> <model.onnx | -> <out_dir> <reference.json> [metric]
# "metric": a Metric (Hypersim, indoor) fine-tune - the same network, its last step a sigmoid times
# 20 (metres along the view) instead of a ReLU; then there's no ONNX to check against ("-").
import json, struct, sys, os
import numpy as np

src, onnx_path, out_dir, ref_path = sys.argv[1:5]
METRIC = len(sys.argv) > 5 and sys.argv[5] == "metric"
MAX_DEPTH = 20.0
Q8_CONV = os.environ.get("Q8_CONV", "1") == "1"   # (0: convolutions as float32 too)
np.seterr(all="ignore")   # (numpy's Accelerate matmul warns spuriously on macOS)
P, D, HEADS, LAYERS = 14, 384, 6, 12
OUT_LAYERS = [3, 6, 9, 12]
NECK = [48, 96, 192, 384]
FACTORS = [4, 2, 1, 0.5]
FUSION, HEAD_HIDDEN = 64, 32
MEAN = np.array([0.485, 0.456, 0.406], np.float32)
STD = np.array([0.229, 0.224, 0.225], np.float32)

def load_safetensors(path):
    with open(path, "rb") as f:
        n = struct.unpack("<Q", f.read(8))[0]
        header = json.loads(f.read(n))
        base = 8 + n
        out = {}
        for k, v in header.items():
            if k == "__metadata__":
                continue
            assert v["dtype"] == "F32", (k, v["dtype"])
            s, e = v["data_offsets"]
            f.seek(base + s)
            out[k] = np.frombuffer(f.read(e - s), np.float32).reshape(v["shape"]).copy()
        return out

t = load_safetensors(src)

weights = []   # (name, array, "q8" | "f32")
def add(name, arr, kind):
    weights.append((name, np.ascontiguousarray(arr, dtype=np.float32), kind))
def conv(name, key, bias=True):
    # torch [out, in, kh, kw] -> TensorFlow.js conv2d [kh, kw, in, out]
    w = t[key + ".weight"].transpose(2, 3, 1, 0)
    add(name + "_w", w, "q8" if w.size >= 4096 and Q8_CONV else "f32")
    if bias:
        add(name + "_b", t[key + ".bias"], "f32")
def deconv(name, key):
    # torch ConvTranspose2d [in, out, kh, kw] -> TensorFlow.js conv2dTranspose [kh, kw, out, in]
    w = t[key + ".weight"].transpose(2, 3, 1, 0)
    add(name + "_w", w, "q8" if Q8_CONV else "f32")
    add(name + "_b", t[key + ".bias"], "f32")

b = "backbone."
pw = t[b + "embeddings.patch_embeddings.projection.weight"]          # [384, 3, 14, 14]
add("patch_w", pw.transpose(2, 3, 1, 0).reshape(P * P * 3, D), "q8")
add("patch_b", t[b + "embeddings.patch_embeddings.projection.bias"], "f32")
add("cls", t[b + "embeddings.cls_token"].reshape(1, D), "f32")
pos = t[b + "embeddings.position_embeddings"][0]                      # [1370, 384]: CLS + 37x37
add("pos", pos, "f32")
for i in range(LAYERS):
    p = b + "encoder.layer.%d." % i
    a = p + "attention.attention."
    add("l%d.norm1_g" % i, t[p + "norm1.weight"], "f32")
    add("l%d.norm1_b" % i, t[p + "norm1.bias"], "f32")
    add("l%d.qkv_w" % i, np.concatenate([t[a + "query.weight"], t[a + "key.weight"], t[a + "value.weight"]], 0).T, "q8")
    add("l%d.qkv_b" % i, np.concatenate([t[a + "query.bias"], t[a + "key.bias"], t[a + "value.bias"]], 0), "f32")
    add("l%d.proj_w" % i, t[p + "attention.output.dense.weight"].T, "q8")
    add("l%d.proj_b" % i, t[p + "attention.output.dense.bias"], "f32")
    add("l%d.ls1" % i, t[p + "layer_scale1.lambda1"], "f32")
    add("l%d.norm2_g" % i, t[p + "norm2.weight"], "f32")
    add("l%d.norm2_b" % i, t[p + "norm2.bias"], "f32")
    add("l%d.fc1_w" % i, t[p + "mlp.fc1.weight"].T, "q8")
    add("l%d.fc1_b" % i, t[p + "mlp.fc1.bias"], "f32")
    add("l%d.fc2_w" % i, t[p + "mlp.fc2.weight"].T, "q8")
    add("l%d.fc2_b" % i, t[p + "mlp.fc2.bias"], "f32")
    add("l%d.ls2" % i, t[p + "layer_scale2.lambda1"], "f32")
add("norm_g", t[b + "layernorm.weight"], "f32")
add("norm_b", t[b + "layernorm.bias"], "f32")
for i, f in enumerate(FACTORS):
    r = "neck.reassemble_stage.layers.%d." % i
    conv("r%d.proj" % i, r + "projection")
    if f > 1:
        deconv("r%d.resize" % i, r + "resize")
    elif f < 1:
        conv("r%d.resize" % i, r + "resize")
    conv("c%d" % i, "neck.convs.%d" % i, bias=False)
for i in range(4):
    fl = "neck.fusion_stage.layers.%d." % i
    for res in (1, 2):
        conv("f%d.res%d.conv1" % (i, res), fl + "residual_layer%d.convolution1" % res)
        conv("f%d.res%d.conv2" % (i, res), fl + "residual_layer%d.convolution2" % res)
    conv("f%d.proj" % i, fl + "projection")
conv("head.conv1", "head.conv1")
conv("head.conv2", "head.conv2")
conv("head.conv3", "head.conv3")

blob = bytearray()
entries = []
deq = {}
for name, arr, kind in weights:
    while len(blob) % 4: blob.append(0)
    e = {"name": name, "shape": list(arr.shape), "offset": len(blob)}
    if kind == "q8":
        flat = arr.reshape(-1, arr.shape[-1])
        scale = np.abs(flat).max(0) / 127.0
        scale[scale == 0] = 1.0
        q = np.clip(np.round(arr / scale), -127, 127).astype(np.int8)
        e["dtype"] = "int8"
        blob += scale.astype(np.float32).tobytes()
        e["scaleOffset"] = e["offset"]
        e["offset"] = len(blob)
        blob += q.tobytes()
        deq[name] = q.astype(np.float32) * scale
    else:
        e["dtype"] = "float32"
        blob += arr.tobytes()
        deq[name] = arr
    entries.append(e)
os.makedirs(out_dir, exist_ok=True)
with open(os.path.join(out_dir, "depth.bin"), "wb") as f:
    f.write(bytes(blob))
meta = {
    "format": "pmc-dpt-1",
    "source": "depth-anything/Depth-Anything-V2-Metric-Indoor-Small-hf (Apache-2.0, as depth-anything/Depth-Anything-V2-Metric-Hypersim-Small), revision 8078d68a9c75a972131914f6afd0c1723be0da7f" if METRIC else "depth-anything/Depth-Anything-V2-Small-hf (Apache-2.0), revision 5426e4f0f36572d16453bbda7a8389317b1bef99",
    "patch": P, "dim": D, "heads": HEADS, "layers": LAYERS, "posGrid": 37, "outLayers": OUT_LAYERS,
    "neck": NECK, "factors": FACTORS, "fusion": FUSION, "headHidden": HEAD_HIDDEN,
    "head": "sigmoid" if METRIC else "relu", "maxDepth": MAX_DEPTH if METRIC else None,
    "mean": MEAN.tolist(), "std": STD.tolist(), "eps": 1e-6,
    "weights": entries
}
with open(os.path.join(out_dir, "depth.json"), "w") as f:
    json.dump(meta, f, separators=(",", ":"))
print("depth.bin", len(blob), "bytes,", len(entries), "weights")

# ---------------- numpy run of the converted weights (camera/depth.js does the same) ----------------
def cubic(x, a=-0.75):
    x = abs(x)
    if x <= 1: return (a + 2) * x ** 3 - (a + 3) * x ** 2 + 1
    if x < 2: return a * x ** 3 - 5 * a * x ** 2 + 8 * a * x - 4 * a
    return 0.0
def cubic_matrix(n_in, n_out):
    M = np.zeros((n_out, n_in), np.float64)
    scale = n_in / n_out
    for o in range(n_out):
        s = (o + 0.5) * scale - 0.5
        x0 = int(np.floor(s)); fr = s - x0
        for k in range(-1, 3):
            M[o, min(max(x0 + k, 0), n_in - 1)] += cubic(k - fr)
    return M
def linear_matrix(n_in, n_out, align):
    M = np.zeros((n_out, n_in), np.float64)
    for o in range(n_out):
        if align:
            s = o * (n_in - 1) / (n_out - 1) if n_out > 1 else 0.0
        else:
            s = max((o + 0.5) * n_in / n_out - 0.5, 0.0)
        x0 = min(int(np.floor(s)), n_in - 1); x1 = min(x0 + 1, n_in - 1); fr = s - x0
        M[o, x0] += 1 - fr; M[o, x1] += fr
    return M
def resize(x, h, w, align):   # x [H, W, C]
    x = np.einsum("yh,hwc->ywc", linear_matrix(x.shape[0], h, align), x)
    return np.einsum("xw,ywc->yxc", linear_matrix(x.shape[1], w, align), x).astype(np.float32)
def layernorm(x, g, b):
    m = x.mean(-1, keepdims=True); v = ((x - m) ** 2).mean(-1, keepdims=True)
    return (x - m) / np.sqrt(v + 1e-6) * g + b
from math import erf
verf = np.vectorize(erf)
def gelu(x):
    return 0.5 * x * (1 + verf(x / np.sqrt(2)))
def conv2d(x, wt, bias=None, stride=1, pad=0):   # x [H, W, Cin], wt [kh, kw, Cin, Cout]
    kh, kw = wt.shape[:2]
    if pad: x = np.pad(x, ((pad, pad), (pad, pad), (0, 0)))
    H = (x.shape[0] - kh) // stride + 1; W = (x.shape[1] - kw) // stride + 1
    out = np.zeros((H, W, wt.shape[3]), np.float32)
    for i in range(kh):
        for j in range(kw):
            out += x[i:i + stride * H:stride, j:j + stride * W:stride] @ wt[i, j]
    return out + (bias if bias is not None else 0)
def deconv2d(x, wt, bias, k):   # kernel == stride == k, wt [k, k, Cout, Cin]
    H, W = x.shape[:2]
    out = np.zeros((H * k, W * k, wt.shape[2]), np.float32)
    for i in range(k):
        for j in range(k):
            out[i::k, j::k] = x @ wt[i, j].T
    return out + bias
relu = lambda x: np.maximum(x, 0)

def run(img, w):   # img [H, W, 3] in 0..1, H and W multiples of 14 -> [H, W] nearness
    H, W = img.shape[:2]; GH, GW = H // P, W // P
    x = (img - MEAN) / STD
    patches = x.reshape(GH, P, GW, P, 3).transpose(0, 2, 1, 3, 4).reshape(GH * GW, P * P * 3)
    grid = w["pos"][1:].reshape(37, 37, D).astype(np.float64)
    grid = np.einsum("ys,sxd->yxd", cubic_matrix(37, GH), grid)
    grid = np.einsum("xs,ysd->yxd", cubic_matrix(37, GW), grid)
    pos_g = np.concatenate([w["pos"][:1], grid.reshape(GH * GW, D).astype(np.float32)], 0)
    h = np.concatenate([w["cls"], patches @ w["patch_w"] + w["patch_b"]], 0) + pos_g
    hd = D // HEADS
    feats = []
    for i in range(LAYERS):
        y = layernorm(h, w["l%d.norm1_g" % i], w["l%d.norm1_b" % i])
        qkv = y @ w["l%d.qkv_w" % i] + w["l%d.qkv_b" % i]
        q, k, v = [qkv[:, j * D:(j + 1) * D].reshape(-1, HEADS, hd).transpose(1, 0, 2) for j in range(3)]
        att = q @ k.transpose(0, 2, 1) / np.sqrt(hd)
        att = np.exp(att - att.max(-1, keepdims=True)); att /= att.sum(-1, keepdims=True)
        o = (att @ v).transpose(1, 0, 2).reshape(-1, D)
        h = h + w["l%d.ls1" % i] * (o @ w["l%d.proj_w" % i] + w["l%d.proj_b" % i])
        y = layernorm(h, w["l%d.norm2_g" % i], w["l%d.norm2_b" % i])
        y = gelu(y @ w["l%d.fc1_w" % i] + w["l%d.fc1_b" % i]) @ w["l%d.fc2_w" % i] + w["l%d.fc2_b" % i]
        h = h + w["l%d.ls2" % i] * y
        if i + 1 in OUT_LAYERS:
            feats.append(layernorm(h, w["norm_g"], w["norm_b"])[1:].reshape(GH, GW, D))
    maps = []
    for i, f in enumerate(FACTORS):
        m = conv2d(feats[i], w["r%d.proj_w" % i], w["r%d.proj_b" % i])
        if f > 1: m = deconv2d(m, w["r%d.resize_w" % i], w["r%d.resize_b" % i], int(f))
        elif f < 1: m = conv2d(m, w["r%d.resize_w" % i], w["r%d.resize_b" % i], stride=2, pad=1)
        maps.append(conv2d(m, w["c%d_w" % i], None, pad=1))
    def res(x, n):
        y = conv2d(relu(x), w[n + ".conv1_w"], w[n + ".conv1_b"], pad=1)
        return conv2d(relu(y), w[n + ".conv2_w"], w[n + ".conv2_b"], pad=1) + x
    maps = maps[::-1]
    fused = None
    for i in range(4):
        if fused is None:
            hs = maps[0]
        else:
            r = maps[i]
            if r.shape != fused.shape: r = resize(r, fused.shape[0], fused.shape[1], False)
            hs = fused + res(r, "f%d.res1" % i)
        hs = res(hs, "f%d.res2" % i)
        size = maps[i + 1].shape[:2] if i < 3 else (hs.shape[0] * 2, hs.shape[1] * 2)
        hs = resize(hs, size[0], size[1], True)
        fused = conv2d(hs, w["f%d.proj_w" % i], w["f%d.proj_b" % i])
    y = conv2d(fused, w["head.conv1_w"], w["head.conv1_b"], pad=1)
    y = resize(y, GH * P, GW * P, True)
    y = relu(conv2d(y, w["head.conv2_w"], w["head.conv2_b"], pad=1))
    out = conv2d(y, w["head.conv3_w"], w["head.conv3_b"])[:, :, 0]
    return MAX_DEPTH / (1 + np.exp(-out)) if METRIC else relu(out)

full = {name: arr for name, arr, kind in weights}
GH, GW = 21, 37
H, W = GH * P, GW * P
rng = np.random.default_rng(11)
# a picture-like input: a floor going away, a wall, some blobs
yy, xx = np.mgrid[0:H, 0:W]
img = np.zeros((H, W, 3), np.float32)
img[:] = np.array([0.55, 0.45, 0.35], np.float32)
img[yy < H * 0.4] = np.array([0.8, 0.78, 0.72], np.float32)
for _ in range(14):
    cy, cx, r = rng.uniform(0, H), rng.uniform(0, W), rng.uniform(10, 60)
    img[(yy - cy) ** 2 + (xx - cx) ** 2 < r * r] = rng.uniform(0, 1, 3)
img = img * (0.6 + 0.4 * yy[..., None] / H)
img = (np.round(np.clip(img, 0, 1) * 255) / 255).astype(np.float32)

mine_f = run(img, full)
if onnx_path != "-":
    import onnxruntime as ort
    sess = ort.InferenceSession(onnx_path, providers=["CPUExecutionProvider"])
    ref = sess.run(None, {"pixel_values": ((img - MEAN) / STD).transpose(2, 0, 1)[None].astype(np.float32)})[0][0]
else:
    ref = mine_f   # (no ONNX export to check against: the float32 run is the reference)
mine_q = run(img, deq)
def rel(a, b): return float(np.abs(a - b).max() / np.abs(b).max())
def corr(a, b): return float(np.corrcoef(a.reshape(-1), b.reshape(-1))[0, 1])
print("output %dx%d, range %.3f..%.3f" % (ref.shape[0], ref.shape[1], ref.min(), ref.max()))
print("float32 numpy vs onnxruntime: max diff %.2e of range, correlation %.6f" % (rel(mine_f, ref), corr(mine_f, ref)))
print("int8 numpy vs onnxruntime:    max diff %.2e of range, correlation %.6f" % (rel(mine_q, ref), corr(mine_q, ref)))
with open(ref_path, "w") as f:
    json.dump({"h": H, "w": W, "input": (img * 255).round().astype(np.uint8).reshape(-1).tolist(),
               "depth": np.round(ref, 4).reshape(-1).tolist(), "depthInt8": np.round(mine_q, 4).reshape(-1).tolist()}, f)
