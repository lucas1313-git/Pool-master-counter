// A highlight reel from three cued clips on the Mac (P35), no browser - the server's own recorder
// in this process with a throwaway HOME (its recordings folder there): one recording (30 s of
// test picture and a tone), three cues; server/reel.js through the recorder
// (_buildHighlightReel - what POST /api/rec/reel runs):
// - 9:16, sound off: 1080 x 1920, no sound, as long as the three clips; the score bug burned in
//   (a red PNG here: the bottom left of a frame is red - and isn't in the same reel without it);
// - 16:9, sound on: 1920 x 1080 with sound;
// - a clip no recording covers is skipped, the rest still made;
// - a score card after a clip (🎞 One video's winning shots, 2026-11-26 - a yellow PNG here): 3 s
//   more of the recording under it, darker, the card in the middle; then straight to the next
//   clip, no black between ("make sure that the transition from the score card goes straight to
//   the next clip"), the card fading off it; a card past the end of the recording: the last
//   picture held under it; a card after the last clip: to black, the sound fading out.
// usage: node tests/test_highlight_reel.js
const fs = require("fs");
const os = require("os");
const path = require("path");
const cp = require("child_process");
const FF = ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg"].find((f) => fs.existsSync(f));
if (!FF) { console.log("SKIP no ffmpeg"); process.exit(0); }
const FP = path.join(path.dirname(FF), "ffprobe");
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "pmc-reel-"));
process.env.HOME = HOME;
const recorder = require("../server/recorder.js");
let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra).slice(0, 900) : "")); if (!ok) fails++; }
const ff = (args) => cp.execFileSync(FF, ["-hide_banner", "-loglevel", "error", "-y"].concat(args));

