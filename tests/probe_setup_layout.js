// Current Session › Tournament Type, laid out as asked, and the score
// card's "Now playing" line.
// Checks: "🏁 Race to [n] wins" and "🎯 Single Game" side by side, the race
// number right in its option and big; Single Game keeps the number shown;
// typing a number picks Race to Wins; picking Race to Wins uses the number
// shown (no question popping up); "Rotate game types automatically — change
// every [n] games" on one line, the same setting as Games Rotations' Switch
// every; the Timed Tournament right under it, "— ends after [n] minutes" on
// its line; the Q-Score balance and its explanation on one line. The score
// card: "🎱 Now playing 8-Ball - target [x] rack — switches to 9-Ball in [y]
// games." with x and y boxes (their own color, bigger) - x changes the
// target (the rotation keeps it), y the games left before the switch.
// usage: node tests/probe_setup_layout.js http://localhost:4235/ [screenshot dir]
const puppeteer = require("puppeteer-core");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const [BASE, OUT] = process.argv.slice(2);
let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra) : "")); if (!ok) fails++; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// The app opens on the board (Focus Mode); this probe works in the panels, so 🔍 Show All once it's up.
const showAll = async (pg) => {
  await pg.waitForFunction(() => document.getElementById("app") && document.getElementById("app").classList.contains("focus-mode"), { timeout: 10000 });
  await pg.evaluate(() => document.getElementById("btn-toggle-focus").click());
};

