// The top of the scoreboard: Focus Mode, Rotation / Single game, Winner Stays (a copy of the Players
// section's checkbox, kept in step), the voice button and voice - one row, same height, same centre.
// The Players section's Winner Stays: bigger, boxed.
// usage: node tests/probe_score_top_row.js http://localhost:4235/ <screenshot dir>
const puppeteer = require("puppeteer-core");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const [BASE, OUT] = process.argv.slice(2);
let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined ? "  " + JSON.stringify(extra) : "")); if (!ok) fails++; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({ executablePath: EXE, headless: "new", defaultViewport: { width: 1280, height: 900 } });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(BASE + "manifest.json");
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem("poolMasterCounter.onboardingSeen.v1", "1"); localStorage.setItem("poolMasterCounter.migratedFromRepo.v1", "1"); });
  await page.goto(BASE, { waitUntil: "networkidle2" });
  await sleep(600);
  await page.evaluate(async () => {
    for (const n of ["Alex", "Sam", "Kim"]) {
      const input = document.getElementById("new-player-name"), btn = document.getElementById("btn-add-player");
      input.value = n; input.dispatchEvent(new Event("input", { bubbles: true })); btn.disabled = false; btn.click();
      await new Promise((r) => setTimeout(r, 250));
    }
  });
  await sleep(500);
  const row = () => page.evaluate(() => {
    const items = [...document.querySelectorAll(".voice-toggle-row .focus-toggle-btn, .voice-toggle-row .game-mode-toggle, .voice-toggle-row .scoreboard-queue-toggle, .voice-toggle-row .voice-toggle-btn, .voice-toggle-row .format-info-btn, .voice-toggle-row select")]
      .filter((el) => el.offsetParent !== null)
      .map((el) => { const r = el.getBoundingClientRect(); return { el: el.id || el.className.split(" ")[0], top: Math.round(r.top), mid: Math.round(r.top + r.height / 2), h: Math.round(r.height), left: Math.round(r.left), right: Math.round(r.right) }; });
    return items;
  });
  let items = await row();
  console.log(JSON.stringify(items));
  const order = items.map((i) => i.el);
  const qi = order.indexOf("scoreboard-queue-row"), ri = order.findIndex((e) => /game-mode-toggle/.test(e));
  check("Winner Stays sits right of Rotation / Single game", qi === ri + 1 && items[qi].left > items[ri].right, order);
  const mids = items.map((i) => i.mid), main = items.filter((i) => i.el !== "btn-keypad-speech-help"); // (the round ❓ is small on purpose)
  check("one row at 1280, every control centred on the same line", Math.max(...mids) - Math.min(...mids) <= 2, mids);
  check("...and the same height (44px)", main.every((i) => i.h === 44), main.map((i) => i.el + ":" + i.h));
  if (OUT) { const el = await page.$(".voice-toggle-row"); await el.screenshot({ path: OUT + "/top_row_1280.png" }); }
  // in step with the Players section
  const q = () => page.evaluate(() => ({ copy: document.getElementById("scoreboard-queue-checkbox").checked, players: document.getElementById("queue-mode-checkbox").checked, saved: JSON.parse(localStorage.getItem("poolMasterCounter.state.v2")).currentGame.queueEnabled }));
  await page.click("#scoreboard-queue-checkbox");
  await sleep(500);
  let v = await q();
  check("ticked at the top: on, the Players section's box too", v.copy && v.players && v.saved, v);
  await page.evaluate(() => document.getElementById("queue-mode-checkbox").click());
  await sleep(500);
  v = await q();
  check("unticked in the Players section: the copy follows", !v.copy && !v.players && !v.saved, v);
  // the Players section's own: bigger, boxed
  const p = await page.evaluate(() => { const el = document.getElementById("queue-mode-row"), cs = getComputedStyle(el); return { size: cs.fontSize, border: cs.borderTopWidth + " " + cs.borderTopStyle, weight: cs.fontWeight }; });
  check("Players section: bigger (1.25rem), bold, with a border", p.size === "20px" && p.border === "1px solid" && +p.weight >= 700, p);
  if (OUT) {
    await page.evaluate(() => { const b = document.getElementById("btn-toggle-players-panel"); if (document.getElementById("players-panel").classList.contains("collapsed")) b.click(); });
    await sleep(300);
    const el = await page.$("#queue-mode-row"); await el.evaluate((e) => e.scrollIntoView({ block: "center" })); await sleep(200); await el.screenshot({ path: OUT + "/players_queue.png" });
  }
  // Teams: Winner Stays is Individual-only, at the top too
  await page.evaluate(() => { const r = document.querySelector('input[name="game-mode"][value="teams"]'); r.click(); });
  await sleep(500);
  check("Teams: the copy hides like the Players section's", await page.evaluate(() => document.getElementById("scoreboard-queue-row").offsetParent === null && document.getElementById("queue-mode-row").offsetParent === null));
  await page.evaluate(() => { const r = document.querySelector('input[name="game-mode"][value="individual"]'); r.click(); });
  await sleep(400);
  // phone
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await sleep(500);
  items = await row();
  if (OUT) { const el = await page.$(".voice-toggle-row"); await el.screenshot({ path: OUT + "/top_row_390.png" }); }
  const w = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: innerWidth }));
  check("phone: wraps, nothing sticks out", w.doc <= w.win && items.every((i) => i.right <= 390), { w, items });
  check("no page errors", errors.length === 0, errors);
  console.log(fails ? "TOP_ROW_FAIL (" + fails + ")" : "TOP_ROW_OK");
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
