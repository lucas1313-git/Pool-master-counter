# Room labels - what everything in the empty-room snapshot is

`segment.json` + `segment.bin` are Meta's ADE20K linear segmentation head for DINOv2 ViT-S/14, with
the model's own 37x37 position table, run by `camera/segment.js` on the DINOv2 the camera page
already has (`camera/models/dinov2/dino.bin` - the same backbone, so it isn't stored twice). Every
14-pixel patch of the empty-room snapshot gets one of ADE20K's 150 kinds of thing (wall, floor,
chair, armchair, sofa, rug, lamp, cabinet, painting, mirror, television, pool table...); camera.html
turns them into the room's tags.

- Source: https://dl.fbaipublicfiles.com/dinov2/dinov2_vits14/ - `dinov2_vits14_ade20k_linear_head.pth`
  (the head: a batch norm and a 1x1 convolution, 384 -> 150) and `dinov2_vits14_pretrain.pth` (only its
  `pos_embed`). Licence: Apache-2.0, as all of DINOv2 - a copy is in `LICENSE` here.
- Converted by `convert.py` (needs `torch` and `numpy`):
  `python convert.py dinov2_vits14_pretrain.pth dinov2_vits14_ade20k_linear_head.pth <out_dir> [../dinov2]`.
  The batch norm is folded into the convolution (one 384 -> 150 matrix and its bias); all float32,
  2.3 MB. With the last argument it also checks that `../dinov2/dino.bin` is this same backbone -
  it is: every weight within its int8 rounding (0.4% of the largest), the CLS token and the final
  layer norm exactly.
- Checked: `camera/segment.js` in the browser (WebGL) against a torch run of DINOv2 + this head on
  the same pixels and the same int8 backbone weights - 100% of the patches given the same label,
  the scores within 0.001; against the original float32 backbone, 98% the same label (the rest:
  the int8 rounding). On real rooms (Wikimedia Commons photos of billiard rooms) it finds the pool
  table, chairs, sofas, lamps, paintings, fireplace, doors, windows, radiators.
- Speed: about 0.4 s for a 644x406-pixel snapshot (46 x 29 patches) once warmed up, a few seconds
  the first time (the GPU programs compile).
