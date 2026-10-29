// Readable across the room (P14). Kim, Jo, Ann, Bob racing to 5 on the board at 1180x820:
// - every theme: the + sign on its button, the score digits, the names and the card's label reach
//   7:1 (WCAG) and APCA Lc 75 against what they sit on (both ends of the card's gradient, and the
//   shooter's tinted card too);
// - score digits at least 130 CSS px tall (25 mm on an 11-inch iPad) with 4 players;
// - no text under 14 px on the board; the label says RACKS, "2 / 5" in a race; a long name stays
//   on one line;
// - Practice (not saved): asked before it goes on (No leaves it off), then PRACTICE · NOT SAVED
//   stays on the board; on the full page the switch is in Current Session, not above the board;
// - 🔊 Sounds: Off - a rack won makes no sound; Wins only - the win sounds, a point in Straight
//   Pool doesn't; All - the point too; everything goes out through the volume (30% -> 0.3);
// - the roster's × : gone, with ↩ Undo in the toast - Undo brings the player back with their wins;
// - a toast on the board covers no control (it sits over the top bar's line);
// - no page errors.
// Its own file server on 4267.
// usage: node tests/probe_legibility.js [screenshot dir]
const puppeteer = require("puppeteer-core");
const http = require("http");
const fs = require("fs");
const path = require("path");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const REPO = path.join(__dirname, "..");
const PORT = 4267, BASE = "http://localhost:" + PORT + "/";
const OUT = process.argv[2];
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra).slice(0, 1200) : "")); if (!ok) fails++; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const THEMES = ["crimson-felt", "emerald-rail", "neon-arcade", "midnight-ivory", "sunset-chalk", "obsidian-break", "sunset-blaze", "red-and-pink", "gold-mine", "rock-and-roll", "copper-shine", "daybreak-chalk", "pearl-lounge", "sunrise-glow", "stainless-steel", "opal-shimmer", "flowery-forest", "blackout-contrast", "paper-contrast"];

function board(opts) {
  opts = opts || {};
  return JSON.stringify({
    players: [{ id: "k", name: opts.longName ? "Maximilian Alexander-Fitzgerald" : "Kim", playing: true, balls: 0 }, { id: "j", name: "Jo", playing: true, balls: 0 }, { id: "a", name: "Ann", playing: opts.two ? false : true, balls: 0 }, { id: "b", name: "Bob", playing: opts.two ? false : true, balls: 0 }],
    playerWins: { k: 2, j: 1 }, teamWins: {}, teamMvpWins: {}, gameHistory: [], gamesPlayedCount: 3,
    currentGame: Object.assign({ gameType: "8ball", target: 1, unit: "rack", mode: "individual" }, opts.game || {}), raceToWinsTarget: 5, rotation: { enabled: false, order: [], every: 1 }
  });
}

// (in the page) the colours read from across the room, against what they sit on
function measureContrast() {
  const parse = (s) => {
    const out = [];
    (s || "").replace(/rgba?\(([^)]+)\)|color\(srgb ([^)]+)\)/g, (m, rgb, srgb) => {
      if (rgb) { const v = rgb.split(/[ ,/]+/).filter(Boolean).map(Number); if ((v[3] === undefined || v[3] > 0.5)) out.push(v.slice(0, 3)); }
      else { const v = srgb.split(/[ /]+/).filter(Boolean).map(Number); out.push(v.slice(0, 3).map((x) => Math.round(x * 255))); }
    });
    return out;
  };
  const lum = (c) => c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const apca = (txt, bg) => {
    const sY = (c) => c.map((v) => Math.pow(v / 255, 2.4)).reduce((a, v, i) => a + v * [0.2126729, 0.7151522, 0.0721750][i], 0);
    let Yt = sY(txt), Yb = sY(bg); const bc = 0.022, bce = 1.414;
    Yt = Yt > bc ? Yt : Yt + Math.pow(bc - Yt, bce); Yb = Yb > bc ? Yb : Yb + Math.pow(bc - Yb, bce);
    let S;
    if (Yb > Yt) { S = (Math.pow(Yb, 0.56) - Math.pow(Yt, 0.57)) * 1.14; return S < 0.1 ? 0 : (S - 0.027) * 100; }
    S = (Math.pow(Yb, 0.65) - Math.pow(Yt, 0.62)) * 1.14; return S > -0.1 ? 0 : (S + 0.027) * 100;
  };
  const worst = (fg, bgs) => ({ ratio: Math.min(...bgs.map((b) => ratio(fg, b))), lc: Math.min(...bgs.map((b) => Math.abs(apca(fg, b)))) });
  const cards = [...document.querySelectorAll("#scoreboard .player-panel")];
  const cardBgs = (c) => { const cs = getComputedStyle(c); const g = parse(cs.backgroundImage); return g.length ? g : parse(cs.backgroundColor); };
  const out = {};
  const plus = document.querySelector("#scoreboard .btn-ball.plus"), pcs = getComputedStyle(plus);
  const plusBg = parse(pcs.backgroundImage).length ? parse(pcs.backgroundImage) : parse(pcs.backgroundColor);
  out.plus = worst(parse(pcs.color)[0], plusBg);
  const all = (sel) => cards.map((c) => worst(parse(getComputedStyle(c.querySelector(sel)).color)[0], cardBgs(c))).reduce((a, b) => ({ ratio: Math.min(a.ratio, b.ratio), lc: Math.min(a.lc, b.lc) }));
  out.digits = all(".stat-value");
  out.names = all(".player-name");
  out.label = all(".stat-label");
  out.selected = cards.some((c) => c.classList.contains("is-keypad-selected"));
  return out;
}

