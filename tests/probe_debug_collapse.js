// "Debugging visual matching" folds like Capture Settings: collapsed with its summary, opens and
// closes from its header or summary, and starts open after a reload while a debug mode is on.
// usage: node tests/probe_debug_collapse.js http://localhost:4235/ <screenshot dir>
const puppeteer = require("/private/tmp/claude-501/-Users-lucmartin/955cf1c9-ee76-47df-9aa6-1e62c9263742/scratchpad/videopipe/node_modules/puppeteer-core");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const BASE = process.argv[2], OUT = process.argv[3];
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
  await sleep(800);
  // open Visual Scoring, Capture Settings, turn camera recognition on (the debug section shows then)
  await page.evaluate(() => {
    const vs = document.getElementById("visual-scoring-panel"); if (vs.classList.contains("collapsed")) document.getElementById("btn-toggle-visual-scoring-panel").click();
    const cb = document.getElementById("camera-input-checkbox"); if (!cb.checked) cb.click();
  });
  await sleep(800);
  const state = () => page.evaluate(() => {
    const p = document.getElementById("camera-debug-options-row"), body = document.getElementById("camera-debug-options-row-body");
    const cb = document.getElementById("camera-debug-checkbox");
    return { shown: !p.classList.contains("hidden"), collapsed: p.classList.contains("collapsed"), expanded: document.getElementById("btn-toggle-camera-debug-options").getAttribute("aria-expanded"),
      bodyVisible: body.offsetParent !== null, checkboxVisible: cb.offsetParent !== null, summaryVisible: document.getElementById("camera-debug-options-row-summary").offsetParent !== null,
      title: document.querySelector("#btn-toggle-camera-debug-options h4").textContent };
  });
  let s = await state();
  check("shown with the camera on, collapsed, summary showing, checkboxes folded away", s.shown && s.collapsed && s.expanded === "false" && !s.checkboxVisible && s.summaryVisible, s);
  const shot = async (name) => { const el = await page.$("#camera-debug-options-row"); await el.evaluate((e) => e.scrollIntoView({ block: "center" })); await sleep(200); await el.screenshot({ path: OUT + "/" + name }); };
  await shot("debug_collapsed_1280.png");
  await page.click("#btn-toggle-camera-debug-options");
  await sleep(300);
  s = await state();
  check("header opens it", !s.collapsed && s.expanded === "true" && s.checkboxVisible, s);
  await shot("debug_open_1280.png");
  await page.click("#btn-toggle-camera-debug-options");
  await sleep(300);
  s = await state();
  check("...and closes it", s.collapsed && !s.checkboxVisible, s);
  await page.click("#camera-debug-options-row-summary");
  await sleep(300);
  s = await state();
  check("the summary opens it too", !s.collapsed && s.checkboxVisible, s);
  // turn debug info on, reload: starts open
  await page.click("#camera-debug-checkbox");
  await sleep(600);
  await page.reload({ waitUntil: "networkidle2" });
  await sleep(1200);
  await page.evaluate(() => { const vs = document.getElementById("visual-scoring-panel"); if (vs.classList.contains("collapsed")) document.getElementById("btn-toggle-visual-scoring-panel").click(); });
  await sleep(500);
  s = await state();
  const on = await page.evaluate(() => document.getElementById("camera-debug-checkbox").checked);
  check("debug info on: after a reload it starts open", on && !s.collapsed && s.checkboxVisible, { on, s });
  await page.click("#camera-debug-checkbox");
  await sleep(600);
  await page.reload({ waitUntil: "networkidle2" });
  await sleep(1200);
  await page.evaluate(() => { const vs = document.getElementById("visual-scoring-panel"); if (vs.classList.contains("collapsed")) document.getElementById("btn-toggle-visual-scoring-panel").click(); });
  await sleep(500);
  s = await state();
  check("debug info off: after a reload it starts collapsed", s.collapsed, s);
  // phone width
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await sleep(500);
  await shot("debug_collapsed_390.png");
  const w = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: innerWidth }));
  check("no sideways scroll at 390", w.doc <= w.win, w);
  // French title + summary
  check("no page errors", errors.length === 0, errors);
  console.log(fails ? "DEBUG_COLLAPSE_FAIL (" + fails + ")" : "DEBUG_COLLAPSE_OK");
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
