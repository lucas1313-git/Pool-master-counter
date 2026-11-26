// js/lib/score-bug.js
// The score bug - a clip's caption, laid over the bottom left of the video: two lines on a
// dark rounded card with a gold edge, "Kim  5 – 3  Jo" then "9-Ball · Race to 7 · 9:41 PM",
// the words shrunk to fit. Drawn here (the Mac's ffmpeg has no text filter), as a PNG for
// server/reel.js - ✨ Tonight's highlights (js/app.js) and 🎞 One video of the checked cues
// (js/cue-viewer.js). And the score card 🎞 One video shows after each winning shot (card).
(function (root) {
  "use strict";

  var FONT = "-apple-system, system-ui, 'Segoe UI', Roboto, sans-serif";
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  // s centred on cx at baseline y, its font px tall at most - smaller until it fits in maxW
  function centred(ctx, s, cx, y, px, weight, maxW) {
    var size = px;
    ctx.font = weight + " " + size + "px " + FONT;
    while (size > 8 && ctx.measureText(s).width > maxW) {
      size -= 1;
      ctx.font = weight + " " + size + "px " + FONT;
    }
    ctx.textAlign = "center";
    ctx.fillText(s, cx, y);
    ctx.textAlign = "start";
  }

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


  // 🏆 The score card between the winning shots of 🎞 One video (2026-11-26, the user: "in
  // between every win, after the most recent one, a quick fade in fade out of the score card, as
  // a transition. this way we can see the progress. if possible when there is a race-to win, the
  // transition could even be the winning window"): the score once it was won, big - a panel a
  // side, the winner's edged in gold, its number gold - on the board's red felt with its gold
  // edge; the race won: the race-won screen's look above it (🎉🏆🎉, Congratulations!, who won).
  // card: { title ("8-Ball · Race to 7"), sides [{ name, value }] (the winner's first), foot
  // ("9:41 PM"), won: { congrats, headline } or null }; w wide -> its height
  function cardHeight(card, w) {
    return Math.round(w * (card.won ? 0.74 : 0.5));
  }
  function drawCard(ctx, x, y, w, card) {
    var h = cardHeight(card, w), pad = Math.round(w * 0.05), edge = Math.max(3, Math.round(w * 0.005));
    ctx.save();
    roundRect(ctx, x + edge / 2, y + edge / 2, w - edge, h - edge, Math.round(w * 0.035));
    var bg = ctx.createLinearGradient(0, y, 0, y + h);
    bg.addColorStop(0, "#8a1a1f");
    bg.addColorStop(0.6, "#5c0f14");
    bg.addColorStop(1, "#3a1212");
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.lineWidth = edge;
    ctx.strokeStyle = "#e8b923";
    ctx.stroke();
    ctx.textBaseline = "alphabetic";
    var cx = x + w / 2, at = y + pad, inner = w - pad * 2;
    if (card.won) {
      ctx.fillStyle = "#ffffff";
      centred(ctx, "🎉🏆🎉", cx, at + w * 0.075, Math.round(w * 0.075), "400", inner);
      ctx.fillStyle = "#f6efe9";
      centred(ctx, card.won.congrats, cx, at + w * 0.15, Math.round(w * 0.06), "800", inner);
      centred(ctx, card.won.headline, cx, at + w * 0.205, Math.round(w * 0.034), "600", inner);
      at += w * 0.24;
    }
    ctx.fillStyle = "#e8b923";
    centred(ctx, card.title || "", cx, at + w * 0.04, Math.round(w * 0.038), "700", inner);
    // the panels
    var n = Math.max(1, card.sides.length), gap = Math.round(w * (n === 2 ? 0.05 : 0.03));
    var pw = (inner - gap * (n - 1)) / n, ph = Math.round(w * 0.25), py = at + w * 0.075;
    card.sides.forEach(function (sd, i) {
      var px = x + pad + i * (pw + gap), win = i === 0;
      roundRect(ctx, px, py, pw, ph, Math.round(w * 0.022));
      ctx.fillStyle = win ? "rgba(232, 185, 35, 0.16)" : "rgba(0, 0, 0, 0.3)";
      ctx.fill();
      if (win) {
        ctx.lineWidth = Math.max(3, Math.round(w * 0.006));
        ctx.strokeStyle = "#ffd23f";
        ctx.stroke();
      }
      ctx.fillStyle = "#ffffff";
      centred(ctx, sd.name, px + pw / 2, py + ph * 0.28, Math.round(ph * 0.19), "800", pw - ph * 0.16);
      ctx.fillStyle = win ? "#ffd23f" : "#f6efe9";
      centred(ctx, sd.value === null || sd.value === undefined ? "–" : String(sd.value), px + pw / 2, py + ph * 0.86, Math.round(ph * 0.54), "800", pw - ph * 0.16);
    });
    if (card.foot) {
      ctx.fillStyle = "#c9a2a2";
      centred(ctx, card.foot, cx, py + ph + w * 0.06, Math.round(w * 0.03), "600", inner);
    }
    ctx.restore();
    return h;
  }
  // how wide on a frame frameW wide: half a wide video, most of a tall one
  function cardWidth(aspect, frameW) {
    return Math.round(frameW * (aspect === "9:16" ? 0.88 : 0.5));
  }
  // as a PNG data URL, w wide (see the clear corners: the video shows through)
  function cardPng(card, w) {
    var c = document.createElement("canvas");
    c.width = w;
    c.height = cardHeight(card, w);
    drawCard(c.getContext("2d"), 0, 0, w, card);
    return c.toDataURL("image/png");
  }

  var api = { draw: draw, width: width, png: png, drawCard: drawCard, cardWidth: cardWidth, cardPng: cardPng };
  root.PMCLib = root.PMCLib || {};
  root.PMCLib.scoreBug = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
