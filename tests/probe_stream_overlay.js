// The stream overlay (overlay.html, P30): a read-only relay guest for an OBS Browser Source.
// Its own file server on 4270 with a fake relay on /ws that answers the overlay's hello with a
// made-up {type:"state", state, board} snapshot (Kim Lee v Jo Smith, 8-Ball, race to 7, 3-2,
// rack 6, Q-Scores 512 / 488, the scoring device on Emerald Rail):
// - layout=lower at 1920x1080: names, "Race to 7", 3 and 2, Q-Scores, "8-Ball · Rack 6 · Kim Lee
//   breaks" (the last rack's winner), the host's theme, in the bottom third, nothing to tap;
//   the screenshot (omitBackground) is see-through everywhere but the scoreboard (alpha 0 / 255);
// - layout=vertical at 1080x1920: the same, stacked, see-through around it;
// - theme=paper-contrast wins over the host's theme and changes the colours; lang=french and
//   lang=cantonese; break=alternate (and first=2), break=off; ratings=off;
// - a new snapshot redraws it (3-3, rack 7, Jo breaks; on the hill lit); the first rack: lag;
// - a host too old to send the board: worked out from the state alone (no Q-Scores);
// - teams (Team A / Team B and who's on each), four players at 15 Ball Rotation, a points race
//   (points in the box, racks won as dots), Quick Counter (names and points only);
// - nothing from the host yet: "Waiting for the scoreboard"; a server that wants pairing:
//   "isn't paired" without a key, the board with ?device=<key> - passed on to the ws address;
// - the overlay never sends anything but its one hello per connection;
// then the real thing, server/server.js on 4271 (a throwaway HOME): overlay.html served; the
// scoreboard hosting (🎯 Host This Session) feeds the overlay its board - Q-Scores as on its
// cards, its theme (and a theme change), a rack won; the app's own guest (?join=1) still fine
// with the board in the snapshot; from the LAN address (another computer) "isn't paired"
// without the app key, the board with ?device=<app key>; no page errors.
// usage: node tests/probe_stream_overlay.js [screenshot dir]
const puppeteer = require("puppeteer-core");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const REPO = path.join(__dirname, "..");
const WebSocket = require(path.join(REPO, "server", "node_modules", "ws"));
const PORT = 4270, BASE = "http://localhost:" + PORT + "/";
const REAL_PORT = 4271, REAL = "http://localhost:" + REAL_PORT + "/";
const OUT = process.argv[2];
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra).slice(0, 900) : "")); if (!ok) fails++; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lanIp = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === "IPv4" && !i.internal);

// ---- the made-up session ----
const KEY = "0123456789abcdef".repeat(4);
function history(winners) {
  return winners.map((w, i) => ({ ts: new Date(Date.UTC(2026, 9, 29, 20, 50 - i * 8)).toISOString(), gameType: "8ball", gameLabel: "8-Ball", target: 1, winnerNames: [w], opponentNames: [w === "Kim Lee" ? "Jo Smith" : "Kim Lee"] }));
}
const STATE = {
  players: [
    { id: "k", name: "Kim Lee", playing: true, balls: 0, teamId: null },
    { id: "j", name: "Jo Smith", playing: true, balls: 0, teamId: null },
    { id: "a", name: "Ann", playing: false, balls: 0, teamId: null }
  ],
  playerWins: { k: 3, j: 2 }, teamWins: {}, raceToWinsTarget: 7, gamesPlayedCount: 5,
  currentGame: { gameType: "8ball", target: 1, unit: "rack", mode: "individual", queueEnabled: false },
  gameHistory: history(["Kim Lee", "Jo Smith", "Kim Lee", "Jo Smith", "Kim Lee"])
};
function player(id, name, wins, rating, extra) { return Object.assign({ id, name, nickname: "", team: null, score: 0, wins, race: 7, rating }, extra || {}); }
function board(o) {
  return Object.assign({
    theme: "emerald-rail", quick: false, gameType: "8ball", gameLabel: "8-Ball", target: 1, unit: "rack", race: 7, mode: "individual",
    rack: 6, lastWinners: ["Kim Lee"], players: [player("k", "Kim Lee", 3, 512), player("j", "Jo Smith", 2, 488)], teams: null
  }, o || {});
}
const snap = (b, s) => ({ type: "state", state: s || STATE, tournament: null, board: b });

