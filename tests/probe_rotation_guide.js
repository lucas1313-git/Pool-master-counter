// Rotation picked with no game types in its lineup: Games Rotations opens, scrolls into view, its game
// list focused (and opened where the browser allows); picking a game lights "+ Add to Order";
// after adding, still short of two: the list again.
// usage: node tests/probe_rotation_guide.js http://localhost:4235/ <screenshot dir>
const puppeteer = require("puppeteer-core");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const [BASE, OUT] = process.argv.slice(2);
let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined ? "  " + JSON.stringify(extra) : "")); if (!ok) fails++; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// The app opens on the board (Focus Mode); this probe uses the full page's Rotation switch, so 🔍 Show All once it's up.
const showAll = async (pg) => {
  await pg.waitForFunction(() => document.getElementById("app") && document.getElementById("app").classList.contains("focus-mode"), { timeout: 10000 });
  await pg.evaluate(() => document.getElementById("btn-toggle-focus").click());
};
(async () => {
  const browser = await puppeteer.launch({ executablePath: EXE, headless: "new", defaultViewport: { width: 1280, height: 900 } });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(BASE + "manifest.json");
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem("poolMasterCounter.onboardingSeen.v1", "1"); localStorage.setItem("poolMasterCounter.migratedFromRepo.v1", "1"); });
  await page.goto(BASE, { waitUntil: "networkidle2" }); await showAll(page);
  await sleep(600);
  await page.evaluate(async () => {
    for (const n of ["Alex", "Sam"]) {
      const input = document.getElementById("new-player-name"), btn = document.getElementById("btn-add-player");
      input.value = n; input.dispatchEvent(new Event("input", { bubbles: true })); btn.disabled = false; btn.click();
      await new Promise((r) => setTimeout(r, 250));
    }
    document.querySelectorAll("#roster-list li.roster-row .btn-playing:not(.is-on)").forEach((b) => b.click());
    window.scrollTo(0, 0);
  });
  await sleep(500);
  const st = () => page.evaluate(() => {
    const sel = document.getElementById("rotation-add-type"), add = document.getElementById("btn-rotation-add"), panel = document.getElementById("rotation-panel");
    const r = sel.getBoundingClientRect();
    return { open: !panel.classList.contains("collapsed"), selectInView: r.top >= 0 && r.bottom <= innerHeight, focused: document.activeElement === sel, value: sel.value, shown: sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].text : null,
      lit: add.classList.contains("rotation-add-ready"), addBg: getComputedStyle(add).backgroundColor, order: JSON.parse(localStorage.getItem("poolMasterCounter.state.v2")).rotation.order.map((e) => e.gameType) };
  });
  let s = await st();
  check("to start: the list says Choose a game type…, Add not lit", s.value === "" && /Choose a game type/.test(s.shown) && !s.lit, s);
  await page.click("#scoreboard-mode-rotation");
  await sleep(1400);
  s = await st();
  check("Rotation with no games: Games Rotations open, in view, its game list focused", s.open && s.selectInView && s.focused, s);
  const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim());
  await page.select("#rotation-add-type", "straight");
  await sleep(300);
  s = await st();
  check("a game picked: + Add to Order lit in gold", s.lit && s.value === "straight", { lit: s.lit, bg: s.addBg, accent });
  if (OUT) { const el = await page.$("#btn-rotation-add"); const row = await el.evaluateHandle((e) => e.closest(".row")); await row.asElement().screenshot({ path: OUT + "/rotation_add_lit.png" }); }
  await page.click("#btn-rotation-add");
  await sleep(500);
  s = await st();
  check("added: in the lineup, the list back to Choose…, Add not lit, the list focused again (one more needed)", s.order.join() === "straight" && s.value === "" && !s.lit && s.focused, s);
  // Add with nothing chosen: nothing added, the list instead
  await page.click("#btn-rotation-add");
  await sleep(400);
  s = await st();
  check("Add with nothing chosen: nothing added, the list focused", s.order.length === 1 && s.focused, s);
  // 8-Ball - the first game in the list - is a real choice too
  await page.select("#rotation-add-type", "8ball");
  await sleep(300);
  s = await st();
  check("8-Ball picked: lit too", s.lit && s.value === "8ball", s);
  await page.click("#btn-rotation-add");
  await sleep(600);
  s = await st();
  check("two games: the rotation runs (no more prompting)", s.order.join() === "straight,8ball" && !s.lit && !s.focused, s);
  const line = await page.evaluate(() => document.getElementById("now-playing-banner").textContent.replace(/\s+/g, " "));
  check("...the Now playing line follows the rotation", /Now playing (Straight Pool|8-Ball)/.test(line), line);
  check("no page errors", errors.length === 0, errors);
  console.log(fails ? "ROTATION_GUIDE_FAIL (" + fails + ")" : "ROTATION_GUIDE_OK");
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
