// "Tourney Victories: n" on the player cards: 24px on wide cards, smaller on narrow ones, never past
// the card's edge - desktop, phone, more players, Focus Mode, French.
// usage: node tests/probe_tourney_stat.js http://localhost:4235/ <screenshot dir>
const puppeteer = require("puppeteer-core");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const [BASE, OUT] = process.argv.slice(2);
let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined ? "  " + JSON.stringify(extra) : "")); if (!ok) fails++; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function setup(page, names, lang) {
  await page.goto(BASE + "manifest.json");
  await page.evaluate((lang) => { localStorage.clear(); localStorage.setItem("poolMasterCounter.onboardingSeen.v1", "1"); localStorage.setItem("poolMasterCounter.migratedFromRepo.v1", "1"); if (lang) localStorage.setItem("poolMasterCounter.language.v1", lang); }, lang);
  await page.goto(BASE, { waitUntil: "networkidle2" });
  await sleep(600);
  await page.evaluate(async (names) => {
    for (const n of names) {
      const input = document.getElementById("new-player-name"), btn = document.getElementById("btn-add-player");
      input.value = n; input.dispatchEvent(new Event("input", { bubbles: true })); btn.disabled = false; btn.click();
      await new Promise((r) => setTimeout(r, 250));
    }
    document.querySelectorAll("#roster-list li.roster-row .btn-playing:not(.is-on)").forEach((b) => b.click());
    const sel = document.querySelector("#now-playing-banner select.now-playing-type-select"); if (sel) { sel.value = "straight"; sel.dispatchEvent(new Event("change", { bubbles: true })); }
  }, names);
  await sleep(600);
}
const measure = (page) => page.evaluate(() => [...document.querySelectorAll(".stat-mini-tourney")].filter((e) => e.offsetParent).map((e) => {
  const card = e.closest(".player-panel, .member-card"), r = e.getBoundingClientRect(), c = card.getBoundingClientRect();
  return { text: e.textContent, size: parseFloat(getComputedStyle(e).fontSize), inside: r.right <= c.right + 0.5 && r.left >= c.left - 0.5, clipped: e.scrollWidth > e.clientWidth + 1, cardW: Math.round(c.width) };
}));
(async () => {
  const browser = await puppeteer.launch({ executablePath: EXE, headless: "new", defaultViewport: { width: 1280, height: 900 } });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await setup(page, ["Alex", "Sam"]);
  let m = await measure(page);
  check("desktop, 2 players: 24px, inside the card", m.length === 2 && m.every((x) => x.size === 24 && x.inside && !x.clipped), m);
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await sleep(500);
  m = await measure(page);
  check("phone, 2 players: smaller, whole, inside the card", m.length === 2 && m.every((x) => x.size < 24 && x.size >= 12 && x.inside && !x.clipped), m);
  if (OUT) { const el = await page.$(".scoreboard"); await el.screenshot({ path: OUT + "/tourney_390.png" }); }
  check("phone: no sideways scroll", (await page.evaluate(() => document.documentElement.scrollWidth)) <= 390);
  await page.click("#btn-toggle-focus");
  await sleep(600);
  m = await measure(page);
  check("phone, Focus Mode: inside the card, one line", m.every((x) => x.inside && !x.clipped), m);
  await page.click("#btn-toggle-focus");
  await setup(page, ["Alex", "Sam", "Kim", "Lee"]);
  m = await measure(page);
  check("phone, 4 players: inside each card (ellipsis at worst)", m.length >= 2 && m.every((x) => x.inside), m);
  console.log("4 players:", JSON.stringify(m.map((x) => x.size + "px " + (x.clipped ? "clipped" : "whole"))));
  if (OUT) { const el = await page.$(".scoreboard"); await el.screenshot({ path: OUT + "/tourney_390_4.png" }); }
  await setup(page, ["Alex", "Sam"], "french");
  m = await measure(page);
  check("phone, French: inside the card", m.every((x) => x.inside), m);
  console.log("French:", JSON.stringify(m.map((x) => x.text + " " + x.size + "px " + (x.clipped ? "clipped" : "whole"))));
  check("no page errors", errors.length === 0, errors);
  console.log(fails ? "TOURNEY_FAIL (" + fails + ")" : "TOURNEY_OK");
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
