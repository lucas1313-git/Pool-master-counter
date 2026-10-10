# DINOv2 - the camera's second appearance model

`dino.json` + `dino.bin` are Meta's DINOv2 ViT-S/14 (`facebook/dinov2-small`) in a small format of
our own, run by `camera/dino.js` on the same TensorFlow.js engine as the pose model and OSNet. It
turns a person's picture (112x224, a 8x16 grid of 14-pixel patches) into 384 numbers - its CLS
token after the last layer norm, made unit length.

- Source: https://huggingface.co/facebook/dinov2-small, revision
  `ed25f3a31f01632728cabb09d1542f84ab7b0056` (`model.safetensors`). Licence: Apache-2.0 - a copy
  is in `LICENSE` here. Free for any use, a sold app included. Trained by Meta on general
  pictures (LVD-142M), not on photos of people in particular.
- Converted by `convert.py` (needs `numpy`; `onnxruntime` for the check):
  `python convert.py model.safetensors model.onnx <out_dir> reference.json`, the ONNX file being
  https://huggingface.co/onnx-community/dinov2-small `onnx/model.onnx` (only used to check).
  - The position table is resized from the model's own 37x37 grid to 16x8 once, here (bicubic,
    as the model does itself for any other picture size).
  - The big matrices (patch embedding, attention, MLP) are stored as int8 with a float32 scale per
    output column - 22 MB instead of 88; everything else as float32.
- Checked: the conversion's float32 numpy run against onnxruntime - largest difference 9e-5; the
  int8 weights against onnxruntime - cosine similarity 0.9993 between the two outputs; the
  browser (`camera/dino.js`, WebGL) against the int8 numpy run - 0.99999999.
- Speed: about 30 ms a picture on a 2020s Mac (OSNet: about 15).
