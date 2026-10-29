// Many tables (P22), against server/server.js on 4277 (a throwaway HOME):
// - 8 players, round robin in rounds (the circle method: 7 rounds of 4, everyone once a round),
//   3 tables: the first three matches start on tables 1-3 by themselves, six different players;
// - a table frees: the next match in the queue starts there, nobody in two live matches - at
//   every step;
// - auto-assign off: ▶ Play on a match whose player is still playing is refused ("Kim is playing
//   on Table 1"), one with both players free starts on the free table; auto back on fills a new
//   table; ↔ Table moves a live match to a free table;
// - 📺 Next up: "Table N: A vs B - go now", every live table's score, the queue (and who it
//   waits for), a QR to follow;
// - over the relay (🎯 Host This Session): a table's own device (?join=1&table=2) has no Abandon,
//   ⋯ More or manage row; its + scores table 2 on the host, table 1's + is disabled, and an
//   action claiming table 1 from table 2's device is ignored by the host; with table 2 free it
//   starts a match there;
// - follow.html (no pairing, /ws-follow): the live tables, the standings, "Me" → my next match;
//   it receives only the event's summary, never the app's state;
// - no page errors.
// usage: node tests/probe_multi_table.js [screenshot dir]
const puppeteer = require("puppeteer-core");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const REPO = path.join(__dirname, "..");
const PORT = 4277, REAL = "http://localhost:" + PORT + "/";
const OUT = process.argv[2];
let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra).slice(0, 1200) : "")); if (!ok) fails++; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PLAYERS = ["Ann", "Ben", "Cat", "Dan", "Eve", "Fay", "Gus", "Hal"];

