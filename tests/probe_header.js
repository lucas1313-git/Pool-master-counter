// The header's button groups: 4 bordered groups in the asked order, the first three primary,
// line 1 = start / events / stats, line 2 = Contact Sheet + Set Up Camera + Help, Theme, Language; renamed buttons;
// no sideways scroll; screenshots at several widths.
// usage: node tests/probe_header.js http://localhost:4235/ <screenshot dir>
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
  await sleep(800);
  const info = await page.evaluate(() => {
    const groups = [...document.querySelectorAll(".header-nav-group")].map((g) => ({ id: g.id, items: [...g.children].map((b) => b.textContent.trim()), primary: [...g.children].map((b) => b.classList.contains("btn-primary")), border: getComputedStyle(g).borderTopStyle }));
    const lines = [...document.querySelectorAll(".header-nav-line")].map((l) => [...l.children].map((c) => c.id || c.className));
    return { groups, lines };
  });
  console.log(JSON.stringify(info));
  const g = Object.fromEntries(info.groups.map((x) => [x.id, x]));
  check("group 1: Quick Game, Welcome New Player, Game Setup Wizard, all primary", JSON.stringify(g["header-group-start"].items) === JSON.stringify(["⚡ Quick Game", "👋 Welcome New Player", "🧙 Game Setup Wizard"]) && g["header-group-start"].primary.every(Boolean), g["header-group-start"]);
  check("group 2: Tournament, League, Multi Tables", JSON.stringify(g["header-group-events"].items) === JSON.stringify(["🏆 Tournament", "🏆 League", "🎯 Multi Tables"]), g["header-group-events"].items);
  check("group 3: Leaderboard, Global Stats", JSON.stringify(g["header-group-stats"].items) === JSON.stringify(["🏆 Leaderboard", "🌐 Global Stats"]), g["header-group-stats"].items);
  check("group 4: Contact Sheet, Set Up Camera, Record, Help", JSON.stringify(g["header-group-people"].items) === JSON.stringify(["📇 Contact Sheet", "📷 Set Up Camera", "🎬 Record", "❓ Help"]), g["header-group-people"].items);
  check("all four bordered", info.groups.every((x) => x.border === "solid"));
  check("line 2: Contact Sheet + Help, then Theme, then Language", JSON.stringify(info.lines[1]) === JSON.stringify(["header-group-people", "theme-select-row", "language-select-row"]), info.lines[1]);
  for (const w of [1280, 1024, 768, 390]) {
    await page.setViewport({ width: w, height: 900, deviceScaleFactor: w === 390 ? 2 : 1 });
    await sleep(400);
    const m = await page.evaluate(() => {
      const tops = [...document.querySelectorAll(".header-nav-line")].map((l) => [...l.children].map((c) => Math.round(c.getBoundingClientRect().top)));
      return { doc: document.documentElement.scrollWidth, win: innerWidth, line1Rows: new Set(tops[0]).size, line2Rows: new Set(tops[1]).size };
    });
    console.log(w + "px:", JSON.stringify(m));
    check(w + "px: no sideways scroll", m.doc <= m.win, m);
    if (OUT) { const el = await page.$(".app-header"); await el.screenshot({ path: OUT + "/header_" + w + ".png" }); }
  }
  // a guest's device: the start group goes away entirely, no empty box
  await page.setViewport({ width: 1280, height: 900 });
  await page.evaluate(() => document.body.classList.add("network-guest-mode"));
  await sleep(200);
  const guest = await page.evaluate(() => [...document.querySelectorAll(".header-nav-group")].map((g) => g.id + ":" + (g.offsetParent !== null) + ":" + [...g.children].filter((b) => b.offsetParent !== null).length));
  check("guest mode: no empty bordered box", guest.every((s) => { const [, shown, n] = s.split(":"); return shown === "false" || +n > 0; }), guest);
  // Multi Tables opens a page titled Multi Tables (French too)
  await page.evaluate(() => document.body.classList.remove("network-guest-mode"));
  for (const [lang, title] of [["english", "Multi Tables"], ["french", "Multi-tables"]]) {
    await page.evaluate((lang) => localStorage.setItem("poolMasterCounter.language.v1", lang), lang);
    await page.goto(BASE, { waitUntil: "networkidle2" });
    await sleep(800);
    await page.evaluate(() => document.getElementById("btn-open-group-session").click());
    await sleep(600);
    const h = await page.evaluate(() => { const el = [...document.querySelectorAll('[data-i18n="groupSession.heading"]')].find((e) => e.offsetParent !== null); return el ? el.textContent.trim() : null; });
    check(lang + ": the Multi Tables page is titled " + title, h === title, h);
  }
  await page.evaluate(() => localStorage.removeItem("poolMasterCounter.language.v1"));
  check("no page errors", errors.length === 0, errors);
  console.log(fails ? "HEADER_FAIL (" + fails + ")" : "HEADER_OK");
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
