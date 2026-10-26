// The scoreboard's Now Playing line: "Now playing [game] - target [n] [unit]", the controls in the
// line's own big accent type, kept in step with Game Setup both ways, the target there for every
// game; plain text while a Rotation runs. The Rotation / Single game radios beside Focus Mode, and
// the rotation line's size and its two-digit "every" box.
// usage: node tests/probe_now_playing.js http://localhost:4235/ <screenshot dir>
const puppeteer = require("puppeteer-core");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const BASE = process.argv[2], OUT = process.argv[3];
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
  });
  await sleep(600);
  const line = () => page.evaluate(() => {
    const b = document.getElementById("now-playing-banner");
    const parts = [];
    b.childNodes.forEach((n) => {
      if (n.nodeType === 3) parts.push(n.textContent);
      else if (n.tagName === "SELECT") parts.push("[" + n.options[n.selectedIndex].text + " v]");
      else if (n.tagName === "INPUT") parts.push("[" + n.value + "]");
      else if (n.classList && n.classList.contains("now-playing-value")) parts.push("{" + n.textContent + "}");
    });
    return parts.join("").replace(/\s+/g, " ").trim();
  });
  const styleOf = () => page.evaluate(() => {
    const b = document.getElementById("now-playing-banner"), bs = getComputedStyle(b);
    return { banner: [bs.fontSize, bs.fontWeight, bs.color], controls: [...b.querySelectorAll(".now-playing-control")].map((c) => { const s = getComputedStyle(c); return [c.tagName, s.fontSize, s.fontWeight, s.color]; }) };
  });
  const setup = () => page.evaluate(() => ({ type: document.getElementById("game-type").value, target: document.getElementById("game-target").value, unit: document.getElementById("game-target-unit-select").value, saved: JSON.parse(localStorage.getItem("poolMasterCounter.state.v2")).currentGame }));

  let t = await line();
  console.log("line:", t);
  // a game with a target
  await page.select("#now-playing-banner select.now-playing-type-select", "straight");
  await sleep(500);
  t = await line();
  check("Straight Pool: Now playing [game] - target [n] [unit]", /^🎱 Now playing \[Straight Pool v\] - target \[100\] \[points v\]$/.test(t), t);
  let st = await styleOf();
  check("the game and unit use the line's own size, weight and colour - the number its own colour, a bit bigger", st.controls.length === 3 && [st.controls[0], st.controls[2]].every((c) => c[1] === st.banner[0] && c[2] === st.banner[1] && c[3] === st.banner[2]) && st.controls[1][0] === "INPUT" && st.controls[1][3] !== st.banner[2] && parseFloat(st.controls[1][1]) > parseFloat(st.banner[0]), st);
  if (OUT) { const el = await page.$("#now-playing-banner"); await el.screenshot({ path: OUT + "/now_playing_1280.png" }); }
  // the target from the line
  await page.evaluate(() => { const i = document.querySelector("#now-playing-banner .now-playing-target-input"); i.value = "75"; i.dispatchEvent(new Event("change", { bubbles: true })); });
  await sleep(400);
  let s = await setup();
  check("target typed on the line: saved, Game Setup shows it", s.saved.target === 75 && s.target === "75" && /target \[75\]/.test(await line()), { saved: s.saved.target, field: s.target, line: await line() });
  await page.select("#now-playing-banner select.now-playing-unit-select", "balls");
  await sleep(400);
  s = await setup();
  check("unit picked on the line: saved, Game Setup shows it", s.saved.unit === "balls" && s.unit === "balls" && /\[balls v\]$/.test(await line()), { saved: s.saved.unit, field: s.unit, line: await line() });
  // and the other way: Game Setup's own target field
  await page.evaluate(() => { const i = document.getElementById("game-target"); i.value = "120"; i.dispatchEvent(new Event("input", { bubbles: true })); });
  await sleep(400);
  check("Game Setup's target shows on the line", /target \[120\]/.test(await line()), await line());
  // nonsense in the line's field is put back
  await page.evaluate(() => { const i = document.querySelector("#now-playing-banner .now-playing-target-input"); i.value = "0"; i.dispatchEvent(new Event("change", { bubbles: true })); });
  await sleep(300);
  check("0 isn't taken: back to 120", (await setup()).saved.target === 120 && /target \[120\]/.test(await line()), await line());
  // a one-rack game: its target (1 rack) stays on the line
  await page.select("#now-playing-banner select.now-playing-type-select", "8ball");
  await sleep(400);
  t = await line();
  check("8-Ball: the target stays - Now playing [8-Ball] - target [1] [rack]", /^🎱 Now playing \[8-Ball v\] - target \[1\] \[rack v\]$/.test(t), t);
  // phone width
  await page.select("#now-playing-banner select.now-playing-type-select", "straight");
  await sleep(300);
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await sleep(500);
  if (OUT) { const el = await page.$("#now-playing-banner"); await el.screenshot({ path: OUT + "/now_playing_390.png" }); }
  const w = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: innerWidth }));
  check("no sideways scroll at 390", w.doc <= w.win, w);
  await page.setViewport({ width: 1280, height: 900 });
  // Rotation / Single game beside Focus Mode
  const modes = () => page.evaluate(() => ({ rotation: document.getElementById("scoreboard-mode-rotation").checked, single: document.getElementById("scoreboard-mode-single").checked, enabled: JSON.parse(localStorage.getItem("poolMasterCounter.state.v2")).rotation.enabled, besideFocus: document.getElementById("btn-toggle-focus").nextElementSibling.classList.contains("game-mode-toggle") && (function () { var g = document.querySelector(".game-mode-toggle").getBoundingClientRect().left - document.getElementById("btn-toggle-focus").getBoundingClientRect().right; return g >= 0 && g <= 12; })() }));
  let m = await modes();
  check("Single game chosen to start, beside Focus Mode", m.single && !m.rotation && !m.enabled && m.besideFocus, m);
  await page.click("#scoreboard-mode-rotation");
  await sleep(700);
  m = await modes();
  const toast = await page.evaluate(() => document.body.innerText.includes("Add at least two game types to the rotation first."));
  const rotPanelOpen = await page.evaluate(() => !document.getElementById("rotation-panel").classList.contains("collapsed"));
  check("Rotation with no lineup: on, says to add game types, opens Games Rotations", m.rotation && m.enabled && toast && rotPanelOpen, { m, toast, rotPanelOpen });
  check("...nothing rotating yet: the line stays editable", /^🎱 Now playing \[[^\]]+ v\] - target \[\d+\] \[[a-z]+ v\]$/.test(await line()), await line());
  // a lineup: 8-Ball and Straight Pool
  await page.evaluate(() => {
    const add = (type) => { const s = document.getElementById("rotation-add-type"); s.value = type; s.dispatchEvent(new Event("change", { bubbles: true })); document.getElementById("btn-rotation-add").click(); };
    add("8ball"); add("straight");
    const e = document.getElementById("rotation-every"); e.value = "3"; e.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await sleep(700);
  t = await line();
  const controls = await page.evaluate(() => document.querySelectorAll("#now-playing-banner .now-playing-control").length);
  console.log("rotation line:", t);
  check("Rotation running: the game and unit as text (the rotation's), the target and the games until the switch adjustable", controls === 2 && /^🎱 Now playing \{8-Ball\} - target \[1\] \{rack\}/.test(t), { controls, t });
  const rot = await page.evaluate(() => { const el = document.getElementById("rotation-position-text"), i = el.querySelector("input"); return { text: el.textContent + "[" + (i && i.value) + "]", size: getComputedStyle(el).fontSize, inputW: i ? Math.round(i.getBoundingClientRect().width) : null, max: i && i.max }; });
  check("the rotation line is big (1.5rem) and its box two digits wide", rot.size === "24px" && rot.inputW > 20 && rot.inputW < 60 && rot.max === "99", rot);
  if (OUT) { const el = await page.$("#rotation-position-row"); await el.screenshot({ path: OUT + "/rotation_line.png" }); const bar = await page.$(".voice-toggle-row"); await bar.screenshot({ path: OUT + "/mode_toggle.png" }); }
  await page.evaluate(() => { const i = document.querySelector("#rotation-position-text input"); i.value = "250"; i.dispatchEvent(new Event("change", { bubbles: true })); });
  await sleep(400);
  check("a 3-digit 'every' is held to 99", (await page.evaluate(() => JSON.parse(localStorage.getItem("poolMasterCounter.state.v2")).rotation.every)) === 99);
  // back to a single game: editable, target still there
  await page.click("#scoreboard-mode-single");
  await sleep(600);
  m = await modes();
  t = await line();
  check("Single game again: rotation off, the target still on the line, editable", m.single && !m.enabled && /^🎱 Now playing \[[^\]]+ v\] - target \[\d+\] \[[a-z]+ v\]$/.test(t) && (await page.evaluate(() => document.getElementById("rotation-enabled").checked)) === false, { m, t });
  // French
  await page.evaluate(() => { localStorage.setItem("poolMasterCounter.language", "fr"); });
  check("no page errors", errors.length === 0, errors);
  console.log(fails ? "NOW_PLAYING_FAIL (" + fails + ")" : "NOW_PLAYING_OK");
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