(async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "pmc-multi-"));
  const server = spawn(process.execPath, [path.join(REPO, "server", "server.js")], { env: Object.assign({}, process.env, { HOME: home, PORT: String(PORT) }), stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  server.stdout.on("data", (d) => (log += d));
  server.stderr.on("data", (d) => (log += d));
  const browser = await puppeteer.launch({ executablePath: EXE, headless: "new" });
  const errors = [];
  try {
    for (let i = 0; i < 60 && !/running on port/.test(log); i++) await sleep(150);
    const host = await browser.newPage();
    host.on("pageerror", (e) => errors.push("host: " + e.message));
    await host.setViewport({ width: 1280, height: 900 });
    const T = () => host.evaluate(() => JSON.parse(localStorage.getItem("poolMasterCounter.tournament.v1") || "null"));
    const lastToast = () => host.evaluate(() => (document.getElementById("page-toast") || {}).textContent || "");
    const closePopups = (pg) => pg.evaluate(() => {
      for (let i = 0; i < 4; i++) {
        const o = [...document.querySelectorAll("[id$='-overlay']")].find((x) => !x.classList.contains("hidden") && getComputedStyle(x).display !== "none" && x.getClientRects().length);
        if (!o) return;
        const b = [...o.querySelectorAll("button.btn-primary")].find((x) => x.getClientRects().length);
        if (b) b.click(); else return;
      }
    });
    const doubleBooked = (t) => {
      const seen = {};
      for (const a of t.activeMatches) {
        const m = t.matches.find((x) => x.id === a.matchId);
        for (const n of [m.a, m.b]) { if (seen[n]) return n; seen[n] = true; }
      }
      return null;
    };
    const live = (t) => t.activeMatches.map((a) => { const m = t.matches.find((x) => x.id === a.matchId); return { table: a.table, a: m.a, b: m.b, round: m.round, id: m.id }; }).sort((x, y) => x.table - y.table);
    // finishes the match on a table from the host's board (Enter score 2-0)
    const finishOn = async (table) => {
      await host.evaluate((table) => {
        const board = [...document.querySelectorAll(".tournament-floating-board")].find((b) => new RegExp("Table " + table + "\\b").test(b.querySelector(".tournament-now-playing").textContent));
        board.querySelector(".tournament-enter-score").click();
      }, table);
      await host.waitForSelector("#tournament-score-a", { timeout: 3000 });
      await host.evaluate(() => { document.getElementById("tournament-score-a").value = 2; document.getElementById("tournament-score-b").value = 0; document.getElementById("btn-tournament-score-save").click(); });
      await sleep(700);
      await closePopups(host);
      await sleep(400);
    };

    await host.goto(REAL + "manifest.json");
    await host.evaluate((players) => {
      localStorage.clear();
      localStorage.setItem("poolMasterCounter.onboardingSeen.v1", "1");
      localStorage.setItem("poolMasterCounter.boardTipsSeen.v1", "1");
      localStorage.setItem("poolMasterCounter.state.v2", JSON.stringify({ players: players.map((n, i) => ({ id: "p" + i, name: n, playing: i < 2, balls: 0 })), playerWins: {}, teamWins: {}, teamMvpWins: {}, gameHistory: [], currentGame: { gameType: "8ball", target: 1, unit: "rack", mode: "individual" }, raceToWinsTarget: 5, rotation: { enabled: false, order: [], every: 1 } }));
    }, PLAYERS);
    await host.goto(REAL, { waitUntil: "networkidle2" });
    await sleep(800);
    await host.evaluate(() => document.getElementById("btn-open-tournament").click());
    await sleep(500);
    await host.click('input[name="tournament-format"][value="roundrobin"]');
    await host.click("#btn-tournament-setup-next");
    await sleep(200);
    await host.evaluate(() => { const i = document.getElementById("tournament-race-to"); i.value = 2; i.dispatchEvent(new Event("change", { bubbles: true })); });
    await host.click("#btn-tournament-setup-next");
    await sleep(200);
    await host.click("#btn-tournament-setup-next");
    await sleep(200);
    await host.evaluate(() => { const i = document.getElementById("tournament-table-count"); i.value = 3; i.dispatchEvent(new Event("change", { bubbles: true })); });
    await host.click("#btn-tournament-start");
    await sleep(900);

    let t = await T();
    const rounds = {};
    t.matches.forEach((m) => { (rounds[m.round] = rounds[m.round] || []).push(m); });
    const roundsOk = Object.keys(rounds).length === 7 && Object.values(rounds).every((r) => r.length === 4 && new Set(r.flatMap((m) => [m.a, m.b])).size === 8);
    check("8 players, round robin in rounds: 7 rounds of 4, everyone once a round (the circle method)", t.matches.length === 28 && roundsOk, Object.values(rounds).map((r) => r.length));
    let l = live(t);
    check("3 tables: the first three matches started on tables 1-3 by themselves - six different players, round 1", l.length === 3 && l.map((x) => x.table).join() === "1,2,3" && new Set(l.flatMap((x) => [x.a, x.b])).size === 6 && l.every((x) => x.round === 1) && !doubleBooked(t), l);

    // a table frees
    const before2 = l.find((x) => x.table === 2);
    await finishOn(2);
    t = await T();
    l = live(t);
    const new2 = l.find((x) => x.table === 2);
    check("table 2 finishes: the next match in the queue starts there by itself, nobody in two live matches", new2 && new2.id !== before2.id && !doubleBooked(t) && l.length === 3, { before2, l });

    // auto-assign off: a busy player's match is refused, a free one starts
    await host.evaluate(() => { const c = document.getElementById("tournament-auto-assign"); c.click(); });
    await sleep(300);
    await finishOn(3);
    t = await T();
    const busyName = live(t)[0].a;
    const busyMatch = t.matches.find((m) => !m.winner && !t.activeMatches.some((a) => a.matchId === m.id) && (m.a === busyName || m.b === busyName));
    await host.evaluate((id) => {
      const card = [...document.querySelectorAll(".tournament-match-card")].find((c) => c.querySelector(".tournament-play-btn") && c.__id === undefined && c.textContent);
      // the card for that match: by its two names
      return id;
    }, busyMatch.id);
    const clickPlay = (a, b) => host.evaluate((a, b) => {
      const card = [...document.querySelectorAll("#tournament-rr-matches .tournament-match-card")].find((c) => { const s = [...c.querySelectorAll(".tournament-match-side")].map((x) => x.textContent); return s.some((x) => x.startsWith(a)) && s.some((x) => x.startsWith(b)) && c.querySelector(".tournament-play-btn"); });
      if (!card) return false;
      card.querySelector(".tournament-play-btn").click();
      return true;
    }, a, b);
    await clickPlay(busyMatch.a, busyMatch.b);
    await sleep(400);
    const refused = await lastToast();
    t = await T();
    const stillTwo = t.activeMatches.length === 2;
    const busyNow = Object.fromEntries(live(t).flatMap((x) => [[x.a, 1], [x.b, 1]]));
    const freeMatch = t.matches.find((m) => !m.winner && !t.activeMatches.some((a) => a.matchId === m.id) && !busyNow[m.a] && !busyNow[m.b]);
    await clickPlay(freeMatch.a, freeMatch.b);
    await sleep(500);
    t = await T();
    l = live(t);
    check("auto-assign off: ▶ Play on " + busyMatch.a + " vs " + busyMatch.b + " is refused (\"" + refused.slice(0, 50) + "\"), one with both players free starts on table 3", stillTwo && /is playing on Table/.test(refused) && l.some((x) => x.table === 3 && x.id === freeMatch.id) && !doubleBooked(t), { refused, l });
    // a fourth table, auto back on
    await host.click("#btn-tournament-tables-more");
    await sleep(300);
    const fourOff = (await T()).activeMatches.length;
    await host.evaluate(() => document.getElementById("tournament-auto-assign").click());
    await sleep(500);
    t = await T();
    check("a 4th table: nothing starts with auto-assign off; back on, it fills table 4 - still nobody twice", fourOff === 3 && live(t).some((x) => x.table === 4) && !doubleBooked(t), live(t));
    // ↔ to a 5th table
    await host.click("#btn-tournament-tables-more");
    await sleep(300);
    await host.evaluate(() => { const c = document.getElementById("tournament-auto-assign"); if (c.checked) c.click(); });
    await sleep(300);
    const on1 = live(await T()).find((x) => x.table === 1);
    await host.evaluate(() => {
      const board = [...document.querySelectorAll(".tournament-floating-board")].find((b) => /Table 1\b/.test(b.querySelector(".tournament-now-playing").textContent));
      board.querySelector(".tournament-move-table").click();
    });
    await sleep(300);
    await host.evaluate(() => [...document.querySelectorAll("#tournament-chooser-overlay button")].find((b) => /Table 5/.test(b.textContent)).click());
    await sleep(500);
    t = await T();
    check("↔ Table: the match on table 1 moves to free table 5", live(t).some((x) => x.table === 5 && x.id === on1.id) && !live(t).some((x) => x.table === 1), live(t));
    await host.evaluate(() => { const c = document.getElementById("tournament-auto-assign"); if (!c.checked) c.click(); });
    await sleep(500);

    // 📺 Next up
    await host.click("#btn-tournament-next-up");
    await sleep(1500);
    const nu = await host.evaluate(() => ({ mode: document.body.getAttribute("data-tournament-tv"), call: (document.querySelector(".next-up-call") || {}).textContent || "", tables: document.querySelectorAll(".next-up-table").length, queue: [...document.querySelectorAll(".next-up-queue li")].map((li) => li.textContent), qr: !!document.querySelector(".next-up-follow img") }));
    t = await T();
    if (OUT) await host.screenshot({ path: path.join(OUT, "next_up_board.png") });
    check("📺 Next up: \"" + nu.call + "\", every live table (" + nu.tables + "), the queue and who it waits for, a QR to follow", nu.mode === "next" && /^Table \d+: \w+ vs \w+ - go now$/.test(nu.call) && nu.tables === t.activeMatches.length && nu.queue.length > 0 && nu.queue.some((q) => /waiting for/.test(q)) && nu.qr, nu);
    await host.keyboard.press("Escape");
    await sleep(300);

    // ---- over the relay ----
    await host.evaluate(() => document.getElementById("btn-group-session-host").click());
    await sleep(1500);
    // (a table 2 to score: table 2 live)
    t = await T();
    const guest = await browser.newPage();
    guest.on("pageerror", (e) => errors.push("guest: " + e.message));
    await guest.setViewport({ width: 1180, height: 820 });
    await guest.goto(REAL + "?join=1&table=2", { waitUntil: "networkidle2" });
    await sleep(1500);
    await guest.evaluate(() => document.getElementById("btn-open-tournament").click()).catch(() => {});
    await guest.evaluate(() => { const v = document.getElementById("view-tournament-page"); if (v.classList.contains("hidden")) window.history; });
    await sleep(800);
    const gUi = await guest.evaluate(() => {
      const shown = (id) => { const e = document.getElementById(id); return !!(e && e.getClientRects().length); };
      const boards = [...document.querySelectorAll(".tournament-floating-board")].map((b) => ({ head: b.querySelector(".tournament-now-playing").textContent, plusDisabled: [...b.querySelectorAll(".btn-ball.plus")].map((p) => p.disabled) }));
      return { guest: document.body.classList.contains("network-guest-mode"), abandon: shown("btn-tournament-abandon"), more: shown("btn-tournament-more"), manage: shown("tournament-manage-row"), myTable: document.getElementById("tournament-my-table").value, boards };
    });
    const b2 = gUi.boards.find((b) => /Table 2\b/.test(b.head)), b1 = gUi.boards.find((b) => /Table [13-9]\b/.test(b.head));
    check("a table's own device (?join=1&table=2): no Abandon, ⋯ More or manage row; table 2's + live, the other tables' disabled", gUi.guest && !gUi.abandon && !gUi.more && !gUi.manage && gUi.myTable === "2" && b2 && b2.plusDisabled.every((d) => !d) && b1 && b1.plusDisabled.every((d) => d), gUi);
    const t2before = live(await T()).find((x) => x.table === 2);
    const a2before = (await T()).activeMatches.find((a) => a.table === 2).aWins;
    await guest.evaluate(() => { const b = [...document.querySelectorAll(".tournament-floating-board")].find((x) => /Table 2\b/.test(x.querySelector(".tournament-now-playing").textContent)); b.querySelectorAll(".btn-ball.plus")[0].click(); });
    await sleep(1200);
    const a2after = ((await T()).activeMatches.find((a) => a.table === 2) || {}).aWins;
    check("...its + scores table 2 on the host (" + a2before + " → " + a2after + ")", a2after === a2before + 1, { a2before, a2after, t2before });
    // a forged action for another table, from table 2's device
    const other = (await T()).activeMatches.find((a) => a.table !== 2);
    const otherBefore = other.aWins;
    await guest.evaluate((port, matchId) => new Promise((resolve) => {
      const ws = new WebSocket("ws://localhost:" + port + "/ws");
      ws.onopen = () => { ws.send(JSON.stringify({ type: "hello", role: "guest", table: 2 })); ws.send(JSON.stringify({ type: "action", fn: "tournamentAdjustScore", args: [matchId, "a", 1] })); setTimeout(() => { ws.close(); resolve(); }, 500); };
      ws.onerror = () => resolve();
    }), PORT, other.matchId);
    await sleep(800);
    const otherAfter = ((await T()).activeMatches.find((a) => a.matchId === other.matchId) || {}).aWins;
    check("...an action for table " + other.table + " sent from table 2's device: the host ignores it", otherAfter === otherBefore, { otherBefore, otherAfter });
    // table 2 free (auto off on the host): the device starts a match there
    await host.evaluate(() => { const c = document.getElementById("tournament-auto-assign"); if (c.checked) c.click(); });
    await sleep(300);
    await guest.evaluate(() => { const b = [...document.querySelectorAll(".tournament-floating-board")].find((x) => /Table 2\b/.test(x.querySelector(".tournament-now-playing").textContent)); b.querySelectorAll(".btn-ball.plus")[0].click(); });
    await sleep(1500);
    await closePopups(host);
    await sleep(500);
    t = await T();
    const free2 = !t.activeMatches.some((a) => a.table === 2);
    // (one more table done on the host, so two free players haven't met yet)
    await finishOn(live(t).find((x) => x.table !== 2).table);
    t = await T();
    const busyG = Object.fromEntries(live(t).flatMap((x) => [[x.a, 1], [x.b, 1]]));
    const candidate = t.matches.find((m) => !m.winner && !t.activeMatches.some((a) => a.matchId === m.id) && !busyG[m.a] && !busyG[m.b] && (!m.table || m.table === 2));
    await guest.evaluate((a, b) => {
      const card = [...document.querySelectorAll("#tournament-rr-matches .tournament-match-card")].find((c) => { const s = [...c.querySelectorAll(".tournament-match-side")].map((x) => x.textContent); return s.some((x) => x.startsWith(a)) && s.some((x) => x.startsWith(b)); });
      const play = card && card.querySelector(".tournament-play-btn:not(.hidden)");
      if (play) play.click();
    }, candidate.a, candidate.b);
    await sleep(1500);
    t = await T();
    check("...its match won, table 2 free: ▶ Play on the device starts " + candidate.a + " vs " + candidate.b + " on table 2 (on the host)", free2 && t.activeMatches.some((a) => a.table === 2 && a.matchId === candidate.id) && !doubleBooked(t), { free2, live: live(t) });
    if (OUT) await guest.screenshot({ path: path.join(OUT, "table_device.png") });

    // ---- follow.html ----
    const follower = await browser.newPage();
    follower.on("pageerror", (e) => errors.push("follow: " + e.message));
    await follower.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
    const frames = [];
    const cdp = await follower.target().createCDPSession();
    await cdp.send("Network.enable");
    cdp.on("Network.webSocketFrameReceived", (e) => frames.push(e.response.payloadData));
    await follower.goto(REAL + "follow.html", { waitUntil: "networkidle2" });
    await sleep(1500);
    await follower.select("#follow-me", live(t)[0].a);
    await sleep(300);
    const f = await follower.evaluate(() => ({ text: document.getElementById("app").textContent, live: document.querySelectorAll(".live-dot").length, status: (document.querySelector(".me .status") || {}).textContent || "" }));
    if (OUT) await follower.screenshot({ path: path.join(OUT, "follow_page.png"), fullPage: true });
    check("follow.html (no pairing): the live tables (" + f.live + "), the standings, \"Me\" → \"" + f.status + "\"", f.live === live(t).length && /Standings/.test(f.text) && /Playing now on Table \d+ vs \w+/.test(f.status), f);
    check("...it receives only the event's summary - never the app's state", frames.length > 0 && frames.every((x) => /^\{"type":"follow"/.test(x) && !/"state"/.test(x) && !/gameHistory/.test(x)), frames.slice(0, 2).map((x) => x.slice(0, 80)));
  } finally {
    check("no page errors", errors.length === 0, errors);
    await browser.close();
    server.kill();
  }
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log("FAIL crashed: " + (e && e.stack)); process.exit(1); });
