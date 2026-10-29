// Voice commands from a Siri Shortcut: sentences sent to the server's /voice
// (as the Shortcut's "Get Contents of URL" does) reach the open scoreboard,
// are done there, and the answer comes back as text for Siri to speak.
// Two scoreboards open: only the one used last acts. None open: 503. GET /voice
// is gone (POST only). From this computer (no pairing needed here - see
// probe_pairing.js for another device and the app key).
// usage: node tests/probe_voice_siri.js http://localhost:4235/
const puppeteer = require("puppeteer-core");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const [BASE] = process.argv.slice(2);
let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra) : "")); if (!ok) fails++; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function send(body, type) {
  const opts = { method: "POST", headers: { "Content-Type": type || "application/json" }, body: type ? body : JSON.stringify({ text: body }) };
  const r = await fetch(BASE + "voice", opts);
  return { status: r.status, text: await r.text() };
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: EXE, headless: "new", defaultViewport: { width: 1280, height: 900 } });
  const errors = [];
  async function open() {
    const page = await browser.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.evaluateOnNewDocument(() => {
      window.__spoken = [];
      if (window.speechSynthesis) window.speechSynthesis.speak = function (u) { window.__spoken.push(u.text); };
    });
    await page.goto(BASE, { waitUntil: "networkidle2" });
    await sleep(900);
    return page;
  }
  const setup = await browser.newPage();
  await setup.goto(BASE + "manifest.json");
  await setup.evaluate(() => { localStorage.clear(); localStorage.setItem("poolMasterCounter.onboardingSeen.v1", "1"); localStorage.setItem("poolMasterCounter.migratedFromRepo.v1", "1"); });
  await setup.close();

  const A = await open();
  await A.evaluate(async () => {
    for (const n of ["Luc", "Luigi", "Bob"]) {
      const input = document.getElementById("new-player-name"), btn = document.getElementById("btn-add-player");
      input.value = n; input.dispatchEvent(new Event("input", { bubbles: true })); btn.disabled = false; btn.click();
      await new Promise((r) => setTimeout(r, 200));
    }
  });
  const toast = (p) => p.evaluate(() => document.getElementById("page-toast").textContent);
  const stateOf = (p) => p.evaluate(() => JSON.parse(localStorage.getItem("poolMasterCounter.state.v2")));

  let r = await send("Race to 6");
  let s = await stateOf(A);
  check("POST JSON \"Race to 6\": 200, \"Race to 6\" to speak, done on the scoreboard", r.status === 200 && r.text === "Race to 6" && s.raceToWinsTarget === 6, { r, race: s.raceToWinsTarget });
  r = await send("Play straight pool");
  check("\"Play straight pool\"", r.status === 200 && /Now playing Straight Pool/.test(r.text), r);
  r = await send("Luigi plays against Luke");
  check("\"Luigi plays against Luke\": Luigi against Luc", r.status === 200 && r.text === "Luigi against Luc", r);
  // (GET /voice?text= is gone - a link or a picture on any web page could set it off; POST only)
  const g = await fetch(BASE + "voice?text=" + encodeURIComponent("add one point to Luc"));
  check("GET ?text=... does nothing now (404, POST only)", g.status === 404, g.status);
  r = await send("add one point to Luc");
  check("POST \"add one point to Luc\": \"Luc plus 1, now 1\"", r.status === 200 && r.text === "Luc plus 1, now 1", r);
  r = await send("text=" + encodeURIComponent("what's the score"), "application/x-www-form-urlencoded");
  check("form body \"what's the score\": \"Score: Luc 1, Luigi 0\"", r.status === 200 && r.text === "Score: Luc 1, Luigi 0", r);
  r = await send("take one point from Luc", "text/plain");
  check("plain-text body \"take one point from Luc\"", r.status === 200 && r.text === "Luc minus 1, now 0", r);
  const spoken = await A.evaluate(() => window.__spoken.slice());
  check("the page doesn't speak Siri's answers itself (Siri does)", spoken.length === 0, spoken);
  r = await send("the weather is nice");
  check("not understood: said so, no symbols", r.status === 200 && r.text === "Didn't understand: the weather is nice - tap Talk for the sentences", r);
  r = await send("Help");
  const sheet = await A.evaluate(() => ({ open: !document.getElementById("voice-sheet-overlay").classList.contains("hidden"), siri: (document.querySelector(".voice-sheet-siri") || {}).textContent || "", siriShown: !!document.querySelector(".voice-sheet-siri:not(.hidden)") }));
  await sleep(500);
  const sheet2 = await A.evaluate(() => ({ siriShown: !!document.querySelector(".voice-sheet-siri:not(.hidden)"), siri: (document.querySelector(".voice-sheet-siri") || {}).textContent || "" }));
  check("\"Help\": the sheet opens on the scoreboard; Siri hears where to look", r.text === "The sentences are on the scoreboard's screen." && sheet.open, { r, sheet });
  check("the sheet's Siri section: the computer's address for the Shortcut", sheet2.siriShown && /Get Contents of URL: http:\/\/[\d.]+:\d+\/voice/.test(sheet2.siri), sheet2);
  await A.evaluate(() => window.PMCVoice.closeSheet());

  // two scoreboards: the one used last gets it, only it
  const B = await open();
  await sleep(500);
  await B.bringToFront();
  await B.mouse.click(5, 300);
  await sleep(400);
  r = await send("Race to 4");
  const tA = await toast(A), tB = await toast(B);
  const raceA = await A.evaluate(() => document.getElementById("race-to-wins").value), raceB = await B.evaluate(() => document.getElementById("race-to-wins").value);
  check("two scoreboards: the one just used (B) does it, A doesn't", r.text === "Race to 4" && raceB === "4" && raceA !== "4" && /Race to 4/.test(tB) && !/Race to 4/.test(tA), { r, raceA, raceB, tA, tB });
  await A.bringToFront(); // (clicking a window brings it forward; here, by hand)
  await A.mouse.click(5, 300);
  await sleep(400);
  r = await send("Race to 3");
  const raceA2 = await A.evaluate(() => document.getElementById("race-to-wins").value), raceB2 = await B.evaluate(() => document.getElementById("race-to-wins").value);
  check("...then A used again: A does the next one", raceA2 === "3" && raceB2 === "4", { raceA2, raceB2 });

  await A.close();
  await B.close();
  await sleep(500);
  r = await send("Race to 5");
  check("no scoreboard open: 503, said so", r.status === 503 && /isn't open/.test(r.text), r);
  r = await send("");
  check("nothing said: 400", r.status === 400, r);

  check("no page errors", errors.length === 0, errors);
  await browser.close();
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