(async () => {
  // ---- the fake scoreboard server: files, /api/pair/status, the relay on /ws ----
  let snapshot = snap(board());
  let pairing = false; // (on: like the real server for another computer - only a paired key gets in)
  const conns = [];
  const site = http.createServer((req, res) => {
    const u = new URL(req.url, BASE);
    let p = decodeURIComponent(u.pathname);
    if (p === "/api/pair/status" && pairing) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ paired: u.searchParams.get("device") === KEY, local: false }));
    }
    if (p.endsWith("/")) p += "index.html";
    const f = path.join(REPO, p);
    if (!f.startsWith(REPO) || p.startsWith("/api/") || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end("404"); }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream" });
    fs.createReadStream(f).pipe(res);
  });
  const wss = new WebSocket.Server({ noServer: true });
  site.on("upgrade", (req, socket, head) => {
    const u = new URL(req.url, BASE);
    if (u.pathname !== "/ws") return socket.destroy();
    if (pairing && u.searchParams.get("device") !== KEY) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      return socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const c = { url: req.url, sent: [], ws };
      conns.push(c);
      ws.on("message", (raw) => {
        let m;
        try { m = JSON.parse(raw); } catch (e) { m = String(raw); }
        c.sent.push(m);
        if (m && m.type === "hello") {
          if (snapshot) ws.send(JSON.stringify(snapshot));
          ws.send(JSON.stringify({ type: "host-status", connected: !!snapshot }));
        }
      });
    });
  });
  const push = (s) => { snapshot = s; if (s) conns.forEach((c) => c.ws.readyState === 1 && c.ws.send(JSON.stringify(s))); };
  await new Promise((ok) => site.listen(PORT, ok));

  const browser = await puppeteer.launch({ executablePath: EXE, headless: "new" });
  const errors = [];
  const pages = [];
  const open = async (base, query, w, h) => {
    const page = await browser.newPage();
    pages.push(page);
    page.on("pageerror", (e) => errors.push(e.message));
    await page.setViewport({ width: w || 1920, height: h || 1080 });
    await page.goto(base + "overlay.html" + (query || ""), { waitUntil: "load" });
    await page.waitForFunction(() => !document.getElementById("ov-root").classList.contains("hidden") || !document.getElementById("ov-status").classList.contains("hidden"), { timeout: 10000 }).catch(() => {});
    await sleep(300);
    return page;
  };
  const read = (page) => page.evaluate(() => {
    const all = (sel) => [...document.querySelectorAll(sel)].map((e) => e.textContent.trim());
    const root = document.getElementById("ov-root"), status = document.getElementById("ov-status");
    if (!root || !status) return { shown: false, status: "", names: [], scores: [], ratings: [], members: [], info: "", breaking: -1, hill: [], pips: [], controls: 0, rect: null, cut: [] };
    const bar = document.getElementById("ov-bar");
    const r = bar ? bar.getBoundingClientRect() : null;
    return {
      shown: !root.classList.contains("hidden"),
      status: status.classList.contains("hidden") ? "" : status.textContent,
      names: all(".ov-name"), scores: all(".ov-score"), center: (document.querySelector(".ov-center") || {}).textContent || "",
      ratings: all(".ov-rating"), members: all(".ov-members"), info: (document.getElementById("ov-info") || {}).textContent || "",
      breaking: [...document.querySelectorAll(".ov-side")].findIndex((s) => s.classList.contains("is-breaking")),
      hill: [...document.querySelectorAll(".ov-score")].map((s) => s.classList.contains("is-hill")),
      pips: [...document.querySelectorAll(".ov-side")].map((s) => [s.querySelectorAll(".ov-pip").length, s.querySelectorAll(".ov-pip.on").length]),
      theme: document.documentElement.getAttribute("data-theme"),
      controls: document.querySelectorAll("button, input, select, textarea, a[href], [tabindex], [contenteditable]").length,
      rect: r && { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width },
      nameColor: document.querySelector(".ov-name") ? getComputedStyle(document.querySelector(".ov-name")).color : "",
      plateBg: document.querySelector(".ov-plate") ? getComputedStyle(document.querySelector(".ov-plate")).backgroundImage : "",
      cut: [...document.querySelectorAll(".ov-name, .ov-center, .ov-info")].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent)
    };
  });
  // a screenshot's pixels: how much of it is fully see-through, and the alpha at given points
  const pixels = async (png, points) => {
    const p = await browser.newPage();
    const res = await p.evaluate(async (b64, points) => {
      const img = new Image();
      img.src = "data:image/png;base64," + b64;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let clear = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] === 0) clear++;
      return { w: c.width, h: c.height, clear: clear / (c.width * c.height), alpha: points.map(([x, y]) => d[(Math.round(y) * c.width + Math.round(x)) * 4 + 3]) };
    }, Buffer.from(png).toString("base64"), points);
    await p.close();
    return res;
  };
  // (for looking at: the transparent PNG laid on a checkerboard)
  const preview = async (png, file) => {
    if (!OUT) return;
    const p = await browser.newPage();
    const url = await p.evaluate(async (b64) => {
      const img = new Image();
      img.src = "data:image/png;base64," + b64;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext("2d");
      for (let y = 0; y < c.height; y += 40) for (let x = 0; x < c.width; x += 40) { ctx.fillStyle = (x + y) % 80 ? "#6d7b85" : "#9aa7b0"; ctx.fillRect(x, y, 40, 40); }
      ctx.drawImage(img, 0, 0);
      return c.toDataURL("image/png");
    }, Buffer.from(png).toString("base64"));
    fs.writeFileSync(path.join(OUT, file), Buffer.from(url.split(",")[1], "base64"));
    await p.close();
  };
  const shoot = async (page, file) => {
    const png = await page.screenshot({ omitBackground: true, type: "png" });
    if (OUT) {
      fs.writeFileSync(path.join(OUT, file), png);
      await preview(png, file.replace(/\.png$/, "_preview.png"));
    }
    return png;
  };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  if (OUT) fs.mkdirSync(OUT, { recursive: true });

  // ---- 16:9, a lower third ----
  let page = await open(BASE, "?layout=lower", 1920, 1080);
  const there = await page.evaluate(() => !!document.getElementById("ov-root"));
  check("overlay.html is there", there);
  if (!there) {
    await browser.close();
    site.close();
    console.log(fails + " FAILED");
    process.exit(1);
  }
  let v = await read(page);
  check("lower: names, \"Race to 7\", 3 and 2, Q-Scores 512 / 488", v.shown && same(v.names, ["Kim Lee", "Jo Smith"]) && v.center === "Race to 7" && same(v.scores, ["3", "2"]) && same(v.ratings, ["Q-Score 512", "Q-Score 488"]), v);
  check("...\"8-Ball · Rack 6 · Kim Lee breaks\" (the last rack's winner), the cue ball on Kim's side", v.info === "8-Ball·Rack 6·Kim Lee breaks" && v.breaking === 0, v.info);
  check("...the scoring device's theme (Emerald Rail)", v.theme === "emerald-rail", v.theme);
  check("...nothing to tap: no button, field, link or focusable", v.controls === 0, v.controls);
  check("...in the bottom third, inside the picture, names not cut", v.rect && v.rect.top > 1080 * 2 / 3 && v.rect.bottom <= 1080 && v.rect.left >= 0 && v.rect.right <= 1920 && v.rect.width >= 1200 && v.cut.length === 0, v);
  let png = await shoot(page, "overlay_lower_1920x1080.png");
  let px = await pixels(png, [[20, 20], [960, 300], [1900, 700], [(v.rect.left + v.rect.right) / 2, (v.rect.top + v.rect.bottom) / 2], [v.rect.left + 120, v.rect.top + 40]]);
  check("...screenshot 1920x1080 see-through (alpha 0 above the bar, " + Math.round(px.clear * 100) + "% clear) and solid on it (alpha 255)", px.w === 1920 && px.h === 1080 && px.alpha[0] === 0 && px.alpha[1] === 0 && px.alpha[2] === 0 && px.alpha[3] === 255 && px.alpha[4] === 255 && px.clear > 0.8, px);
  const emerald = v;

  // ---- 9:16 ----
  page = await open(BASE, "?layout=vertical", 1080, 1920);
  v = await read(page);
  check("vertical: the same names, race, scores, Q-Scores and line", v.shown && same(v.names, ["Kim Lee", "Jo Smith"]) && v.center === "Race to 7" && same(v.scores, ["3", "2"]) && same(v.ratings, ["Q-Score 512", "Q-Score 488"]) && v.info === "8-Ball·Rack 6·Kim Lee breaks" && v.breaking === 0, v);
  check("...across the picture, in its lower half, names not cut", v.rect && v.rect.top > 960 && v.rect.bottom <= 1920 && v.rect.width >= 900 && v.rect.right <= 1080 && v.cut.length === 0, v.rect);
  png = await shoot(page, "overlay_vertical_1080x1920.png");
  px = await pixels(png, [[20, 20], [540, 600], [1060, 1900], [(v.rect.left + v.rect.right) / 2, (v.rect.top + v.rect.bottom) / 2]]);
  check("...screenshot 1080x1920 see-through (alpha 0 around it, " + Math.round(px.clear * 100) + "% clear) and solid on it", px.w === 1080 && px.h === 1920 && px.alpha[0] === 0 && px.alpha[1] === 0 && px.alpha[2] === 0 && px.alpha[3] === 255 && px.clear > 0.7, px);

  // ---- options ----
  page = await open(BASE, "?layout=lower&theme=paper-contrast", 1920, 1080);
  v = await read(page);
  check("theme=paper-contrast wins over the host's theme and changes the colours", v.theme === "paper-contrast" && v.nameColor !== emerald.nameColor && v.plateBg !== emerald.plateBg, { theme: v.theme, a: [emerald.nameColor, emerald.plateBg], b: [v.nameColor, v.plateBg] });
  png = await shoot(page, "overlay_lower_paper-contrast.png");
  px = await pixels(png, [[20, 20], [960, 300]]);
  check("...still see-through around it (a light theme)", px.alpha[0] === 0 && px.alpha[1] === 0, px);
  page = await open(BASE, "?layout=vertical&theme=gold-mine&pos=top", 1080, 1920);
  v = await read(page);
  check("pos=top: at the top", v.theme === "gold-mine" && v.rect && v.rect.top < 400, v.rect);
  if (OUT) await shoot(page, "overlay_vertical_gold-mine_top.png");
  page = await open(BASE, "?theme=nonsense", 1920, 1080);
  v = await read(page);
  check("an unknown theme= is left out (the host's theme)", v.theme === "emerald-rail", v.theme);

  page = await open(BASE, "?lang=french", 1920, 1080);
  v = await read(page);
  check("lang=french: \"Course à 7\", \"Rack 6\", \"Kim Lee casse\"", v.center === "Course à 7" && v.info === "8-Ball·Rack 6·Kim Lee casse", v);
  page = await open(BASE, "?lang=cantonese", 1920, 1080);
  v = await read(page);
  check("lang=cantonese: \"搶 7\", \"第 6 局\", \"Kim Lee 開波\"", v.center === "搶 7" && v.info === "8-Ball·第 6 局·Kim Lee 開波", v);

  page = await open(BASE, "?break=alternate", 1920, 1080);
  v = await read(page);
  check("break=alternate: rack 6 is the second player's (Jo Smith breaks)", v.breaking === 1 && /Jo Smith breaks$/.test(v.info), v.info);
  page = await open(BASE, "?break=alternate&first=2", 1920, 1080);
  v = await read(page);
  check("break=alternate&first=2: rack 6 is Kim Lee's", v.breaking === 0 && /Kim Lee breaks$/.test(v.info), v.info);
  page = await open(BASE, "?break=off&ratings=off", 1920, 1080);
  v = await read(page);
  check("break=off: nobody breaking; ratings=off: no Q-Scores", v.breaking === -1 && !/breaks/.test(v.info) && v.ratings.length === 0, v);

  // ---- a new snapshot ----
  page = await open(BASE, "", 1920, 1080);
  push(snap(board({ rack: 7, lastWinners: ["Jo Smith"], players: [player("k", "Kim Lee", 3, 507), player("j", "Jo Smith", 3, 493)] })));
  await page.waitForFunction(() => /Rack 7/.test(document.getElementById("ov-root").textContent), { timeout: 5000 }).catch(() => {});
  v = await read(page);
  check("a new snapshot redraws it: 3-3, Rack 7, Jo Smith breaks, Q-Scores 507 / 493", same(v.scores, ["3", "3"]) && /Rack 7·Jo Smith breaks/.test(v.info) && v.breaking === 1 && same(v.ratings, ["Q-Score 507", "Q-Score 493"]), v);
  push(snap(board({ rack: 12, lastWinners: ["Kim Lee"], players: [player("k", "Kim Lee", 6, 520), player("j", "Jo Smith", 5, 480)] })));
  await page.waitForFunction(() => /Rack 12/.test(document.getElementById("ov-root").textContent), { timeout: 5000 }).catch(() => {});
  v = await read(page);
  check("...6-5 in a race to 7: Kim's score lit (on the hill), Jo's not", same(v.hill, [true, false]), v.hill);
  push(snap(board({ rack: 1, lastWinners: [], players: [player("k", "Kim Lee", 0, 512), player("j", "Jo Smith", 0, 488)] }), Object.assign({}, STATE, { gameHistory: [], playerWins: {} })));
  await page.waitForFunction(() => /Rack 1\b/.test(document.getElementById("ov-root").textContent), { timeout: 5000 }).catch(() => {});
  v = await read(page);
  check("the first rack: \"Lag for the break\", nobody's cue ball", v.breaking === -1 && /Rack 1·Lag for the break$/.test(v.info), v.info);

  // ---- a host that sends no board: from the state ----
  push({ type: "state", state: STATE, tournament: null });
  page = await open(BASE, "", 1920, 1080);
  v = await read(page);
  check("no board in the snapshot: worked out from the state (names, race, 3-2, rack 6, Kim breaks, no Q-Score, Crimson Felt)", same(v.names, ["Kim Lee", "Jo Smith"]) && v.center === "Race to 7" && same(v.scores, ["3", "2"]) && v.info === "8-Ball·Rack 6·Kim Lee breaks" && v.ratings.length === 0 && v.theme === "crimson-felt", v);

  // ---- teams, four players, a points race ----
  push(snap(board({
    mode: "teams", rack: 4, lastWinners: ["Jo Smith", "Bob"],
    players: [player("k", "Kim Lee", 2, 512, { team: "A" }), player("a", "Ann", 2, 430, { team: "A" }), player("j", "Jo Smith", 1, 488, { team: "B" }), player("b", "Bob", 1, 450, { team: "B" })],
    teams: [{ id: "A", names: ["Kim Lee", "Ann"], score: 0, wins: 2, race: 7, rating: 471 }, { id: "B", names: ["Jo Smith", "Bob"], score: 0, wins: 1, race: 7, rating: 469 }]
  })));
  page = await open(BASE, "", 1920, 1080);
  v = await read(page);
  check("teams: Team A (Kim Lee & Ann) 2 - Team B (Jo Smith & Bob) 1, Team B breaks", same(v.names, ["Team A", "Team B"]) && same(v.members, ["Kim Lee & Ann", "Jo Smith & Bob"]) && same(v.scores, ["2", "1"]) && v.breaking === 1 && /Team B breaks$/.test(v.info), v);
  if (OUT) await shoot(page, "overlay_lower_teams.png");
  push(snap(board({
    gameType: "15ballrotation", gameLabel: "15 Ball Rotation", target: 61, unit: "points", race: 1, rack: 3, lastWinners: ["Ann"],
    players: [player("k", "Kim Lee", 1, 512, { score: 34, race: 1 }), player("j", "Jo Smith", 0, 488, { score: 21, race: 1 }), player("a", "Ann", 1, 430, { score: 40, race: 1 }), player("b", "Bob", 0, 450, { score: 9, race: 1 })]
  })));
  page = await open(BASE, "", 1920, 1080);
  v = await read(page);
  check("four players at 15 Ball Rotation: four boxes with their points, \"15 Ball Rotation to 61 points · Rack 3\", no breaker", v.names.length === 4 && same(v.scores, ["34", "21", "40", "9"]) && v.info === "15 Ball Rotation to 61 points·Rack 3" && v.breaking === -1 && v.rect.right <= 1920, v);
  if (OUT) await shoot(page, "overlay_lower_four_players.png");
  page = await open(BASE, "?layout=vertical", 1080, 1920);
  v = await read(page);
  check("...vertical: four rows", v.names.length === 4 && v.rect.bottom <= 1920, v.rect);
  if (OUT) await shoot(page, "overlay_vertical_four_players.png");
  push(snap(board({
    gameType: "straight", gameLabel: "Straight Pool", target: 100, unit: "points", race: 3, rack: 4, lastWinners: ["Jo Smith"],
    players: [player("k", "Kim Lee", 1, 512, { score: 87, race: 3 }), player("j", "Jo Smith", 2, 488, { score: 64, race: 3 })]
  })));
  page = await open(BASE, "", 1920, 1080);
  v = await read(page);
  check("Straight Pool to 100, race to 3: the points in the boxes, racks won as dots (1 of 3, 2 of 3)", same(v.scores, ["87", "64"]) && same(v.pips, [[3, 1], [3, 2]]) && v.center === "Race to 3" && v.info === "Straight Pool to 100 points·Rack 4·Jo Smith breaks", v);
  if (OUT) await shoot(page, "overlay_lower_straight_pool.png");
  push(snap(board({
    quick: true, gameLabel: "", target: 1, unit: "points", race: 1, rack: 1, lastWinners: [],
    players: [player("k", "Kim Lee", 0, null, { score: 12, race: 1 }), player("j", "Jo Smith", 0, null, { score: 9, race: 1 })]
  })));
  page = await open(BASE, "", 1920, 1080);
  v = await read(page);
  const quickCenter = await page.evaluate(() => getComputedStyle(document.querySelector(".ov-center")).display);
  check("Quick Counter: just the names and points - no race box, rack, breaker or Q-Score", same(v.scores, ["12", "9"]) && quickCenter === "none" && v.info === "" && v.ratings.length === 0 && v.breaking === -1, { v, quickCenter });

  // ---- before the first board ----
  push(null);
  page = await open(BASE, "", 1920, 1080);
  v = await read(page);
  check("no host yet: \"Waiting for the scoreboard…\" and how to host, no board", !v.shown && /Waiting for the scoreboard/.test(v.status) && /Host This Session/.test(v.status), v.status);
  if (OUT) await shoot(page, "overlay_waiting.png");
  push(snap(board()));
  await page.waitForFunction(() => !document.getElementById("ov-root").classList.contains("hidden"), { timeout: 5000 }).catch(() => {});
  v = await read(page);
  check("...the board replaces it as soon as the host sends one", v.shown && v.status === "" && v.names.length === 2, v);

  // ---- pairing and ?device= ----
  pairing = true;
  const before = conns.length;
  page = await open(BASE, "", 1920, 1080);
  await sleep(1500);
  v = await read(page);
  check("a server that wants pairing, no key: \"isn't paired\" (how to add &device=), no board", !v.shown && /isn't paired/.test(v.status) && /&device=/.test(v.status) && conns.length === before, v.status);
  page = await open(BASE, "?layout=lower&device=" + KEY, 1920, 1080);
  v = await read(page);
  const keyed = conns.slice(before);
  check("?device=<key>: the board, and the key passed on to the ws address", v.shown && v.names.length === 2 && keyed.length >= 1 && keyed.every((c) => c.url === "/ws?device=" + KEY), keyed.map((c) => c.url));
  pairing = false;

  // ---- what the overlay sent ----
  const sent = conns.map((c) => c.sent);
  check("the overlay only ever sent its hello - one per connection (" + conns.length + " connections)", conns.length > 10 && sent.every((s) => s.length === 1 && same(s[0], { type: "hello", role: "guest" })), sent.filter((s) => !(s.length === 1 && same(s[0], { type: "hello", role: "guest" }))));
  for (const p of pages.splice(0)) await p.close().catch(() => {});

  // ---- the real server, the real scoreboard ----
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "pmc-overlay-"));
  const server = spawn(process.execPath, [path.join(REPO, "server", "server.js")], { env: Object.assign({}, process.env, { HOME: home, PORT: String(REAL_PORT) }), stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  server.stdout.on("data", (d) => (log += d));
  server.stderr.on("data", (d) => (log += d));
  try {
    for (let i = 0; i < 40 && !/running on port/.test(log); i++) await sleep(150);
    const served = await new Promise((resolve) => http.get(REAL + "overlay.html", (res) => { let b = ""; res.on("data", (c) => (b += c)); res.on("end", () => resolve({ status: res.statusCode, ok: /id="ov-root"/.test(b) })); }).on("error", () => resolve({ status: 0 })));
    check("server/server.js serves overlay.html", served.status === 200 && served.ok, { served, log: log.slice(0, 300) });
    if (!served.ok) throw new Error("no overlay from the real server - the rest of it can't run");

    const app = await browser.newPage();
    app.on("pageerror", (e) => errors.push("app: " + e.message));
    await app.setViewport({ width: 1180, height: 820 });
    await app.goto(REAL + "manifest.json");
    await app.evaluate((state) => {
      localStorage.clear();
      localStorage.setItem("poolMasterCounter.onboardingSeen.v1", "1");
      localStorage.setItem("poolMasterCounter.migratedFromRepo.v1", "1");
      localStorage.setItem("poolMasterCounter.theme.v1", "midnight-ivory");
      localStorage.setItem("poolMasterCounter.state.v2", JSON.stringify(state));
      localStorage.setItem("poolMasterCounter.ratings.v1", JSON.stringify({
        "Kim Lee": { name: "Kim Lee", rating: 512, gamesPlayed: 40, history: [] },
        "Jo Smith": { name: "Jo Smith", rating: 488, gamesPlayed: 35, history: [] }
      }));
    }, Object.assign({}, STATE, { gameHistory: [], gamesPlayedCount: 0, teamMvpWins: {}, rotation: { enabled: false, order: [], every: 1 }, queue: [] }));
    await app.goto(REAL, { waitUntil: "networkidle2" });
    await app.waitForFunction(() => document.getElementById("app").classList.contains("focus-mode"), { timeout: 10000 }).catch(() => {});
    await sleep(500);
    await app.evaluate(() => document.getElementById("btn-group-session-host").click());
    await sleep(1200);
    const appBadges = () => app.evaluate(() => [...document.querySelectorAll("#scoreboard .player-panel")].map((c) => c.querySelector(".rating-badge").textContent.trim()));
    let ov = await open(REAL, "?layout=lower", 1920, 1080);
    v = await read(ov);
    let badges = await appBadges();
    check("hosting from the scoreboard: the overlay gets its board - Kim Lee 3, Jo Smith 2, Race to 7, Rack 1, lag", v.shown && same(v.names, ["Kim Lee", "Jo Smith"]) && same(v.scores, ["3", "2"]) && v.center === "Race to 7" && v.info === "8-Ball·Rack 1·Lag for the break", v);
    check("...the Q-Scores the score cards show (" + badges.join(" / ") + ") and the scoreboard's theme", same(v.ratings, badges.map((b) => "Q-Score " + b)) && same(badges, ["512", "488"]) && v.theme === "midnight-ivory", { ratings: v.ratings, badges, theme: v.theme });
    if (OUT) await shoot(ov, "overlay_live_from_scoreboard.png");
    await app.evaluate(() => { const s = document.getElementById("theme-select"); s.value = "gold-mine"; s.dispatchEvent(new Event("change", { bubbles: true })); });
    await ov.waitForFunction(() => document.documentElement.getAttribute("data-theme") === "gold-mine", { timeout: 5000 }).catch(() => {});
    v = await read(ov);
    check("...the scoreboard's theme changed to Gold Mine: so does the overlay", v.theme === "gold-mine", v.theme);
    const tapped = await app.evaluate(() => {
      const card = [...document.querySelectorAll("#scoreboard .player-panel")].find((c) => c.querySelector(".player-name").firstChild.textContent.trim() === "Jo");
      const plus = card && card.querySelector(".card-plus-zone .btn-ball.plus");
      if (!plus) return false;
      plus.click();
      return true;
    });
    await ov.waitForFunction(() => /Rack 2/.test(document.getElementById("ov-root").textContent), { timeout: 5000 }).catch(() => {});
    await sleep(400);
    v = await read(ov);
    badges = await appBadges();
    check("...a rack won on the scoreboard (Jo's +): 3-3, Rack 2, Jo Smith breaks, the new Q-Scores (" + badges.join(" / ") + ")", tapped && same(v.scores, ["3", "3"]) && v.info === "8-Ball·Rack 2·Jo Smith breaks" && same(v.ratings, badges.map((b) => "Q-Score " + b)) && !same(badges, ["512", "488"]), { v, badges });

    const guest = await browser.newPage();
    guest.on("pageerror", (e) => errors.push("guest: " + e.message));
    await guest.setViewport({ width: 1180, height: 820 });
    await guest.goto(REAL + "?join=1", { waitUntil: "networkidle2" });
    await sleep(1500);
    const g = await guest.evaluate(() => ({ guest: document.body.classList.contains("network-guest-mode"), cards: [...document.querySelectorAll("#scoreboard .player-panel .player-name")].map((n) => n.textContent.trim()) }));
    check("the app's own guest (?join=1) still shows the host's board with the summary in the snapshot", g.guest && g.cards.length === 2 && /^Kim/.test(g.cards[0]) && /^Jo/.test(g.cards[1]), g);
    await guest.close();

    if (lanIp) {
      const LAN = "http://" + lanIp.address + ":" + REAL_PORT + "/";
      ov = await open(LAN, "?layout=lower", 1920, 1080);
      await sleep(1500);
      v = await read(ov);
      check("another computer (" + lanIp.address + "), no key: \"isn't paired\", no board", !v.shown && /isn't paired/.test(v.status), v.status);
      const appKey = await new Promise((resolve) => http.get(REAL + "api/pair/app-token", (res) => { let b = ""; res.on("data", (c) => (b += c)); res.on("end", () => { try { resolve(JSON.parse(b).token); } catch (e) { resolve(null); } }); }).on("error", () => resolve(null)));
      ov = await open(LAN, "?layout=lower&device=" + appKey, 1920, 1080);
      v = await read(ov);
      check("...with &device=<the app key>: the board", !!appKey && v.shown && same(v.names, ["Kim Lee", "Jo Smith"]) && same(v.scores, ["3", "3"]), v);
    } else {
      console.log("SKIP another computer: this computer has no LAN address");
    }
    await app.close();
  } catch (e) {
    check("the real server's part ran to the end", false, String(e));
  } finally {
    server.kill();
  }

  check("no page errors", errors.length === 0, errors);
  await browser.close();
  site.close();
  wss.close();
  console.log(fails ? fails + " FAILED" : "ALL PASSED");
  process.exit(fails ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
