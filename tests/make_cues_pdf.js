// Makes docs/cue-commands.pdf - marking the best moments of a recording:
// the voice sentences (each checked against js/voice.js's own parser, so the
// PDF can't promise a sentence the scoreboard doesn't understand), the "/"
// key and the ⭐ Cue button, Siri, what a cue is and how it's named, the
// sound, the cue viewer and deleting. Printed by the same headless Chrome
// the tests use.
// usage: node tests/make_cues_pdf.js [the Mac's address on the Wi-Fi, e.g. http://10.0.0.52:4173]
const puppeteer = require("puppeteer-core");
const fs = require("fs");
const path = require("path");
const os = require("os");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const REPO = path.join(__dirname, "..");
const P = require(path.join(REPO, "js", "voice.js"));

function lanAddress() {
  const ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)) for (const i of ifs[name] || []) if (i.family === "IPv4" && !i.internal) return i.address;
  return "<your computer's address>";
}
const BASE = (process.argv[2] || "http://" + lanAddress() + ":4173").replace(/\/$/, "");
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const today = new Date().toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" });

// what to say - every one checked by the scoreboard's own parser
const START = ["mark", "mark it", "mark that", "mark the shot", "cue it", "cue that", "start a clip", "bookmark"];
const END = ["finish", "finish it", "finish the cue", "end the cue", "stop the clip", "cut", "cut it"];
const bad = [];
START.forEach((t) => { if ((P.parse(t) || {}).type !== "recMark") bad.push(t); });
END.forEach((t) => { if ((P.parse(t) || {}).type !== "recFinish") bad.push(t); });
if (bad.length) { console.error("not understood by js/voice.js: " + bad.join(", ")); process.exit(1); }
const say = (list) => list.map((t) => `<li>“${esc(t[0].toUpperCase() + t.slice(1))}”</li>`).join("");

