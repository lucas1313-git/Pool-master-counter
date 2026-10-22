// Depth - camera.html's room-shape model for the room map. A picture in (the
// empty-room snapshot), out how far every pixel of it is from the camera,
// along its view, in metres - roughly: camera.html sets the exact scale
// from the calibrated table, whose real size it knows.
//
// The model is Depth Anything V2 Small, fine-tuned for indoor rooms in
// metres (depth-anything/Depth-Anything-V2-Metric-Indoor-Small-hf, trained
// on Hypersim; Apache-2.0): a DINOv2 ViT-S/14 - the same as camera/dino.js,
// with its own weights - whose layers 3, 6, 9 and 12 feed a DPT head, which
// turns them back into picture-shaped grids at 4x, 2x, 1x and 1/2 of the
// patch grid and fuses them, coarsest first, into one map at the picture's
// own size. Converted once into a small format of our own
// (camera/models/depth/: depth.json + depth.bin, the big matrices and
// convolutions as int8 with a scale per column) and run on the same
// TensorFlow.js engine as the pose model.
//
// PMCDepth.load(baseUrl) -> Promise<model>; model.estimate(picture,
// { gridW }) -> Promise<{ w, h, data: Float32Array(w * h), metric }>, the picture
// (canvas, image or video) resized to gridW x (its shape) patches of 14
// pixels first - gridW 37 (518 pixels across) unless given.
(function () {
  "use strict";

  function load(baseUrl) {
    return Promise.all([
      fetch(baseUrl + "depth.json").then(function (r) { if (!r.ok) throw new Error("depth.json " + r.status); return r.json(); }),
      fetch(baseUrl + "depth.bin").then(function (r) { if (!r.ok) throw new Error("depth.bin " + r.status); return r.arrayBuffer(); })
    ]).then(function (parts) {
      var meta = parts[0], buf = parts[1], w = {};
      meta.weights.forEach(function (e) {
        var size = e.shape.reduce(function (a, b) { return a * b; }, 1), data;
        if (e.dtype === "int8") {
          var cols = e.shape[e.shape.length - 1];
          var q = new Int8Array(buf, e.offset, size), scale = new Float32Array(buf, e.scaleOffset, cols);
          data = new Float32Array(size);
          for (var i = 0; i < size; i++) data[i] = q[i] * scale[i % cols];
        } else {
          data = new Float32Array(buf, e.offset, size).slice();
        }
        w[e.name] = tf.tensor(data, e.shape);
      });
      w.__mean = tf.tensor(meta.mean, [1, 1, 3]);
      w.__std = tf.tensor(meta.std, [1, 1, 3]);
      var posCache = {};
      function run(x) {
        // x: [H, W, 3] in 0-1, H and W multiples of the patch size
        var GH = x.shape[0] / meta.patch, GW = x.shape[1] / meta.patch, key = GH + "x" + GW;
        if (!posCache[key]) posCache[key] = tf.keep(resizedPositions(meta, w.pos, GH, GW));
        return forward(meta, w, x, GH, GW, posCache[key]);
      }
      return {
        estimate: function (picture, opts) {
          var gridW = (opts && opts.gridW) || 37;
          var pw = picture.videoWidth || picture.naturalWidth || picture.width, ph = picture.videoHeight || picture.naturalHeight || picture.height;
          var gridH = Math.max(4, Math.round(gridW * ph / pw));
          var H = gridH * meta.patch, W = gridW * meta.patch;
          var out = tf.tidy(function () {
            var x = tf.div(tf.cast(tf.browser.fromPixels(picture), "float32"), 255);
            return run(tf.image.resizeBilinear(x, [H, W], false, true));
          });
          return out.data().then(function (data) { out.dispose(); return { w: W, h: H, data: data, metric: meta.head === "sigmoid" }; });
        },
        // (tests: a ready-made [H, W, 3] input in 0-1)
        estimateTensor: function (x) {
          var out = tf.tidy(function () { return run(x); });
          return out.data().then(function (data) { out.dispose(); return { w: x.shape[1], h: x.shape[0], data: data, metric: meta.head === "sigmoid" }; });
        },
        dispose: function () {
          Object.keys(w).forEach(function (name) { w[name].dispose(); });
          Object.keys(posCache).forEach(function (k) { posCache[k].dispose(); });
        }
      };
    });
  }

  // The position table (CLS + 37x37) resized to the patch grid - bicubic,
  // as the model does itself for any picture size but its own.
  function cubic(x) {
    var a = -0.75;
    x = Math.abs(x);
    if (x <= 1) return (a + 2) * x * x * x - (a + 3) * x * x + 1;
    if (x < 2) return a * x * x * x - 5 * a * x * x + 8 * a * x - 4 * a;
    return 0;
  }
  function cubicMatrix(nIn, nOut) {
    var m = new Float32Array(nOut * nIn), scale = nIn / nOut;
    for (var o = 0; o < nOut; o++) {
      var s = (o + 0.5) * scale - 0.5, x0 = Math.floor(s), fr = s - x0;
      for (var k = -1; k < 3; k++) m[o * nIn + Math.min(Math.max(x0 + k, 0), nIn - 1)] += cubic(k - fr);
    }
    return tf.tensor(m, [nOut, nIn]);
  }
  function resizedPositions(meta, pos, GH, GW) {
    return tf.tidy(function () {
      var n = meta.posGrid, D = meta.dim;
      var grid = tf.slice(pos, [1, 0], [n * n, D]);
      var rows = tf.reshape(tf.matMul(cubicMatrix(n, GH), tf.reshape(grid, [n, n * D])), [GH, n, D]);
      var cols = tf.matMul(tf.reshape(tf.transpose(rows, [0, 2, 1]), [GH * D, n]), cubicMatrix(n, GW), false, true);
      var both = tf.reshape(tf.transpose(tf.reshape(cols, [GH, D, GW]), [0, 2, 1]), [GH * GW, D]);
      return tf.concat([tf.slice(pos, [0, 0], [1, D]), both], 0);
    });
  }

  function layerNorm(x, g, b, eps) {
    var m = tf.moments(x, -1, true);
    return tf.add(tf.mul(tf.mul(tf.sub(x, m.mean), tf.rsqrt(tf.add(m.variance, eps))), g), b);
  }
  function gelu(x) {
    return tf.mul(tf.mul(x, 0.5), tf.add(tf.erf(tf.mul(x, Math.SQRT1_2)), 1));
  }
  function linear(x, wt, b) {
    return tf.fused.matMul({ a: x, b: wt, bias: b });
  }
  // 3x3 (padding 1) or 1x1 convolution, x [1, H, W, C]
  function conv(x, w, name, bias) {
    var f = w[name + "_w"];
    return tf.fused.conv2d({ x: x, filter: f, strides: 1, pad: "same", bias: bias === false ? undefined : w[name + "_b"] });
  }
  function residual(x, w, name) {
    var y = conv(tf.relu(x), w, name + ".conv1");
    return tf.add(conv(tf.relu(y), w, name + ".conv2"), x);
  }

  function forward(meta, w, x, GH, GW, pos) {
    var P = meta.patch, D = meta.dim, heads = meta.heads, hd = D / heads, eps = meta.eps;
    x = tf.div(tf.sub(x, w.__mean), w.__std);
    var patches = tf.reshape(tf.transpose(tf.reshape(x, [GH, P, GW, P, 3]), [0, 2, 1, 3, 4]), [GH * GW, P * P * 3]);
    var h = tf.add(tf.concat([w.cls, linear(patches, w.patch_w, w.patch_b)], 0), pos);
    var T = GH * GW + 1, scale = 1 / Math.sqrt(hd), feats = [];
    for (var i = 0; i < meta.layers; i++) {
      var p = "l" + i + ".";
      var qkv = linear(layerNorm(h, w[p + "norm1_g"], w[p + "norm1_b"], eps), w[p + "qkv_w"], w[p + "qkv_b"]);
      var split = tf.split(qkv, 3, 1).map(function (t) { return tf.transpose(tf.reshape(t, [T, heads, hd]), [1, 0, 2]); });
      var att = tf.softmax(tf.mul(tf.matMul(split[0], split[1], false, true), scale));
      var o = tf.reshape(tf.transpose(tf.matMul(att, split[2]), [1, 0, 2]), [T, D]);
      h = tf.add(h, tf.mul(linear(o, w[p + "proj_w"], w[p + "proj_b"]), w[p + "ls1"]));
      var y = gelu(linear(layerNorm(h, w[p + "norm2_g"], w[p + "norm2_b"], eps), w[p + "fc1_w"], w[p + "fc1_b"]));
      h = tf.add(h, tf.mul(linear(y, w[p + "fc2_w"], w[p + "fc2_b"]), w[p + "ls2"]));
      if (meta.outLayers.indexOf(i + 1) !== -1) {
        feats.push(tf.reshape(tf.slice(layerNorm(h, w.norm_g, w.norm_b, eps), [1, 0], [GH * GW, D]), [1, GH, GW, D]));
      }
    }
    // each layer's grid brought to 4x, 2x, 1x, 1/2 of the patch grid
    var maps = feats.map(function (f, i) {
      var m = conv(f, w, "r" + i + ".proj"), factor = meta.factors[i];
      if (factor > 1) {
        var C = m.shape[3];
        m = tf.add(tf.conv2dTranspose(m, w["r" + i + ".resize_w"], [1, GH * factor, GW * factor, C], factor, "valid"), w["r" + i + ".resize_b"]);
      } else if (factor < 1) {
        m = tf.fused.conv2d({ x: tf.pad(m, [[0, 0], [1, 1], [1, 1], [0, 0]]), filter: w["r" + i + ".resize_w"], strides: 2, pad: "valid", bias: w["r" + i + ".resize_b"] });
      }
      return conv(m, w, "c" + i, false);
    }).reverse();
    // fused from the coarsest up, each doubled (or brought to the next one's size)
    var fused = null;
    for (var j = 0; j < 4; j++) {
      var hs = fused === null ? maps[0] : tf.add(fused, residual(maps[j], w, "f" + j + ".res1"));
      hs = residual(hs, w, "f" + j + ".res2");
      var size = j < 3 ? [maps[j + 1].shape[1], maps[j + 1].shape[2]] : [hs.shape[1] * 2, hs.shape[2] * 2];
      fused = conv(tf.image.resizeBilinear(hs, size, true), w, "f" + j + ".proj");
    }
    var out = conv(fused, w, "head.conv1");
    out = tf.image.resizeBilinear(out, [GH * P, GW * P], true);
    out = tf.relu(conv(out, w, "head.conv2"));
    out = conv(out, w, "head.conv3");
    // metres (a sigmoid times the furthest it knows), or the plain model's nearness
    out = meta.head === "sigmoid" ? tf.mul(tf.sigmoid(out), meta.maxDepth) : tf.relu(out);
    return tf.reshape(out, [GH * P, GW * P]);
  }

  window.PMCDepth = { load: load };
})();
