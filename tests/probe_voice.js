// Voice commands, in the page: the microphone is replaced by a fake that
// "hears" window.__voiceNext when the hold ends, so the whole path runs -
// the number pad's "." key and the 🎤 button held, what's done, the beep,
// what's spoken, the win window's balls left, the sentences sheet.
// usage: node tests/probe_voice.js http://localhost:4235/ <screenshot dir>
const puppeteer = require("puppeteer-core");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const [BASE, OUT] = process.argv.slice(2);
let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra) : "")); if (!ok) fails++; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({ executablePath: EXE, headless: "new", defaultViewport: { width: 1280, height: 900 } });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.evaluateOnNewDocument(() => {
    window.__voiceNext = null; window.__voiceStarts = 0; window.__spoken = []; window.__oscStarts = 0;
    class FakeRecognition {
      start() { window.__voiceStarts++; window.__voiceRec = this; }
      stop() {
        const said = window.__voiceNext;
        setTimeout(() => {
          if (said && this.onresult) {
            const res = [].concat(said).map((t) => ({ transcript: t }));
            res.isFinal = true;
            this.onresult({ resultIndex: 0, results: [res] });
          }
          if (this.onend) this.onend();
        }, 120);
      }
      abort() { setTimeout(() => this.onend && this.onend(), 10); }
    }
    window.SpeechRecognition = FakeRecognition;
    window.webkitSpeechRecognition = FakeRecognition;
    const start = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function () { window.__oscStarts++; return start.apply(this, arguments); };
    if (window.speechSynthesis) window.speechSynthesis.speak = function (u) { window.__spoken.push(u.text); };
  });
  await page.goto(BASE + "manifest.json");
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem("poolMasterCounter.onboardingSeen.v1", "1"); localStorage.setItem("poolMasterCounter.migratedFromRepo.v1", "1"); });
  await page.goto(BASE, { waitUntil: "networkidle2" });
  await sleep(700);
  await page.evaluate(async () => {
    for (const n of ["Luc", "Luigi", "Bob", "Chris"]) {
      const input = document.getElementById("new-player-name"), btn = document.getElementById("btn-add-player");
      input.value = n; input.dispatchEvent(new Event("input", { bubbles: true })); btn.disabled = false; btn.click();
      await new Promise((r) => setTimeout(r, 200));
    }
    window.scrollTo(0, 0);
  });
  await sleep(400);

  const st = () => page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("poolMasterCounter.state.v2"));
    const by = {};
    s.players.forEach((p) => { by[p.name] = { playing: p.playing, team: p.teamId, balls: p.balls }; });
    return { game: s.currentGame.gameType, target: s.currentGame.target, unit: s.currentGame.unit, mode: s.currentGame.mode, race: s.raceToWinsTarget,
      rotation: s.rotation.order.map((e) => e.gameType), rotationOn: !!s.rotation.enabled, every: s.rotation.every, players: by,
      lastWin: s.gameHistory[0] && typeof s.gameHistory[0] === "object" ? { winner: s.gameHistory[0].winnerNames, ballsLeft: s.gameHistory[0].ballsLeftOnTable } : null,
      toast: document.getElementById("page-toast").textContent,
      rotationRadio: document.getElementById("scoreboard-mode-rotation").checked,
      winOpen: !document.getElementById("gamewin-overlay").classList.contains("hidden") };
  });
  const say = async (text) => { await page.evaluate((t) => window.PMCVoice.handleText(t), text); await sleep(250); return st(); };
  const holdKey = async (text) => {
    await page.evaluate((t) => { window.__voiceNext = t; }, text);
    await page.keyboard.down("NumpadDecimal");
    await sleep(400);
    await page.keyboard.up("NumpadDecimal");
    await sleep(700);
    return st();
  };

  const visible = await page.evaluate(() => !document.getElementById("voice-command-group").classList.contains("hidden"));
  check("the 🎤 Talk button shows (speech recognition available)", visible);
  if (OUT) { const row = await page.$("#scoreboard-panel .voice-toggle-row"); await row.screenshot({ path: OUT + "/voice_row.png" }); }

  // --- game and race ---
  let s = await say("Play 8-ball race to 5");
  check("\"Play 8-ball race to 5\": 8-Ball, race to 5", s.game === "8ball" && s.race === 5, s);
  s = await say("Race to 7");
  check("\"Race to 7\"", s.race === 7 && /Race to 7/.test(s.toast), s);

  // --- rotation ---
  s = await say("Rotation 8-ball and 9-ball");
  check("\"Rotation 8-ball and 9-ball\": the lineup, rotation on, the score section's radio too", s.rotation.join() === "8ball,9ball" && s.rotationOn && s.rotationRadio, s);
  s = await say("Add 10-ball to the rotation");
  check("\"Add 10-ball to the rotation\"", s.rotation.join() === "8ball,9ball,10ball", s);
  s = await say("Remove 9-ball from the rotation");
  check("\"Remove 9-ball from the rotation\"", s.rotation.join() === "8ball,10ball", s);
  s = await say("Change game every 2 games");
  check("\"Change game every 2 games\"", s.every === 2, s);
  s = await say("Single game");
  check("\"Single game\": rotation off (radio too), lineup kept", !s.rotationOn && !s.rotationRadio && s.rotation.length === 2, s);
  s = await say("Clear the rotation");
  check("\"Clear the rotation\"", s.rotation.length === 0, s);

  // --- players ---
  s = await say("Add Mario to the session");
  check("\"Add Mario to the session\": added on standby", s.players.Mario && s.players.Mario.playing === false, s.players);
  s = await say("Mario is playing");
  check("\"Mario is playing\"", s.players.Mario.playing === true, s.players);
  s = await say("Mario is standby");
  check("\"Mario is standby\"", s.players.Mario.playing === false, s.players);
  s = await say("Luigi plays against Luke");
  check("\"Luigi plays against Luke\" (heard Luke for Luc): exactly Luigi and Luc playing",
    s.players.Luigi.playing && s.players.Luc.playing && !s.players.Bob.playing && !s.players.Chris.playing && !s.players.Mario.playing && s.mode === "individual", s.players);
  s = await say("Luigi and Luc are team A against Bob and Chris as team B");
  check("teams: Luigi + Luc team A, Bob + Chris team B, Play as Teams",
    s.mode === "teams" && s.players.Luigi.team === "A" && s.players.Luc.team === "A" && s.players.Bob.team === "B" && s.players.Chris.team === "B" && s.players.Bob.playing && !s.players.Mario.playing, s);
  if (OUT) await page.screenshot({ path: OUT + "/voice_teams.png" });
  s = await say("Luigi plays against Luc");
  check("back to Luigi against Luc, individual", s.mode === "individual" && !s.players.Bob.playing && s.players.Luc.playing, s);

  // --- points, through the held "." key ---
  s = await say("Play straight pool");
  check("\"Play straight pool\": points to 100", s.game === "straight" && s.unit === "points" && s.target === 100, s);
  const osc0 = await page.evaluate(() => window.__oscStarts);
  const starts0 = await page.evaluate(() => window.__voiceStarts);
  await page.evaluate(() => { window.__voiceNext = "add one point to Luc"; });
  await page.keyboard.down("NumpadDecimal");
  await sleep(250);
  const during = await page.evaluate(() => ({ btn: document.getElementById("btn-voice-hold").classList.contains("listening"), live: document.getElementById("voice-live").className, text: document.getElementById("voice-live").textContent }));
  if (OUT) await page.screenshot({ path: OUT + "/voice_listening.png" });
  await sleep(200);
  await page.keyboard.up("NumpadDecimal");
  await sleep(700);
  s = await st();
  const osc1 = await page.evaluate(() => window.__oscStarts);
  check("holding the number pad's . key listens (button red, Listening… shown)", during.btn && /listening/.test(during.live) && (await page.evaluate(() => window.__voiceStarts)) === starts0 + 1, during);
  check("\"add one point to Luc\" by the held key: Luc 1, a beep, the toast", s.players.Luc.balls === 1 && osc1 > osc0 && /Luc \+1 → 1/.test(s.toast), { luc: s.players.Luc, osc0, osc1, toast: s.toast });
  s = await holdKey("Add 3 points to Luigi");
  check("\"Add 3 points to Luigi\"", s.players.Luigi.balls === 3, s.players);
  s = await holdKey("add one point");
  check("\"add one point\" (no name): the selected player - Luigi", s.players.Luigi.balls === 4, s.players);
  s = await holdKey("Take one point from Luc");
  check("\"Take one point from Luc\"", s.players.Luc.balls === 0, s.players);
  await page.evaluate(() => { window.__spoken = []; });
  await say("What's the score?");
  await sleep(1200);
  let spoken = await page.evaluate(() => window.__spoken.slice());
  check("\"What's the score?\" is spoken", spoken.some((t) => /Score: .*Luc 0.*Luigi 4|Score: .*Luigi 4.*Luc 0/.test(t)), spoken);

  // --- an 8-ball win with balls left ---
  s = await say("Play 8-ball");
  s = await say("Luigi wins the game with 5 balls left on the table");
  const field = await page.evaluate(() => { const i = document.querySelector("#gamewin-details .balls-left-input"); return i ? i.value : null; });
  check("\"Luigi wins the game with 5 balls left on the table\": the win window, Luigi, 5 left", s.winOpen && s.lastWin && s.lastWin.winner.join() === "Luigi" && s.lastWin.ballsLeft === 5 && field === "5", { s, field });
  if (OUT) await page.screenshot({ path: OUT + "/voice_win.png" });
  s = await holdKey("6 balls left");
  const field2 = await page.evaluate(() => document.querySelector("#gamewin-details .balls-left-input").value);
  check("\"6 balls left\" by the held key while the balls-left field has focus: 6, no '.' typed", s.lastWin.ballsLeft === 6 && field2 === "6", { field2, s: s.lastWin });
  s = await say("Nice game");
  check("\"Nice game\" closes the win window, 6 kept", !s.winOpen && s.lastWin.ballsLeft === 6, s);

  // --- Q-score ---
  await page.evaluate(() => { window.__spoken = []; });
  await say("What is Luigi's Q-score today?");
  await sleep(1200);
  spoken = await page.evaluate(() => window.__spoken.slice());
  check("\"What is Luigi's Q-score today?\" is spoken", spoken.some((t) => /Luigi's Q-Score is \d+, up \d+ today/.test(t)), spoken);

  // --- the 🎤 button held with the mouse ---
  const btn = await page.$("#btn-voice-hold");
  const box = await btn.boundingBox();
  await page.evaluate(() => { window.__voiceNext = "Race to 3"; });
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await sleep(450);
  await page.mouse.up();
  await sleep(700);
  s = await st();
  check("the 🎤 button held: \"Race to 3\"", s.race === 3, s);
  // a tap is not a hold
  const before = await st();
  await page.evaluate(() => { window.__voiceNext = "Race to 9"; });
  await page.mouse.down();
  await sleep(60);
  await page.mouse.up();
  await sleep(500);
  s = await st();
    const tapSheet = await page.evaluate(() => !document.getElementById("voice-sheet-overlay").classList.contains("hidden"));
  check("a quick tap on the button: no command, the sentences sheet instead", s.race === before.race && tapSheet, { race: s.race, tapSheet });
  await page.click("#btn-voice-sheet-close");
  await sleep(200);
  // a quick tap of the "." key: a hint, no command
  await page.keyboard.down("NumpadDecimal");
  await sleep(60);
  await page.keyboard.up("NumpadDecimal");
  await sleep(400);
  const keyHint = await page.evaluate(() => document.getElementById("voice-live").textContent);
  s = await st();
  check("a quick tap of the . key: no command, a hint to hold", s.race === before.race && /Hold to talk/.test(keyHint), { race: s.race, keyHint });

  // --- not understood, unknown names ---
  const osc2 = await page.evaluate(() => window.__oscStarts);
  s = await say("Add one point to Zelda");
  const osc3 = await page.evaluate(() => window.__oscStarts);
  check("an unknown name: told who wasn't found, the miss sound", /Who is "zelda"/i.test(s.toast) && osc3 > osc2, s.toast);
  s = await say("the weather is nice");
  check("not a command: \"Didn't understand\"", /Didn't understand/.test(s.toast), s.toast);

  // --- the sheet ---
  await say("Help");
  const sheet = await page.evaluate(() => ({ open: !document.getElementById("voice-sheet-overlay").classList.contains("hidden"), sections: document.querySelectorAll("#voice-sheet-body .voice-sheet-section:not(.voice-sheet-siri)").length, siri: !!document.querySelector("#voice-sheet-body .voice-sheet-siri"), text: document.getElementById("voice-sheet-body").textContent }));
  check("\"Help\" opens the sentences sheet (6 sections of sentences + Siri)", sheet.open && sheet.sections === 6 && sheet.siri && /Luigi wins the game with 5 balls left/.test(sheet.text), sheet);
  if (OUT) { await page.screenshot({ path: OUT + "/voice_sheet.png" }); }
  await page.keyboard.press("Escape");
  await sleep(200);
  check("Escape closes it", await page.evaluate(() => document.getElementById("voice-sheet-overlay").classList.contains("hidden")));
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await sleep(60);
  await page.mouse.up();
  await sleep(300);
  check("a tap on the 🎤 button opens it too", await page.evaluate(() => !document.getElementById("voice-sheet-overlay").classList.contains("hidden")));
  await page.click("#btn-voice-sheet-close");

  // --- phone width: the row still fits ---
  await page.setViewport({ width: 390, height: 844 });
  await sleep(300);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  check("phone width: no sideways scroll", !overflow);
  if (OUT) { const row = await page.$("#scoreboard-panel .voice-toggle-row"); await row.screenshot({ path: OUT + "/voice_row_phone.png" }); }

  check("no page errors", errors.length === 0, errors);
  await browser.close();
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
