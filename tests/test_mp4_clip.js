// js/mp4-clip.js on its own, in Node: a fragmented MP4 like a browser's
// MediaRecorder writes (made here with ffmpeg: 20 s, a key frame every 2 s,
// a fragment a second) fed to the Indexer in random-size pieces, then cut
// at three stretches. Checks: every fragment found and timed; each clip
// starts on the last key frame at or before the start asked for, is about
// as long as asked, and decodes cleanly (ffmpeg); the reading range stays
// near the stretch. Run: node tests/test_mp4_clip.js
const fs = require("fs"), cp = require("child_process"), path = require("path"), os = require("os");
const M = require(path.join(__dirname, "..", "js", "mp4-clip.js"));
const FF = fs.existsSync("/opt/homebrew/bin/ffmpeg") ? "/opt/homebrew/bin/" : "";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pmc-mp4clip-"));
let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra) : "")); if (!ok) fails++; }
const src = path.join(dir, "frag.mp4");
cp.execFileSync(FF + "ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc=size=640x360:rate=30", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "20", "-c:v", "libx264", "-g", "60", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "96k", "-movflags", "frag_keyframe+empty_moov+default_base_moof", "-frag_duration", "1000000", src]);
const all = new Uint8Array(fs.readFileSync(src));
const ix = new M.Indexer();
for (let o = 0; o < all.length;) { const n = 1 + Math.floor(Math.random() * 40000); ix.push(all.subarray(o, Math.min(all.length, o + n))); o += n; }
check("the Indexer, fed random-size pieces: 21 fragments, timed 0..19 s, video and sound tracks", ix.fragments.length === 21 && Math.abs(ix.duration() - 19) < 0.05 && ix.tracks.map((t) => t.handler).join(",") === "vide,soun", { n: ix.fragments.length, d: ix.duration() });
for (const [a, b, wantStart] of [[5.2, 9.7, 4], [0, 3, 0], [14, 25, 14]]) {
  const r = M.pick(ix.fragments, a, b);
  const clip = M.cut(ix.init, all.subarray(r.from, r.to), a, b);
  const f = path.join(dir, "clip.mp4");
  fs.writeFileSync(f, clip.bytes);
  const dur = parseFloat(cp.execFileSync(FF + "ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString());
  let clean = true; try { cp.execFileSync(FF + "ffmpeg", ["-v", "error", "-i", f, "-f", "null", "-"], { stdio: ["ignore", "pipe", "pipe"] }); } catch (e) { clean = false; }
  const want = Math.min(b, 20) - wantStart;
  check(`[${a}, ${b}] s: starts on the key frame at ${wantStart} s, ${dur.toFixed(2)} s long (want ~${want}), decodes cleanly, reads ${((r.to - r.from) / 1024).toFixed(0)} KB`, Math.abs(clip.start - wantStart) < 0.01 && Math.abs(dur - want) < 0.2 && clean && r.to - r.from < all.length, { start: clip.start, dur, clean });
}
fs.rmSync(dir, { recursive: true, force: true });
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
