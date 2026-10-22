// The "Select player from keypad" banner and the score card's red "?" don't blink with the camera's
// frame-to-frame changes: shown once the situation holds 1s, kept at least 3s; a keypad pick clears
// both at once; the banner is big. Camera messages are simulated through PMCCameraBridge.reportCandidateSeen.
// usage: node tests/probe_unmatched_banner.js http://localhost:4235/ <screenshot dir>
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
    for (const n of ["Alex", "Sam"]) {
      const input = document.getElementById("new-player-name"), btn = document.getElementById("btn-add-player");
      input.value = n; input.dispatchEvent(new Event("input", { bubbles: true })); btn.disabled = false; btn.click();
      await new Promise((r) => setTimeout(r, 250));
    }
    document.querySelectorAll("#roster-list li.roster-row .btn-playing:not(.is-on)").forEach((b) => b.click());
    const vs = document.getElementById("visual-scoring-panel"); if (vs.classList.contains("collapsed")) document.getElementById("btn-toggle-visual-scoring-panel").click();
    const cb = document.getElementById("camera-input-checkbox"); if (!cb.checked) cb.click();
  });
  await sleep(600);
  // the score cards' camera icons are there with the camera on this same device
  await page.evaluate(() => { const st = JSON.parse(localStorage.getItem("poolMasterCounter.state.v2")); st.sameDeviceCameraSetUp = true; localStorage.setItem("poolMasterCounter.state.v2", JSON.stringify(st)); });
  await page.goto(BASE, { waitUntil: "networkidle2" });
  await sleep(1200);
  console.log("camera icons on the cards:", await page.evaluate(() => document.querySelectorAll(".scorecard-camera-badge").length));
  // watch: count every change of the banner's visibility and of the "?" on any card
  await page.evaluate(() => {
    window.__log = [];
    const b = document.getElementById("unmatched-shooter-banner");
    let lastB = !b.classList.contains("hidden"), lastQ = "";
    setInterval(() => {
      const nb = !b.classList.contains("hidden");
      const q = [...document.querySelectorAll(".scorecard-camera-badge.show-question")].map((x) => x.dataset.playerId).join();
      if (nb !== lastB) { window.__log.push({ t: Date.now(), what: "banner", on: nb }); lastB = nb; }
      if (q !== lastQ) { window.__log.push({ t: Date.now(), what: "question", on: q }); lastQ = q; }
    }, 20);
  });
  const report = (name, stance, needs) => page.evaluate((name, stance, needs) => window.PMCCameraBridge.reportCandidateSeen(name, stance, stance === "bent" ? 45 : 5, null, null, 1.2, 0.8, 0.3, false, null, needs), name, stance, needs);
  const log = () => page.evaluate(() => window.__log.splice(0));
  // 1. flickering every ~150ms for 3s: nothing should appear
  for (let i = 0; i < 20; i++) { await report(i % 2 ? "Alex" : null, "bent", i % 2 ? null : "Alex"); await sleep(150); }
  let l = await log();
  check("a guess flickering every 150ms: no banner, no '?' at all", l.length === 0, l);
  await report("Alex", "upright", null);
  await sleep(300);
  // 2. steady for 1.6s: shows after ~1s, once
  const t0 = Date.now();
  for (let i = 0; i < 8; i++) { await report(null, "bent", "Sam"); await sleep(200); }
  l = await log();
  const bOn = l.find((e) => e.what === "banner" && e.on), qOn = l.find((e) => e.what === "question" && e.on);
  check("steady 'bent, can't say who': the banner shows after ~1s, once", bOn && bOn.t - t0 >= 900 && l.filter((e) => e.what === "banner").length === 1, l.map((e) => e.what + ":" + e.on + "@" + (e.t - t0)));
  check("...and Sam's card shows the '?' after ~1s, once", qOn && qOn.t - t0 >= 900 && l.filter((e) => e.what === "question").length === 1, l.map((e) => e.what + ":" + e.on + "@" + (e.t - t0)));
  const sizes = await page.evaluate(() => { const b = document.getElementById("unmatched-shooter-banner"); return { text: parseFloat(getComputedStyle(b).fontSize), icon: parseFloat(getComputedStyle(b.querySelector(".unmatched-shooter-banner-icon")).fontSize) }; });
  check("the banner is big (text ~21.6px, camera 32px)", sizes.text >= 21 && sizes.icon >= 31, sizes);
  if (OUT) { const el = await page.$("#unmatched-shooter-banner"); await el.screenshot({ path: OUT + "/unmatched_banner.png" }); }
  // 3. the situation ends at once: both stay their 3s, then go - no flicker
  const tEnd = Date.now();
  await report("Sam", "upright", null);
  for (let i = 0; i < 4; i++) { await sleep(300); await report(i % 2 ? null : "Sam", "upright", null); }
  await sleep(2600);
  l = await log();
  const bOff = l.find((e) => e.what === "banner" && !e.on);
  check("it ends: the banner stays its 3s, then goes, once", bOff && bOff.t - bOn.t >= 2900 && l.filter((e) => e.what === "banner").length === 1, l.map((e) => e.what + ":" + e.on + "@" + (e.t - tEnd)));
  // 4. a keypad pick clears both at once
  for (let i = 0; i < 8; i++) { await report(null, "bent", "Sam"); await sleep(200); }
  await log();
  const tPick = Date.now();
  await page.evaluate(() => { const id = window.PMCCameraBridge.resolvePlayerIdByName("Sam"); window.PMCCameraBridge.resolveUnmatchedShooterPrompt(id); });
  await sleep(150);
  l = await log();
  const s4 = await page.evaluate(() => ({ banner: !document.getElementById("unmatched-shooter-banner").classList.contains("hidden"), q: document.querySelectorAll(".scorecard-camera-badge.show-question").length }));
  check("a keypad pick: banner and '?' gone at once", !s4.banner && s4.q === 0, { s4, l: l.map((e) => e.what + ":" + e.on + "@" + (e.t - tPick)) });
  check("no page errors", errors.length === 0, errors);
  console.log(fails ? "UNMATCHED_FAIL (" + fails + ")" : "UNMATCHED_OK");
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
