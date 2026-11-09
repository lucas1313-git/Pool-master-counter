// 🤖 AI take (Publish Daily Report): with no key the button asks for one; a key that isn't sk-ant- is
// refused; with a key, Claude's take on the night streams in and is kept for that day (reopening it is
// free); Copy/Share hand it on with a heading; a bad key, an API error and a refusal each say so; the
// key never goes in a backup (the takes do). api.anthropic.com is answered here, never really called.
// usage: node tests/probe_ai_take.js http://localhost:4337/
const puppeteer = require("puppeteer-core");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const BASE = process.argv[2];
let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined ? "  " + JSON.stringify(extra).slice(0, 400) : "")); if (!ok) fails++; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const KEY = "sk-ant-test-1234567890abcd";
const TAKE = "Alex carried the night 🎱 and Sam kept it close.\n\nTwo racks to one, and the ratings moved with it.";
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "POST, OPTIONS" };
function sse(text, stopReason) {
  const events = [
    ["message_start", { type: "message_start", message: { id: "msg_test", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 900, output_tokens: 1 } } }],
    ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }]
  ];
  // (in a few pieces, as it streams)
  for (let i = 0; i < text.length; i += 20) events.push(["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: text.slice(i, i + 20) } }]);
  events.push(["content_block_stop", { type: "content_block_stop", index: 0 }]);
  events.push(["message_delta", { type: "message_delta", delta: { stop_reason: stopReason || "end_turn", stop_sequence: null }, usage: { output_tokens: 120 } }]);
  events.push(["message_stop", { type: "message_stop" }]);
  return events.map(([name, data]) => "event: " + name + "\ndata: " + JSON.stringify(data) + "\n\n").join("");
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: EXE, headless: "new", defaultViewport: { width: 1280, height: 900 } });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.dismiss().catch(() => {}));
  await page.evaluateOnNewDocument(() => {
    window.__copied = [];
    try { Object.defineProperty(navigator, "clipboard", { value: { writeText: (t) => { window.__copied.push(t); return Promise.resolve(); } } }); } catch (e) {}
    const orig = URL.createObjectURL;
    URL.createObjectURL = function (blob) { if (blob && blob.type === "application/json") blob.text().then((t) => { window.__lastExport = t; }); return orig.call(URL, blob); };
    HTMLAnchorElement.prototype.click = function () {}; // (no real downloads)
  });
  // Anthropic's API, answered here: what to answer next, and every request it got
  let mode = "ok";
  const calls = [];
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const url = req.url();
    if (!url.startsWith("https://api.anthropic.com/")) return req.continue();
    if (req.method() === "OPTIONS") return req.respond({ status: 204, headers: CORS, body: "" });
    calls.push({ url, headers: req.headers(), body: JSON.parse(req.postData() || "{}") });
    if (mode === "badKey") return req.respond({ status: 401, headers: Object.assign({ "content-type": "application/json" }, CORS), body: JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }) });
    if (mode === "noCredit") return req.respond({ status: 400, headers: Object.assign({ "content-type": "application/json" }, CORS), body: JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API." } }) });
    if (mode === "refusal") return req.respond({ status: 200, headers: Object.assign({ "content-type": "text/event-stream" }, CORS), body: sse("", "refusal") });
    return req.respond({ status: 200, headers: Object.assign({ "content-type": "text/event-stream" }, CORS), body: sse(TAKE) });
  });

  await page.goto(BASE + "manifest.json");
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem("poolMasterCounter.onboardingSeen.v1", "1"); localStorage.setItem("poolMasterCounter.migratedFromRepo.v1", "1"); });
  await page.goto(BASE, { waitUntil: "networkidle2" });
  await sleep(800);
  // a short night: Alex 2, Sam 1
  await page.evaluate(async () => {
    for (const n of ["Alex", "Sam"]) {
      const input = document.getElementById("new-player-name"), btn = document.getElementById("btn-add-player");
      input.value = n; input.dispatchEvent(new Event("input", { bubbles: true })); btn.disabled = false; btn.click();
      await new Promise((r) => setTimeout(r, 250));
    }
    document.querySelectorAll("#roster-list li.roster-row .btn-playing:not(.is-on)").forEach((b) => b.click());
  });
  await sleep(500);
  const win = async (name) => {
    await page.evaluate((n) => { const el = [...document.querySelectorAll(".player-panel")].find((c) => c.querySelector(".player-name").textContent.trim().startsWith(n)); [...el.querySelectorAll("button")].find((b) => b.textContent.trim() === "+").click(); }, name);
    await sleep(900);
    await page.evaluate(() => { for (let i = 0; i < 4; i++) { const b = [...document.querySelectorAll("button")].find((x) => x.offsetParent && /^(Next game|Continue|OK|Close|Got it|Start next game|Done)/i.test(x.textContent.trim()) && x.closest("[class*='overlay'],[class*='modal'],[role='dialog']")); if (b) b.click(); } });
    await sleep(500);
  };
  await win("Alex"); await win("Sam"); await win("Alex");

  // ☰ Menu › 📝 Day report › Today's report
  const openPanel = async () => {
    await page.click("#btn-board-menu");
    await sleep(250);
    await page.evaluate(() => [...document.querySelectorAll("#board-menu-list .board-menu-row")].find((x) => x.dataset.menuKey === "menu.dayReport").click());
    await sleep(250);
    await page.evaluate(() => [...document.querySelectorAll("#board-menu-list .board-menu-row")].find((x) => x.dataset.menuKey === "menu.todaysReport").click());
    await sleep(600);
  };
  const box = () => page.evaluate(() => ({
    button: document.getElementById("btn-ai-take").textContent,
    buttonDisabled: document.getElementById("btn-ai-take").disabled,
    keyBoxShown: !document.getElementById("ai-take-key").classList.contains("hidden"),
    keyError: document.getElementById("ai-take-key-error").classList.contains("hidden") ? "" : document.getElementById("ai-take-key-error").textContent,
    resultShown: !document.getElementById("ai-take-result").classList.contains("hidden"),
    status: document.getElementById("ai-take-status").textContent,
    statusError: document.getElementById("ai-take-status").classList.contains("is-error"),
    text: document.getElementById("ai-take-text").textContent,
    actionsShown: !document.getElementById("ai-take-actions").classList.contains("hidden")
  }));
  const waitFor = async (fn, ms = 8000) => { for (let t = 0; t < ms; t += 200) { const b = await box(); if (fn(b)) return b; await sleep(200); } return box(); };
  await openPanel();
  await sleep(400);
  let b = await box();
  check("Publish Daily Report has the 🤖 AI take, nothing written yet", b.button === "🤖 Write an AI take" && !b.resultShown && !b.keyBoxShown, b);

  // no key yet: it asks for one, and nothing is sent
  await page.click("#btn-ai-take");
  await sleep(300);
  b = await box();
  check("with no key, the button opens the key box (nothing sent)", b.keyBoxShown && calls.length === 0, { b, calls: calls.length });
  await page.type("#ai-take-key-input", "hello there");
  await page.click("#btn-ai-take-key-save");
  await sleep(200);
  b = await box();
  check("a key that isn't sk-ant-… is refused", b.keyBoxShown && /sk-ant-/.test(b.keyError) && !(await page.evaluate(() => localStorage.getItem("poolMasterCounter.anthropicApiKey.v1"))), b);
  await page.evaluate(() => { document.getElementById("ai-take-key-input").value = ""; });
  await page.type("#ai-take-key-input", KEY);
  await page.click("#btn-ai-take-key-save");
  await sleep(300);
  b = await box();
  check("a real-looking key is saved on the device, the box closes", !b.keyBoxShown && (await page.evaluate(() => localStorage.getItem("poolMasterCounter.anthropicApiKey.v1"))) === KEY, b);

  // write one
  await page.click("#btn-ai-take");
  b = await waitFor((x) => x.actionsShown);
  check("the take is written and shown, with Copy and Share", b.text === TAKE && b.actionsShown && /Written/.test(b.status) && /Sportswriter/.test(b.status) && !b.statusError, b);
  check("...and the button now offers a new one", b.button === "🤖 Write a new AI take" && !b.buttonDisabled, b.button);
  const call = calls[0] || { headers: {}, body: {} };
  const user = ((call.body.messages || [])[0] || {}).content || "";
  // (the SDK, 1.x, sends an API key as a bearer token)
  const sentKey = call.headers["x-api-key"] || (call.headers.authorization || "").replace(/^Bearer /, "");
  check("one request, to Claude Opus 5.5 with the saved key, straight from the browser", calls.length === 1 && call.body.model === "claude-opus-5-5" && sentKey === KEY && call.headers["anthropic-dangerous-direct-browser-access"] === "true" && call.body.stream === true, { n: calls.length, model: call.body.model, stream: call.body.stream, sentKey });
  check("...a declined request falls back on its own (fallbacks: default), medium effort", call.body.fallbacks === "default" && /server-side-fallback-2026-07-01/.test(call.headers["anthropic-beta"] || "") && call.body.output_config && call.body.output_config.effort === "medium", { fallbacks: call.body.fallbacks, beta: call.headers["anthropic-beta"], oc: call.body.output_config });
  check("...the night as Claude reads it: both players, every game, the tone, the language", /Alex: 2 won, 1 lost, rating/.test(user) && /Sam: 1 won, 2 lost, rating/.test(user) && (user.match(/ beat /g) || []).length === 3 && /local sports columnist/.test(user) && /Write the take in English\./.test(user), user);
  check("...and the scoring rules: team games are the team's, Rotating Teams the exception", /whole team wins or loses together/.test(call.body.system || "") && /Rotating Teams/.test(call.body.system || ""), (call.body.system || "").slice(0, 80));
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("poolMasterCounter.aiTakes.v1") || "{}"));
  const savedDays = Object.keys(saved);
  check("the take is kept for that day", savedDays.length === 1 && saved[savedDays[0]].text === TAKE && saved[savedDays[0]].tone === "sportswriter", saved);

  // copy / share
  await page.click("#btn-ai-take-copy");
  await sleep(200);
  const copied = await page.evaluate(() => window.__copied.slice(-1)[0] || "");
  check("📋 Copy gives the take with a dated heading", /^🤖 AI take, \w+day, /.test(copied) && copied.endsWith(TAKE), copied);
  const shared = await page.evaluate(async () => { let got = null; navigator.share = (d) => { got = d; return Promise.resolve(); }; document.getElementById("btn-ai-take-share").click(); await new Promise((r) => setTimeout(r, 100)); return got; });
  check("📤 Share hands the same text to the share sheet", shared && shared.text === copied, shared);

  // reopening: shown from what was kept, nothing sent
  await page.reload({ waitUntil: "networkidle2" });
  await sleep(900);
  await openPanel();
  await sleep(400);
  b = await box();
  check("after a reload the day's take is still there, for free", b.text === TAKE && b.actionsShown && calls.length === 1, { b, calls: calls.length });

  // trash talk
  await page.select("#ai-take-tone-select", "banter");
  await page.click("#btn-ai-take");
  b = await waitFor((x) => x.actionsShown && calls.length === 2);
  const user2 = ((calls[1] || { body: {} }).body.messages || [{}])[0].content || "";
  check("😏 Trash talk asks for a roast (about the pool only), and the tone is remembered", /roasts everyone/.test(user2) && /pool only/.test(user2) && /Trash talk/.test(b.status) && (await page.evaluate(() => localStorage.getItem("poolMasterCounter.aiTakeTone.v1"))) === "banter", { status: b.status });

  // errors
  mode = "noCredit";
  await page.click("#btn-ai-take");
  b = await waitFor((x) => x.statusError);
  check("an API error says what Claude said (no credit), the kept take stays", b.statusError && /^Claude said: Your credit balance is too low/.test(b.status) && b.text === TAKE && !b.buttonDisabled, b);
  mode = "refusal";
  await page.click("#btn-ai-take");
  b = await waitFor((x) => x.statusError && /declined/.test(x.status));
  check("a refusal says Claude declined, the kept take stays", /declined/.test(b.status) && b.text === TAKE, b);
  mode = "badKey";
  await page.click("#btn-ai-take");
  b = await waitFor((x) => x.statusError && /key/.test(x.status));
  check("a key Anthropic turns down: says so and opens the key box", /That key didn't work/.test(b.status) && b.keyBoxShown, b);
  const keyHint = await page.evaluate(() => document.getElementById("ai-take-key-saved").textContent);
  check("...which shows the saved key only in part", keyHint.includes("sk-ant-tes") && keyHint.includes("abcd") && !keyHint.includes(KEY), keyHint);

  // a backup: the takes go, the key never does
  await page.evaluate(() => { window.__lastExport = null; const p = document.getElementById("backup-panel"); if (p.classList.contains("collapsed")) document.getElementById("btn-toggle-backup-panel").click(); });
  await sleep(300);
  await page.click("#btn-backup-now");
  await sleep(300);
  await page.click("#btn-confirm-modal-ok");
  await sleep(300);
  await page.evaluate(() => { const x = document.getElementById("btn-bk-to-drive-folder") || document.getElementById("btn-bk-to-downloads"); if (x) x.click(); });
  let raw = null;
  for (let i = 0; i < 30 && !raw; i++) { await sleep(200); raw = await page.evaluate(() => window.__lastExport); }
  const settings = raw ? (JSON.parse(raw).settings || {}) : {};
  check("a backup has the takes and the tone, never the key", !!raw && !raw.includes(KEY) && !raw.includes("anthropicApiKey") && !!settings["poolMasterCounter.aiTakes.v1"] && settings["poolMasterCounter.aiTakeTone.v1"] === "banter", { got: !!raw, keys: Object.keys(settings).filter((k) => /ai|nthropic/i.test(k)) });

  // remove the key
  await page.evaluate(() => { const k = document.getElementById("ai-take-key"); if (k.classList.contains("hidden")) document.getElementById("btn-ai-take-key").click(); });
  await sleep(200);
  await page.click("#btn-ai-take-key-remove");
  await sleep(200);
  check("Remove key takes it off the device", (await page.evaluate(() => localStorage.getItem("poolMasterCounter.anthropicApiKey.v1"))) === null && !(await box()).keyBoxShown);
  check("no page errors", errors.length === 0, errors);
  console.log(fails ? "AI_TAKE_FAIL (" + fails + ")" : "AI_TAKE_OK");
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
