// DINOv2 - camera.html's second appearance model, next to OSNet. A person's
// picture in, 384 numbers out (unit length), like OSNet's 512 - but learned
// by Meta from general pictures rather than from photos of people, and
// Apache-2.0 licensed: free for any use, a sold app included.
//
// The model is facebook/dinov2-small (ViT-S/14), converted once into a
// small format of our own for one fixed picture size, 112x224 (a 8x16 grid
// of 14-pixel patches): camera/models/dinov2/dino.json says where each
// weight is in dino.bin; the big matrices are stored as int8 with a scale
// per output column (22 MB instead of 88), everything else as float32. Run
// here on the same TensorFlow.js engine as the pose model and OSNet.
//
// PMCDino.load(baseUrl) -> Promise<model>; model.embed(picture) ->
// Promise<Float32Array(384)>, the picture being camera.html's 128x256
// person crop (ImageData or canvas) - resized to 112x224 here.
(function () {
  "use strict";

  function load(baseUrl) {
    return Promise.all([
      fetch(baseUrl + "dino.json").then(function (r) { if (!r.ok) throw new Error("dino.json " + r.status); return r.json(); }),
      fetch(baseUrl + "dino.bin").then(function (r) { if (!r.ok) throw new Error("dino.bin " + r.status); return r.arrayBuffer(); })
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
      var H = meta.inputShape[1], W = meta.inputShape[2];
      var mean = tf.tensor(meta.mean, [1, 1, 3]), std = tf.tensor(meta.std, [1, 1, 3]);
      w.__mean = mean;
      w.__std = std;
      var model = {
        inputShape: meta.inputShape,
        embed: function (picture) {
          var out = tf.tidy(function () {
            var x = tf.div(tf.cast(tf.browser.fromPixels(picture), "float32"), 255);
            if (x.shape[0] !== H || x.shape[1] !== W) x = tf.image.resizeBilinear(x, [H, W], false, true);
            return forward(meta, w, x);
          });
          return out.data().then(function (data) { out.dispose(); return data; });
        },
        dispose: function () {
          Object.keys(w).forEach(function (name) { w[name].dispose(); });
        },
        // (tests: run on a ready-made [H,W,3] input in 0-1, without the
        // final unit length - the raw CLS token to compare with the original)
        embedTensor: function (x) {
          var out = tf.tidy(function () { return forward(meta, w, x, true); });
          return out.data().then(function (data) { out.dispose(); return data; });
        }
      };
      // The first run compiles every GPU program - done here, so the first
      // real person doesn't wait for it.
      var warm = document.createElement("canvas");
      warm.width = W;
      warm.height = H;
      return model.embed(warm).then(function () { return model; });
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

  // x: [H, W, 3] in 0-1 -> the CLS token after the last layer norm, unit
  // length (raw: as it comes out, for checking against the original).
  function forward(meta, w, x, raw) {
    var P = meta.patch, GH = meta.grid[0], GW = meta.grid[1], D = meta.dim, heads = meta.heads, hd = D / heads, eps = meta.eps;
    x = tf.div(tf.sub(x, w.__mean), w.__std);
    // patches, each flattened (row, column, channel) - the conversion laid
    // the patch weights out the same way
    var patches = tf.reshape(tf.transpose(tf.reshape(x, [GH, P, GW, P, 3]), [0, 2, 1, 3, 4]), [GH * GW, P * P * 3]);
    var h = tf.add(tf.concat([w.cls, linear(patches, w.patch_w, w.patch_b)], 0), w.pos);
    var T = GH * GW + 1, scale = 1 / Math.sqrt(hd);
    for (var i = 0; i < meta.layers; i++) {
      var p = "l" + i + ".";
      var qkv = linear(layerNorm(h, w[p + "norm1_g"], w[p + "norm1_b"], eps), w[p + "qkv_w"], w[p + "qkv_b"]);
      var split = tf.split(qkv, 3, 1).map(function (t) { return tf.transpose(tf.reshape(t, [T, heads, hd]), [1, 0, 2]); });
      var att = tf.softmax(tf.mul(tf.matMul(split[0], split[1], false, true), scale));
      var o = tf.reshape(tf.transpose(tf.matMul(att, split[2]), [1, 0, 2]), [T, D]);
      h = tf.add(h, tf.mul(linear(o, w[p + "proj_w"], w[p + "proj_b"]), w[p + "ls1"]));
      var y = gelu(linear(layerNorm(h, w[p + "norm2_g"], w[p + "norm2_b"], eps), w[p + "fc1_w"], w[p + "fc1_b"]));
      h = tf.add(h, tf.mul(linear(y, w[p + "fc2_w"], w[p + "fc2_b"]), w[p + "ls2"]));
    }
    var cls = tf.slice(layerNorm(h, w.norm_g, w.norm_b, eps), [0, 0], [1, D]).reshape([D]);
    return raw ? cls : tf.div(cls, tf.norm(cls));
  }

  window.PMCDino = { load: load };
})();
