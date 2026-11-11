// 🧊 The night in 3D (☰ Menu › Day Report): a night played here - three players at 8-Ball, so Winner
// Stays brings the next one in - then the panel: the day it picks, the night rebuilt from the saved
// games (who came in, who sat down, the tally), ▶ Replay stepped, played to the end and driven from the
// keyboard, 🧵 The whole night with a player followed, its picture made within the tap (a PNG, saved as
// a download on a computer and through the share sheet on a tablet), a light theme, no page errors.
// usage: node tests/probe_night_3d.js http://localhost:4339/ [screenshot dir]
//   (server: HOME=tests/tmphome PORT=4339 node server/server.js)
const puppeteer = require("puppeteer-core");
const path = require("path");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const BASE = process.argv[2], OUT = process.argv[3];
let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra).slice(0, 500) : "")); if (!ok) fails++; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({ executablePath: EXE, headless: "new", defaultViewport: { width: 1180, height: 820 } });
  const errors = [];
  async function open(tablet) {
    const page = await browser.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.evaluateOnNewDocument((tablet) => {
      window.__downloads = []; window.__shares = [];
      const click = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () { if (this.download) { window.__downloads.push({ name: this.download }); return; } return click.call(this); };
      if (tablet) {
        window.__tap = false;
        window.addEventListener("click", () => { window.__tap = true; }, true);
        window.addEventListener("click", () => { window.__tap = false; }, false);
        Object.defineProperty(navigator, "maxTouchPoints", { get: () => 5 });
        navigator.canShare = (d) => !!(d && d.files && d.files.length);
        navigator.share = (d) => { window.__shares.push({ duringTap: window.__tap, name: d.files[0].name, type: d.files[0].type, size: d.files[0].size }); return Promise.resolve(); };
      }
    }, !!tablet);
    return page;
  }
  const page = await open(false);
  await page.goto(BASE + "manifest.json");
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem("poolMasterCounter.onboardingSeen.v1", "1"); localStorage.setItem("poolMasterCounter.migratedFromRepo.v1", "1"); });
  await page.goto(BASE, { waitUntil: "networkidle2" });
  await sleep(800);

  // ☰ Menu › 📝 Day Report › 🧊 The night in 3D
  const openPanel = async (pg) => {
    await pg.click("#btn-board-menu");
    await sleep(300);
    await pg.evaluate(() => document.querySelector('#board-menu-list button[data-menu-key="menu.dayReport"]').click());
    await sleep(300);
    await pg.evaluate(() => document.querySelector('#board-menu-list button[data-menu-key="menu.night3d"]').click());
    await sleep(900);
  };
  const state = (pg) => (pg || page).evaluate(() => window.PMCNight3d.state());

  // no games yet: the panel says so
  await openPanel(page);
  const none = await page.evaluate(() => ({ open: !document.getElementById("night-3d-panel").classList.contains("collapsed"), empty: !document.getElementById("night3d-empty").classList.contains("hidden"), days: document.getElementById("night3d-day").options.length }));
  check("☰ Menu › Day Report › 🧊 The night in 3D opens the panel; no games yet: it says so, no day to pick", none.open && none.empty && none.days === 0, none);
  await page.evaluate(() => document.getElementById("btn-toggle-night-3d-panel").click()); // folded again
  await page.evaluate(() => { if (!document.getElementById("app").classList.contains("focus-mode")) document.getElementById("btn-toggle-focus").click(); });
  await sleep(300);

  // a short night: Alex, Sam and Kim at 8-Ball - two at the table, Winner Stays on by itself
  await page.evaluate(async () => {
    for (const n of ["Alex", "Sam", "Kim"]) {
      const input = document.getElementById("new-player-name"), btn = document.getElementById("btn-add-player");
      input.value = n; input.dispatchEvent(new Event("input", { bubbles: true })); btn.disabled = false; btn.click();
      await new Promise((r) => setTimeout(r, 250));
    }
    document.querySelectorAll("#roster-list li.roster-row .btn-playing:not(.is-on)").forEach((b) => b.click());
  });
  await sleep(600);
  const win = async (name) => {
    const ok = await page.evaluate((n) => { const el = [...document.querySelectorAll(".player-panel")].find((c) => c.querySelector(".player-name").textContent.trim().startsWith(n)); if (!el) return false; [...el.querySelectorAll("button")].find((b) => b.textContent.trim() === "+").click(); return true; }, name);
    await sleep(900);
    await page.evaluate(() => { for (let i = 0; i < 4; i++) { const b = [...document.querySelectorAll("button")].find((x) => x.offsetParent && /^(Next game|Continue|OK|✔ OK|Close|Got it|Start next game|Done)/i.test(x.textContent.trim()) && x.closest("[class*='overlay'],[class*='modal'],[role='dialog'],.win-banner")); if (b) b.click(); } });
    await sleep(500);
    return ok;
  };
  // (a card's name comes with its rating)
  const seated = () => page.evaluate(() => [...document.querySelectorAll(".player-panel .player-name")].map((n) => ["Alex", "Sam", "Kim"].find((x) => n.textContent.trim().startsWith(x))));
  const s0 = await seated();
  // (whoever sits first: the one seated beats the other, the next comes in, twice; then the newcomer wins)
  const w1 = s0[0], l1 = s0[1];
  await win(w1);
  const s1 = await seated(), in2 = s1.find((n) => n !== w1);
  await win(w1);
  const s2 = await seated(), in3 = s2.find((n) => n !== w1);
  await win(in3);
  check("the night: 3 racks of 8-Ball, Winner Stays - " + w1 + " beat " + l1 + ", then " + in2 + ", then lost to " + in3, s0.length === 2 && s1.length === 2 && s2.length === 2 && in2 !== l1 && in3 === l1, { s0, s1, s2 });

  await openPanel(page);
  let st = await state();
  const ui = await page.evaluate(() => ({ day: document.getElementById("night3d-day").value, options: document.getElementById("night3d-day").options.length, facts: document.getElementById("night3d-facts").textContent, empty: !document.getElementById("night3d-empty").classList.contains("hidden"), today: window.PMCLib.poolDay.todayDateStr() }));
  check("the panel: today's night picked (" + ui.facts + ")", ui.day === ui.today && ui.options === 1 && !ui.empty && /3 players · 3 games/.test(ui.facts), ui);
  const night = st.night || { matches: [], players: [] };
  const by = Object.fromEntries(night.players.map((p) => [p.name, p]));
  const names = (ids) => ids.map((id) => night.players.find((p) => p.id === id).name);
  check("the night rebuilt from the saved games: 3 matches, " + w1 + " 2/3, " + l1 + " 1/2, " + in2 + " 0/1", night.matches.length === 3 && night.rackCount === 3 && by[w1] && by[w1].won === 2 && by[w1].played === 3 && by[l1].won === 1 && by[l1].played === 2 && by[in2].won === 0 && by[in2].played === 1, night.players);
  const c2 = night.matches[1] && night.matches[1].changes, c3 = night.matches[2] && night.matches[2].changes;
  check("...who came in, who sat down: match 2 " + in2 + " in, " + l1 + " out, the winner stayed; match 3 " + l1 + " back in", c2 && names(c2.in).join() === in2 && names(c2.out).join() === l1 && c2.winnerStayed === true && c3 && names(c3.in).join() === l1 && names(c3.out).join() === in2, { c2, c3 });
  check("...the last one's winner: " + in3, night.matches[2] && names(night.matches[2].sides[night.matches[2].winner].players).join() === in3, night.matches[2]);

  // ▶ Replay
  const canvasOf = (id) => page.evaluate((id) => { const c = document.querySelector("#" + id + " canvas"); return c ? { w: c.width, h: c.height, shown: !!c.offsetParent } : null; }, id);
  let cv = await canvasOf("night3d-replay");
  check("▶ Replay: drawn (" + (cv && cv.w + "x" + cv.h) + "), 3 matches, at the first", st.replay && st.replay.count === 3 && st.replay.index === 0 && st.replay.width > 300 && cv && cv.shown && cv.w > 300, { replay: st.replay, cv });
  if (OUT) await (await page.$("#night-3d-panel")).screenshot({ path: path.join(OUT, "night_3d_replay.png") });
  await page.click("#night3d-replay .pmc-nr-next");
  await sleep(300);
  const moving = (await state()).replay;
  await sleep(4000);
  st = await state();
  check("...▶ the next match: the players walk (moving), then it rests on match 2", moving.index === 1 && moving.moving === true && st.replay.index === 1 && st.replay.moving === false, { moving, after: st.replay });
  await page.focus("#night3d-replay");
  await page.keyboard.press("ArrowLeft");
  await sleep(300);
  check("...← on the keyboard (focus in the replay): back to match 1", (await state()).replay.index === 0, (await state()).replay);
  await page.click("#night3d-replay .pmc-nr-play");
  await sleep(400);
  const playing = (await state()).replay.playing;
  for (let i = 0; i < 40; i++) { if (!(await state()).replay.playing) break; await sleep(500); }
  st = await state();
  check("...▶ Play: runs to the last match and stops", playing === true && st.replay.playing === false && st.replay.index === 2, st.replay);

  // 🧵 The whole night
  await page.evaluate(() => document.querySelector('input[name="night3d-view"][value="braid"]').click());
  await sleep(900);
  st = await state();
  cv = await canvasOf("night3d-braid");
  const shown = await page.evaluate(() => ({ replay: !document.getElementById("night3d-replay").classList.contains("hidden"), braid: !document.getElementById("night3d-braid").classList.contains("hidden") }));
  check("🧵 The whole night: the picture in place of the replay - 3 matches, 3 players, drawn in " + (st.braid && Math.round(st.braid.drawMs)) + " ms", !shown.replay && shown.braid && st.braid && st.braid.matches === 3 && st.braid.players === 3 && cv && cv.shown && cv.w > 300, { shown, braid: st.braid, cv });
  if (OUT) await (await page.$("#night-3d-panel")).screenshot({ path: path.join(OUT, "night_3d_braid.png") });
  await page.click("#night3d-braid .pmc-nb-chip");
  await sleep(300);
  check("...a player's chip tapped: that ribbon followed", (await state()).braid.highlight !== null, (await state()).braid);
  const pic = await page.evaluate(() => { const b = window.PMCNight3d.braid(), url = b.pictureDataUrl(), size = b.pictureSize(), bin = atob(url.split(",")[1]); return { png: /^data:image\/png;base64,/.test(url) && bin.charCodeAt(1) === 80 && bin.charCodeAt(2) === 78 && bin.charCodeAt(3) === 71, bytes: bin.length, width: (bin.charCodeAt(16) << 24 | bin.charCodeAt(17) << 16 | bin.charCodeAt(18) << 8 | bin.charCodeAt(19)), height: (bin.charCodeAt(20) << 24 | bin.charCodeAt(21) << 16 | bin.charCodeAt(22) << 8 | bin.charCodeAt(23)), size }; });
  check("...its picture: a PNG made at once, " + pic.width + "x" + pic.height + " (" + Math.round(pic.bytes / 1024) + " KB)", pic.png && pic.bytes > 20000 && pic.width === pic.size.width && pic.height === pic.size.height && pic.width * pic.height < 16e6, pic);
  await page.evaluate(() => [...document.querySelectorAll("#night3d-braid button")].find((b) => /Save as picture/.test(b.textContent)).click());
  await sleep(500);
  const saved = await page.evaluate(() => ({ downloads: window.__downloads, toast: (document.getElementById("page-toast") || {}).textContent || "" }));
  check("🖼️ Save as picture on a computer: downloaded as pool-master-counter-night-<day>.png, and said so", saved.downloads.length === 1 && /^pool-master-counter-night-\d{4}-\d{2}-\d{2}\.png$/.test(saved.downloads[0].name) && /Picture saved/.test(saved.toast), saved);

  // a light theme: both still drawn
  await page.evaluate(() => { const s = document.getElementById("theme-select"); s.value = "paper-contrast"; s.dispatchEvent(new Event("change", { bubbles: true })); });
  await sleep(600);
  st = await state();
  if (OUT) await (await page.$("#night-3d-panel")).screenshot({ path: path.join(OUT, "night_3d_light.png") });
  check("a light theme (Paper Contrast): still drawn", st.braid && st.braid.matches === 3 && (await canvasOf("night3d-braid")).shown, st.braid);

  // a tablet: the same night (kept on this device), the picture through the share sheet, from the tap
  const tab = await open(true);
  await tab.goto(BASE, { waitUntil: "networkidle2" });
  await sleep(900);
  await openPanel(tab);
  await tab.evaluate(() => document.querySelector('input[name="night3d-view"][value="braid"]').click());
  await sleep(900);
  await tab.evaluate(() => [...document.querySelectorAll("#night3d-braid button")].find((b) => /Save as picture/.test(b.textContent)).click());
  await sleep(500);
  const shared = await tab.evaluate(() => ({ shares: window.__shares, downloads: window.__downloads.length, matches: (window.PMCNight3d.state().night || { matches: [] }).matches.length }));
  check("a tablet: the same night after a reload, 🖼️ Save as picture opens the share sheet with the PNG - from that tap", shared.matches === 3 && shared.shares.length === 1 && shared.shares[0].duringTap && shared.shares[0].type === "image/png" && shared.shares[0].size > 20000 && shared.downloads === 0, shared);

  check("no page errors", errors.length === 0, errors);
  await browser.close();
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log("FAIL crashed: " + (e && e.stack || e)); process.exit(1); });
