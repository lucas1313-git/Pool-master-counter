# Depth Anything V2 Metric Indoor Small - the room map's depth model

`depth.json` + `depth.bin` are Depth Anything V2 Small fine-tuned for indoor rooms in metres
(`depth-anything/Depth-Anything-V2-Metric-Indoor-Small-hf`, the transformers copy of
`depth-anything/Depth-Anything-V2-Metric-Hypersim-Small`) in a small format of our own, run by
`camera/depth.js` on the same TensorFlow.js engine as the pose model. It turns the empty-room
snapshot into how far every pixel is from the camera along its view, in metres; camera.html's room
map then sets the exact scale from the calibrated table and finds the floor and everything standing
on it.

- Source: https://huggingface.co/depth-anything/Depth-Anything-V2-Metric-Indoor-Small-hf, revision
  `8078d68a9c75a972131914f6afd0c1723be0da7f` (`model.safetensors`). Licence: Apache-2.0 (the Small
  models; Base and Large are non-commercial) - a copy is in `LICENSE` here. Trained by its authors
  on Hypersim (synthetic indoor scenes) on top of Depth Anything V2.
- The network: a DINOv2 ViT-S/14 (as in `camera/models/dinov2`, with its own weights) whose layers
  3, 6, 9 and 12 feed a DPT head - each turned back into a picture-shaped grid at 4x, 2x, 1x and
  1/2 of the patch grid, then fused from the coarsest up - ending in a sigmoid times 20 m.
- Converted by `convert.py` (needs `numpy`; `onnxruntime` only to check the plain, non-metric
  model): `python convert.py model.safetensors - <out_dir> reference.json metric`. The position
  table stays at its own 37x37 and is resized (bicubic) by `camera/depth.js` for whatever picture
  size it's given. The big matrices and convolutions are int8 with a float32 scale per column
  (27 MB instead of 99), everything else float32.
- Checked: the converter's numpy run of the network against onnxruntime on the official ONNX
  export of the plain model (`onnx-community/depth-anything-v2-small`) - largest difference 2e-5 of
  the output's range; the browser's int8 run against numpy's - 7e-5; int8 against float32 on a real
  room - 0.8% on average (1.7% at the 95th percentile).
