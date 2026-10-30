// 📁 A folder of each day's cues (2026-10-29 request), server/recorder.js in this process with a
// throwaway HOME (its recordings folder there): two recordings - yesterday's (two ⭐ cues, Ann v Ben
// and Ben v Cat, and a 🎱 game mark) and today's (one cue, Ann v Dan):
// - every hour (here: once): yesterday's folder made - "Pool Master Cues <yesterday> Ann - Ben -
//   Cat", its two cues cut into it (not the game mark); today's isn't (the day isn't over);
// - "make it now" for today: "Pool Master Cues <today> Ann - Dan", one clip;
// - a cue more today with Eve: made again - renamed "... Ann - Dan - Eve", two clips;
// - deleted: to the Trash, and not made again on its own; the list says so; made by hand: back;
// - a long night (40 players): the name stays short ("+ n more").
// usage: node tests/test_cue_folders.js
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const FF = ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg"].find((f) => fs.existsSync(f));
if (!FF) { console.log("SKIP no ffmpeg"); process.exit(0); }
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "pmc-cue-folders-"));
process.env.HOME = HOME;
const rec = require(path.join(__dirname, "..", "server", "recorder.js"));
const poolDay = require(path.join(__dirname, "..", "js", "lib", "pool-day.js"));
let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra).slice(0, 900) : "")); if (!ok) fails++; }
const ROOT = path.join(HOME, "Movies", "Pool Master Counter");
const now = Date.now();
function session(id, startedAt) {
  const dir = path.join(ROOT, id);
  fs.mkdirSync(dir, { recursive: true });
  execFileSync(FF, ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=duration=20:size=160x120:rate=10", "-c:v", "libx264", "-g", "10", "-pix_fmt", "yuv420p", path.join(dir, "part-001.mp4")]);
  fs.writeFileSync(path.join(dir, "session.json"), JSON.stringify({ id, startedAt, endedAt: startedAt + 20000, mime: "video/mp4", ext: "mp4", parts: [{ n: 1, file: "part-001.mp4", startedAt, endedAt: startedAt + 20000 }] }));
}
const pad2 = (n) => String(n).padStart(2, "0");
const folderId = (t) => { const d = new Date(t); return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) + " " + pad2(d.getHours()) + "h" + pad2(d.getMinutes()); };
const y0 = now - 30 * 3600000, t0 = now - 120000;
const yday = poolDay.localDateStrFromTs(y0), today = poolDay.localDateStrFromTs(now);
session(folderId(y0), y0);
session(folderId(t0), t0);
const cue = (id, s, a, b, player, opponent, extra) => Object.assign({ id, name: id + "-" + player + "-vs-" + opponent, session: s, startedAt: a, endedAt: b, player, opponent }, extra || {});
const cues = [
  cue("c1", folderId(y0), y0 + 2000, y0 + 6000, "Ann", "Ben"),
  cue("c2", folderId(y0), y0 + 9000, y0 + 13000, "Ben", "Cat"),
  { id: "g1", kind: "game", name: "🎱 Game 2 · 8-Ball · Ann v Ben", session: folderId(y0), startedAt: y0 + 8000, endedAt: y0 + 8000, matchup: "Ann v Ben" },
  cue("c3", folderId(t0), t0 + 2000, t0 + 6000, "Ann", "Dan")
];
fs.writeFileSync(path.join(ROOT, "cues.json"), JSON.stringify(cues));
const make = (now) => new Promise((ok) => rec._makeDueCueFolders(now, ok));
const build = (d) => new Promise((ok) => rec._buildCueFolder(d, (err, r) => ok({ err, r })));
const mp4s = (name) => { try { return fs.readdirSync(path.join(ROOT, name)).filter((f) => /\.mp4$/.test(f)); } catch (e) { return null; } };

(async () => {
  try {
    const made = await make(now);
    const yName = "Pool Master Cues " + yday + " Ann - Ben - Cat";
    check("every hour: yesterday's folder made - \"" + yName + "\" - its two cues cut in (not the game mark); today's not", made.join() === yday && (mp4s(yName) || []).length === 2 && !(mp4s(yName) || []).some((f) => /Game/.test(f)) && !fs.readdirSync(ROOT).some((n) => n.indexOf("Pool Master Cues " + today) === 0), { made, files: mp4s(yName), dir: fs.readdirSync(ROOT) });
    let b = await build(today);
    const tName = "Pool Master Cues " + today + " Ann - Dan";
    check("make it now, today: \"" + (b.r && b.r.name) + "\", one clip", !b.err && b.r.name === tName && (mp4s(tName) || []).length === 1, b);
    cues.push(cue("c4", folderId(t0), t0 + 9000, t0 + 13000, "Eve", "Dan"));
    fs.writeFileSync(path.join(ROOT, "cues.json"), JSON.stringify(cues));
    b = await build(today);
    const tName2 = "Pool Master Cues " + today + " Ann - Dan - Eve";
    check("a cue more with Eve, made again: renamed \"" + (b.r && b.r.name) + "\", two clips (the first not cut again: " + (b.r && b.r.cut) + " cut)", !b.err && b.r.name === tName2 && !fs.existsSync(path.join(ROOT, tName)) && (mp4s(tName2) || []).length === 2 && b.r.cut === 1, b);
    const trash = rec._deleteCueFolder(yday);
    const again = await make(now);
    const list = rec._listCueFolders();
    const yRow = list.find((d) => d.date === yday);
    check("deleted: to the Trash (" + path.basename(trash || "") + "), not made again on its own; the list says so", trash && fs.existsSync(trash) && !fs.existsSync(path.join(ROOT, yName)) && again.length === 0 && yRow && yRow.deleted && !yRow.exists, { trash, again, yRow });
    b = await build(yday);
    check("...made by hand: back", !b.err && (mp4s(yName) || []).length === 2, b);
    const many = Array.from({ length: 40 }, (_, i) => ({ player: "Player" + String(i).padStart(2, "0"), opponent: "" }));
    const long = rec._cueFolderName("2026-10-29", many);
    check("a long night (40 players): the name stays short (" + long.length + " characters, \"" + long.slice(-14) + "\")", long.length <= 190 && /\+ \d+ more$/.test(long), long);
  } finally {
    fs.rmSync(HOME, { recursive: true, force: true });
  }
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})();
