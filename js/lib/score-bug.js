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
  // edge, "Luc won!" on top ("in top of the score card I would like to see [player name/ team]
  // won!"); the race won: the race-won screen's look above it (🎉🏆🎉, Congratulations!, who won).
  // card: { head ("Luc won!"), title ("8-Ball · Race to 7"), sides [{ name, value }] (the winner's
  // first), from (the winner's number before the win - it rolls from that to its value: see
  // cardParts), foot ("9:41 PM"), won: { congrats, headline } or null }; w wide
  function cardHeight(card, w) {
    return Math.round(w * (card.won ? 0.74 : card.head ? 0.58 : 0.5));
  }
  // -> { h, box (the winner's number: { x, y, w, h }), panel (the winner's: { x, y, w, h, r }) };
  // bare: the winner's number left out (it rolls in over it)
  function drawCard(ctx, x, y, w, card, bare) {
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
    } else if (card.head) {
      ctx.fillStyle = "#ffffff";
      centred(ctx, card.head, cx, at + w * 0.055, Math.round(w * 0.062), "800", inner);
      at += w * 0.08;
    }
    ctx.fillStyle = "#e8b923";
    centred(ctx, card.title || "", cx, at + w * 0.04, Math.round(w * 0.038), "700", inner);
    // the panels
    var n = Math.max(1, card.sides.length), gap = Math.round(w * (n === 2 ? 0.05 : 0.03));
    var pw = (inner - gap * (n - 1)) / n, ph = Math.round(w * 0.25), py = at + w * 0.075, out = { h: h };
    card.sides.forEach(function (sd, i) {
      var px = x + pad + i * (pw + gap), win = i === 0, r = Math.round(w * 0.022);
      roundRect(ctx, px, py, pw, ph, r);
      ctx.fillStyle = win ? "rgba(232, 185, 35, 0.16)" : "rgba(0, 0, 0, 0.3)";
      ctx.fill();
      if (win) {
        ctx.lineWidth = Math.max(3, Math.round(w * 0.006));
        ctx.strokeStyle = "#ffd23f";
        ctx.stroke();
        out.panel = { x: Math.round(px), y: Math.round(py), w: Math.round(pw), h: ph, r: r };
        out.box = { x: Math.round(px + ph * 0.06), y: Math.round(py + ph * 0.36), w: Math.round(pw - ph * 0.12), h: Math.round(ph * 0.6) };
      }
      ctx.fillStyle = "#ffffff";
      centred(ctx, sd.name, px + pw / 2, py + ph * 0.28, Math.round(ph * 0.19), "800", pw - ph * 0.16);
      if (win && bare) return;
      ctx.fillStyle = win ? "#ffd23f" : "#f6efe9";
      centred(ctx, valueText(sd.value), px + pw / 2, py + ph * 0.86, Math.round(ph * 0.54), "800", pw - ph * 0.16);
    });
    if (card.foot) {
      ctx.fillStyle = "#c9a2a2";
      centred(ctx, card.foot, cx, py + ph + w * 0.06, Math.round(w * 0.03), "600", inner);
    }
    ctx.restore();
    return out;
  }
  function valueText(v) { return v === null || v === undefined ? "–" : String(v); }
  // how wide on a frame frameW wide: half a wide video, most of a tall one
  function cardWidth(aspect, frameW) {
    return Math.round(frameW * (aspect === "9:16" ? 0.88 : 0.5));
  }
  function canvasOf(w, h) {
    var c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    return c;
  }
  // as a PNG data URL, w wide (see the clear corners: the video shows through)
  function cardPng(card, w) {
    var c = canvasOf(w, cardHeight(card, w));
    drawCard(c.getContext("2d"), 0, 0, w, card);
    return c.toDataURL("image/png");
  }
  // The card in pieces, for the old score to turn into the new one as it shows ("I would like to
  // see the score board change from old score to new score with a visual effect when the score
  // card show"): the card without the winner's number; the strip its number rolls up (the old
  // one above the new - server/reel.js shows a box of it, moving down), where (x, y, w, h - in
  // the card), and the gold glow its panel flashes as the new one lands (fx, fy). No number
  // before (card.from null - a points game): the card whole, no roll.
  // -> { card (PNG data URL), roll: { strip, flash (PNG data URLs), x, y, w, h, fx, fy } or null }
  function cardParts(card, w) {
    var rolls = typeof card.from === "number" && card.from !== card.sides[0].value;
    var c = canvasOf(w, cardHeight(card, w)), at = drawCard(c.getContext("2d"), 0, 0, w, card, rolls);
    if (!rolls || !at.box) return { card: c.toDataURL("image/png"), roll: null };
    var b = at.box, p = at.panel, ph = p.h;
    // the strip: the old number, the new one under it - drawn where the card has them
    var st = canvasOf(b.w, b.h * 2), sx = st.getContext("2d"), base = p.y + ph * 0.86 - b.y;
    sx.textBaseline = "alphabetic";
    sx.fillStyle = "#ffd23f";
    centred(sx, valueText(card.from), b.w / 2, base, Math.round(ph * 0.54), "800", p.w - ph * 0.16);
    centred(sx, valueText(card.sides[0].value), b.w / 2, b.h + base, Math.round(ph * 0.54), "800", p.w - ph * 0.16);
    // the flash: the panel's edge, glowing
    var m = Math.round(ph * 0.22), fl = canvasOf(p.w + m * 2, p.h + m * 2), fx = fl.getContext("2d");
    fx.shadowColor = "#ffd23f";
    fx.shadowBlur = m * 0.8;
    fx.lineWidth = Math.max(4, Math.round(w * 0.01));
    fx.strokeStyle = "#fff3b0";
    roundRect(fx, m, m, p.w, p.h, p.r);
    fx.stroke();
    fx.stroke();
    fx.fillStyle = "rgba(255, 210, 63, 0.18)";
    fx.fill();
    return { card: c.toDataURL("image/png"), roll: { strip: st.toDataURL("image/png"), flash: fl.toDataURL("image/png"), x: b.x, y: b.y, w: b.w, h: b.h, fx: p.x - m, fy: p.y - m } };
  }

  var api = { draw: draw, width: width, png: png, drawCard: drawCard, cardWidth: cardWidth, cardPng: cardPng, cardParts: cardParts };
  root.PMCLib = root.PMCLib || {};
  root.PMCLib.scoreBug = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
