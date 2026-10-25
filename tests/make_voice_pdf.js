// Makes docs/voice-commands.pdf - the voice commands and how to set up Siri,
// from the app's own sentence list (js/voice.js's SHEET) and texts
// (languages/english.json), so the PDF and what the app understands can't
// drift apart. Printed by the same headless Chrome the tests use.
// usage: node tests/make_voice_pdf.js [address the Siri Shortcut uses, e.g. http://10.0.0.52:4173]
const puppeteer = require("puppeteer-core");
const fs = require("fs");
const path = require("path");
const os = require("os");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const REPO = path.join(__dirname, "..");
const P = require(path.join(REPO, "js", "voice.js"));
const T = JSON.parse(fs.readFileSync(path.join(REPO, "languages", "english.json"), "utf8"));

function lanAddress() {
  const ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)) for (const i of ifs[name] || []) if (i.family === "IPv4" && !i.internal) return i.address;
  return "<your computer's address>";
}
const BASE = (process.argv[2] || "http://" + lanAddress() + ":4173").replace(/\/$/, "");
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const today = new Date().toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" });

const sections = P.SHEET.map((sec) => `
  <section class="cmds">
    <h3>${esc(T[sec.title])}</h3>
    <p class="note">${esc(T[sec.note])}</p>
    <ul>${sec.lines.map((l) => `<li>“${esc(l)}”</li>`).join("")}</ul>
  </section>`).join("");

