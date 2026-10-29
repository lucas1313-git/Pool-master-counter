// Works out each theme's colours for what's read from across the room (the + sign's button, the
// score digits, the names, the card's label, the board's line - and the card's own background
// where nothing could read on it): the nearest shade of the theme's own colour reaching 7:1 (WCAG)
// and APCA Lc 75, with a small margin. Prints a table and writes the CSS block that goes after the
// themes in css/style.css ("Readable across the room, per theme"); tests/probe_legibility.js
// checks the result in the browser.
// usage: node tests/legible_colors.js <out.css>
const fs = require("fs");
const css = fs.readFileSync(require("path").join(__dirname, "..", "css", "style.css"), "utf8");
function block(sel) { const i = css.indexOf(sel + " {"); if (i < 0) return {}; const j = css.indexOf("}", i); const out = {}; css.slice(i, j).replace(/((?:--)?[a-z-]+):\s*([^;{}]+);/g, (_, k, v) => { out[k] = v.trim(); }); return out; }
const base = block(":root");
// (each theme once; its first block is its own definition - the generated ones come after)
const themes = ["crimson-felt"].concat([...css.matchAll(/^:root\[data-theme="([a-z-]+)"\] \{/gm)].map((m) => m[1])).filter((v, i, a) => a.indexOf(v) === i);
const hex = (c) => { c = (c || "").trim(); if (/^#[0-9a-f]{3}$/i.test(c)) c = "#" + c.slice(1).split("").map((x) => x + x).join(""); const m = /^#([0-9a-f]{6})$/i.exec(c); return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) : null; };
const toHex = (rgb) => "#" + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
const lum = (rgb) => rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
function apca(txt, bg) {
  const sY = (c) => c.map((v) => Math.pow(v / 255, 2.4)).reduce((a, v, i) => a + v * [0.2126729, 0.7151522, 0.0721750][i], 0);
  let Yt = sY(txt), Yb = sY(bg); const bc = 0.022, bce = 1.414;
  Yt = Yt > bc ? Yt : Yt + Math.pow(bc - Yt, bce); Yb = Yb > bc ? Yb : Yb + Math.pow(bc - Yb, bce);
  let S;
  if (Yb > Yt) { S = (Math.pow(Yb, 0.56) - Math.pow(Yt, 0.57)) * 1.14; return S < 0.1 ? 0 : (S - 0.027) * 100; }
  S = (Math.pow(Yb, 0.65) - Math.pow(Yt, 0.62)) * 1.14; return S > -0.1 ? 0 : (S + 0.027) * 100;
}
const ok = (fg, bgs) => bgs.every((b) => ratio(fg, b) >= 7.15 && Math.abs(apca(fg, b)) >= 76.5); // (a margin for the hex rounding and the browser's own colour mixing)
const mix = (a, b, t) => a.map((v, i) => v * t + b[i] * (1 - t));
function rgb2hsl([r, g, b]) { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b); let h = 0, s = 0; const l = (mx + mn) / 2; if (mx !== mn) { const d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h /= 6; } return [h, s, l]; }
function hsl2rgb([h, s, l]) { if (!s) return [l * 255, l * 255, l * 255]; const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q; const f = (t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; }; return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255]; }
// the nearest shade of col (same hue) that reads on every bg - lighter or darker, whichever is closer
function shade(col, bgs) {
  if (ok(col, bgs)) return col;
  const [h, s, l] = rgb2hsl(col);
  for (let d = 0.01; d <= 1; d += 0.01) {
    for (const nl of [l + d, l - d]) { if (nl < 0 || nl > 1) continue; const c = hsl2rgb([h, s, nl]); if (ok(c, bgs)) return c; }
  }
  return null;
}
// a background (same hue as col) for a white sign
function darkFor(col) {
  const [h, s, l] = rgb2hsl(col);
  for (let nl = l; nl >= 0; nl -= 0.01) { const c = hsl2rgb([h, s, nl]); if (ok([255, 255, 255], [c])) return c; }
  return null;
}
const out = [], report = [];
for (const t of themes) {
  const tok = Object.assign({}, base, t === "crimson-felt" ? {} : block(':root[data-theme="' + t + '"]'));
  const get = (k) => { let v = tok[k]; let g = 0; while (v && /^var\(/.test(v) && g++ < 5) v = tok[v.slice(4, -1).split(",")[0].trim()]; return hex(v); };
  const light = /light/.test(tok["color-scheme"] || "");
  const felt = get("--felt"), glow = get("--bg-glow"), fl = get("--felt-light"), acc = get("--accent"), text = get("--text"), dim = get("--text-dim"), bg = get("--bg");
  // the card's own background (its gradient's two ends, and the shooter's tint over it): where
  // nothing can read on it, a shade further from the text (darker on a dark theme)
  let top = felt, bottom = glow, score, name, label, cardBgs;
  for (let step = 0; step < 60; step++) {
    cardBgs = [top, bottom, mix(acc, top, 0.12)];
    score = shade(acc, cardBgs); name = shade(text, cardBgs); label = shade(dim, cardBgs);
    if (score && name && label) break;
    const nudge = (c) => { const [h, s, l] = rgb2hsl(c); return hsl2rgb([h, s, Math.max(0, Math.min(1, l + (light ? 0.02 : -0.02)))]); };
    top = nudge(top); bottom = nudge(bottom);
  }
  const plusBg = darkFor(light ? acc : fl);
  const status = shade(text, [bg, glow]);
  const vals = { "--plus-bg": plusBg, "--plus-fg": [255, 255, 255], "--score-fg": score, "--card-text": name, "--card-label": label, "--board-text": status };
  const lines = [];
  for (const k in vals) { if (!vals[k]) { console.error("NO SHADE", t, k); continue; } }
  // only what differs from the theme's own token (the defaults below point at it)
  if (toHex(top) !== toHex(felt)) lines.push("  --card-top: " + toHex(top) + ";");
  if (toHex(bottom) !== toHex(glow)) lines.push("  --card-bottom: " + toHex(bottom) + ";");
  if (toHex(plusBg) !== toHex(fl)) lines.push("  --plus-bg: " + toHex(plusBg) + ";");
  if (toHex(score) !== toHex(acc)) lines.push("  --score-fg: " + toHex(score) + ";");
  if (toHex(name) !== toHex(text)) lines.push("  --card-text: " + toHex(name) + ";");
  if (toHex(label) !== toHex(dim)) lines.push("  --card-label: " + toHex(label) + ";");
  if (toHex(status) !== toHex(text)) lines.push("  --board-text: " + toHex(status) + ";");
  report.push({ t, card: toHex(felt) === toHex(top) ? "" : toHex(felt) + "→" + toHex(top), plus: toHex(fl) + "→" + toHex(plusBg) + " " + ratio([255, 255, 255], plusBg).toFixed(1), score: toHex(acc) + "→" + toHex(score), name: toHex(text) + "→" + toHex(name), label: toHex(dim) + "→" + toHex(label), status: toHex(text) + "→" + toHex(status) });
  if (lines.length) out.push((t === "crimson-felt" ? ":root:not([data-theme]),\n:root[data-theme=\"crimson-felt\"]" : ':root[data-theme="' + t + '"]') + " {\n" + lines.join("\n") + "\n}");
}
console.table(report);
fs.writeFileSync(process.argv[2], out.join("\n") + "\n");
