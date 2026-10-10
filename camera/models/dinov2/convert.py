# Converts Meta's DINOv2 ViT-S/14 (facebook/dinov2-small, Apache-2.0) into the camera page's
# own small format for a fixed 224x112 (HxW) person crop - a 16x8 grid of 14px patches:
#   dino.json - shapes, where each weight sits in dino.bin and how it's stored
#   dino.bin  - the big matrices as int8 (one scale per output column), everything else float32
# The position table is resized to the 16x8 grid here once (bicubic, as the model itself does
# for any size other than its own), so the browser never has to.
# Also writes a reference input/output (onnxruntime on the official ONNX export, and this
# script's own numpy run of the converted weights) for checking the browser version.
# usage: python convert.py <model.safetensors> <model.onnx> <out_dir> <reference.json>
import json, struct, sys, os
import numpy as np

src, onnx_path, out_dir, ref_path = sys.argv[1:5]
H, W, P = 224, 112, 14
GH, GW = H // P, W // P
D, HEADS, LAYERS = 384, 6, 12
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

# --- bicubic resize as torch / ONNX Resize do it (a=-0.75, half-pixel, edges repeated) ---
def cubic(x, a=-0.75):
    x = abs(x)
    if x <= 1: return (a + 2) * x ** 3 - (a + 3) * x ** 2 + 1
    if x < 2: return a * x ** 3 - 5 * a * x ** 2 + 8 * a * x - 4 * a
    return 0.0
def resize_matrix(n_in, n_out):
    M = np.zeros((n_out, n_in), np.float64)
    scale = n_in / n_out
    for o in range(n_out):
        src_x = (o + 0.5) * scale - 0.5
        x0 = int(np.floor(src_x)); frac = src_x - x0
        for k in range(-1, 3):
            M[o, min(max(x0 + k, 0), n_in - 1)] += cubic(k - frac)
    return M
pos = t["embeddings.position_embeddings"][0]          # [1370, 384]: CLS + 37x37
side = int(round((pos.shape[0] - 1) ** 0.5))
grid = pos[1:].reshape(side, side, D).astype(np.float64)
Ry, Rx = resize_matrix(side, GH), resize_matrix(side, GW)
grid = np.einsum("ys,sxd->yxd", Ry, grid)
grid = np.einsum("xs,ysd->yxd", Rx, grid)
pos_small = np.concatenate([pos[:1], grid.reshape(GH * GW, D).astype(np.float32)], 0)   # [129, 384]

# --- the weights, in the order and layout the browser wants them ---
weights = []   # (name, array, "q8" | "f32")
def add(name, arr, kind):
    weights.append((name, np.ascontiguousarray(arr, dtype=np.float32), kind))

# patch embedding as a matrix: a patch flattened (row, col, channel) -> 384
pw = t["embeddings.patch_embeddings.projection.weight"]         # [384, 3, 14, 14]
add("patch_w", pw.transpose(2, 3, 1, 0).reshape(P * P * 3, D), "q8")
add("patch_b", t["embeddings.patch_embeddings.projection.bias"], "f32")
add("cls", t["embeddings.cls_token"].reshape(1, D), "f32")
add("pos", pos_small, "f32")
for i in range(LAYERS):
    p = "encoder.layer.%d." % i
    a = p + "attention.attention."
    qkv_w = np.concatenate([t[a + "query.weight"], t[a + "key.weight"], t[a + "value.weight"]], 0).T   # [384, 1152]
    qkv_b = np.concatenate([t[a + "query.bias"], t[a + "key.bias"], t[a + "value.bias"]], 0)
    add("l%d.norm1_g" % i, t[p + "norm1.weight"], "f32")
    add("l%d.norm1_b" % i, t[p + "norm1.bias"], "f32")
    add("l%d.qkv_w" % i, qkv_w, "q8")
    add("l%d.qkv_b" % i, qkv_b, "f32")
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
add("norm_g", t["layernorm.weight"], "f32")
add("norm_b", t["layernorm.bias"], "f32")

# --- write: int8 matrices (per output column scale, stored as float32 right before them) ---
blob = bytearray()
entries = []
deq = {}
for name, arr, kind in weights:
    while len(blob) % 4: blob.append(0)
    e = {"name": name, "shape": list(arr.shape), "offset": len(blob)}
    if kind == "q8":
        scale = np.abs(arr).max(0) / 127.0
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
with open(os.path.join(out_dir, "dino.bin"), "wb") as f:
    f.write(bytes(blob))
meta = {
    "format": "pmc-vit-1",
    "source": "facebook/dinov2-small (Apache-2.0), revision ed25f3a31f01632728cabb09d1542f84ab7b0056",
    "inputShape": [1, H, W, 3], "patch": P, "grid": [GH, GW], "dim": D, "heads": HEADS, "layers": LAYERS,
    "mean": MEAN.tolist(), "std": STD.tolist(), "eps": 1e-6,
    "weights": entries
}
with open(os.path.join(out_dir, "dino.json"), "w") as f:
    json.dump(meta, f, separators=(",", ":"))
print("dino.bin", len(blob), "bytes,", len(entries), "weights")

# --- numpy run of the converted weights (the browser does exactly this) ---
from math import erf
def layernorm(x, g, b):
    m = x.mean(-1, keepdims=True); v = ((x - m) ** 2).mean(-1, keepdims=True)
    return (x - m) / np.sqrt(v + 1e-6) * g + b
def gelu(x):
    return 0.5 * x * (1 + np.vectorize(erf)(x / np.sqrt(2)))
def run(img, w):   # img [H, W, 3] in 0..1
    x = (img - MEAN) / STD
    patches = x.reshape(GH, P, GW, P, 3).transpose(0, 2, 1, 3, 4).reshape(GH * GW, P * P * 3)
    tok = patches @ w["patch_w"] + w["patch_b"]
    h = np.concatenate([w["cls"], tok], 0) + w["pos"]
    hd = D // HEADS
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
    return layernorm(h, w["norm_g"], w["norm_b"])

full = {name: arr for name, arr, kind in weights}
rng = np.random.default_rng(7)
# a smooth, picture-like input (random blobs), plus the page's grey letterbox
img = np.zeros((H, W, 3), np.float32) + np.array([124, 116, 104], np.float32) / 255
yy, xx = np.mgrid[0:H, 0:W]
for _ in range(12):
    cy, cx, r = rng.uniform(20, H - 20), rng.uniform(10, W - 10), rng.uniform(8, 40)
    img[(yy - cy) ** 2 + (xx - cx) ** 2 < r * r] = rng.uniform(0, 1, 3)
img = (np.round(img * 255) / 255).astype(np.float32)   # exactly what a canvas holds

import onnxruntime as ort
sess = ort.InferenceSession(onnx_path, providers=["CPUExecutionProvider"])
x = ((img - MEAN) / STD).transpose(2, 0, 1)[None].astype(np.float32)
ref = sess.run(None, {"pixel_values": x})[0][0]          # [129, 384]
mine_f = run(img, full)
mine_q = run(img, deq)
def cos(a, b): return float((a * b).sum() / np.linalg.norm(a) / np.linalg.norm(b))
print("float32 numpy vs onnxruntime: CLS cos %.6f, max abs diff %.2e" % (cos(mine_f[0], ref[0]), np.abs(mine_f - ref).max()))
print("int8 numpy vs onnxruntime:    CLS cos %.6f" % cos(mine_q[0], ref[0]))
with open(ref_path, "w") as f:
    json.dump({"input": (img * 255).round().astype(np.uint8).reshape(-1).tolist(), "cls": ref[0].tolist(), "clsInt8": mine_q[0].tolist()}, f)
