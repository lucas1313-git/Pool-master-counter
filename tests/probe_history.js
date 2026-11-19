// The Leaderboard's 📈 History (2026-11-19, the user: "represent the leaderboard as a historical
// graph with each player represented by a line, there should be "influencers" these would be events
// that makes a player leaderboard position change these should be up and down graphic arrows of
// diferent colors ... multiple timelines dynamically ... a library of graph"), at 1180x820:
// - 4 nights: 12 days ago Ace beats Bob 8–4; 8 days ago Cid beats Bob 6–4; 4 days ago Bob wins two
//   races to 3 against Ace (3–1, 3–2); yesterday Dee and Cid play 10 (5–5);
// - 📈 History from the leaderboard: one 🏆 leaderboard graph (MVP, all time), the players picked,
//   "Sep 3 – Nov 15 · 4 nights"-style range, a line per player, end labels "#1 …", the ▲▼ legend;
// - the night Bob's races moved him: his tooltip row "▲ from #3 · won 2 races · 6–3 that night ·
//   passed Ace, Cid", Ace's "▼ from #1 · 3–6 that night · passed by Bob", Cid's "didn't play";
//   their arrows drawn (gold double, red, hollow grey);
// - every graph from the library: 📈 rating, 🎯 win % trend, ⚔️ head-to-head ("One-on-one: Ace
//   11 – 10 Bob (21 games)"), 📅 activity (a cell per player per night, a ring for a race won);
// - a player taken off and put back: the others keep their colours; the 📋 table: a row a night;
// - the range: "2 weeks" preset, and dragging the bar's left edge in; ▶ replay at ⚡ very fast:
//   ⏸ Pause + ⏹, the date, back to ▶ at the end, the commentary kept;
// - 🎙️ the commentator (2026-11-19, the user: "some text when an event of signifiance occurs, like
//   a sport commentator"): Ace sets the early pace (the first night: nothing before it to compare),
//   Cid comes in, Bob slips, "👑 … Bob …
//   Ace … won 2 races" and "Top-3 clash: Bob beats Ace 6–3" (no slip line for Ace - same news),
//   Ace slips, "🦨 Skunk! Dee shuts out Cid." (Dee's biggest moment - his coming in only at 🔎);
// - 🎯 following Bob ("view the animation from his point of view ... much more details ... more
//   comments"): his races night - the headline, "🎱 Bob goes 6–3 tonight: beats Ace 6–3. 🏁 2
//   races won!", career best, the gap, his rating, his first race (no clash line, no "moves up" -
//   said already); ⏸ holds the night, ▶ Resume; his line the thick one; his timeline (3 nights, the
//   one on screen marked); ⏹ mid-way keeps the commentary; the speed kept;
// - 🔊 the voice ("i mean voice talking to us"; "also tell the date and day"): each night's day and
//   date first ("Sunday, November 15"), every line said, no emoji, "6 to 3", "number 1", at the
//   speed's rate; the replay waits for it (the date and 3 lines of 0.9 s: 3.6 s);
//   🔇 off: nothing said;
// - the page stays put during a replay, scrolled down to a graph ("the window is scrolling up when
//   the timeline is moving"); the commentary a fixed bar along the bottom, ✕ closes it;
// - the amount of detail (2026-11-19, "a drop list for the amount of detail to see and hear"): 📰
//   headlines - the lead change only; 🔎 everything - everyone's night ("🎱 Ace: 8–4.", "🔥 Ace wins
//   8 in a row."), the skunk (Dee shuts out Cid - said at normal too, nobody moved for it); 🎙️
//   Earlier scrolls ("when I press past events I cannot scroll the popup"); 🔥 lots of trash talk:
//   a quip under the lead change, about Ace; 😇 none: no quip;
// - ✕ removes a graph; it's all there after a reload; French; no page errors.
// Its own file server on 4322.
// usage: node tests/probe_history.js [screenshot dir]
const puppeteer = require("puppeteer-core");
const http = require("http");
const fs = require("fs");
const path = require("path");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const REPO = process.env.PMC_SITE || path.join(__dirname, "..");
const PORT = 4322, BASE = "http://localhost:" + PORT + "/";
const OUT = process.argv[2] || null;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra).slice(0, 1600) : "")); if (!ok) fails++; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function logs() {
  const out = {};
  const now = new Date();
  const add = (name, ts, won, opp, extra) => {
    const d = new Date(ts);
    const day = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    const log = (out[name] = out[name] || { name, sessions: [] });
    let s = log.sessions.find((x) => x.date === day);
    if (!s) log.sessions.push((s = { date: day, wins: 0, gamesWon: [], opponents: [], games: [] }));
    s.games.push(Object.assign({ ts: new Date(ts).toISOString(), gameType: "8ball", gameLabel: "8-Ball", target: 1, unit: "rack", result: won ? "won" : "lost", winnerNames: [won ? name : opp], opponentNames: [opp], teammateNames: [], isTeam: false }, extra || {}));
    if (won) s.wins += 1;
  };
  const evening = (ago) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - ago, 20, 0).getTime();
  // a night of racks: [winner, loser, extra] each, 10 minutes apart
  const night = (ago, racks) => racks.forEach(([w, l, extra], i) => {
    const t = evening(ago) + i * 600000;
    add(w, t, true, l, extra);
    add(l, t, false, w, extra);
  });
  const many = (w, l, n) => Array.from({ length: n }, () => [w, l]);
  night(12, [].concat(many("Ace", "Bob", 8), many("Bob", "Ace", 4)));
  night(8, [].concat(many("Cid", "Bob", 6), many("Bob", "Cid", 4)));
  // two races to 3: the last rack of each marked wonRace, as the scoreboard does
  const r = { raceTarget: 3 };
  const last = { raceTarget: 3, wonRace: true };
  night(4, [["Bob", "Ace", r], ["Ace", "Bob", r], ["Bob", "Ace", r], ["Bob", "Ace", last], ["Ace", "Bob", r], ["Bob", "Ace", r], ["Ace", "Bob", r], ["Bob", "Ace", r], ["Bob", "Ace", last]]);
  // (the last night: one of Dee's racks a skunk - Cid potted nothing)
  night(1, [["Dee", "Cid", { skunk: true }]].concat(many("Dee", "Cid", 4), many("Cid", "Dee", 5)));
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
  const page = await browser.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewport({ width: 1180, height: 820 });
  // (a stand-in voice: what would be said, each line taking __speechMs)
  await page.evaluateOnNewDocument(() => {
    window.__said = [];
    window.__speechMs = 0;
    const synth = {
      speaking: false,
      pending: false,
      q: [],
      speak(u) {
        window.__said.push({ text: u.text, lang: u.lang, rate: u.rate, at: Date.now() });
        this.q.push(u);
        this.run();
      },
      run() {
        if (this.speaking || !this.q.length) return;
        const u = this.q.shift();
        this.speaking = true;
        setTimeout(() => {
          this.speaking = false;
          if (u.onend) u.onend();
          this.run();
        }, window.__speechMs);
      },
      cancel() {
        this.q = [];
        this.speaking = false;
      },
      getVoices() {
        return [];
      },
      addEventListener() {},
      removeEventListener() {}
    };
    Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
  });
  try {
    await page.goto(BASE, { waitUntil: "networkidle2" });
    await page.evaluate((logs) => {
      localStorage.clear();
      ["onboardingSeen", "boardTipsSeen", "homeScreenTipSeen", "migratedFromRepo"].forEach((k) => localStorage.setItem("poolMasterCounter." + k + ".v1", "1"));
      localStorage.setItem("poolMasterCounter.playerStats.v1", JSON.stringify(logs));
      localStorage.setItem("poolMasterCounter.state.v2", JSON.stringify({
        players: ["Ace", "Bob", "Cid", "Dee"].map((n) => ({ id: n.toLowerCase(), name: n, playing: n === "Ace" || n === "Bob", balls: 0 })),
        playerWins: {}, teamWins: {}, teamMvpWins: {}, gameHistory: [], gamesPlayedCount: 0,
        currentGame: { gameType: "8ball", target: 1, unit: "rack", mode: "individual" }, raceToWinsTarget: 3, rotation: { enabled: false, order: [], every: 1 }
      }));
    }, logs());
    const open = async () => {
      await page.goto(BASE, { waitUntil: "networkidle2" });
      await sleep(900);
      await page.evaluate(() => document.getElementById("btn-open-leaderboard").click());
      await sleep(600);
      await page.evaluate(() => document.getElementById("btn-leaderboard-history").click());
      await sleep(700);
    };
    const card = (type) => '#history-cards .history-card[data-type="' + type + '"]';
    // a card's tooltip on night i (0-based, of the nights shown): its text
    const tipAt = async (type, i, count) => {
      const svg = await page.$(card(type) + " .hc-svg");
      await page.evaluate((sel) => document.querySelector(sel).scrollIntoView({ block: "center" }), card(type) + " .hc-svg");
      await sleep(200);
      const geo = await page.evaluate((sel) => {
        const s = document.querySelector(sel);
        const r = s.getBoundingClientRect();
        const scale = r.width / Number(s.getAttribute("width"));
        const hit = [...s.querySelectorAll("rect")].pop();
        return { left: r.left, top: r.top, scale, x: Number(hit.getAttribute("x")) + 12, w: Number(hit.getAttribute("width")) - 24, h: r.height };
      }, card(type) + " .hc-svg");
      const px = geo.x + (count > 1 ? (i / (count - 1)) * geo.w : geo.w / 2);
      await page.mouse.move(geo.left + px * geo.scale, geo.top + geo.h * 0.3);
      await sleep(250);
      void svg;
      return page.evaluate((sel) => (document.querySelector(sel + " .hc-tip:not([hidden])") || {}).innerText || "", card(type));
    };

    await open();
    let s = await page.evaluate(() => ({
      visible: !document.getElementById("view-history-page").classList.contains("hidden"),
      cards: [...document.querySelectorAll("#history-cards .history-card")].map((c) => c.dataset.type + ":" + [...c.querySelectorAll("select")].map((x) => x.value).join("/")),
      chips: [...document.querySelectorAll(".history-player-chip")].map((b) => b.textContent + (b.getAttribute("aria-pressed") === "true" ? "*" : "")),
      range: document.getElementById("history-range-label").textContent,
      ends: [...document.querySelectorAll('#history-cards .history-card[data-type="leaderboard"] .hc-svg text')].map((t) => t.textContent).filter((t) => /^#\d+ /.test(t)),
      paths: document.querySelectorAll('#history-cards .history-card[data-type="leaderboard"] .hc-svg path[stroke-width="3"]').length,
      legend: (document.querySelector('#history-cards .history-card[data-type="leaderboard"] .history-legend') || {}).innerText || ""
    }));
    check("📈 History opens from the leaderboard: one 🏆 graph (" + s.cards.join() + "), the 4 picked (" + s.chips.join(", ") + "), \"" + s.range + "\"",
      s.visible && s.cards.join() === "leaderboard:mvp/all" && s.chips.length === 4 && s.chips.every((c) => c.endsWith("*")) && /· 4 nights$/.test(s.range), s);
    check("...a line per player, end labels " + JSON.stringify(s.ends) + ", the ▲▼ legend",
      s.paths >= 4 && s.ends.length === 4 && s.ends[0].startsWith("#1 ") && /won a race/.test(s.legend) && /lost games/.test(s.legend) && /moved by the others/.test(s.legend), s);
    if (OUT) await page.screenshot({ path: path.join(OUT, "history.png"), fullPage: true });

    // ---- the night of Bob's races (the 3rd of 4) ----
    const tip = await tipAt("leaderboard", 2, 4);
    const row = (name) => (tip.split("\n#").find((r) => new RegExp("^\\d+\\n" + name + " · ").test(r)) || "").replace(/\n/g, " | ");
    check("the races night: Bob \"" + row("Bob") + "\"", /^1 \| Bob · [\d.]+ \| ▲ from #3 · won 2 races · 6–3 that night · passed Ace, Cid$/.test(row("Bob")), tip);
    check("...Ace \"" + row("Ace") + "\"", /^2 \| Ace · [\d.]+ \| ▼ from #1 · 3–6 that night · passed by Bob$/.test(row("Ace")), tip);
    check("...Cid \"" + row("Cid") + "\"", /^3 \| Cid · [\d.]+ \| ▼ from #2 · didn't play · passed by Bob$/.test(row("Cid")), tip);
    const arrows = await page.evaluate(() => {
      const H = PMCLib.historyCharts;
      const fills = [...document.querySelectorAll('#history-cards .history-card[data-type="leaderboard"] .hc-svg path')].map((p) => p.getAttribute("fill") + "|" + p.getAttribute("stroke"));
      const mode = document.querySelector(".hc-host").style.getPropertyValue("--hc-surface") === H.CHROME.light.surface ? "light" : "dark";
      return { race: fills.some((f) => f.startsWith(H.ARROWS[mode].race + "|")), down: fills.some((f) => f.startsWith(H.ARROWS[mode].down + "|")), passive: fills.some((f) => f.endsWith("|" + H.ARROWS[mode].passiveDown)) };
    });
    check("...their arrows drawn: gold ⏫ race, red ▼, hollow grey ▽ " + JSON.stringify(arrows), arrows.race && arrows.down && arrows.passive);

    // ---- the library ----
    for (const type of ["rating", "winTrend", "headToHead", "activity"]) {
      await page.select("#history-add", type);
      await sleep(400);
    }
    await page.evaluate((sel) => {
      const sels = document.querySelectorAll(sel + " select");
      sels[0].value = "Ace";
      sels[0].dispatchEvent(new Event("change"));
    }, card("headToHead"));
    await sleep(200);
    await page.evaluate((sel) => {
      const sels = document.querySelectorAll(sel + " select");
      sels[1].value = "Bob";
      sels[1].dispatchEvent(new Event("change"));
    }, card("headToHead"));
    await sleep(300);
    s = await page.evaluate(() => {
      const c = (t) => document.querySelector('#history-cards .history-card[data-type="' + t + '"]');
      return {
        types: [...document.querySelectorAll("#history-cards .history-card")].map((x) => x.dataset.type),
        ratingLines: c("rating").querySelectorAll('.hc-svg path[stroke-width="3"]').length,
        ratingEnds: [...c("rating").querySelectorAll(".hc-svg text")].map((t) => t.textContent).filter((t) => /^\d{3} /.test(t)),
        trendEnds: [...c("winTrend").querySelectorAll(".hc-svg text")].map((t) => t.textContent).filter((t) => /^\d+% /.test(t)),
        h2h: c("headToHead").querySelector(".history-card-note").textContent,
        cells: c("activity").querySelectorAll(".hc-svg rect[rx]:not([width=\"14\"])").length,
        rings: c("activity").querySelectorAll(".hc-svg circle").length
      };
    });
    check("the library: " + s.types.join(", ") + " - rating " + JSON.stringify(s.ratingEnds) + ", win % " + JSON.stringify(s.trendEnds),
      s.types.join() === "leaderboard,rating,winTrend,headToHead,activity" && s.ratingLines === 4 && s.ratingEnds.length === 4 && s.trendEnds.length >= 3, s);
    check("...⚔️ \"" + s.h2h + "\"; 📅 " + s.cells + " cells, " + s.rings + " ring(s) for the races", s.h2h === "One-on-one: Ace 11 – 10 Bob (21 games)" && s.cells === 16 && s.rings >= 1, s);
    const h2hTip = await tipAt("headToHead", 2, 4);
    check("...⚔️ on the races night: \"" + h2hTip.replace(/\n/g, " | ") + "\"", /11[\s\S]*Ace[\s\S]*3–6 that night[\s\S]*10[\s\S]*Bob/.test(h2hTip), h2hTip);
    const actTip = await tipAt("activity", 2, 4);
    check("...📅 on the races night: \"" + actTip.replace(/\n/g, " | ") + "\"", /9 games\nAce\n3–6 that night/.test(actTip) && /9 games\nBob\n6–3 that night · won 2 races/.test(actTip), actTip);
    if (OUT) await page.screenshot({ path: path.join(OUT, "history_library.png"), fullPage: true });

    // ---- colours follow the player ----
    const colours = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll(".history-player-chip")].map((b) => [b.textContent, b.querySelector(".history-line-key").style.background])));
    const before = await colours();
    await page.evaluate(() => [...document.querySelectorAll(".history-player-chip")].find((b) => b.textContent === "Cid").click());
    await sleep(300);
    const without = await colours();
    const lines = await page.evaluate(() => document.querySelectorAll('#history-cards .history-card[data-type="rating"] .hc-svg path[stroke-width="3"]').length);
    await page.evaluate(() => [...document.querySelectorAll(".history-player-chip")].find((b) => b.textContent === "Cid").click());
    await sleep(300);
    const back = await colours();
    check("Cid taken off (rating lines: " + lines + "), the others keep their colours; put back, his own again", lines === 3 && !without.Cid.includes("rgb") && ["Ace", "Bob", "Dee"].every((n) => without[n] === before[n]) && back.Cid === before.Cid, { before, without, back });

    // ---- the table ----
    const rows = await page.evaluate(() => {
      const d = document.querySelector('#history-cards .history-card[data-type="leaderboard"] details');
      d.open = true;
      return [...d.querySelectorAll("tbody tr")].map((r) => r.innerText.replace(/\t/g, " "));
    });
    check("📋 table: a row a night, newest first (" + rows.length + ")", rows.length === 4 && /#/.test(rows[0]), rows);

    // ---- the range: a preset, then the bar's left edge dragged in ----
    await page.evaluate(() => [...document.querySelectorAll("#history-range-presets button")][3].click());
    await sleep(300);
    const twoWeeks = await page.evaluate(() => document.getElementById("history-range-label").textContent);
    await page.evaluate(() => [...document.querySelectorAll("#history-range-presets button")][0].click());
    await sleep(300);
    await page.evaluate(() => document.getElementById("history-brush").scrollIntoView({ block: "center" }));
    await sleep(200);
    const bar = await (await page.$("#history-brush")).boundingBox();
    await page.mouse.move(bar.x + 8, bar.y + bar.height / 2);
    await page.mouse.down();
    await page.mouse.move(bar.x + bar.width * 0.55, bar.y + bar.height / 2, { steps: 6 });
    await page.mouse.up();
    await sleep(400);
    const dragged = await page.evaluate(() => ({ label: document.getElementById("history-range-label").textContent, cols: document.querySelectorAll('#history-cards .history-card[data-type="activity"] .hc-svg rect[rx]:not([width="14"])').length }));
    check("range: \"2 weeks\" → \"" + twoWeeks + "\"; the left edge dragged in → \"" + dragged.label + "\" (" + dragged.cols + " activity cells)", /· 4 nights$/.test(twoWeeks) && /· 2 nights$/.test(dragged.label) && dragged.cols === 8, { twoWeeks, dragged });

    // ---- ▶ replay, the commentator: everyone, at ⚡ very fast ----
    await page.evaluate(() => [...document.querySelectorAll("#history-range-presets button")][0].click());
    await sleep(200);
    await page.select("#history-speed", "veryFast");
    await page.select("#history-trash", "none");
    // each night's commentary as it comes up, until the replay ends
    const replay = async (pauseAt) => {
      await page.evaluate(() => document.getElementById("btn-history-replay").click());
      const seen = [];
      const out = { seen, playing: null, paused: null };
      for (let k = 0; k < 120; k++) {
        await sleep(100);
        const st = await page.evaluate(() => ({
          now: document.getElementById("history-say-now").innerText,
          btn: document.getElementById("btn-history-replay").textContent,
          stop: !document.getElementById("btn-history-stop").classList.contains("hidden"),
          big: [...document.querySelectorAll('#history-cards .history-card[data-type="leaderboard"] .hc-svg text[font-size="28"]')].map((t) => t.textContent),
          focus: document.querySelectorAll('#history-cards .history-card[data-type="leaderboard"] .hc-svg path[stroke-width="5"]').length,
          timeline: [...document.querySelectorAll(".history-timeline-night")].map((li) => li.className + ": " + li.innerText.replace(/\n/g, " | "))
        }));
        if (!out.playing) out.playing = st;
        if (st.now && seen[seen.length - 1] !== st.now) {
          seen.push(st.now);
          if (pauseAt && seen.length === pauseAt) {
            // ⏸: the night stays put; ▶ Resume goes on
            await page.evaluate(() => document.getElementById("btn-history-replay").click());
            const btn = await page.evaluate(() => document.getElementById("btn-history-replay").textContent);
            await sleep(2200);
            const still = await page.evaluate(() => document.getElementById("history-say-now").innerText);
            out.paused = { btn, same: still === st.now, timeline: st.timeline, focus: st.focus };
            await page.evaluate(() => document.getElementById("btn-history-replay").click());
          }
        }
        if (k > 3 && st.btn === "▶ Replay") break;
      }
      out.end = await page.evaluate(() => ({ btn: document.getElementById("btn-history-replay").textContent, stop: !document.getElementById("btn-history-stop").classList.contains("hidden"), panel: !document.getElementById("history-commentary").classList.contains("hidden"), earlier: document.getElementById("history-say-earlier-summary").textContent, big: document.querySelectorAll(".hc-svg text[font-size=\"28\"]").length }));
      return out;
    };
    let rp = await replay();
    const flat = rp.seen.map((x) => x.replace(/\n+/g, " | "));
    check("▶ replay: \"" + rp.playing.btn + "\" + ⏹, the night's date " + JSON.stringify(rp.playing.big) + "; at the end \"" + rp.end.btn + "\", the commentary kept (" + rp.end.earlier + ")",
      rp.playing.btn === "⏸ Pause" && rp.playing.stop && rp.playing.big.length === 1 && rp.end.btn === "▶ Replay" && !rp.end.stop && rp.end.panel && rp.end.big === 0 && rp.seen.length === 4, rp.end);
    check("🎙️ the commentator, night by night: " + JSON.stringify(flat),
      /🏁 Ace sets the early pace at #1\.$/.test(flat[0]) &&
      /👋 Cid enters the rankings at #2\./.test(flat[1]) && /↘️ Bob slips from #2 to #3\./.test(flat[1]) &&
      /👑 [^|]*Bob[^|]*Ace[^|]*won 2 races/.test(flat[2]) && /⚔️ Top-3 clash: Bob beats Ace 6–3\./.test(flat[2]) && !/Ace slips/.test(flat[2]) &&
      /↘️ Ace slips from #2 to #3\./.test(flat[3]) && /🦨 Skunk! Dee shuts out Cid\./.test(flat[3]) && !/Dee enters/.test(flat[3]), flat);

    // ---- 🎯 following Bob: his whole night, the timeline, his line on top; ⏸ / ▶ Resume ----
    await page.select("#history-follow", "Bob");
    await sleep(300);
    rp = await replay(3);
    const bob = rp.seen.map((x) => x.replace(/\n+/g, " | "));
    check("🎯 following Bob - the races night: " + JSON.stringify(bob[2]),
      /· 🎯 Bob/.test(bob[2]) && /👑 [^|]*Bob/.test(bob[2]) && /🎱 Bob goes 6–3 tonight: beats Ace 6–3\. 🏁 2 races won!/.test(bob[2]) && /🌟 Career best for Bob: #1!/.test(bob[2]) && /🛡️ [\d.]+ points ahead of Ace \(#2\)\./.test(bob[2]) && /📈 Rating \+\d+, now \d+\./.test(bob[2]) && /🏆 Bob's first race win!/.test(bob[2]) && !/Top-3 clash/.test(bob[2]) && !/moves up/.test(bob[2]), bob);
    check("...⏸ \"" + (rp.paused || {}).btn + "\" holds the night; his line on top (" + (rp.paused || {}).focus + "); 🎯 his timeline " + JSON.stringify((rp.paused || {}).timeline),
      rp.paused && rp.paused.btn === "▶ Resume" && rp.paused.same && rp.paused.focus === 1 && rp.paused.timeline.length === 3 && /is-now/.test(rp.paused.timeline[0]) && /#1/.test(rp.paused.timeline[0]) && /🎱 Bob goes 6–3/.test(rp.paused.timeline[0]), rp.paused);
    // (⏹ mid-way: stopped, the commentary kept)
    await page.evaluate(() => document.getElementById("btn-history-replay").click());
    await sleep(700);
    await page.evaluate(() => document.getElementById("btn-history-stop").click());
    await sleep(200);
    const stopped = await page.evaluate(() => ({ btn: document.getElementById("btn-history-replay").textContent, panel: !document.getElementById("history-commentary").classList.contains("hidden"), speed: document.getElementById("history-speed").value }));
    check("⏹ mid-way: \"" + stopped.btn + "\", the commentary still there; the speed kept (" + stopped.speed + ")", stopped.btn === "▶ Replay" && stopped.panel && stopped.speed === "veryFast", stopped);
    await page.select("#history-follow", "");
    await sleep(200);

    // ---- 🔊 the voice: each line said, as it should sound; the replay waits for it ----
    await page.evaluate(() => { window.__said = []; window.__speechMs = 900; });
    const voice0 = await page.evaluate(() => document.getElementById("btn-history-voice").textContent);
    const times = [];
    await page.evaluate(() => document.getElementById("btn-history-replay").click());
    let lastNow = null;
    for (let k = 0; k < 200; k++) {
      await sleep(100);
      const st = await page.evaluate(() => ({ now: document.getElementById("history-say-now").innerText, btn: document.getElementById("btn-history-replay").textContent }));
      if (st.now !== lastNow) {
        times.push(Date.now());
        lastNow = st.now;
      }
      if (k > 3 && st.btn === "▶ Replay") break;
    }
    const said = await page.evaluate(() => window.__said.map((x) => x.text + " [" + x.lang + " " + x.rate + "]"));
    const racesNight = times[3] - times[2];
    check("🔊 \"" + voice0 + "\": each night's day and date first, every line said, no emoji, \"6 to 3\", \"number 1\" - " + JSON.stringify(said.slice(0, 7)),
      voice0 === "🔊 Voice on" && said.some((t) => /^Top-3 clash: Bob beats Ace 6 to 3\. \[en-GB 1\.(3|29\d*)\]$/.test(t)) &&
      said.filter((t) => /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), (January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}( \[|, \d{4} \[)/.test(t)).length === 4 &&
      /^(Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day, /.test(said[0]) && said.some((t) => /^Ace sets the early pace at number 1\./.test(t)) && said.every((t) => !/[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/u.test(t)) && said.length >= 8, said);
    check("...the replay waits for the voice: the races night (its date and 3 lines, 0.9 s each) stayed up " + racesNight + " ms", racesNight >= 3600, times);
    // (voice off: nothing said)
    await page.evaluate(() => { window.__said = []; window.__speechMs = 0; document.getElementById("btn-history-voice").click(); });
    const voiceOff = await page.evaluate(() => document.getElementById("btn-history-voice").textContent);
    rp = await replay();
    const saidOff = await page.evaluate(() => window.__said.length);
    check("🔇 \"" + voiceOff + "\": the replay runs (" + rp.seen.length + " nights), nothing said", voiceOff === "🔇 Voice off" && rp.seen.length === 4 && saidOff === 0, { saidOff });
    await page.evaluate(() => document.getElementById("btn-history-voice").click());

    // ---- the page stays put during a replay, wherever it was scrolled ----
    await page.evaluate(() => document.querySelector('#history-cards .history-card[data-type="rating"]').scrollIntoView({ block: "start" }));
    await sleep(300);
    const y0 = await page.evaluate(() => window.scrollY);
    await page.evaluate(() => document.getElementById("btn-history-replay").click());
    const ys = [];
    for (let k = 0; k < 80; k++) {
      await sleep(100);
      const st = await page.evaluate(() => ({ y: window.scrollY, btn: document.getElementById("btn-history-replay").textContent }));
      ys.push(st.y);
      if (k > 3 && st.btn === "▶ Replay") break;
    }
    const barPos = await page.evaluate(() => getComputedStyle(document.getElementById("history-commentary")).position);
    check("the page stays put during a replay (scrolled to " + y0 + ": " + [...new Set(ys)].join(", ") + "); the commentary a " + barPos + " bar", y0 > 300 && ys.every((y) => Math.abs(y - y0) <= 1) && barPos === "fixed", { y0, ys });
    await page.evaluate(() => document.getElementById("btn-history-say-close").click());
    await sleep(200);
    const closed = await page.evaluate(() => document.getElementById("history-commentary").classList.contains("hidden"));
    check("✕ closes the commentary", closed);

    // ---- the amount of detail, and the trash talk ----
    await page.select("#history-detail", "headlines");
    rp = await replay();
    const heads = rp.seen.map((x) => x.replace(/\n+/g, " | "));
    await page.select("#history-detail", "everything");
    rp = await replay();
    const every = rp.seen.map((x) => x.replace(/\n+/g, " | "));
    check("📰 headlines - the moves at the top only: " + JSON.stringify(heads),
      /👑 [^|]*Bob/.test(heads[2]) && !/Top-3 clash/.test(heads[2]) && !/slips/.test(heads.join()) && !/Skunk/.test(heads[3]), heads);
    check("🔎 everything - every moment: " + JSON.stringify(every[0]) + " … " + JSON.stringify(every[3]),
      /🎱 Ace: 8–4\./.test(every[0]) && /🔥 Ace wins 8 in a row\./.test(every[0]) && /🎱 Bob: 4–8\./.test(every[0]) && /🦨 Skunk! Dee shuts out Cid\./.test(every[3]) && /👋 Dee enters the rankings at #4\./.test(every[3]) && /🎱 Dee: 5–5\./.test(every[3]), every);
    // (🎙️ Earlier, after everything: a long list that scrolls)
    const scrolled = await page.evaluate(async () => {
      const d = document.getElementById("history-say-earlier");
      d.open = true;
      await new Promise((r) => setTimeout(r, 200));
      const log = document.getElementById("history-say-log");
      return { overflow: getComputedStyle(log).overflowY, tall: log.scrollHeight > log.clientHeight };
    });
    const logBox = await (await page.$("#history-say-log")).boundingBox();
    await page.mouse.move(logBox.x + logBox.width / 2, logBox.y + logBox.height / 2);
    await page.mouse.wheel({ deltaY: 300 });
    await sleep(300);
    const after = await page.evaluate(() => ({ top: document.getElementById("history-say-log").scrollTop, page: window.scrollY }));
    check("🎙️ Earlier scrolls (" + JSON.stringify(scrolled) + ", scrolled to " + after.top + ")", scrolled.overflow === "auto" && scrolled.tall && after.top > 0, { scrolled, after });
    await page.evaluate(() => { document.getElementById("history-say-earlier").open = false; });
    await page.select("#history-detail", "normal");
    await page.select("#history-trash", "lots");
    rp = await replay();
    const lots = rp.seen.map((x) => x.replace(/\n+/g, " | "));
    check("🔥 lots of trash talk: a quip under the news it teases - " + JSON.stringify(lots[2]), /😏/.test(lots.join()) && /👑 [^|]*\| 😏 [^|]*Ace/.test(lots[2]), lots);
    await page.select("#history-trash", "none");
    rp = await replay();
    check("😇 no trash talk: no quip", !/😏/.test(rp.seen.join()), rp.seen);

    // ---- ✕, then a reload ----
    await page.evaluate(() => document.querySelector('#history-cards .history-card[data-type="winTrend"] .history-card-remove').click());
    await sleep(300);
    await open();
    s = await page.evaluate(() => ({ types: [...document.querySelectorAll("#history-cards .history-card")].map((x) => x.dataset.type), h2h: [...document.querySelectorAll('#history-cards .history-card[data-type="headToHead"] select')].map((x) => x.value) }));
    check("✕ removes the 🎯 graph; after a reload: " + s.types.join(", ") + " (⚔️ " + s.h2h.join(" v ") + ")", s.types.join() === "leaderboard,rating,headToHead,activity" && s.h2h.join() === "Ace,Bob", s);

    // ---- in French ----
    await page.evaluate(() => localStorage.setItem("poolMasterCounter.language.v1", "french"));
    await open();
    s = await page.evaluate(() => ({ btn: document.getElementById("btn-history-replay").textContent, title: document.querySelector(".history-card-title").textContent, legend: document.querySelector(".history-legend").innerText }));
    check("in French: \"" + s.btn + "\", \"" + s.title + "\"", s.btn === "▶ Rejouer" && s.title === "🏆 Place au classement" && /course gagnée/.test(s.legend), s);
  } finally {
    check("no page errors", errors.length === 0, errors);
    await browser.close();
    site.close();
  }
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log("FAIL crashed: " + (e && e.stack)); process.exit(1); });
