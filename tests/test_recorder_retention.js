// Keeping the Mac recorder's recordings (P26), server/recorder.js's own retention, in a
// throwaway home folder:
// - "for good" (0, the default): nothing goes;
// - 30 days: a recording that ended 40 days ago goes to the Trash; one from 10 days ago stays;
//   one from 40 days ago with a cue not cut yet has its cue cut out as a clip first (kept in
//   Clips/), then goes; its cue goes with it, the clip stays;
// - the setting only takes 0, 7, 14, 30 or 90.
// usage: node tests/test_recorder_retention.js
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "pmc-retention-"));
process.env.HOME = HOME;
const rec = require(path.join(__dirname, "..", "server", "recorder.js"));
let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra).slice(0, 900) : "")); if (!ok) fails++; }
const ROOT = path.join(HOME, "Movies", "Pool Master Counter");
const DAY = 86400000, now = Date.now();
const FF = ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg"].find((f) => fs.existsSync(f));
function session(id, endedDaysAgo, withPart) {
  const dir = path.join(ROOT, id);
  fs.mkdirSync(dir, { recursive: true });
  const startedAt = now - endedDaysAgo * DAY - 60000, endedAt = now - endedDaysAgo * DAY;
  const parts = [];
  if (withPart && FF) {
    execFileSync(FF, ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=duration=6:size=160x120:rate=10", "-c:v", "mpeg4", "-pix_fmt", "yuv420p", path.join(dir, "part-001.mp4")]);
    parts.push({ n: 1, file: "part-001.mp4", startedAt, endedAt: startedAt + 6000, bytes: fs.statSync(path.join(dir, "part-001.mp4")).size });
  }
  fs.writeFileSync(path.join(dir, "session.json"), JSON.stringify({ id, startedAt, endedAt, mime: "video/mp4", ext: "mp4", parts }));
  return { startedAt, endedAt };
}
const run = (t) => new Promise((ok) => rec._applyRetention(t, ok));
const exists = (id) => fs.existsSync(path.join(ROOT, id));
const inTrash = (id) => fs.existsSync(path.join(HOME, ".Trash", "Pool Master Counter " + id));

(async () => {
  session("2026-09-01 20h00", 40);
  session("2026-10-19 20h00", 10);
  const c = session("2026-09-02 20h00", 40, true);
  fs.writeFileSync(path.join(ROOT, "cues.json"), JSON.stringify([{ id: "cue1", name: "Ann-vs-Ben-break", session: "2026-09-02 20h00", startedAt: c.startedAt + 1000, endedAt: c.startedAt + 4000 }]));

  let gone = await run(now);
  check("kept for good (the default): nothing goes", gone.length === 0 && exists("2026-09-01 20h00"), gone);

  fs.writeFileSync(path.join(ROOT, "settings.json"), JSON.stringify({ keepDays: 30 }));
  gone = await run(now);
  check("30 days: the recording from 40 days ago goes to the Trash; the one from 10 days ago stays", inTrash("2026-09-01 20h00") && !exists("2026-09-01 20h00") && exists("2026-10-19 20h00"), { gone });
  if (FF) {
    const clips = fs.existsSync(path.join(ROOT, "Clips")) ? fs.readdirSync(path.join(ROOT, "Clips")) : [];
    const cues = JSON.parse(fs.readFileSync(path.join(ROOT, "cues.json"), "utf8"));
    check("...one with a cue not cut yet: the cue cut out as a clip first (" + clips.join(", ") + "), then to the Trash, its cue with it", clips.length === 1 && inTrash("2026-09-02 20h00") && cues.length === 0, { clips, cues, gone });
  } else {
    check("...one with a cue it can't cut (no ffmpeg) stays", exists("2026-09-02 20h00"));
  }
  check("the setting takes 0, 7, 14, 30 or 90 only (anything else reads as kept for good)", (() => { fs.writeFileSync(path.join(ROOT, "settings.json"), JSON.stringify({ keepDays: 5 })); return true; })() && (await run(now)).length === 0);
  fs.rmSync(HOME, { recursive: true, force: true });
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})();
