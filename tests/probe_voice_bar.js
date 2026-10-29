// Voice that works in a bar (P28), an iPad board, 14.1, Kim and Jo - sentences handed to the
// voice module as the recognizer would (PMCVoice.handleText):
// - "add 3 points to Kim": Kim 3, and a big "🎤 Heard: “add 3 points to Kim”" with ↩ Undo for 5 s;
//   "undo" said: Kim back to 0;
// - "Jo plus 2", then the banner's ↩ Undo: Jo back to 0;
// - "play 9-ball" (not a score), "undo": straight pool again;
// - "add 1 point to Kim", then a + tapped for Jo: "undo" won't (the board changed since) - Kim
//   keeps the point;
// - in French: the recognizer asked for fr-FR; "ajoute trois points à Kim" - Kim +3, "annule" -
//   back; the sentences sheet starts with them in French;
// - a clicker: ☰ › Voice › Use a clicker, one press of its Page Down - learned; then a press
//   starts listening, the next stops;
// - no page errors.
// Its own file server on 4286.
// usage: node tests/probe_voice_bar.js [screenshot dir]
const puppeteer = require("puppeteer-core");
const http = require("http");
const fs = require("fs");
const path = require("path");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const REPO = path.join(__dirname, "..");
const PORT = 4286, BASE = "http://localhost:" + PORT + "/";
const OUT = process.argv[2];
let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra).slice(0, 1200) : "")); if (!ok) fails++; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
const IPAD_UA = "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

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
  const browser = await puppeteer.launch({ executablePath: EXE, headless: "new", args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
  const errors = [];
  try {
    const page = await browser.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.setUserAgent(IPAD_UA);
    await page.setViewport({ width: 1180, height: 820, hasTouch: true });
    const seed = async (lang) => {
      await page.goto(BASE + "manifest.json");
      await page.evaluate((lang) => {
        localStorage.clear();
        localStorage.setItem("poolMasterCounter.onboardingSeen.v1", "1");
        localStorage.setItem("poolMasterCounter.boardTipsSeen.v1", "1");
        localStorage.setItem("poolMasterCounter.homeScreenTipSeen.v1", "1");
        if (lang) localStorage.setItem("poolMasterCounter.language.v1", lang);
        localStorage.setItem("poolMasterCounter.state.v2", JSON.stringify({ players: [{ id: "pa", name: "Kim", playing: true, balls: 0 }, { id: "pb", name: "Jo", playing: true, balls: 0 }], playerWins: {}, teamWins: {}, teamMvpWins: {}, gameHistory: [], currentGame: { gameType: "straight", target: 100, unit: "points", mode: "individual" }, raceToWinsTarget: 5, rotation: { enabled: false, order: [], every: 1 } }));
      }, lang);
      await page.goto(BASE, { waitUntil: "networkidle2" });
      await sleep(900);
    };
    const say = async (text) => { await page.evaluate((t) => window.PMCVoice.handleText(t), text); await sleep(400); };
    const S = () => page.evaluate(() => JSON.parse(localStorage.getItem("poolMasterCounter.state.v2")));
    const score = async (name) => (await S()).players.find((p) => p.name === name).balls;
    const banner = () => page.evaluate(() => { const b = document.getElementById("voice-heard-banner"); return { shown: !b.classList.contains("hidden"), text: document.getElementById("voice-heard-text").textContent, undo: !document.getElementById("btn-voice-heard-undo").classList.contains("hidden") }; });

    await seed();
    await say("add 3 points to Kim");
    const b1 = await banner(), k1 = await score("Kim");
    if (OUT) await page.screenshot({ path: path.join(OUT, "voice_heard_banner.png") });
    check("\"add 3 points to Kim\": Kim " + k1 + ", and \"" + b1.text + "\" with ↩ Undo", k1 === 3 && b1.shown && /Heard: “add 3 points to Kim”/.test(b1.text) && b1.undo, b1);
    await say("undo");
    check("...\"undo\" said: Kim back to " + (await score("Kim")), (await score("Kim")) === 0);
    await say("Jo plus 2");
    const j1 = await score("Jo");
    await page.evaluate(() => document.getElementById("btn-voice-heard-undo").click());
    await sleep(400);
    check("\"Jo plus 2\" (Jo " + j1 + "), then the banner's ↩ Undo: Jo back to " + (await score("Jo")), j1 === 2 && (await score("Jo")) === 0);
    await say("play 9-ball");
    const g1 = (await S()).currentGame.gameType;
    await say("undo");
    const g2 = (await S()).currentGame.gameType;
    check("\"play 9-ball\" (" + g1 + "), \"undo\": back to " + g2, g1 === "9ball" && g2 === "straight", { g1, g2 });
    await say("add 1 point to Kim");
    await page.evaluate(() => [...document.querySelectorAll("#scoreboard button.btn-ball.plus")].find((x) => / for Jo$/.test(x.getAttribute("aria-label"))).click());
    await sleep(400);
    const toasts = [];
    await page.evaluate(() => { window.__toasts = []; const o = new MutationObserver(() => { document.querySelectorAll(".toast, .page-toast").forEach((t) => window.__toasts.push(t.textContent)); }); o.observe(document.body, { childList: true, subtree: true, characterData: true }); });
    await say("undo");
    const changed = { kim: await score("Kim"), jo: await score("Jo"), toasts: await page.evaluate(() => window.__toasts.join(" | ")) };
    check("\"add 1 point to Kim\", a + tapped for Jo, \"undo\": refused (the board changed since) - Kim keeps " + changed.kim, changed.kim === 1 && changed.jo === 1 && /changed since/.test(changed.toasts), changed);

    // ---- in French ----
    await seed("french");
    const lang = await page.evaluate(() => window.PMCVoice.recognitionLang());
    await say("ajoute trois points à Kim");
    const fr1 = await score("Kim"), fb = await banner();
    await say("annule");
    const fr2 = await score("Kim");
    check("in French: the recognizer asked for " + lang + "; \"ajoute trois points à Kim\" - Kim " + fr1 + " (\"" + fb.text + "\"), \"annule\" - " + fr2, lang === "fr-FR" && fr1 === 3 && fr2 === 0 && /Entendu/.test(fb.text), { lang, fr1, fr2, fb });
    await page.evaluate(() => window.PMCVoice.openSheet());
    await sleep(300);
    const sheet = await page.evaluate(() => { const own = document.querySelector("#voice-sheet-body .voice-sheet-own"); const first = document.querySelector("#voice-sheet-body section"); return { own: own ? [...own.querySelectorAll("li")].map((li) => li.textContent) : null, first: first === own }; });
    if (OUT) await page.screenshot({ path: path.join(OUT, "voice_sheet_french.png") });
    check("...the sentences sheet starts with them in French: " + JSON.stringify(sheet.own), sheet.first && sheet.own && sheet.own.length >= 5 && /Ajoute trois points/.test(sheet.own[0]), sheet);
    await page.evaluate(() => window.PMCVoice.closeSheet());

    // ---- a clicker ----
    await seed();
    await page.evaluate(() => document.getElementById("btn-voice-clicker").click());
    await sleep(200);
    const learning = await page.evaluate(() => document.getElementById("voice-clicker-status").textContent);
    await page.keyboard.press("PageDown");
    await sleep(300);
    const learned = await page.evaluate(() => ({ key: window.PMCVoice.clickerKey(), status: document.getElementById("voice-clicker-status").textContent }));
    await page.keyboard.press("PageDown");
    await sleep(500);
    const on = await page.evaluate(() => ({ listening: window.PMCVoice.isListening(), source: window.PMCVoice._source(), supported: window.PMCVoice.supported() }));
    await page.keyboard.press("PageDown");
    await sleep(500);
    const off = await page.evaluate(() => window.PMCVoice.isListening());
    check("a clicker: \"" + learning + "\", one press of Page Down - learned (\"" + learned.status + "\")", /Press the clicker/.test(learning) && learned.key === "PageDown" && /PageDown/.test(learned.status), { learning, learned });
    check("...a press starts listening, the next stops", !on.supported || (on.listening && on.source === "clicker" && !off), { on, off });
  } finally {
    check("no page errors", errors.length === 0, errors);
    await browser.close();
    site.close();
  }
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log("FAIL crashed: " + (e && e.stack)); process.exit(1); });
