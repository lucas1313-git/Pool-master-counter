// The iPad-only "iPad recognition (USB camera)" card: hidden in a browser; shown, and opening the
// native screen, when the app's Recognition plugin is there (simulated window.Capacitor).
// usage: node tests/probe_native_card.js http://localhost:4235/
const puppeteer = require("puppeteer-core");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const BASE = process.argv[2];
let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined ? "  " + JSON.stringify(extra) : "")); if (!ok) fails++; }
(async () => {
  const browser = await puppeteer.launch({ executablePath: EXE, headless: "new", defaultViewport: { width: 1280, height: 900 } });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const open = async (native) => {
    if (native) await page.evaluateOnNewDocument(() => { window.__opened = 0; window.Capacitor = { isNativePlatform: () => true, Plugins: { Recognition: { open: () => { window.__opened++; return Promise.resolve(); } } } }; });
    await page.goto(BASE + "manifest.json");
    await page.evaluate(() => { localStorage.clear(); localStorage.setItem("poolMasterCounter.onboardingSeen.v1", "1"); localStorage.setItem("poolMasterCounter.migratedFromRepo.v1", "1"); });
    await page.goto(BASE, { waitUntil: "networkidle2" }); await showAll(page);
    await new Promise((r) => setTimeout(r, 700));
    return page.evaluate(() => !document.getElementById("camera-path-card-native").classList.contains("hidden"));
  };
  check("in a browser: no iPad card", (await open(false)) === false);
  check("in the iPad app: the card is there", (await open(true)) === true);
  // (📷 Set Up Camera: Visual Scoring stays out of the way until then)
  await page.evaluate(() => document.getElementById("btn-open-camera-wizard-header").click());
  await new Promise((r) => setTimeout(r, 300));
  await page.evaluate(() => { const vs = document.getElementById("visual-scoring-panel"); if (vs.classList.contains("collapsed")) document.getElementById("btn-toggle-visual-scoring-panel").click(); const cs = document.getElementById("camera-setup-panel"); if (cs.classList.contains("collapsed")) document.getElementById("btn-toggle-camera-setup-panel").click(); });
  await new Promise((r) => setTimeout(r, 300));
  await page.click("#camera-wizard-path-native");
  await new Promise((r) => setTimeout(r, 200));
  check("...and opens the native Recognition screen", (await page.evaluate(() => window.__opened)) === 1);
  check("no page errors", errors.length === 0, errors);
  console.log(fails ? "NATIVE_CARD_FAIL (" + fails + ")" : "NATIVE_CARD_OK");
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
// The app opens on the board (Focus Mode); this probe works in the panels, so 🔍 Show All once it's up.
const showAll = async (pg) => {
  await pg.waitForFunction(() => document.getElementById("app") && document.getElementById("app").classList.contains("focus-mode"), { timeout: 10000 });
  await pg.evaluate(() => document.getElementById("btn-toggle-focus").click());
};
