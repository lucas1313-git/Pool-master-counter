// The board's top bar (☰ Menu, the line, ↩ Undo, 🎱 Game) at phone width, and the full page's own
// Focus Mode + Rotation / Single game row (screenshots).
// usage: node tests/probe_focus_row.js http://localhost:4235/ <dir>
const puppeteer = require("puppeteer-core");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
(async () => {
  const [BASE, OUT] = process.argv.slice(2);
  const browser = await puppeteer.launch({ executablePath: EXE, headless: "new", defaultViewport: { width: 390, height: 844, deviceScaleFactor: 2 } });
  const page = await browser.newPage();
  await page.goto(BASE + "manifest.json");
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem("poolMasterCounter.onboardingSeen.v1", "1"); localStorage.setItem("poolMasterCounter.migratedFromRepo.v1", "1"); });
  await page.goto(BASE, { waitUntil: "networkidle2" });
  await page.waitForFunction(() => document.getElementById("app").classList.contains("focus-mode"), { timeout: 10000 });
  await new Promise((r) => setTimeout(r, 600));
  const shot = async (sel, name) => { const el = await page.$(sel); await el.screenshot({ path: OUT + "/" + name }); };
  await shot("#board-topbar", "row_390_focus.png");
  await page.evaluate(() => document.getElementById("btn-toggle-focus").click());
  await new Promise((r) => setTimeout(r, 600));
  console.log(JSON.stringify(await page.evaluate(() => ({ focusText: document.getElementById("btn-toggle-focus").textContent, radiosVisible: document.querySelector(".game-mode-toggle").offsetParent !== null, doc: document.documentElement.scrollWidth }))));
  await shot(".voice-toggle-row", "row_390.png");
  await browser.close();
})();