const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Cues: voice, key and button</title>
<style>
  @page { size: Letter; margin: 16mm 15mm 16mm 15mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif; color: #1d1414; font-size: 10.5pt; line-height: 1.42; margin: 0; }
  header { border-bottom: 3px solid #b8890f; padding-bottom: 8px; margin-bottom: 12px; }
  h1 { font-size: 22pt; margin: 0; color: #5a1414; }
  .sub { color: #6b5555; margin-top: 2px; }
  h2 { font-size: 14pt; color: #5a1414; margin: 16px 0 6px; border-bottom: 1px solid #e3d3c3; padding-bottom: 3px; break-after: avoid; }
  h3 { font-size: 11.5pt; margin: 0 0 3px; color: #7a4a00; }
  p { margin: 4px 0; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 16px; }
  .grid3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px 12px; }
  .box { border: 1px solid #e3d3c3; border-radius: 8px; padding: 8px 11px; background: #fbf7f1; break-inside: avoid; }
  .box b { color: #5a1414; }
  .big { font-size: 15pt; font-weight: 800; color: #5a1414; margin: 2px 0 4px; }
  ul.say { margin: 2px 0 0; padding-left: 18px; columns: 2; column-gap: 14px; }
  ul.say li { font-weight: 700; margin: 1px 0; break-inside: avoid; }
  ul.plain { margin: 2px 0; padding-left: 18px; }
  ul.plain li { margin: 2px 0; }
  ol.steps { margin: 2px 0; padding-left: 20px; }
  ol.steps li { margin: 3px 0; }
  code, .url { font-family: "SF Mono", Menlo, monospace; font-size: 9.3pt; background: #f3ebe0; padding: 1px 4px; border-radius: 4px; overflow-wrap: anywhere; }
  .key { display: inline-block; min-width: 1.6em; text-align: center; font-weight: 800; border: 1.5px solid #5a1414; border-bottom-width: 3px; border-radius: 5px; padding: 0 5px; background: #fff; }
  .btn { display: inline-block; font-weight: 800; border-radius: 6px; padding: 0 6px; background: #e8b923; color: #1a0a0a; }
  .btn.red { background: #d93a3a; color: #fff; }
  .timeline { position: relative; height: 46px; margin: 8px 4px 2px; }
  .timeline .bar { position: absolute; left: 0; right: 0; top: 18px; height: 6px; background: #e3d3c3; border-radius: 3px; }
  .timeline .cue { position: absolute; left: 22%; width: 52%; top: 12px; height: 18px; background: rgba(232,185,35,0.45); border: 2px solid #b8890f; border-radius: 5px; }
  .timeline .t { position: absolute; top: 32px; font-size: 8.5pt; color: #5a1414; transform: translateX(-50%); white-space: nowrap; font-weight: 700; }
  .timeline .m { position: absolute; top: 4px; width: 2px; height: 30px; background: #5a1414; }
  table.trouble { border-collapse: collapse; width: 100%; }
  table.trouble td { vertical-align: top; padding: 4px 8px 4px 0; border-bottom: 1px solid #efe3d6; }
  table.trouble td:first-child { font-weight: 700; color: #5a1414; width: 36%; }
  .note { color: #4a3a3a; font-size: 9.5pt; }
  .page-break { break-before: page; }
  .foot { margin-top: 14px; color: #8a7a7a; font-size: 8.5pt; border-top: 1px solid #e3d3c3; padding-top: 6px; }
</style></head><body>
<header>
  <h1>🎬 Cues — marking the best moments</h1>
  <div class="sub">Pool Master Counter · by voice, key or button · ${esc(today)}</div>
</header>

<h2>Before you start</h2>
<ol class="steps">
  <li>Open the scoreboard at <span class="url">http://localhost:4173</span> on the Mac (or <span class="url">${esc(BASE)}</span> from another device on the Wi-Fi). <b>Not</b> the GitHub web page: recording needs the Mac's server.</li>
  <li>Click <b>🎬 Record</b> in the scoreboard's header. The recording page opens in the <b>same browser</b> — both must come from the same address, or they can't talk to each other.</li>
  <li>Press <b>● Record</b> on the recording page. That click also lets the page silence its sound at each cue (see “The sound” below).</li>
  <li>Back on the scoreboard, the <span class="btn">⭐ Cue</span> button appears in the score section: you're ready.</li>
</ol>

<h2>Three ways to make a cue</h2>
<div class="grid3">
  <div class="box"><h3>🎤 By voice</h3>Hold <b>🎤 Talk</b> (or the <span class="key">.</span> key on the number pad), say <b>“Mark”</b>, let go. Later: hold, say <b>“Finish”</b>.</div>
  <div class="box"><h3>⌨️ The <span class="key">/</span> key</h3>Press <span class="key">/</span> (number pad or keyboard) to start a cue; press it again to end it. While nothing records, <span class="key">/</span> pauses the shot counter as before.</div>
  <div class="box"><h3>👆 The button</h3>Tap <span class="btn">⭐ Cue</span>. It turns into <span class="btn red">✔ End cue 0:12</span>, counting; tap it to end the cue.</div>
</div>
<p class="note">On the recording page itself: <b>⭐ Mark</b> / <b>✔ Finish</b>, or the keys <span class="key">M</span> / <span class="key">F</span> / <span class="key">/</span>.</p>

<h2>What to say</h2>
<div class="grid2">
  <div class="box"><h3>To start a cue</h3><ul class="say">${say(START)}</ul></div>
  <div class="box"><h3>To end it</h3><ul class="say">${say(END)}</ul></div>
</div>
<p class="note">One sentence at a time. The big line at the bottom of the scoreboard shows what was heard; a message at the top says <b>Marked</b> or <b>Finished</b>. Nothing is said out loud — it would end up in the video.</p>
<div class="box" style="margin-top:6px"><h3>With Siri</h3>Say <b>“Hey Siri, Scoreboard”</b>, wait for Siri, then <b>“Mark”</b> (later: “Hey Siri, Scoreboard” … <b>“Finish”</b>). The Shortcut is set up once — see the <i>Voice commands &amp; Siri</i> PDF. Siri answers out loud on the phone; the recording goes quiet for 3 seconds so that answer isn't in the video.</div>

<h2 class="page-break">What a cue is</h2>
<p><b>Mark right after the good shot.</b> You only know a shot was good once it's over, so the cue <b>starts 20 seconds before</b> you marked it — the beginning of the shot — and runs until you finish it.</p>
<div class="timeline">
  <div class="bar"></div><div class="cue"></div>
  <div class="m" style="left:22%"></div><div class="t" style="left:22%">cue starts 1:00</div>
  <div class="m" style="left:42%"></div><div class="t" style="left:42%">“Mark” at 1:20</div>
  <div class="m" style="left:74%"></div><div class="t" style="left:74%">“Finish” at 2:35</div>
</div>
<ul class="plain">
  <li><b>Its name</b> is made from the scoreboard, as things stood <b>when the cue starts</b>:<br><code>Luigi-vs-Bob-8-Ball-game 5 of raceto 7-1m35s-2026-10-25-21h04m10s-cued</code><br>the player selected, who they play against, the game, where the race stands, the length, the date and time of its start.</li>
  <li><b>Switched to the next player just before marking?</b> The shot still goes to the one selected 20 s earlier.</li>
  <li><b>Who's “against”:</b> the other player; in teams, the other team (<code>Luigi-vs-Bob+Chris</code>); in a points game with more players, all the others. Nobody selected: the two sides (<code>Luc-vs-Bob</code>).</li>
  <li><b>A new mark</b> while one is still open ends the open one first. A cue nobody finishes ends by itself after 15 minutes.</li>
  <li>The 20 seconds can be changed on the recording page (<i>A clip starts … seconds before the mark</i>).</li>
</ul>

<h2>The sound</h2>
<ul class="plain">
  <li>The only sound a cue makes is a <b>very faint tick</b>.</li>
  <li>The recording's own sound goes <b>silent for a moment</b> at each cue — 1 second for the key and button, 3 seconds by voice or Siri — so not even the tick is in the video.</li>
  <li>Your own voice saying “Mark” <b>is</b> recorded (it comes before the cue is made). Prefer the <span class="key">/</span> key or the button when the room's sound matters.</li>
</ul>

<h2>Afterwards: watch, fix, export, delete</h2>
<div class="grid2">
  <div class="box"><h3>🎞️ The cue list</h3>On the recording page (even while it records) or the Cues page. Click a cue to play it straight from the recording. Drag its yellow start and end, nudge them ±1 s, or set them at the playhead (<span class="key">I</span> / <span class="key">O</span>); <b>💾 Save</b>. <b>✎ Name</b> renames it.</div>
  <div class="box"><h3>⬇ Export</h3>Cuts the cue out as a video and downloads it; a copy stays in <code>Movies/Pool Master Counter/Clips</code>. Works while it's still recording.</div>
  <div class="box"><h3>🗑 Delete a cue</h3>The 🗑 at the end of its row: the first click asks <b>Delete?</b>, the second deletes it. The recording itself stays.</div>
  <div class="box"><h3>🗑 Delete a recording</h3><b>🗑 Delete</b> beside a recording (first click asks): it goes to the Mac's <b>Trash</b> (can be put back), its cues with it. Exported clips are kept. Not while it's recording — stop it first.</div>
</div>

<h2>If it doesn't work</h2>
<table class="trouble">
  <tr><td>“The recording page isn't open”</td><td>Open 🎬 Record from the scoreboard — same browser, same address (localhost:4173, not the GitHub page).</td></tr>
  <tr><td>“The recording page isn't recording”</td><td>Press ● Record on the recording page.</td></tr>
  <tr><td>No ⭐ Cue button</td><td>It only shows while recording, and only if both pages come from the same address. Reload the scoreboard after an update.</td></tr>
  <tr><td>“Nothing is marked to finish”</td><td>There's no open cue — it was already finished (or a new mark ended it).</td></tr>
  <tr><td><span class="key">/</span> pauses the shot counter instead</td><td>The scoreboard doesn't see a recording running — check the two points above.</td></tr>
  <tr><td>“Mark” not understood</td><td>Say it a little longer: “mark the shot”. Voice needs the internet in Chrome.</td></tr>
</table>

<div class="foot">The sentences here are checked against the scoreboard's own sentence list (js/voice.js) when this PDF is made. Siri address: ${esc(BASE)}/voice.</div>
</body></html>`;

(async () => {
  const out = path.join(REPO, "docs", "cue-commands.pdf");
  fs.writeFileSync(path.join(REPO, "docs", "cue-commands.html"), html);
  const browser = await puppeteer.launch({ executablePath: EXE, headless: "new" });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "load" });
  await page.pdf({ path: out, format: "Letter", printBackground: true, displayHeaderFooter: true, headerTemplate: "<span></span>",
    footerTemplate: '<div style="font-size:8px;color:#8a7a7a;width:100%;text-align:center">Pool Master Counter — Cues · page <span class="pageNumber"></span> of <span class="totalPages"></span></div>',
    margin: { top: "16mm", bottom: "18mm", left: "15mm", right: "15mm" } });
  await browser.close();
  console.log("written: " + out + " (" + Math.round(fs.statSync(out).size / 1024) + " KB)");
})().catch((e) => { console.error(e); process.exit(1); });