(async () => {
  const browser = await puppeteer.launch({ executablePath: EXE, headless: "new", defaultViewport: { width: 1280, height: 1000 } });
  const errors = [];
  const page = await browser.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(BASE + "manifest.json");
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem("poolMasterCounter.onboardingSeen.v1", "1"); localStorage.setItem("poolMasterCounter.migratedFromRepo.v1", "1"); });
  await page.goto(BASE, { waitUntil: "networkidle2" }); await showAll(page);
  await sleep(700);
  await page.evaluate(async () => {
    for (const n of ["Luigi", "Luc"]) {
      const input = document.getElementById("new-player-name"), btn = document.getElementById("btn-add-player");
      input.value = n; input.dispatchEvent(new Event("input", { bubbles: true })); btn.disabled = false; btn.click();
      await new Promise((r) => setTimeout(r, 200));
    }
    const b = document.getElementById("btn-toggle-game-setup-panel");
    if (document.getElementById("game-setup-panel").classList.contains("collapsed")) b.click();
  });
  await sleep(600);
  const state = () => page.evaluate(() => { const s = JSON.parse(localStorage.getItem("poolMasterCounter.state.v2")); return { race: s.raceToWinsTarget, every: s.rotation.every, rotation: s.rotation.enabled, target: s.currentGame.target, played: s.gamesPlayedCount, order: s.rotation.order.map((o) => o.gameType + ":" + o.target), game: s.currentGame.gameType }; });
  const box = (sel) => page.evaluate((sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return { top: Math.round(r.top), mid: Math.round(r.top + r.height / 2), left: Math.round(r.left), right: Math.round(r.right), h: Math.round(r.height), font: parseFloat(getComputedStyle(e).fontSize), color: getComputedStyle(e).color, visible: e.offsetParent !== null }; }, sel);

  // the layout
  const rtw = await box("#race-mode-raceto-option"), single = await box("#race-mode-single"), num = await box("#race-to-wins");
  const inRtw = await page.evaluate(() => ({ inside: document.getElementById("race-mode-raceto-option").contains(document.getElementById("race-to-wins")), text: document.getElementById("race-mode-raceto-option").textContent.replace(/\s+/g, " ").trim() }));
  check("\"🏁 Race to [n] wins\" and \"🎯 Single Game\": side by side", rtw && single && Math.abs(rtw.mid - single.mid) < 10 && single.left > rtw.right - 5, { rtw, single });
  check("...the race number right in Race to Wins, big (≥ 20 px) - \"🏁 Race to [5] wins\"", inRtw.inside && /🏁 Race to\s*wins/.test(inRtw.text) && num.font >= 20 && num.visible, { inRtw, num });
  const rotRow = await page.evaluate(() => { const c = document.getElementById("game-setup-rotation-enabled"), n = document.getElementById("game-setup-rotation-every"); const row = c.closest(".setting-with-number"); const a = c.getBoundingClientRect(), b = n.getBoundingClientRect(); return { same: !!row && row.contains(n), dy: Math.abs((a.top + a.height / 2) - (b.top + b.height / 2)), text: row.textContent.replace(/\s+/g, " ").trim(), font: parseFloat(getComputedStyle(n).fontSize) }; });
  check("\"Rotate game types automatically — change every [n] games\": one line, the number big", rotRow.same && rotRow.dy < 12 && /Rotate game types automatically\s*— change every\s*games/.test(rotRow.text) && rotRow.font >= 20, rotRow);
  await page.evaluate(() => { const c = document.getElementById("timed-tournament-enabled-checkbox"); if (!c.checked) c.click(); });
  await sleep(300);
  const timed = await page.evaluate(() => { const c = document.getElementById("timed-tournament-enabled-checkbox"), n = document.getElementById("timed-tournament-minutes-input"), rot = document.getElementById("game-setup-rotation-enabled").closest(".setting-with-number"), row = c.closest(".setting-with-number"); const a = c.getBoundingClientRect(), b = n.getBoundingClientRect(); return { after: rot.nextElementSibling === row, visible: n.offsetParent !== null, dy: Math.abs((a.top + a.height / 2) - (b.top + b.height / 2)), text: row.textContent.replace(/\s+/g, " ").trim() }; });
  check("\"⏰ Timed Tournament\" right under the rotation - checked: \"— ends after [60] minutes\" on its line", timed.after && timed.visible && timed.dy < 12 && /Timed Tournament\s*— ends after\s*minutes/.test(timed.text), timed);
  await page.evaluate(() => document.getElementById("timed-tournament-enabled-checkbox").click());
  const fair = await page.evaluate(() => { const c = document.getElementById("fair-race-enabled-checkbox"), e = document.querySelector(".fair-race-inline-explain"); const a = c.getBoundingClientRect(), b = e.getBoundingClientRect(); return { sameRow: c.closest(".setting-with-number").contains(e), top: Math.abs(a.top - b.top) }; });
  check("\"⚖️ Use Q-Score to balance the race\" and its explanation: one line (at this width)", fair.sameRow && fair.top < 14, fair);
  if (OUT) { const el = await page.$("#game-setup-panel .session-subsection"); await el.screenshot({ path: OUT + "/tournament_type.png" }); }

  // Race to Wins / Single Game, and the number
  await page.click("#race-mode-single");
  await sleep(300);
  let s = await state();
  const shown = await page.evaluate(() => document.getElementById("race-to-wins").value);
  check("Single Game: race to 1 - the number stays shown (5, ready for Race to Wins)", s.race === 1 && shown === "5" && (await box("#race-to-wins")).visible, { s, shown });
  await page.click("#race-to-wins"); await sleep(100); // (a tap selects the number)
  await page.keyboard.type("7");
  await sleep(300);
  s = await state();
  check("a tap on the number selects it - typing 7: Race to Wins picked, race to 7", s.race === 7 && (await page.evaluate(() => document.getElementById("race-mode-raceto").checked)), s);
  await page.click("#race-mode-single"); await sleep(200);
  await page.click("#race-mode-raceto"); await sleep(400);
  s = await state();
  const after = await page.evaluate(() => ({ modal: !document.getElementById("confirm-modal-overlay").classList.contains("hidden"), focused: document.activeElement && document.activeElement.id }));
  check("Single Game, then Race to Wins: the number shown is the race (7) - no question popping up, the number ready to retype", s.race === 7 && !after.modal && after.focused === "race-to-wins", { s, after });

  // the rotation's "change every" here = Games Rotations' "Switch every"
  await page.click("#game-setup-rotation-every"); await sleep(100);
  await page.keyboard.type("3");
  await sleep(300);
  s = await state();
  check("\"change every [3] games\": the rotation's Switch every (Games Rotations shows 3 too)", s.every === 3 && (await page.evaluate(() => document.getElementById("rotation-every").value)) === "3", s);

  // Games Rotations: the same - "Rotate game types automatically — change every [n] games" in one box
  await page.evaluate(() => { const b = document.getElementById("btn-toggle-rotation-panel"); if (document.getElementById("rotation-panel").classList.contains("collapsed")) b.click(); });
  await sleep(400);
  const gr = await page.evaluate(() => {
    const c = document.getElementById("rotation-enabled"), n = document.getElementById("rotation-every"), row = c.closest(".setting-with-number");
    const a = c.getBoundingClientRect(), b = n.getBoundingClientRect();
    return { same: !!row && row.contains(n), dy: Math.abs((a.top + a.height / 2) - (b.top + b.height / 2)), text: row ? row.textContent.replace(/\s+/g, " ").trim() : "", font: parseFloat(getComputedStyle(n).fontSize), oldRow: [...document.querySelectorAll("#rotation-panel-body label")].some((l) => /Switch every/.test(l.textContent)) };
  });
  check("Games Rotations: \"Rotate game types automatically — change every [3] games\" in one box, the number big - no separate Switch every row", gr.same && gr.dy < 12 && /Rotate game types automatically\s*— change every\s*games/.test(gr.text) && gr.font >= 20 && !gr.oldRow, gr);
  if (OUT) { const el = await page.$("#rotation-panel"); await el.screenshot({ path: OUT + "/games_rotations.png" }); }
  await page.click("#rotation-every"); await sleep(100);
  await page.keyboard.type("4");
  await sleep(300);
  s = await state();
  check("...typing 4 there: Switch every 4 - Current Session's box shows 4 too", s.every === 4 && (await page.evaluate(() => document.getElementById("game-setup-rotation-every").value)) === "4", s);

  // the score card line, with a rotation: 8-Ball and 9-Ball, every 5
  for (const t of ["Rotation 8-ball and 9-ball", "Change game every 5 games"]) { await page.evaluate((t) => window.PMCVoice.handleText(t), t); await sleep(500); }
  await page.evaluate(() => { const o = document.getElementById("confirm-modal-overlay"); if (o && !o.classList.contains("hidden")) document.getElementById("btn-confirm-modal-ok").click(); });
  await sleep(400);
  const line = await page.evaluate(() => {
    const b = document.getElementById("now-playing-banner");
    const text = [...b.childNodes].filter((n) => !(n.classList && n.classList.contains("now-playing-duration-row"))).map((n) => n.nodeType === 3 ? n.textContent : n.tagName === "SELECT" ? n.options[n.selectedIndex].text : n.tagName === "INPUT" ? "[" + n.value + "]" : [...n.childNodes].map((c) => c.nodeType === 3 ? c.textContent : c.tagName === "INPUT" ? "[" + c.value + "]" : c.textContent).join("")).join("");
    const t = b.querySelector(".now-playing-target-input:not(.now-playing-switch-input)"), y = b.querySelector(".now-playing-switch-input");
    const cs = (e) => e && { color: getComputedStyle(e).color, font: parseFloat(getComputedStyle(e).fontSize) };
    return { text: text.replace(/\s+/g, " ").trim(), x: cs(t), y: cs(y), banner: { color: getComputedStyle(b).color, font: parseFloat(getComputedStyle(b).fontSize) } };
  });
  check("the score card: \"🎱 Now playing 8-Ball - target [1] rack — switches to 9-Ball in [5] games.\"", /^🎱 Now playing 8-Ball - target \[1\] rack — switches to 9-Ball in \[5\] games\.$/.test(line.text), line.text);
  check("...x and y in their own color, a bit bigger than the words", line.x && line.y && line.x.color !== line.banner.color && line.y.color !== line.banner.color && line.x.font > line.banner.font && line.y.font > line.banner.font, line);
  if (OUT) { const el = await page.$("#now-playing-banner"); await el.screenshot({ path: OUT + "/now_playing.png" }); }
  const setNum = async (sel, v) => { await page.evaluate((sel, v) => { const i = document.querySelector(sel); i.value = String(v); i.dispatchEvent(new Event("input", { bubbles: true })); i.dispatchEvent(new Event("change", { bubbles: true })); }, sel, v); await sleep(400); };
  await setNum("#now-playing-banner .now-playing-target-input:not(.now-playing-switch-input)", 3);
  s = await state();
  check("x = 3: the target is 3 - and 8-Ball's in the rotation too (it stays)", s.target === 3 && s.order[0] === "8ball:3", s);
  await setNum("#now-playing-banner .now-playing-switch-input", 2);
  s = await state();
  const y2 = await page.evaluate(() => document.querySelector("#now-playing-banner .now-playing-switch-input").value);
  check("y = 2: switches to 9-Ball in 2 games - still 8-Ball now", y2 === "2" && s.played === 3 && s.game === "8ball", { s, y2 });
  await setNum("#now-playing-banner .now-playing-switch-input", 9);
  check("y = 9 (more than every 5): kept to 5", (await page.evaluate(() => document.querySelector("#now-playing-banner .now-playing-switch-input").value)) === "5");

  check("no page errors", errors.length === 0, errors);
  await browser.close();
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
