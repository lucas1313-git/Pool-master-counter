# Room labels for the empty-room snapshot: Meta's ADE20K linear head for
# DINOv2 ViT-S/14, packed for camera/segment.js.
#
# The backbone is the DINOv2 the camera page already has
# (camera/models/dinov2/dino.bin - facebook/dinov2-small); this only adds
# what that one lacks for whole-room pictures:
#   pos     - the model's own position table, 37x37 + CLS (dino.bin keeps a
#             copy resized for person crops only)
#   head_w, head_b - the head: a batch norm then a 1x1 convolution to the
#             150 ADE20K classes, folded into one 384 -> 150 matrix
#
# usage: python convert.py dinov2_vits14_pretrain.pth dinov2_vits14_ade20k_linear_head.pth <out_dir> [dino_dir]
#   (both from https://dl.fbaipublicfiles.com/dinov2/dinov2_vits14/ ;
#    dino_dir: also check that dino.bin is the same backbone)
import sys, json, os
import numpy as np
import torch

ADE20K = ['wall', 'building', 'sky', 'floor', 'tree', 'ceiling', 'road', 'bed', 'windowpane', 'grass', 'cabinet', 'sidewalk', 'person', 'earth', 'door', 'table', 'mountain', 'plant', 'curtain', 'chair', 'car', 'water', 'painting', 'sofa', 'shelf', 'house', 'sea', 'mirror', 'rug', 'field', 'armchair', 'seat', 'fence', 'desk', 'rock', 'wardrobe', 'lamp', 'bathtub', 'railing', 'cushion', 'base', 'box', 'column', 'signboard', 'chest of drawers', 'counter', 'sand', 'sink', 'skyscraper', 'fireplace', 'refrigerator', 'grandstand', 'path', 'stairs', 'runway', 'case', 'pool table', 'pillow', 'screen door', 'stairway', 'river', 'bridge', 'bookcase', 'blind', 'coffee table', 'toilet', 'flower', 'book', 'hill', 'bench', 'countertop', 'stove', 'palm', 'kitchen island', 'computer', 'swivel chair', 'boat', 'bar', 'arcade machine', 'hovel', 'bus', 'towel', 'light', 'truck', 'tower', 'chandelier', 'awning', 'streetlight', 'booth', 'television receiver', 'airplane', 'dirt track', 'apparel', 'pole', 'land', 'bannister', 'escalator', 'ottoman', 'bottle', 'buffet', 'poster', 'stage', 'van', 'ship', 'fountain', 'conveyer belt', 'canopy', 'washer', 'plaything', 'swimming pool', 'stool', 'barrel', 'basket', 'waterfall', 'tent', 'bag', 'minibike', 'cradle', 'oven', 'ball', 'food', 'step', 'tank', 'trade name', 'microwave', 'pot', 'animal', 'bicycle', 'lake', 'dishwasher', 'screen', 'blanket', 'sculpture', 'hood', 'sconce', 'vase', 'traffic light', 'tray', 'ashcan', 'fan', 'pier', 'crt screen', 'plate', 'monitor', 'bulletin board', 'shower', 'radiator', 'glass', 'clock', 'flag']
assert len(ADE20K) == 150


def main():
    pretrain, head_path, out = sys.argv[1], sys.argv[2], sys.argv[3]
    dino_dir = sys.argv[4] if len(sys.argv) > 4 else None
    pt = torch.load(pretrain, map_location='cpu', weights_only=True)
    hd = torch.load(head_path, map_location='cpu', weights_only=True)['state_dict']
    pos = pt['pos_embed'][0].numpy().astype(np.float32)                      # 1370 x 384
    bn_scale = (hd['decode_head.bn.weight'] / torch.sqrt(hd['decode_head.bn.running_var'] + 1e-5)).numpy()
    bn_shift = hd['decode_head.bn.bias'].numpy() - hd['decode_head.bn.running_mean'].numpy() * bn_scale
    conv_w = hd['decode_head.conv_seg.weight'][:, :, 0, 0].numpy()          # 150 x 384
    head_w = (conv_w * bn_scale[None, :]).T.astype(np.float32)              # 384 x 150
    head_b = (hd['decode_head.conv_seg.bias'] + hd['decode_head.conv_seg.weight'][:, :, 0, 0] @ torch.from_numpy(bn_shift)).numpy().astype(np.float32)

    os.makedirs(out, exist_ok=True)
    weights, blobs, offset = [], [], 0
    for name, arr in (('pos', pos), ('head_w', head_w), ('head_b', head_b)):
        b = np.ascontiguousarray(arr).tobytes()
        weights.append({'name': name, 'shape': list(arr.shape), 'dtype': 'float32', 'offset': offset})
        blobs.append(b)
        offset += len(b)
    with open(os.path.join(out, 'segment.bin'), 'wb') as f:
        for b in blobs:
            f.write(b)
    meta = {
        'format': 'pmc-seg-1',
        'source': 'dinov2_vits14_pretrain.pth (position table) + dinov2_vits14_ade20k_linear_head.pth, '
                  'https://dl.fbaipublicfiles.com/dinov2/dinov2_vits14/ (Apache-2.0)',
        'backbone': '../dinov2/', 'posGrid': 37, 'dim': 384, 'classes': ADE20K, 'weights': weights
    }
    with open(os.path.join(out, 'segment.json'), 'w') as f:
        json.dump(meta, f, indent=1)
    print('segment.bin', offset, 'bytes')

    if dino_dir:
        # the vendored backbone has to be this same DINOv2
        m = json.load(open(os.path.join(dino_dir, 'dino.json')))
        buf = open(os.path.join(dino_dir, 'dino.bin'), 'rb').read()
        def get(name):
            e = next(x for x in m['weights'] if x['name'] == name)
            n = int(np.prod(e['shape']))
            if e['dtype'] == 'int8':
                q = np.frombuffer(buf, np.int8, n, e['offset']).astype(np.float32)
                cols = e['shape'][-1]
                s = np.frombuffer(buf, np.float32, cols, e['scaleOffset'])
                return (q.reshape(-1, cols) * s).reshape(e['shape'])
            return np.frombuffer(buf, np.float32, n, e['offset']).reshape(e['shape'])
        patch = pt['patch_embed.proj.weight'].permute(2, 3, 1, 0).reshape(588, 384).numpy()
        checks = {
            'patch_w': np.abs(get('patch_w') - patch).max() / np.abs(patch).max(),
            'cls': np.abs(get('cls') - pt['cls_token'][0].numpy()).max(),
            'l0.qkv_w': np.abs(get('l0.qkv_w') - pt['blocks.0.attn.qkv.weight'].numpy().T).max() / pt['blocks.0.attn.qkv.weight'].abs().max().item(),
            'l11.fc2_w': np.abs(get('l11.fc2_w') - pt['blocks.11.mlp.fc2.weight'].numpy().T).max() / pt['blocks.11.mlp.fc2.weight'].abs().max().item(),
            'norm_g': np.abs(get('norm_g') - pt['norm.weight'].numpy()).max(),
        }
        print('vendored dino.bin vs this backbone (relative to the largest weight):', {k: float('%.2g' % v) for k, v in checks.items()})


if __name__ == '__main__':
    main()
