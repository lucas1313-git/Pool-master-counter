// Room labels - camera.html's "what is that?" for the empty-room snapshot:
// every 14-pixel patch of it gets one of ADE20K's 150 kinds of thing (wall,
// floor, chair, armchair, sofa, rug, lamp, painting, mirror, television,
// pool table...), so the camera can tag the room's chairs, carpets and
// everything else once, and keep them in mind.
//
// The model is Meta's ADE20K linear head for DINOv2 ViT-S/14 (Apache-2.0)
// on the DINOv2 the camera page already has (camera/models/dinov2: the same
// backbone, read from its dino.bin); camera/models/segment/ adds only what
// that one lacks for whole-room pictures - the model's own 37x37 position
// table (resized here, bicubic, for any picture size, as in camera/depth.js)
// and the head, a 384 -> 150 matrix. Run on the same TensorFlow.js engine
// as the pose model.
//
// PMCSegment.load(dinoBaseUrl, segmentBaseUrl) -> Promise<model>;
// model.label(picture, { gridW }) -> Promise<{ gw, gh, labels: Uint8Array,
// conf: Float32Array, classes }>: per patch, row by row, the most likely
// class (an index into classes) and how sure (0-1). The picture (canvas,
// image or video) is resized to gridW x (its shape) patches first.
(function () {
  "use strict";

  function fetchJson(url) {
    return fetch(url).then(function (r) { if (!r.ok) throw new Error(url + " " + r.status); return r.json(); });
  }
  function fetchBin(url) {
    return fetch(url).then(function (r) { if (!r.ok) throw new Error(url + " " + r.status); return r.arrayBuffer(); });
  }
  function readWeights(meta, buf, w, skip) {
    meta.weights.forEach(function (e) {
      if (skip && skip.indexOf(e.name) !== -1) return;
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
  }

  function load(dinoBase, segBase) {
    return Promise.all([
      fetchJson(dinoBase + "dino.json"), fetchBin(dinoBase + "dino.bin"),
      fetchJson(segBase + "segment.json"), fetchBin(segBase + "segment.bin")
    ]).then(function (parts) {
      var dmeta = parts[0], smeta = parts[2], w = {};
      readWeights(dmeta, parts[1], w, ["pos"]); // (its position table is for person crops)
      readWeights(smeta, parts[3], w);
      var meta = { patch: dmeta.patch, dim: dmeta.dim, heads: dmeta.heads, layers: dmeta.layers, eps: dmeta.eps, posGrid: smeta.posGrid };
      w.__mean = tf.tensor(dmeta.mean, [1, 1, 3]);
      w.__std = tf.tensor(dmeta.std, [1, 1, 3]);
      var posCache = {};
      function run(x) {
        var GH = x.shape[0] / meta.patch, GW = x.shape[1] / meta.patch, key = GH + "x" + GW;
        if (!posCache[key]) posCache[key] = tf.keep(resizedPositions(meta, w.pos, GH, GW));
        return forward(meta, w, x, GH, GW, posCache[key]);
      }
      function finish(logits, gw, gh) {
        var probs = tf.softmax(logits);
        var best = tf.argMax(probs, 1), sure = tf.max(probs, 1);
        logits.dispose(); probs.dispose();
        return Promise.all([best.data(), sure.data()]).then(function (d) {
          best.dispose(); sure.dispose();
          return { gw: gw, gh: gh, labels: Uint8Array.from(d[0]), conf: Float32Array.from(d[1]), classes: smeta.classes };
        });
      }
      return {
        classes: smeta.classes,
        label: function (picture, opts) {
          var gw = (opts && opts.gridW) || 46;
          var pw = picture.videoWidth || picture.naturalWidth || picture.width, ph = picture.videoHeight || picture.naturalHeight || picture.height;
          var gh = Math.max(4, Math.round(gw * ph / pw));
          var logits = tf.tidy(function () {
            var x = tf.div(tf.cast(tf.browser.fromPixels(picture), "float32"), 255);
            if (x.shape[0] !== gh * meta.patch || x.shape[1] !== gw * meta.patch) x = tf.image.resizeBilinear(x, [gh * meta.patch, gw * meta.patch], false, true);
            return run(x);
          });
          return finish(logits, gw, gh);
        },
        // (tests: the raw scores for a ready-made [H, W, 3] input in 0-1)
        logitsTensor: function (x) {
          var out = tf.tidy(function () { return run(x); });
          return out.data().then(function (data) { out.dispose(); return data; });
        },
        dispose: function () {
          Object.keys(w).forEach(function (name) { w[name].dispose(); });
          Object.keys(posCache).forEach(function (k) { posCache[k].dispose(); });
        }
      };
    });
  }

  // The position table (CLS + 37x37) resized to the patch grid - bicubic,
  // as the model does itself for any picture size but its own (as in
  // camera/depth.js).
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

  // x: [H, W, 3] in 0-1 -> [GH * GW, classes] scores per patch
  function forward(meta, w, x, GH, GW, pos) {
    var P = meta.patch, D = meta.dim, heads = meta.heads, hd = D / heads, eps = meta.eps;
    x = tf.div(tf.sub(x, w.__mean), w.__std);
    var patches = tf.reshape(tf.transpose(tf.reshape(x, [GH, P, GW, P, 3]), [0, 2, 1, 3, 4]), [GH * GW, P * P * 3]);
    var h = tf.add(tf.concat([w.cls, linear(patches, w.patch_w, w.patch_b)], 0), pos);
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
    var tokens = tf.slice(layerNorm(h, w.norm_g, w.norm_b, eps), [1, 0], [GH * GW, D]);
    return linear(tokens, w.head_w, w.head_b);
  }

  window.PMCSegment = { load: load };
})();
