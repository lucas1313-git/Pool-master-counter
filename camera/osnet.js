// OSNet - camera.html's appearance model. A person's picture in, 512 numbers
// out (unit length): two pictures of the same person come out close by
// cosine distance whatever their posture or the lighting, two different
// people far apart - learned from thousands of people, unlike the colour
// counts camera.html computes itself.
//
// The model is Qualcomm AI Hub's OSNet export (osnet_x1_0, trained on
// Market-1501; export MIT-licensed), converted once into a small format of
// our own - camera/models/osnet/osnet.json (the graph as a flat list of
// ops, NHWC, weights already in TensorFlow.js layout) and osnet.bin (every
// weight as float16) - and run here on the same TensorFlow.js engine the
// pose model already uses, so there's no second runtime to load.
//
// PMCOsnet.load(baseUrl) -> Promise<model>; model.embed(canvas) ->
// Promise<Float32Array(512)>, the canvas being a 128x256 person crop.
(function () {
  "use strict";

  var HALF_TABLE = null;
  function halfToFloatTable() {
    if (HALF_TABLE) return HALF_TABLE;
    HALF_TABLE = new Float32Array(65536);
    for (var h = 0; h < 65536; h++) {
      var sign = h & 0x8000 ? -1 : 1, exp = (h & 0x7c00) >> 10, frac = h & 0x03ff;
      HALF_TABLE[h] = sign * (exp === 0 ? frac * Math.pow(2, -24) : exp === 31 ? (frac ? NaN : Infinity) : (1 + frac / 1024) * Math.pow(2, exp - 15));
    }
    return HALF_TABLE;
  }

  function load(baseUrl) {
    return Promise.all([
      fetch(baseUrl + "osnet.json").then(function (r) { if (!r.ok) throw new Error("osnet.json " + r.status); return r.json(); }),
      fetch(baseUrl + "osnet.bin").then(function (r) { if (!r.ok) throw new Error("osnet.bin " + r.status); return r.arrayBuffer(); })
    ]).then(function (parts) {
      var graph = parts[0], halves = new Uint16Array(parts[1]), table = halfToFloatTable();
      var weights = {};
      graph.weights.forEach(function (w) {
        var size = w.shape.reduce(function (a, b) { return a * b; }, 1);
        var data = new Float32Array(size);
        for (var i = 0; i < size; i++) data[i] = table[halves[w.offset + i]];
        weights[w.name] = tf.tensor(data, w.shape);
      });
      var ops = fuseActivations(graph.ops);
      var model = {
        inputShape: graph.inputShape,
        embed: function (canvas) {
          var out = tf.tidy(function () {
            var x = tf.div(tf.cast(tf.browser.fromPixels(canvas), "float32"), 255).expandDims(0);
            return run(ops, weights, graph.input, graph.output, x);
          });
          return out.data().then(function (data) { out.dispose(); return data; });
        },
        dispose: function () {
          Object.keys(weights).forEach(function (name) { weights[name].dispose(); });
        },
        // (tests: run on a ready-made [1,256,128,3] input)
        embedTensor: function (x) {
          var out = tf.tidy(function () { return run(ops, weights, graph.input, graph.output, x); });
          return out.data().then(function (data) { out.dispose(); return data; });
        }
      };
      // The first run compiles every GPU program - done here, so the first
      // real person doesn't wait for it.
      var warm = document.createElement("canvas");
      warm.width = graph.inputShape[2];
      warm.height = graph.inputShape[1];
      return model.embed(warm).then(function () { return model; });
    });
  }

  // A conv whose output only feeds the ReLU right after it runs as one
  // fused op (conv + bias + ReLU in a single GPU pass).
  function fuseActivations(ops) {
    var uses = {};
    ops.forEach(function (o) {
      [o["in"], o.a, o.b].forEach(function (name) { if (typeof name === "string") uses[name] = (uses[name] || 0) + 1; });
    });
    var out = [];
    for (var i = 0; i < ops.length; i++) {
      var o = ops[i], next = ops[i + 1];
      if (o.op === "conv" && next && next.op === "relu" && next["in"] === o.out && uses[o.out] === 1) {
        out.push(Object.assign({}, o, { out: next.out, activation: "relu" }));
        i++;
      } else {
        out.push(o);
      }
    }
    return out;
  }

  function run(ops, weights, inputName, outputName, x) {
    var vals = {};
    vals[inputName] = x;
    var arg = function (o, which) { return o[which + "Const"] ? weights[o[which]] : vals[o[which]]; };
    ops.forEach(function (o) {
      var input = vals[o["in"]], y;
      switch (o.op) {
        case "conv":
          var pad = o.pad === 0 ? "valid" : o.pad;
          y = (o.depthwise ? tf.fused.depthwiseConv2d : tf.fused.conv2d)({
            x: input, filter: weights[o.w], strides: o.stride, pad: pad,
            bias: o.b ? weights[o.b] : undefined, activation: o.activation || "linear"
          });
          break;
        case "relu": y = tf.relu(input); break;
        case "sigmoid": y = tf.sigmoid(input); break;
        case "add": y = tf.add(arg(o, "a"), arg(o, "b")); break;
        case "mul": y = tf.mul(arg(o, "a"), arg(o, "b")); break;
        case "sub": y = tf.sub(arg(o, "a"), arg(o, "b")); break;
        case "div": y = tf.div(arg(o, "a"), arg(o, "b")); break;
        case "gap": y = tf.mean(input, [1, 2], true); break;
        case "maxpool": y = tf.maxPool(input, o.k, o.stride, o.pad === 0 ? "valid" : o.pad); break;
        case "avgpool": y = tf.avgPool(input, o.k, o.stride, "valid"); break;
        case "flatten": y = tf.reshape(input, [input.shape[0], -1]); break;
        case "dense": y = tf.add(tf.matMul(input, weights[o.w]), weights[o.b]); break;
        case "l2norm": y = tf.sqrt(tf.sum(tf.square(input), 1, true)); break;
        case "clipmin": y = tf.maximum(input, o.min); break;
        case "identity": y = input; break;
        default: throw new Error("osnet: unknown op " + o.op);
      }
      vals[o.out] = y;
    });
    return vals[outputName];
  }

  window.PMCOsnet = { load: load };
})();