(async () => {
  const site = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, BASE).pathname);
    if (p.endsWith("/")) p += "index.html";
    const f = path.join(REPO, p);
    if (!f.startsWith(REPO) || p.startsWith("/api/") || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end("404"); }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream" });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise((ok) => site.listen(PORT, ok));
  const browser = await puppeteer.launch({ executablePath: EXE, headless: "new" });
  const errors = [];
  let page = null;
  const open = async (state, extra, w, h) => {
    if (page) await page.close();
    page = await browser.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.setViewport({ width: w || 1180, height: h || 820, hasTouch: true });
    // every node that reaches the speakers, and every sound started
    await page.evaluateOnNewDocument(() => {
      window.__audio = { toSpeakers: [], oscillators: 0 };
      const A = window.AudioContext || window.webkitAudioContext;
      const conn = AudioNode.prototype.connect;
      AudioNode.prototype.connect = function (dest) {
        if (dest && dest === this.context.destination) window.__audio.toSpeakers.push(this);
        return conn.apply(this, arguments);
      };
      const osc = A.prototype.createOscillator;
      A.prototype.createOscillator = function () { window.__audio.oscillators++; return osc.apply(this, arguments); };
    });
    await page.goto(BASE + "manifest.json");
    await page.evaluate((state, extra) => {
      localStorage.clear();
      localStorage.setItem("poolMasterCounter.onboardingSeen.v1", "1");
      localStorage.setItem("poolMasterCounter.migratedFromRepo.v1", "1");
      if (state) localStorage.setItem("poolMasterCounter.state.v2", state);
      Object.keys(extra || {}).forEach((k) => localStorage.setItem(k, extra[k]));
    }, state, extra);
    await page.goto(BASE, { waitUntil: "networkidle2" });
    await page.waitForFunction(() => document.getElementById("app").classList.contains("focus-mode"), { timeout: 10000 });
    await sleep(600);
  };

  // ---- every theme ----
  const bad = [];
  for (const theme of THEMES) {
    await open(board(), { "poolMasterCounter.theme.v1": theme });
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "2", bubbles: true })));
    await sleep(250);
    const m = await page.evaluate(measureContrast);
    for (const k of ["plus", "digits", "names", "label"]) if (!(m[k].ratio >= 7 && m[k].lc >= 75)) bad.push({ theme, what: k, ratio: +m[k].ratio.toFixed(2), lc: Math.round(m[k].lc) });
    if (OUT && (theme === "daybreak-chalk" || theme === "emerald-rail")) await page.screenshot({ path: path.join(OUT, "legible_" + theme + ".png") });
  }
  check("every theme (" + THEMES.length + "): the + sign, the digits, the names and the label reach 7:1 and Lc 75 (the shooter's tinted card too)", bad.length === 0, bad);

  // ---- 4 players at 1180x820 ----
  await open(board());
  const digits = await page.evaluate(() => [...document.querySelectorAll("#scoreboard .player-panel .stat-value")].map((v) => {
    const cs = getComputedStyle(v), ctx = document.createElement("canvas").getContext("2d");
    ctx.font = cs.fontWeight + " " + cs.fontSize + " " + cs.fontFamily;
    const text = v.firstChild.textContent, m = ctx.measureText(text);
    return { text, h: Math.round(m.actualBoundingBoxAscent + m.actualBoundingBoxDescent), size: cs.fontSize };
  }));
  check("4 players at 1180x820: the score digits are at least 130 px tall (25 mm on an 11-inch iPad)", digits.length === 4 && digits.every((d) => d.h >= 130), digits);
  const small = await page.evaluate(() => {
    const out = [];
    const walk = document.createTreeWalker(document.getElementById("scoreboard-panel"), NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walk.nextNode())) {
      if (!n.textContent.trim()) continue;
      const el = n.parentElement;
      if (!el.getClientRects().length || el.closest(".hidden")) continue;
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs < 14) out.push({ text: n.textContent.trim().slice(0, 30), fs, cls: el.className });
    }
    return out;
  });
  check("...no text under 14 px on the board", small.length === 0, small);
  const label = await page.evaluate(() => ({ label: document.querySelector("#scoreboard .stat-label").textContent, value: document.querySelector("#scoreboard .stat-value").textContent.replace(/\s+/g, " ").trim() }));
  check("...the label says RACKS, the count \"2 / 5\" in a race", /^racks$/i.test(label.label) && label.value === "2 / 5", label);
  if (OUT) await page.screenshot({ path: path.join(OUT, "legible_four.png") });
  await open(board({ longName: true }));
  const name = await page.evaluate(() => { const n = document.querySelector("#scoreboard .player-name"); return { lines: Math.round(n.getBoundingClientRect().height / parseFloat(getComputedStyle(n).lineHeight || getComputedStyle(n).fontSize)), h: Math.round(n.getBoundingClientRect().height), lh: getComputedStyle(n).lineHeight, clamp: getComputedStyle(n).webkitLineClamp }; });
  check("...a long name stays on one line (cut with an ellipsis)", name.clamp === "1", name);

  // ---- Practice ----
  await open(board({ two: true }));
  await page.click("#btn-board-game");
  await sleep(300);
  await page.click("#gs-practice");
  await page.click("#btn-game-sheet-apply");
  await sleep(400);
  const asked = await page.evaluate(() => !document.getElementById("confirm-modal-overlay").classList.contains("hidden"));
  await page.click("#btn-confirm-modal-cancel");
  await sleep(400);
  const stillOff = await page.evaluate(() => ({ cb: document.getElementById("no-stats-checkbox").checked, badge: !document.getElementById("practice-badge").classList.contains("hidden") }));
  check("Practice from 🎱 Game: asked first - No leaves it off, no badge", asked && !stillOff.cb && !stillOff.badge, { asked, stillOff });
  await page.click("#btn-board-game");
  await sleep(300);
  await page.click("#gs-practice");
  await page.click("#btn-game-sheet-apply");
  await sleep(400);
  await page.click("#btn-confirm-modal-ok");
  await sleep(500);
  const on = await page.evaluate(() => { const b = document.getElementById("practice-badge"); return { cb: document.getElementById("no-stats-checkbox").checked, badge: b.classList.contains("hidden") ? null : b.textContent.trim(), shown: b.getClientRects().length > 0 }; });
  check("...Yes: on, and PRACTICE · NOT SAVED on the board", on.cb && on.badge === "PRACTICE · NOT SAVED" && on.shown, on);
  if (OUT) await page.screenshot({ path: path.join(OUT, "legible_practice.png") });
  await open(board({ two: true }));
  await page.evaluate(() => document.getElementById("btn-toggle-focus").click());
  await sleep(300);
  const where = await page.evaluate(() => ({ inSession: document.getElementById("game-setup-panel").contains(document.getElementById("no-stats-checkbox")), aboveBoard: !!document.querySelector("#scoreboard-panel #no-stats-checkbox") }));
  await page.evaluate(() => { const b = document.getElementById("btn-toggle-game-setup-panel"); if (document.getElementById("game-setup-panel").classList.contains("collapsed")) b.click(); });
  await sleep(200);
  await page.evaluate(() => document.getElementById("no-stats-checkbox").click());
  await sleep(300);
  const asked2 = await page.evaluate(() => ({ modal: !document.getElementById("confirm-modal-overlay").classList.contains("hidden"), cb: document.getElementById("no-stats-checkbox").checked }));
  check("...on the full page: the switch is in Current Session (not above the board) and asks too", where.inSession && !where.aboveBoard && asked2.modal && !asked2.cb, { where, asked2 });

  // ---- 🔊 Sounds ----
  const tapPlus = async (i) => { const b = await page.$$("#scoreboard .btn-ball.plus"); await b[i || 0].click(); await sleep(900); };
  const audio = () => page.evaluate(() => ({ osc: window.__audio.oscillators, toSpeakers: window.__audio.toSpeakers.map((n) => n.constructor.name + (n.gain ? ":" + n.gain.value.toFixed(2) : "")) }));
  await open(board({ two: true }), { "poolMasterCounter.sounds.v1": "off" });
  await tapPlus(0);
  let a = await audio();
  check("🔊 Sounds Off: a rack won makes no sound", a.osc === 0, a);
  await open(board({ two: true, game: { gameType: "straight", target: 100, unit: "points" } }));
  await tapPlus(0);
  a = await audio();
  check("Wins only (the default): a point in Straight Pool makes no sound", a.osc === 0, a);
  await open(board({ two: true }));
  await tapPlus(0);
  a = await audio();
  check("...a rack won does", a.osc > 0, a);
  await open(board({ two: true, game: { gameType: "straight", target: 100, unit: "points" } }), { "poolMasterCounter.sounds.v1": "all", "poolMasterCounter.soundVolume.v1": "30" });
  await tapPlus(0);
  a = await audio();
  check("All: the point too - and everything reaches the speakers through the volume (30% -> 0.30)", a.osc > 0 && a.toSpeakers.length >= 1 && a.toSpeakers.every((n) => n === "GainNode:0.30"), a);
  await page.click("#btn-board-menu");
  await sleep(200);
  await page.evaluate(() => [...document.querySelectorAll("#board-menu-list .board-menu-row")].find((b) => b.dataset.menuKey === "menu.sounds").click());
  await sleep(200);
  const menuSounds = await page.evaluate(() => ({ shown: !document.getElementById("menu-sound-box").classList.contains("hidden"), level: (document.querySelector('input[name="sound-level"]:checked') || {}).value, volume: document.getElementById("sound-volume").value, celebrations: !!document.querySelector("#menu-sound-box #celebrations-select") }));
  check("...☰ Menu › Sounds: All / Wins only / Off, the volume, and Celebrations", menuSounds.shown && menuSounds.level === "all" && menuSounds.volume === "30" && menuSounds.celebrations, menuSounds);
  if (OUT) await page.screenshot({ path: path.join(OUT, "legible_sounds.png") });

  // ---- the roster's × ----
  await open(board({ two: true }));
  await page.evaluate(() => { document.getElementById("btn-toggle-focus").click(); const b = document.getElementById("btn-toggle-players-panel"); if (document.getElementById("players-panel").classList.contains("collapsed")) b.click(); });
  await sleep(300);
  await page.evaluate(() => [...document.querySelectorAll("#roster-list .roster-remove")].find((b) => b.getAttribute("aria-label") === "Remove Kim").click());
  await sleep(300);
  const gone = await page.evaluate(() => ({ names: JSON.parse(localStorage.getItem("poolMasterCounter.state.v2")).players.map((p) => p.name), toast: document.getElementById("page-toast").textContent, undo: !!document.querySelector("#page-toast .page-toast-action") }));
  await page.click("#page-toast .page-toast-action");
  await sleep(400);
  const back = await page.evaluate(() => { const s = JSON.parse(localStorage.getItem("poolMasterCounter.state.v2")); const k = s.players.find((p) => p.name === "Kim"); return { names: s.players.map((p) => p.name), wins: k ? s.playerWins[k.id] : null }; });
  check("the roster's × : Kim gone, \"Kim removed\" with ↩ Undo - Undo brings Kim back first, with 2 wins", !gone.names.includes("Kim") && /Kim removed/.test(gone.toast) && gone.undo && back.names[0] === "Kim" && back.wins === 2, { gone, back });

  // ---- a toast on the board ----
  await open(null);
  await page.evaluate(() => document.getElementById("btn-empty-new-game").click());
  await sleep(300);
  await page.type("#quick-game-player1", "Kim");
  await page.type("#quick-game-player2", "Jo");
  await page.click("#btn-quick-game-start");
  await sleep(500);
  const toast = await page.evaluate(() => {
    const t = document.getElementById("page-toast");
    if (t.classList.contains("hidden")) return { shown: false };
    const r = t.getBoundingClientRect();
    const hit = [...document.querySelectorAll("#app button, #app input, #app select, #app label")].filter((e) => {
      if (!e.getClientRects().length) return false;
      const b = e.getBoundingClientRect();
      return b.right > r.left && b.left < r.right && b.bottom > r.top && b.top < r.bottom;
    }).map((e) => e.id || e.className);
    return { shown: true, text: t.textContent, hit };
  });
  check("a toast on the board covers no control (it sits over the top bar's line)", toast.shown && toast.hit.length === 0, toast);
  if (OUT) await page.screenshot({ path: path.join(OUT, "legible_toast.png") });

  check("no page errors", errors.length === 0, errors);
  await browser.close();
  site.close();
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log("FAIL crashed: " + (e && e.stack)); process.exit(1); });
