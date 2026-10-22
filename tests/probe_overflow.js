// Which elements stick out past the right edge at a given width (default 390) - for chasing sideways scroll.
// usage: node tests/probe_overflow.js http://localhost:4235/ [width] [straight]
const puppeteer = require("puppeteer-core");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
(async () => {
  const BASE = process.argv[2], W = +(process.argv[3] || 390);
  const browser = await puppeteer.launch({ executablePath: EXE, headless: "new", defaultViewport: { width: W, height: 844 } });
  const page = await browser.newPage();
  await page.goto(BASE + "manifest.json");
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem("poolMasterCounter.onboardingSeen.v1", "1"); localStorage.setItem("poolMasterCounter.migratedFromRepo.v1", "1"); });
  await page.goto(BASE, { waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 600));
  await page.evaluate(async () => {
    for (const n of ["Alex", "Sam"]) {
      const input = document.getElementById("new-player-name"), btn = document.getElementById("btn-add-player");
      input.value = n; input.dispatchEvent(new Event("input", { bubbles: true })); btn.disabled = false; btn.click();
      await new Promise((r) => setTimeout(r, 250));
    }
    document.querySelectorAll("#roster-list li.roster-row .btn-playing:not(.is-on)").forEach((b) => b.click());
  });
  await new Promise((r) => setTimeout(r, 500));
  if (process.argv[4]) { await page.select("#now-playing-banner select.now-playing-type-select", process.argv[4]).catch(() => {}); await new Promise((r) => setTimeout(r, 400)); }
  const out = await page.evaluate((W) => {
    const res = [];
    document.querySelectorAll("body *").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width && r.right > W + 0.5 && el.offsetParent !== null) res.push((el.id ? "#" + el.id : el.tagName.toLowerCase() + "." + [...el.classList].join(".")) + " right=" + Math.round(r.right) + " w=" + Math.round(r.width));
    });
    return { doc: document.documentElement.scrollWidth, items: res.slice(0, 15) };
  }, W);
  console.log(JSON.stringify(out, null, 1));
  await browser.close();
})();