const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Voice commands and Siri</title>
<style>
  @page { size: Letter; margin: 16mm 15mm 16mm 15mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif; color: #1d1414; font-size: 10.5pt; line-height: 1.42; margin: 0; }
  header { border-bottom: 3px solid #b8890f; padding-bottom: 8px; margin-bottom: 14px; }
  h1 { font-size: 22pt; margin: 0; color: #5a1414; }
  .sub { color: #6b5555; margin-top: 2px; }
  h2 { font-size: 14pt; color: #5a1414; margin: 18px 0 6px; border-bottom: 1px solid #e3d3c3; padding-bottom: 3px; }
  h3 { font-size: 11.5pt; margin: 0 0 2px; color: #7a4a00; }
  .cmds { break-inside: avoid; margin: 0 0 11px; }
  .note { margin: 0 0 4px; color: #4a3a3a; font-size: 9.5pt; }
  ul { margin: 0; padding-left: 18px; }
  li { margin: 1px 0; font-weight: 600; }
  ol.steps li { font-weight: 400; margin: 4px 0; }
  .how { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 18px; }
  .box { border: 1px solid #e3d3c3; border-radius: 8px; padding: 8px 11px; background: #fbf7f1; break-inside: avoid; }
  .box b { color: #5a1414; }
  code, .url { font-family: "SF Mono", Menlo, monospace; font-size: 9.5pt; background: #f3ebe0; padding: 1px 4px; border-radius: 4px; }
  .page-break { break-before: page; }
  .say { font-size: 12pt; font-weight: 700; color: #5a1414; }
  .foot { margin-top: 18px; color: #8a7a7a; font-size: 8.5pt; border-top: 1px solid #e3d3c3; padding-top: 6px; }
  table.trouble td { vertical-align: top; padding: 3px 8px 3px 0; }
  table.trouble td:first-child { font-weight: 700; white-space: nowrap; color: #5a1414; }
</style></head><body>
<header>
  <h1>🎱 Pool Master Counter — Voice commands &amp; Siri</h1>
  <div class="sub">Say it instead of tapping it · English · ${esc(today)}</div>
</header>

<h2>How to talk to the scoreboard</h2>
<div class="how">
  <div class="box"><b>Hold to talk.</b> Hold the <b>🎤 Talk</b> button (score section, top row) — or hold the <b>.</b> key on the number pad — say <b>one sentence</b>, then let go. A quick tap on 🎤 Talk shows all the sentences.</div>
  <div class="box"><b>What you see and hear.</b> A big line at the bottom shows what was heard; a message at the top says what was done. Points beep like the number pad; questions (Q-score, the score) are answered out loud.</div>
  <div class="box"><b>Names.</b> Anyone on the scoreboard or in the Contact Sheet — <b>nicknames work too</b>. A name that sounds alike is found (“Luke” for Luc); when two names are too close, it asks instead of guessing.</div>
  <div class="box"><b>First time.</b> The browser asks to use the microphone — allow it. Chrome needs the internet (it sends the sound to Google to turn it into words). English only for now.</div>
</div>

<h2>The sentences</h2>
<p class="note">Luigi, Luc, Bob and Chris stand for your players' names; numbers and games are examples. Say one sentence at a time.</p>
${sections}

<h2 class="page-break">Siri — “Hey Siri, Scoreboard”</h2>
<p>With a Siri Shortcut you can say any of these sentences without touching anything — from your iPhone, iPad or the Mac. Siri listens, sends the sentence to the scoreboard on your Mac, and says what was done (“Luc plus 1, now 13”).</p>
<h3>Make the Shortcut once</h3>
<ol class="steps">
  <li>Open the <b>Shortcuts</b> app, tap <b>+</b>, and name the shortcut <b>Scoreboard</b> (the name is what you'll say to Siri).</li>
  <li>Add the action <b>Dictate Text</b>. Set its Language to <b>English</b> (Stop Listening: After Pause).</li>
  <li>Add <b>Get Contents of URL</b>. URL: <span class="url">${esc(BASE)}/voice</span>. Tap <b>Show More</b>: Method <b>POST</b>, Request Body <b>JSON</b>, then <b>Add new field → Text</b>: key <code>text</code>, value: the <b>Dictated Text</b> variable.</li>
  <li>Add <b>Speak Text</b> — it speaks the <b>Contents of URL</b> (the scoreboard's answer).</li>
</ol>
<h3>Use it</h3>
<p>Say <span class="say">“Hey Siri, Scoreboard”</span>, wait for Siri to listen, then say your sentence — for example <span class="say">“add one point to Luc”</span>, <span class="say">“mark”</span> or <span class="say">“set session, race to 5, players are Luigi, Luc, Bob and Chris, Luigi and Luc are playing”</span>.</p>
<h3>If it doesn't work</h3>
<table class="trouble">
  <tr><td>“The scoreboard isn't open”</td><td>Open the scoreboard on the Mac (reload it once after an update). It must stay open — in the background is fine.</td></tr>
  <tr><td>Nothing happens on the iPhone</td><td>The phone must be on the same Wi-Fi as the Mac. The first time, iOS asks to let Shortcuts use the local network — allow it.</td></tr>
  <tr><td>The address changed</td><td>The Mac's address can change (a new router, a different Wi-Fi). The scoreboard's sentence list (a tap on 🎤 Talk) ends with a Siri section showing the current one — update step 3.</td></tr>
  <tr><td>Two scoreboards open</td><td>The one used last (on screen) does the sentence — never both, so a point is never counted twice.</td></tr>
  <tr><td>A wrong name</td><td>Say the full name, or the nickname from the Contact Sheet; the big line at the bottom of the scoreboard shows what was heard.</td></tr>
</table>

<h2>Recording: marking the best moments</h2>
<p>With the recording page open (<b>🎬 Record</b> in the scoreboard's header), say <span class="say">“mark”</span> right after a good shot: the cue starts <b>20 seconds earlier</b> — the beginning of the shot — and is named for the player and where the race stood then (e.g. <code>Luigi-8-Ball-game 5 of raceto 7-1m35s-…-cued</code>). Say <span class="say">“finish”</span> to end it. On the recording page's 🎞️ Cues panel (or the Cues page) every cue can be watched, its start and end set by hand, and exported as a clip — even while it records.</p>

<div class="foot">Made from the app's own sentence list (js/voice.js) — what's here is exactly what the scoreboard understands. Siri address: ${esc(BASE)}/voice.</div>
</body></html>`;

(async () => {
  const out = path.join(REPO, "docs", "voice-commands.pdf");
  fs.writeFileSync(path.join(REPO, "docs", "voice-commands.html"), html);
  const browser = await puppeteer.launch({ executablePath: EXE, headless: "new" });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "load" });
  await page.pdf({ path: out, format: "Letter", printBackground: true, displayHeaderFooter: true, headerTemplate: "<span></span>",
    footerTemplate: '<div style="font-size:8px;color:#8a7a7a;width:100%;text-align:center">Pool Master Counter — Voice commands &amp; Siri · page <span class="pageNumber"></span> of <span class="totalPages"></span></div>',
    margin: { top: "16mm", bottom: "18mm", left: "15mm", right: "15mm" } });
  await browser.close();
  console.log("written: " + out + " (" + Math.round(fs.statSync(out).size / 1024) + " KB), Siri address " + BASE + "/voice");
})().catch((e) => { console.error(e); process.exit(1); });
