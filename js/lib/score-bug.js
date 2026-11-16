// js/lib/score-bug.js
// The score bug - a clip's caption, laid over the bottom left of the video: two lines on a
// dark rounded card with a gold edge, "Kim  5 – 3  Jo" then "9-Ball · Race to 7 · 9:41 PM",
// the words shrunk to fit. Drawn here (the Mac's ffmpeg has no text filter), as a PNG for
// server/reel.js - ✨ Tonight's highlights (js/app.js) and 🎞 One video of the checked cues
// (js/cue-viewer.js).
(function (root) {
  "use strict";

  // At (x, y), w wide (a fifth of that tall). text: { top, bottom } -> its height
  function draw(ctx, x, y, w, text) {
    var h = Math.round(w * 0.2), r = Math.round(h * 0.18), pad = Math.round(h * 0.2);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.fillStyle = "rgba(14, 10, 8, 0.86)";
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.fillStyle = "#ffd23f";
    ctx.fillRect(x, y, Math.max(4, Math.round(h * 0.07)), h);
    ctx.restore();
    var fit = function (s, px, weight) {
      var size = px;
      ctx.font = weight + " " + size + "px -apple-system, system-ui, 'Segoe UI', Roboto, sans-serif";
      while (size > 8 && ctx.measureText(s).width > w - pad * 2) {
        size -= 1;
        ctx.font = weight + " " + size + "px -apple-system, system-ui, 'Segoe UI', Roboto, sans-serif";
      }
    };
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#ffffff";
    fit(text.top, Math.round(h * 0.4), "800");
    ctx.fillText(text.top, x + pad, y + Math.round(h * 0.5));
    if (text.bottom) {
      ctx.fillStyle = "#ffd23f";
      fit(text.bottom, Math.round(h * 0.25), "700");
      ctx.fillText(text.bottom, x + pad, y + Math.round(h * 0.84));
    }
    ctx.restore();
    return h;
  }
  // how wide on a frame frameW wide: a third of a wide video, most of a tall one
  function width(aspect, frameW) {
    return Math.round(frameW * (aspect === "9:16" ? 0.7 : 0.36));
  }
  // as a PNG data URL, w wide
  function png(text, w) {
    var c = document.createElement("canvas");
    c.width = w;
    c.height = Math.round(w * 0.2);
    draw(c.getContext("2d"), 0, 0, w, text);
    return c.toDataURL("image/png");
  }

  var api = { draw: draw, width: width, png: png };
  root.PMCLib = root.PMCLib || {};
  root.PMCLib.scoreBug = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
