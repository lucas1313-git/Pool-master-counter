// Merging another account's backup into the main one (2026-11-19, the user: "test the merging
// capabilities when I merge a new session from another account into the main account, test if it is
// flawless and that the old data is preserved"). Two browser profiles on the same test server, each
// its own app and data:
// - MAIN: Ace, Bob, Cid; 2 nights (10 days ago Ace v Bob 6–4, 6 days ago Ace v Cid 5–5 and Bob v
//   Cid 3–2); contacts (Ace's phone and email, Bob's phone, Cid's club team); a saved list; a day
//   note; "Old" removed; the dark theme;
// - OTHER account: the same first night Ace v Bob (the very same games - a copy both have), a new
//   night 2 days ago (Ace v Dan 4–3, "bob" in lower case v Dan 2–3, Old v Dan 3–1), a game being
//   played right now (Dan beats Ace); Ace's contact edited since (a nickname, its phone and email
//   left blank), Dan's; another saved list; a note on the first night and one on the new night;
//   another theme - exported with 👥 Back up for a shared folder (exportedBy "Phone").
// MAIN imports it - same-name players kept as the same person, "Old" left removed - then:
// - every game MAIN had is still there, once (by player: each game's time); the other's games
//   added, once - the shared night not doubled; "bob" folded into Bob; Dan and his games new;
//   the other's game in progress filed;
// - Ace's contact: the newer nickname AND MAIN's phone and email kept (blank never wipes a value);
//   Bob's phone kept though the other device made him a blank contact of its own, newer; Cid's
//   untouched; Dan's added;
// - both saved lists; the shared night's notes both kept, MAIN's first; the other's new-night note;
//   "Old" still removed (his games kept, off the roster); MAIN's theme unchanged; every player
//   rated, Dan included;
// - the same file again: nothing changes (no game twice);
// - MAIN as it was, the import again choosing "keep separate" for Bob: a "Bob (date)" with the
//   other's Bob games, MAIN's Bob untouched;
// - no page errors.
// Its own file server on 4325.
// usage: node tests/probe_merge.js
const puppeteer = require("puppeteer-core");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const REPO = process.env.PMC_SITE || path.join(__dirname, "..");
const PORT = 4325, BASE = "http://localhost:" + PORT + "/";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra).slice(0, 1600) : "")); if (!ok) fails++; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const now = new Date();
const evening = (ago, h) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - ago, h || 20, 0).getTime();
const dayOf = (ts) => { const d = new Date(ts); if (d.getHours() < 5) d.setDate(d.getDate() - 1); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
// game logs from racks [winner, loser, ts]
function logs(racks) {
  const out = {};
  const add = (name, ts, won, opp) => {
    const day = dayOf(ts);
    const log = (out[name] = out[name] || { name, sessions: [] });
    let s = log.sessions.find((x) => x.date === day);
    if (!s) log.sessions.push((s = { date: day, wins: 0, gamesWon: [], opponents: [], games: [], wonTournament: false }));
    s.games.push({ ts: new Date(ts).toISOString(), gameType: "8ball", gameLabel: "8-Ball", target: 1, unit: "rack", result: won ? "won" : "lost", winnerNames: [won ? name : opp], opponentNames: [opp], teammateNames: [], isTeam: false });
    if (won) { s.wins += 1; s.gamesWon.push("8-Ball"); }
    if (s.opponents.indexOf(opp) === -1) s.opponents.push(opp);
  };
  racks.forEach(([w, l, ts]) => { add(w, ts, true, l); add(l, ts, false, w); });
  return out;
}
const night = (ago, pairs) => {
  const out = [];
  let t = evening(ago);
  pairs.forEach(([w, l, n]) => { for (let i = 0; i < n; i++) out.push([w, l, (t += 600000)]); });
  return out;
};
const NIGHT1 = night(10, [["Ace", "Bob", 6], ["Bob", "Ace", 4]]);
const NIGHT2 = night(6, [["Ace", "Cid", 5], ["Cid", "Ace", 5], ["Bob", "Cid", 3], ["Cid", "Bob", 2]]);
const NIGHT3 = night(2, [["Ace", "Dan", 4], ["Dan", "Ace", 3], ["bob", "Dan", 2], ["Dan", "bob", 3], ["Old", "Dan", 3], ["Dan", "Old", 1]]);
const D1 = dayOf(NIGHT1[0][2]), D3 = dayOf(NIGHT3[0][2]);
const T_OLD = Date.now() - 20 * 86400000, T_NEW = Date.now() - 86400000;
const blank = { email: "", phone: "", nickname: "", clubTeam: "", reportOptIn: false, notifyMethod: "", fargoId: "", fargoName: "", fargoLocation: "", fargoRating: null, fargoRobustness: null, fargoFetchedAt: null };
const state = (names, extra) => Object.assign({
  players: names.map((n, i) => ({ id: "p" + i, name: n, playing: i < 2, balls: 0 })),
  playerWins: {}, teamWins: {}, teamMvpWins: {}, gameHistory: [], gamesPlayedCount: 0,
  currentGame: { gameType: "8ball", target: 1, unit: "rack", mode: "individual" }, raceToWinsTarget: 3, rotation: { enabled: false, order: [], every: 1 }
}, extra || {});

const MAIN = {
  "poolMasterCounter.playerStats.v1": logs(NIGHT1.concat(NIGHT2)),
  "poolMasterCounter.state.v2": state(["Ace", "Bob", "Cid"]),
  "poolMasterCounter.contacts.v1": {
    Ace: Object.assign({}, blank, { phone: "555-0101", email: "ace@example.com", localId: "c-ace", updatedAt: T_OLD }),
    Bob: Object.assign({}, blank, { phone: "555-0102", localId: "c-bob", updatedAt: T_OLD }),
    Cid: Object.assign({}, blank, { clubTeam: "Owls", localId: "c-cid", updatedAt: T_OLD })
  },
  "poolMasterCounter.rosters.v1": [{ id: "roster-main", label: "Thursday", players: ["Ace", "Bob", "Cid"], savedAt: new Date(T_OLD).toISOString() }],
  "poolMasterCounter.dayNotes.v1": { [D1]: "MAIN's note" },
  "poolMasterCounter.removedPlayers.v1": { Old: { removedAt: new Date(T_OLD).toISOString() } },
  "poolMasterCounter.theme.v1": "crimson-felt"
};
const OTHER = {
  "poolMasterCounter.playerStats.v1": logs(NIGHT1.concat(NIGHT3)),
  "poolMasterCounter.state.v2": state(["Ace", "Bob", "Dan", "Old"], {
    gameHistory: [{ ts: new Date(Date.now() - 3600000).toISOString(), gameType: "8ball", gameLabel: "8-Ball", target: 1, unit: "rack", winnerNames: ["Dan"], opponentNames: ["Ace"], teammateNames: [], isTeam: false }]
  }),
  "poolMasterCounter.contacts.v1": {
    Ace: Object.assign({}, blank, { nickname: "Big A", localId: "c-ace-phone", updatedAt: T_NEW }),
    Dan: Object.assign({}, blank, { phone: "555-0199", localId: "c-dan", updatedAt: T_NEW })
  },
  "poolMasterCounter.rosters.v1": [{ id: "roster-other", label: "Sunday", players: ["Ace", "Dan"], savedAt: new Date(T_NEW).toISOString() }],
  "poolMasterCounter.dayNotes.v1": { [D1]: "OTHER's note", [D3]: "OTHER's new-night note" },
  "poolMasterCounter.theme.v1": "daybreak-chalk"
};

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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pmc-merge-"));
  // a profile of its own: its downloads caught (the backup the app writes)
  const profile = async () => {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.setViewport({ width: 1180, height: 820 });
    await page.evaluateOnNewDocument(() => {
      window.__downloads = [];
      const click = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () {
        if (this.download && /^blob:/.test(this.href)) {
          const name = this.download;
          fetch(this.href).then((r) => r.text()).then((text) => window.__downloads.push({ name, text }));
          return;
        }
        return click.call(this);
      };
      navigator.canShare = undefined;
      navigator.share = undefined;
    });
    return page;
  };
  const seed = async (page, data) => {
    await page.goto(BASE, { waitUntil: "networkidle2" });
    await page.evaluate((data) => {
      localStorage.clear();
      ["onboardingSeen", "boardTipsSeen", "homeScreenTipSeen", "migratedFromRepo"].forEach((k) => localStorage.setItem("poolMasterCounter." + k + ".v1", "1"));
      Object.keys(data).forEach((k) => localStorage.setItem(k, typeof data[k] === "string" ? data[k] : JSON.stringify(data[k])));
    }, data);
    // (and anything an earlier run left in the big store)
    await page.evaluate(() => new Promise((ok) => { try { const r = indexedDB.deleteDatabase("pmc-big-store"); r.onsuccess = r.onerror = r.onblocked = () => ok(); } catch (e) { ok(); } }));
    await page.goto(BASE, { waitUntil: "networkidle2" });
    await sleep(1200);
  };
  // 👥 Back up for a shared folder: the file the app writes, parsed
  const exportSync = async (page, who) => {
    await page.evaluate(() => { window.__downloads = []; document.getElementById("btn-export-sync").click(); });
    await sleep(400);
    await page.evaluate((who) => { document.getElementById("confirm-modal-input").value = who; document.getElementById("btn-confirm-modal-ok").click(); }, who);
    for (let k = 0; k < 40; k++) {
      await sleep(150);
      const got = await page.evaluate(() => window.__downloads.length);
      if (got) break;
    }
    const text = await page.evaluate(() => (window.__downloads[0] || {}).text || "");
    return text ? JSON.parse(text) : null;
  };
  // MAIN imports a file: OK, then the same-name choices (sync, or "separate" for the names given),
  // then the removed players (none brought back), then the "merged" note - and the reload
  const importInto = async (page, file, separate) => {
    const input = await page.$("#import-file-input");
    await input.uploadFile(file);
    await sleep(800);
    await page.evaluate(() => document.getElementById("btn-confirm-modal-ok").click());
    const seen = { conflicts: [], removed: [], merged: "" };
    for (let k = 0; k < 60; k++) {
      await sleep(250);
      const st = await page.evaluate(() => ({
        conflict: !document.getElementById("player-conflict-overlay").classList.contains("hidden"),
        removed: !document.getElementById("removed-players-overlay").classList.contains("hidden"),
        modal: !document.getElementById("confirm-modal-overlay").classList.contains("hidden") ? document.getElementById("confirm-modal-message").textContent : ""
      }));
      if (st.conflict) {
        seen.conflicts = await page.evaluate((separate) => {
          const rows = [...document.querySelectorAll("#player-conflict-list .player-conflict-row")];
          return rows.map((row) => {
            const name = row.querySelector(".player-conflict-row-name").textContent;
            const want = separate.indexOf(name) !== -1 ? "separate" : "sync";
            const radio = row.querySelector('input[value="' + want + '"]');
            if (radio) radio.click();
            return name + ":" + want;
          });
        }, separate || []);
        await page.evaluate(() => document.getElementById("btn-player-conflict-continue").click());
        continue;
      }
      if (st.removed) {
        seen.removed = await page.evaluate(() => [...document.querySelectorAll("#removed-players-checklist input")].map((cb) => { cb.checked = false; return cb.value; }));
        await page.evaluate(() => document.getElementById("btn-removed-players-continue").click());
        continue;
      }
      if (st.modal) {
        seen.merged = st.modal;
        await Promise.all([page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 }).catch(() => null), page.evaluate(() => document.getElementById("btn-confirm-modal-ok").click())]);
        await sleep(1500);
        break;
      }
    }
    return seen;
  };
  // every game a player has, by time - from a backup the app wrote
  const gamesOf = (b) => {
    const out = {};
    Object.keys(b.playerStats || {}).forEach((key) => {
      const name = key.toLowerCase();
      (b.playerStats[key].sessions || []).forEach((s) => (s.games || []).forEach((g) => {
        (out[name] = out[name] || []).push(g.ts + "|" + g.result);
      }));
    });
    return out;
  };
  const dupes = (list) => list.length - new Set(list).size;

  try {
    const main = await profile();
    const other = await profile();
    await seed(main, MAIN);
    await seed(other, OTHER);
    const before = await exportSync(main, "Main");
    const fromOther = await exportSync(other, "Phone");
    check("the other account's 👥 shared backup: exported by \"" + (fromOther && fromOther.exportedBy) + "\", " + (fromOther ? Object.keys(fromOther.playerStats).join(", ") : "-"), fromOther && fromOther.exportedBy === "Phone" && fromOther.playerStats.Dan && (fromOther.state.gameHistory || []).length === 1, fromOther && Object.keys(fromOther));
    const file = path.join(tmp, "from-phone.json");
    fs.writeFileSync(file, JSON.stringify(fromOther));

    // ---- MAIN merges it ----
    let seen = await importInto(main, file);
    const after = await exportSync(main, "Main");
    check("the merge asked about Ace and Bob (" + seen.conflicts.join(", ") + "), offered Old back (" + seen.removed.join(", ") + "), and said: \"" + seen.merged.slice(0, 90) + "\"",
      seen.conflicts.some((c) => /^Ace:/.test(c)) && seen.conflicts.some((c) => /^Bob:/.test(c)) && seen.removed.join() === "Old" && seen.merged.length > 0, seen);
    const g0 = gamesOf(before);
    const g1 = gamesOf(after);
    const lost = [];
    Object.keys(g0).forEach((n) => g0[n].forEach((g) => { if ((g1[n] || []).indexOf(g) === -1) lost.push(n + " " + g); }));
    check("every game MAIN had is still there (" + Object.keys(g0).map((n) => n + " " + g0[n].length).join(", ") + ") - lost: " + lost.length, lost.length === 0 && Object.keys(g0).length === 3, lost.slice(0, 5));
    const want = { ace: 10 + 10 + 7 + 1, bob: 10 + 5 + 5, cid: 15, dan: 7 + 5 + 4 + 1, old: 4 };
    const got = {};
    Object.keys(want).forEach((n) => (got[n] = (g1[n] || []).length));
    const twice = Object.keys(g1).filter((n) => dupes(g1[n]));
    check("the other's games added once: " + JSON.stringify(got) + " (the shared night not doubled, \"bob\" folded into Bob, the game in progress filed)", JSON.stringify(got) === JSON.stringify(want) && !twice.length, { got, want, twice, keys: Object.keys(after.playerStats) });
    check("one Bob (no \"bob\" beside him): " + Object.keys(after.playerStats).join(", "), Object.keys(after.playerStats).filter((k) => k.toLowerCase() === "bob").length === 1, Object.keys(after.playerStats));
    const roster = after.state.players.map((p) => p.name);
    check("the roster: " + roster.join(", ") + " (Dan new, Old still off it)", ["Ace", "Bob", "Cid", "Dan"].every((n) => roster.indexOf(n) !== -1) && roster.indexOf("Old") === -1 && !!after.removedPlayers.Old, { roster, removed: after.removedPlayers });
    const c = after.contacts || {};
    const ace = c.Ace || {};
    check("Ace's contact: the newer nickname \"" + ace.nickname + "\" and MAIN's phone \"" + ace.phone + "\" and email \"" + ace.email + "\" kept", ace.nickname === "Big A" && ace.phone === "555-0101" && ace.email === "ace@example.com", ace);
    check("Bob's and Cid's contacts untouched, Dan's added", (c.Bob || {}).phone === "555-0102" && (c.Cid || {}).clubTeam === "Owls" && (c.Dan || {}).phone === "555-0199", { Bob: c.Bob, Cid: c.Cid, Dan: c.Dan });
    const lists = (after.rosters || []).map((r) => r.label);
    check("both saved lists: " + lists.join(", "), lists.indexOf("Thursday") !== -1 && lists.indexOf("Sunday") !== -1, lists);
    check("notes: the shared night has both, MAIN's first (" + JSON.stringify((after.dayNotes || {})[D1]) + "), the other's new-night note added", (after.dayNotes || {})[D1] === "MAIN's note\n\nOTHER's note" && (after.dayNotes || {})[D3] === "OTHER's new-night note", after.dayNotes);
    check("MAIN's theme unchanged (" + (after.settings || {})["poolMasterCounter.theme.v1"] + ")", (after.settings || {})["poolMasterCounter.theme.v1"] === "crimson-felt", after.settings);
    const rated = Object.keys(after.ratings || {});
    check("every player rated, Dan included: " + rated.map((n) => n + " " + Math.round(after.ratings[n].rating)).join(", "), ["Ace", "Bob", "Cid", "Dan"].every((n) => rated.some((k) => k.toLowerCase() === n.toLowerCase())), rated);
    check("the import remembered who it came from", !!after.exportedAt, null);

    // ---- the same file again: nothing changes ----
    seen = await importInto(main, file);
    const again = await exportSync(main, "Main");
    const g2 = gamesOf(again);
    const same = Object.keys(g1).every((n) => (g2[n] || []).length === g1[n].length) && Object.keys(g2).length === Object.keys(g1).length;
    check("the same file merged again: nothing changes (" + Object.keys(g2).map((n) => n + " " + g2[n].length).join(", ") + ")", same && (again.rosters || []).length === (after.rosters || []).length && JSON.stringify(again.contacts.Ace) === JSON.stringify(after.contacts.Ace) && again.dayNotes[D1] === after.dayNotes[D1], { g1: Object.keys(g1).map((n) => n + g1[n].length), g2: Object.keys(g2).map((n) => n + g2[n].length), notes: again.dayNotes });

    // ---- MAIN as it was, "keep separate" for Bob ----
    await seed(main, MAIN);
    seen = await importInto(main, file, ["Bob"]);
    const sep = await exportSync(main, "Main");
    const keys = Object.keys(sep.playerStats);
    const bobCopy = keys.find((k) => /^Bob \(\d{4}-\d{2}-\d{2}\)$/.test(k));
    const gs = gamesOf(sep);
    check("\"keep separate\" for Bob: " + keys.join(", ") + " - MAIN's Bob " + (gs.bob || []).length + " games, \"" + bobCopy + "\" " + (bobCopy ? gs[bobCopy.toLowerCase()].length : 0),
      bobCopy && (gs.bob || []).length === 15 && gs[bobCopy.toLowerCase()].length === 10 + 5, { keys, seen });
  } finally {
    check("no page errors", errors.length === 0, errors);
    await browser.close();
    site.close();
  }
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log("FAIL crashed: " + (e && e.stack)); process.exit(1); });
