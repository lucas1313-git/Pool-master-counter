// How much the camera page costs with nobody in view (P27): camera.html in same-device mode
// (?embedded=1), Chrome's test camera (a moving pattern, no people), the models loaded and 15 s
// to settle, then a minute measured:
// - CPU seconds per minute, every Chrome process together (ps, the browser's whole process tree:
//   the page, the GPU process that runs the models, the rest);
// - the page's main thread busy (DevTools' TaskDuration) per minute;
// - pose-model passes per minute.
// Prints one JSON line; run it on the code before and after a change to compare.
// usage: node tests/measure_camera_cpu.js [seconds, default 60] [--simple]
const puppeteer = require("puppeteer-core");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const REPO = path.join(__dirname, "..");
const PORT = 4284, BASE = "http://localhost:" + PORT + "/";
const SECONDS = parseInt(process.argv[2], 10) || 60;
const SIMPLE = process.argv.includes("--simple");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".bin": "application/octet-stream" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// CPU seconds used so far by a process and everything under it
function treeCpu(rootPid) {
  const rows = execFileSync("ps", ["-A", "-o", "pid=,ppid=,time="]).toString().trim().split("\n").map((l) => l.trim().split(/\s+/));
  const kids = {}, cpu = {};
  rows.forEach(([pid, ppid, t]) => {
    (kids[ppid] = kids[ppid] || []).push(pid);
    const p = t.split(/[:.]/).map(Number); // [min, sec, hundredths] or [h, min, sec, hundredths]
    cpu[pid] = p.length === 4 ? p[0] * 3600 + p[1] * 60 + p[2] + p[3] / 100 : p[0] * 60 + p[1] + (p[2] || 0) / 100;
  });
  let total = 0;
  (function walk(pid) { total += cpu[pid] || 0; (kids[pid] || []).forEach(walk); })(String(rootPid));
  return total;
}

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
  const browser = await puppeteer.launch({ executablePath: EXE, headless: "new", args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"] });
  try {
    const page = await browser.newPage();
    await page.goto(BASE + "manifest.json");
    await page.evaluate((simple) => {
      localStorage.clear();
      localStorage.setItem("pmc-camera-wizard-done", "1");
      if (simple) localStorage.setItem("pmc-camera-settings", JSON.stringify({ simpleMode: true }));
    }, SIMPLE);
    await page.goto(BASE + "camera.html?embedded=1", { waitUntil: "networkidle2" });
    await page.waitForFunction(() => /ready/.test(document.getElementById("labelModels").textContent) && document.getElementById("video").videoWidth > 0, { timeout: 120000, polling: 250 });
    await page.evaluate(() => { window.__passes = 0; window.PMCCueDebug.posesOverride = (p) => { window.__passes++; return p; }; });
    await sleep(15000);
    const cdp = await page.target().createCDPSession();
    await cdp.send("Performance.enable");
    const task = async () => (await cdp.send("Performance.getMetrics")).metrics.find((m) => m.name === "TaskDuration").value;
    const pid = browser.process().pid;
    const c0 = treeCpu(pid), t0 = await task(), p0 = await page.evaluate(() => window.__passes), at = Date.now();
    await sleep(SECONDS * 1000);
    const c1 = treeCpu(pid), t1 = await task(), p1 = await page.evaluate(() => window.__passes), secs = (Date.now() - at) / 1000;
    const perMin = (x) => Math.round(x * 60 / secs * 10) / 10;
    console.log(JSON.stringify({ seconds: Math.round(secs), cpuSecondsPerMinute: perMin(c1 - c0), mainThreadSecondsPerMinute: perMin(t1 - t0), posePassesPerMinute: Math.round((p1 - p0) * 60 / secs), simple: SIMPLE }));
  } finally {
    await browser.close();
    site.close();
  }
})().catch((e) => { console.log("FAIL crashed: " + (e && e.stack)); process.exit(1); });
