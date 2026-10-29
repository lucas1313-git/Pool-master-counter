// Accessibility (P19), at 1180x820:
// - every popup is a dialog: role="dialog" (the confirm "alertdialog"), aria-modal, a name;
// - ☰ Menu by keyboard: the focus goes in, Tab stays inside, Escape closes it and the focus is
//   back on ☰; End night (no Escape before) closes on Escape too;
// - honest labels: a rack game's + "Win the rack for Kim"; a points game's "Add a point for Kim" /
//   "Take a point from Kim";
// - the score is a real button: Tab to Jo's, Enter, Jo selected (aria-pressed);
// - one polite live region: "Kim won rack 1 ... Score: Kim 1, Jo 0" after the +, the win banner
//   no longer a second one; a points game's + read out too;
// - reduced motion: the score flash's 0.6 s animation drops to nothing;
// - the camera icon: a shape per state (✓ recognized, ≈ probably them, ↗ out of view, – not seen)
//   and its name for a screen reader;
// - in French: the + says "Gagner la manche pour Kim", no English label left on the board, and the
//   End night share is written in French ("Kim bat Jo", "Journal des parties");
// - camera.html?lang=french: its tabs and title in French;
// - docs/tagalog-review.md lists the Tagalog strings still in English;
// - no page errors.
// Its own file server on 4273.
// usage: node tests/probe_accessibility.js [screenshot dir]
const puppeteer = require("puppeteer-core");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const REPO = path.join(__dirname, "..");
const PORT = 4273, BASE = "http://localhost:" + PORT + "/";
const OUT = process.argv[2];
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra).slice(0, 1200) : "")); if (!ok) fails++; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const site = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, BASE).pathname);
    if (p.endsWith("/")) p += "index.html";
    const f = path.join(REPO, p);
    if (!f.startsWith(REPO) || p.startsWith("/api/") || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end("404"); }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream" });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise((ok) => site.listen(PORT, ok));
  const browser = await puppeteer.launch({ executablePath: EXE, headless: "new" });
  const errors = [];
  const page = await browser.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewport({ width: 1180, height: 820, hasTouch: true });
  await page.evaluateOnNewDocument(() => {
    window.__shares = [];
    navigator.canShare = () => true;
    navigator.share = (data) => { window.__shares.push({ text: data.text || "", files: (data.files || []).map((f) => f.name) }); return Promise.resolve(); };
  });
  const seed = async (game, extra) => {
    await page.goto(BASE + "manifest.json");
    await page.evaluate((game, extra) => {
      localStorage.clear();
      localStorage.setItem("poolMasterCounter.onboardingSeen.v1", "1");
      localStorage.setItem("poolMasterCounter.boardTipsSeen.v1", "1");
      localStorage.setItem("poolMasterCounter.migratedFromRepo.v1", "1");
      Object.keys(extra.ls || {}).forEach((k) => localStorage.setItem(k, extra.ls[k]));
      localStorage.setItem("poolMasterCounter.state.v2", JSON.stringify(Object.assign({
        players: [{ id: "k", name: "Kim", playing: true, balls: 0 }, { id: "j", name: "Jo", playing: true, balls: 0 }],
        playerWins: {}, teamWins: {}, teamMvpWins: {}, gameHistory: [], gamesPlayedCount: 0,
        currentGame: game, raceToWinsTarget: 5, rotation: { enabled: false, order: [], every: 1 }
      }, extra.state || {})));
    }, game, extra || {});
    await page.goto(BASE, { waitUntil: "networkidle2" });
    await sleep(900);
  };
  const plusOf = (name) => page.evaluate((name) => { const b = [...document.querySelectorAll("#scoreboard .btn-ball.plus")].find((x) => x.getAttribute("aria-label").endsWith(" " + name)); return b ? b.getAttribute("aria-label") : null; }, name);
  const minusOf = (name) => page.evaluate((name) => { const b = [...document.querySelectorAll("#scoreboard .btn-ball.minus")].find((x) => x.getAttribute("aria-label").indexOf(name) !== -1); return b ? b.getAttribute("aria-label") : null; }, name);
  const tapPlus = (name) => page.evaluate((name) => [...document.querySelectorAll("#scoreboard .btn-ball.plus")].find((x) => x.getAttribute("aria-label").endsWith(" " + name)).click(), name);
  const RACK = { gameType: "8ball", target: 1, unit: "rack", mode: "individual" };

  // ---- every popup a dialog ----
  await seed(RACK);
  const dialogs = await page.evaluate(() => [...document.querySelectorAll('[id$="-overlay"]')].map((o) => {
    const named = o.getAttribute("aria-labelledby") ? !!document.getElementById(o.getAttribute("aria-labelledby")) : !!o.getAttribute("aria-label");
    return { id: o.id, ok: /^(alert)?dialog$/.test(o.getAttribute("role") || "") && o.getAttribute("aria-modal") === "true" && named };
  }));
  const notDialogs = dialogs.filter((d) => !d.ok).map((d) => d.id);
  check("every popup (" + dialogs.length + ") is a named dialog: role, aria-modal, aria-labelledby", dialogs.length >= 40 && notDialogs.length === 0, notDialogs);

  // ---- ☰ Menu by keyboard ----
  await page.focus("#btn-board-menu");
  await page.keyboard.press("Enter");
  await sleep(350);
  const inMenu = await page.evaluate(() => document.getElementById("board-menu-overlay").contains(document.activeElement));
  const trapped = [];
  for (let i = 0; i < 24; i++) {
    await page.keyboard.press("Tab");
    trapped.push(await page.evaluate(() => document.getElementById("board-menu-overlay").contains(document.activeElement)));
  }
  await page.keyboard.down("Shift");
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("Tab");
    trapped.push(await page.evaluate(() => document.getElementById("board-menu-overlay").contains(document.activeElement)));
  }
  await page.keyboard.up("Shift");
  await page.keyboard.press("Escape");
  await sleep(300);
  const after = await page.evaluate(() => ({ closed: document.getElementById("board-menu-overlay").classList.contains("hidden"), focus: document.activeElement && document.activeElement.id }));
  check("☰ Menu by keyboard: the focus goes in, 30 Tabs stay inside, Escape closes it, the focus back on ☰", inMenu && trapped.every(Boolean) && after.closed && after.focus === "btn-board-menu", { inMenu, trapped: trapped.filter((x) => !x).length, after });
  await page.click("#btn-board-menu");
  await sleep(250);
  await page.evaluate(() => [...document.querySelectorAll("#board-menu-list .board-menu-row")].find((b) => b.dataset.menuKey === "menu.endNight").click());
  await sleep(500);
  const endOpen = await page.evaluate(() => !document.getElementById("end-night-overlay").classList.contains("hidden"));
  await page.keyboard.press("Escape");
  await sleep(300);
  const endClosed = await page.evaluate(() => document.getElementById("end-night-overlay").classList.contains("hidden"));
  check("🌙 End night (no Escape before): Escape closes it", endOpen && endClosed, { endOpen, endClosed });

  // ---- honest labels, the score button, the live region ----
  check("a rack game: the + says \"Win the rack for Kim\"", (await plusOf("Kim")) === "Win the rack for Kim", await plusOf("Kim"));
  await tapPlus("Kim");
  await sleep(1300);
  const live = await page.evaluate(() => ({ text: document.getElementById("score-announcer").textContent, polite: document.getElementById("score-announcer").getAttribute("aria-live"), banner: [document.getElementById("win-banner").getAttribute("aria-live"), document.getElementById("win-banner").getAttribute("role")] }));
  check("one polite live region: \"Kim won rack 1 ... Score: Kim 1, Jo 0\"; the win banner isn't a second one", live.polite === "polite" && /Kim won rack 1/.test(live.text) && /Score: Kim 1, Jo 0/.test(live.text) && live.banner.every((x) => x === null), live);
  await page.evaluate(() => { const x = document.querySelector("#win-banner .win-banner-close"); if (x) x.click(); });
  const scoreButtons = await page.evaluate(() => [...document.querySelectorAll("#scoreboard .stat-value")].map((b) => ({ tag: b.tagName, label: b.getAttribute("aria-label") })));
  await page.evaluate(() => [...document.querySelectorAll("#scoreboard button.stat-value")].find((b) => /Jo/.test(b.getAttribute("aria-label"))).focus());
  await page.keyboard.press("Enter");
  await sleep(400);
  const picked = await page.evaluate(() => { const b = [...document.querySelectorAll("#scoreboard button.stat-value")].find((x) => /Jo/.test(x.getAttribute("aria-label"))); return { pressed: b && b.getAttribute("aria-pressed"), panel: b && b.closest(".player-panel").className }; });
  check("the score is a button (\"Select Jo (0 / 5)\"): Enter on it picks Jo", scoreButtons.length === 2 && scoreButtons.every((b) => b.tag === "BUTTON") && scoreButtons.some((b) => /^Select Jo \(0 \/ 5\)$/.test(b.label)) && picked.pressed === "true" && /is-keypad-selected/.test(picked.panel), { scoreButtons, picked });
  if (OUT) await page.screenshot({ path: path.join(OUT, "a11y_board.png") });

  // ---- a points game, reduced motion ----
  await seed({ gameType: "straight", target: 100, unit: "points", mode: "individual" });
  const pointLabels = [await plusOf("Kim"), await minusOf("Kim")];
  check("a points game: \"Add a point for Kim\" / \"Take a point from Kim\"", pointLabels[0] === "Add a point for Kim" && pointLabels[1] === "Take a point from Kim", pointLabels);
  await tapPlus("Kim");
  const flash = await page.evaluate(() => { const f = document.querySelector("#scoreboard .stat-value-flash"); return f ? getComputedStyle(f).animationDuration : null; });
  await sleep(1300);
  const liveP = await page.evaluate(() => document.getElementById("score-announcer").textContent);
  check("...its + read out: \"Score: Kim 1, Jo 0\"", /Score: Kim 1, Jo 0/.test(liveP), liveP);
  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  await tapPlus("Kim");
  const flashReduced = await page.evaluate(() => { const f = document.querySelector("#scoreboard .stat-value-flash"); return f ? getComputedStyle(f).animationDuration : null; });
  check("reduced motion: the score flash (" + flash + ") drops to nothing (" + flashReduced + ")", flash === "0.6s" && flashReduced !== null && parseFloat(flashReduced) < 0.001, { flash, flashReduced });
  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "no-preference" }]);

  // ---- the camera icon's shapes ----
  await seed(RACK, { state: { cameraInputEnabled: true, cameraWizardCompleted: true, sameDeviceCameraSetUp: true } });
  const marks = async () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll(".scorecard-camera-badge")].map((b, i) => [["k", "j"][i], { mark: (b.querySelector(".scorecard-camera-badge-mark") || {}).textContent, label: b.getAttribute("aria-label"), role: b.getAttribute("role") }])));
  await page.evaluate(() => window.PMCCameraBridge.reportPlayerStates({ Kim: "recognized", Jo: "suspected" }));
  await sleep(200);
  const m1 = await marks();
  if (OUT) await page.screenshot({ path: path.join(OUT, "a11y_camera_marks.png") });
  await page.evaluate(() => window.PMCCameraBridge.reportPlayerStates({ Kim: "located" }));
  await sleep(200);
  const m2 = await marks();
  check("the camera icon: ✓ recognized, ≈ probably them, ↗ out of view, – not seen - each named for a screen reader", m1.k && m1.k.mark === "✓" && m1.k.label === "Camera: recognized" && m1.k.role === "img" && m1.j.mark === "≈" && m1.j.label === "Camera: probably them" && m2.k.mark === "↗" && m2.k.label === "Camera: out of view" && m2.j.mark === "–" && m2.j.label === "Camera: not seen", { m1, m2 });

  // ---- in French ----
  await seed(RACK, { ls: { "poolMasterCounter.language.v1": "french" } });
  await sleep(500);
  check("in French: the + says \"Gagner la manche pour Kim\"", (await plusOf("Kim")) === "Gagner la manche pour Kim", await plusOf("Kim"));
  for (const n of ["Kim", "Kim", "Jo", "Kim"]) {
    await tapPlus(n);
    await sleep(800);
  }
  const english = await page.evaluate(() => [...document.querySelectorAll("#app [aria-label]")].filter((e) => e.getClientRects().length).map((e) => e.getAttribute("aria-label")).filter((l) => /Add point|Remove point|Undo last win|View stats|Move .* queue|Win the rack|Select [A-Z]/.test(l)));
  check("...no English label left on the board", english.length === 0, english);
  await page.evaluate(() => { const x = document.querySelector("#win-banner .win-banner-close"); if (x) x.click(); });
  await page.click("#btn-board-menu");
  await sleep(250);
  await page.evaluate(() => [...document.querySelectorAll("#board-menu-list .board-menu-row")].find((b) => b.dataset.menuKey === "menu.endNight").click());
  await sleep(600);
  await page.click("#btn-end-night-share");
  await sleep(900);
  const frReport = await page.evaluate(() => (window.__shares[window.__shares.length - 1] || {}).text || "");
  check("...🌙 End night's share in French: \"Kim bat Jo\", the game log titled in French - no \"def.\", \"won\" or \"Game Log\"", /Kim bat Jo/.test(frReport) && /Journal des parties|JOURNAL DES PARTIES|Détail des parties|DÉTAIL DES PARTIES/.test(frReport) && !/ def\. | won |Game Log|No games/.test(frReport), frReport.slice(0, 900));

  // ---- camera.html in French ----
  const cam = await browser.newPage();
  cam.on("pageerror", () => {});
  await cam.goto(BASE + "camera.html?lang=french", { waitUntil: "domcontentloaded" });
  await sleep(2500);
  const camText = await cam.evaluate(() => ({ title: document.title, tabs: ["tabRecognize", "tabCalibrate", "tabEnroll", "tabRoomMap"].map((id) => document.getElementById(id).textContent.trim()), lang: document.documentElement.lang }));
  check("camera.html?lang=french: \"Reconnaître\", \"Table\", \"Inscrire\", \"Plan de la salle\" and a French title", camText.tabs.join("|") === "Reconnaître|Table|Inscrire|Plan de la salle" && /Reconnaissance par caméra/.test(camText.title) && camText.lang === "fr", camText);
  await cam.close();

  // ---- the Tagalog list ----
  const out = execFileSync("node", [path.join(__dirname, "tagalog_review.js")]).toString();
  const md = fs.readFileSync(path.join(REPO, "docs/tagalog-review.md"), "utf8");
  const listed = (md.match(/^\| `[^`]+` \|/gm) || []).length;
  check("docs/tagalog-review.md lists the Tagalog strings still in English (" + out.trim() + ")", /## Identical to English \(\d+\)/.test(md) && listed > 50, { listed });

  check("no page errors", errors.length === 0, errors);
  await browser.close();
  site.close();
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log("FAIL crashed: " + (e && e.stack)); process.exit(1); });
