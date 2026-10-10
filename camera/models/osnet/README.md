# OSNet - the camera's appearance model

`osnet.json` + `osnet.bin` are OSNet (osnet_x1_0, 256x128 person crops, 512-number output) in a
small format of our own, run by `camera/osnet.js` on the same TensorFlow.js engine as the pose model.

- Source: Qualcomm AI Hub's OSNet export, v0.64.0, ONNX float -
  https://huggingface.co/qualcomm/OSNet (export code MIT-licensed). The weights are torchreid's
  `osnet_x1_0_market_256x128_amsgrad_ep150_stp60_lr0.0015_b64_fb10_softmax_labelsmooth_flip.pth`,
  trained on the Market-1501 dataset, whose terms are aimed at research/non-commercial use - fine
  while the app isn't sold; revisit before ever selling it.
- Converted by `convert.py` (needs `onnx`, `onnxruntime`, `numpy`):
  `python convert.py osnet.onnx <out_dir> reference.json` - weights pre-transposed to NHWC and
  stored as float16 (4.4 MB). Checked against onnxruntime on the same input: cosine similarity
  0.99995 between the two 512-number outputs.