const root = path.join(HOME, "Movies", "Pool Master Counter");
const dir = path.join(root, "2026-10-29 20h00");
fs.mkdirSync(dir, { recursive: true });
const t0 = Date.parse("2026-10-29T20:00:00");
ff(["-f", "lavfi", "-i", "testsrc=duration=30:size=640x360:rate=30", "-f", "lavfi", "-i", "sine=frequency=440:duration=30", "-c:v", "libx264", "-g", "30", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", path.join(dir, "part-001.mp4")]);
fs.writeFileSync(path.join(dir, "session.json"), JSON.stringify({ id: "2026-10-29 20h00", startedAt: t0, endedAt: t0 + 30000, mime: "video/mp4", ext: "mp4", parts: [{ n: 1, file: "part-001.mp4", startedAt: t0, endedAt: t0 + 30000 }] }));
// three cues, as the recorder keeps them
const cues = [[2, 5, "Kim"], [10, 13, "Jo"], [20, 24, "Kim"]].map(([a, b, p], i) => ({ id: "c" + i, name: "Cue " + i, session: "2026-10-29 20h00", startedAt: t0 + a * 1000, endedAt: t0 + b * 1000, player: p, opponent: p === "Kim" ? "Jo" : "Kim" }));
fs.writeFileSync(path.join(root, "cues.json"), JSON.stringify(cues));
// the score bug: a red PNG (the app draws the real one in a canvas)
const bugFile = path.join(HOME, "bug.png");
ff(["-f", "lavfi", "-i", "color=c=red:s=700x140", "-frames:v", "1", bugFile]);
const bug = "data:image/png;base64," + fs.readFileSync(bugFile).toString("base64");
const probe = (f) => JSON.parse(cp.execFileSync(FP, ["-v", "error", "-show_entries", "stream=codec_type,width,height:format=duration", "-of", "json", f]).toString());
// the average colour of a w x h box at (x, y) of the frame at t seconds
const colourAt = (f, t, x, y, w, h) => {
  const raw = cp.execFileSync(FF, ["-hide_banner", "-loglevel", "error", "-ss", String(t), "-i", f, "-frames:v", "1", "-vf", "crop=" + w + ":" + h + ":" + x + ":" + y, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 64 * 1024 * 1024 });
  const sum = [0, 0, 0];
  for (let i = 0; i < raw.length; i += 3) { sum[0] += raw[i]; sum[1] += raw[i + 1]; sum[2] += raw[i + 2]; }
  return sum.map((v) => Math.round(v / (raw.length / 3)));
};
// the mean loudness (dB) from t, d seconds long
const loudness = (f, t, d) => {
  const r = cp.spawnSync(FF, ["-hide_banner", "-ss", String(t), "-t", String(d), "-i", f, "-af", "volumedetect", "-f", "null", "-"]);
  const m = /mean_volume: (-?[\d.]+) dB/.exec(String(r.stderr));
  return m ? Number(m[1]) : -91;
};
const build = (body) => new Promise((ok) => recorder._buildHighlightReel(body, (err, r) => ok({ err, r })));

(async () => {
  try {
    const clips = cues.map((c) => ({ from: c.startedAt, to: c.endedAt, bug }));
    let { err, r } = await build({ clips, aspect: "9:16", sound: false, name: "Tonight's highlights test" });
    const out = r && path.join(root, "Highlights", r.file);
    const info = out && fs.existsSync(out) ? probe(out) : null;
    const v = info && info.streams.find((s) => s.codec_type === "video");
    const dur = info ? Number(info.format.duration) : 0;
    check("three cued clips, 9:16, sound off: " + (v ? v.width + " x " + v.height : "-") + ", " + dur.toFixed(1) + " s (3 + 3 + 4), no sound", !err && v && v.width === 1080 && v.height === 1920 && Math.abs(dur - 10) < 0.6 && !info.streams.some((s) => s.codec_type === "audio") && r.clips === 3, { err: err && err.message, r, info });
    if (out && fs.existsSync(out)) {
      // the bug: 700 x 140 at x 38, y 1920 - 140 - 86 = 1694 - red there; the same reel without
      // bugs isn't
      const plain = await build({ clips: clips.map((c) => ({ from: c.from, to: c.to })), aspect: "9:16", sound: false, name: "No bug" });
      const bugPx = colourAt(out, 1, 120, 1720, 60, 40), noBug = colourAt(path.join(root, "Highlights", plain.r.file), 1, 120, 1720, 60, 40);
      const red = (c) => c[0] > 180 && c[1] < 70 && c[2] < 70;
      check("...the score bug burned in at the bottom left (" + bugPx.join(",") + "; without it " + noBug.join(",") + ")", red(bugPx) && !red(noBug), { bugPx, noBug });
    }
    ({ err, r } = await build({ clips, aspect: "16:9", sound: true, name: "Tonight's highlights wide" }));
    const out2 = r && path.join(root, "Highlights", r.file);
    const info2 = out2 && fs.existsSync(out2) ? probe(out2) : null;
    const v2 = info2 && info2.streams.find((s) => s.codec_type === "video");
    check("16:9, sound on: " + (v2 ? v2.width + " x " + v2.height : "-") + " with sound", !err && v2 && v2.width === 1920 && v2.height === 1080 && info2.streams.some((s) => s.codec_type === "audio"), { err: err && err.message, info2 });
    ({ err, r } = await build({ clips: clips.concat([{ from: t0 + 100000, to: t0 + 104000, bug }]), aspect: "16:9", sound: false, name: "With a gap" }));
    check("a clip no recording covers: skipped, the other three made (" + (r && r.clips) + ")", !err && r.clips === 3 && r.skipped.length === 1, { err: err && err.message, r });

    // the score card: after the 2nd clip (10-13 s), 3 s; after one ending with the recording (26-30 s), 2 s
    const cardFile = path.join(HOME, "card.png");
    ff(["-f", "lavfi", "-i", "color=c=yellow:s=800x400", "-frames:v", "1", cardFile]);
    const card = "data:image/png;base64," + fs.readFileSync(cardFile).toString("base64");
    const carded = clips.map((c, i) => (i === 1 ? Object.assign({ card, cardSecs: 3 }, c) : c)).concat([{ from: t0 + 26000, to: t0 + 30000, bug, card, cardSecs: 2 }]);
    ({ err, r } = await build({ clips: carded, aspect: "16:9", sound: true, name: "With cards" }));
    const out3 = r && path.join(root, "Highlights", r.file);
    const info3 = out3 && fs.existsSync(out3) ? probe(out3) : null;
    const dur3 = info3 ? Number(info3.format.duration) : 0;
    check("score cards: " + dur3.toFixed(1) + " s (3 + 3+3 + 4 + 4+2), " + (r && r.seconds) + " s said", !err && Math.abs(dur3 - 19) < 0.6 && Math.abs(r.seconds - 19) < 0.2 && r.clips === 4, { err: err && err.message, r, dur3 });
    if (info3) {
      const yellow = (c) => c[0] > 200 && c[1] > 200 && c[2] < 80;
      const lum = (c) => c[0] + c[1] + c[2];
      // the 2nd clip: 3-6 s, its card 6-9 s
      const before = colourAt(out3, 5.5, 900, 500, 120, 80), onCard = colourAt(out3, 7.5, 900, 500, 120, 80);
      check("...the card in the middle once the clip is over (" + onCard.join(",") + "), not before (" + before.join(",") + ")", yellow(onCard) && !yellow(before), { before, onCard });
      const cornerClip = colourAt(out3, 5.5, 100, 480, 200, 120), cornerCard = colourAt(out3, 7.5, 100, 480, 200, 120);
      check("...the video still there around it, darker (" + cornerCard.join(",") + " vs " + cornerClip.join(",") + ")", lum(cornerCard) > 15 && lum(cornerCard) < lum(cornerClip) * 0.6, { cornerClip, cornerCard });
      const bugOff = colourAt(out3, 7.5, 120, 920, 60, 40), red = (c) => c[0] > 180 && c[1] < 70 && c[2] < 70;
      check("...the caption gone under the card (" + bugOff.join(",") + ")", !red(bugOff), bugOff);
      // the cut at 9 s: the card on to the end, then the next clip at once under it, fading off
      const cardEnd = colourAt(out3, 8.97, 900, 500, 120, 80), aroundEnd = colourAt(out3, 8.97, 100, 480, 200, 120);
      const cardGoing = colourAt(out3, 9.04, 900, 500, 120, 80), aroundNext = colourAt(out3, 9.04, 100, 480, 200, 120);
      const cardGone = colourAt(out3, 9.6, 900, 500, 120, 80), aroundOn = colourAt(out3, 9.6, 100, 480, 200, 120);
      check("...then straight to the next clip, no black: the card till the cut (" + cardEnd.join(",") + "), the next clip under it at once (around it " + aroundEnd.join(",") + " -> " + aroundNext.join(",") + "), the card off it (" + cardGoing.join(",") + " -> " + cardGone.join(",") + ", around it " + aroundOn.join(",") + ")",
        yellow(cardEnd) && lum(aroundEnd) > 40 && lum(aroundNext) > 40 && yellow(cardGoing) && !yellow(cardGone) && lum(cardGone) > 150 && lum(aroundOn) > lum(aroundNext) * 1.6, { cardEnd, aroundEnd, cardGoing, aroundNext, cardGone, aroundOn });
      const loud = loudness(out3, 4, 1), under = loudness(out3, 7, 1), nextLoud = loudness(out3, 9.3, 0.5);
      check("...the sound going on under the card (" + under + " dB vs " + loud + " dB), the next clip's right after (" + nextLoud + " dB)", Math.abs(under - loud) < 2 && Math.abs(nextLoud - loud) < 2, { loud, under, nextLoud });
      // the last: 13-17 s, its card 17-19 s - the recording ended at 17 s
      const held = colourAt(out3, 18, 900, 500, 120, 80);
      check("...a card past the end of the recording: still there (" + held.join(",") + ")", yellow(held), held);
      const black = colourAt(out3, 18.97, 0, 0, 1920, 1080), quiet = loudness(out3, 18.86, 0.1);
      check("...the card after the last clip: the video ends to black (" + black.join(",") + "), the sound fading out (" + quiet + " dB)", lum(black) < 40 && quiet < loud - 12, { black, quiet });
    }
  } finally {
    fs.rmSync(HOME, { recursive: true, force: true });
  }
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})();
