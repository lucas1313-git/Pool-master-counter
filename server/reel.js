// Tonight's highlights (P35) on the Mac: a reel cut from the recordings with ffmpeg - each clip
// re-encoded to one size (16:9 1920x1080 or 9:16 1080x1920, the picture filled and centred),
// its score bug (a PNG the app draws - this ffmpeg has no text filter) laid over the bottom
// left, sound only when asked for, then the clips joined. The clips are chosen by the app (it
// knows the scores, the runs, who said yes - js/lib/highlights.js); this only cuts.
// A clip with a score card (🎞 One video's winning shots - js/cue-viewer.js, another PNG the app
// draws): the video goes on under it for its seconds (the last picture held if the recording
// stops), darkened, the card fading in over the middle - with a roll (clip.roll: the winner's
// number as a strip PNG, the old one over the new, and a glow), the old score rolling up into the
// new and its panel flashing gold as it lands, then the players' Q-Scores rolling the same way
// (clip.qroll); then straight to the next clip, the card
// and the dark fading off it as it starts (2026-11-26, the user: "make sure that the transition
// from the score card goes straight to the next clip") - after the last clip, all to black. Its
// fade (in, and off the next clip) as long as asked (opts.fade - 0: none, the card just there).
// rec: the recorder's own helpers { ffmpeg, runFfmpeg, piecesFor, root }.
"use strict";
var fs = require("fs");
var os = require("os");
var path = require("path");
var childProcess = require("child_process");

// "Tonight's highlights 2026-10-29" -> a file name we can serve back
function reelFileName(name) {
  return (String(name || "Highlights").replace(/[\/\\:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 120) || "Highlights") + ".mp4";
}
function sizeFor(aspect, short) {
  short = Math.max(240, Math.min(2160, Math.round((short || 1080) / 2) * 2));
  var long = Math.round((short * 16) / 9 / 2) * 2;
  return aspect === "9:16" ? { w: short, h: long } : { w: long, h: short };
}

// a PNG's size (its IHDR) -> { w, h } or null
function pngSize(buf) {
  return buf && buf.length > 24 && buf.toString("ascii", 12, 16) === "IHDR" ? { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) } : null;
}
// where a score card goes on the picture: in the middle, its own size - smaller, to 90 % of the
// width, should the picture be narrower -> { k (its scale), x, y }
function placeCard(card, size) {
  var px = pngSize(card) || { w: Math.round(size.w * 0.5), h: Math.round(size.h * 0.5) };
  var k = Math.min(1, (size.w * 0.9) / px.w);
  return { k: k, x: Math.round((size.w - px.w * k) / 2), y: Math.round((size.h - px.h * k) / 2) };
}

// does this file have sound?
function hasAudio(rec, file, cb) {
  var probe = rec.ffmpeg() ? path.join(path.dirname(rec.ffmpeg()), "ffprobe") : null;
  if (!probe) return cb(false);
  childProcess.execFile(probe, ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", file], { timeout: 30000 }, function (err, stdout) {
    cb(!err && String(stdout).trim().length > 0);
  });
}

// One clip's source as one file: the part it's in, or (across parts) the
// pieces joined without re-encoding. -> cb(err, { file, from, dur, at (when its
// first picture was, wall-clock ms) })
function clipSource(rec, clip, tmpDir, i, cb) {
  var pieces = rec.piecesFor(clip.from, clip.to);
  if (!pieces.length) return cb(new Error("no recording covers that moment"));
  var at = pieces[0].at + pieces[0].from * 1000;
  if (pieces.length === 1) return cb(null, { file: pieces[0].file, from: pieces[0].from, dur: pieces[0].to - pieces[0].from, at: at });
  var list = [], k = 0;
  (function next() {
    if (k === pieces.length) {
      var listFile = path.join(tmpDir, "list-" + i + ".txt"), joined = path.join(tmpDir, "joined-" + i + ".mp4");
      fs.writeFileSync(listFile, list.map(function (f) { return "file '" + f.replace(/'/g, "'\\''") + "'"; }).join("\n"));
      return rec.runFfmpeg(["-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", joined], function (err) {
        cb(err, { file: joined, from: 0, dur: (clip.to - clip.from) / 1000, at: at });
      });
    }
    var pc = pieces[k], piece = path.join(tmpDir, "piece-" + i + "-" + k + ".mp4");
    k++;
    rec.runFfmpeg(["-ss", pc.from.toFixed(3), "-i", pc.file, "-t", (pc.to - pc.from).toFixed(3), "-c", "copy", "-avoid_negative_ts", "make_zero", piece], function (err) {
      if (err) return cb(err);
      list.push(piece);
      next();
    });
  })();
}

// opts: { clips: [{ from, to (wall-clock ms), bug: PNG Buffer or null, card: PNG Buffer
// or null (its score card after it), cardSecs, roll: { strip, flash (PNG Buffers), x, y, w, h
// (the number's box in the card), fx, fy (the glow's corner) } or null, qroll: [{ strip, x, y,
// w, h }] (the Q-Scores') }],
// aspect "16:9" | "9:16", sound (false), size (the short side, 1080),
// name, outDir (default <recordings>/Highlights), fade (a score card's, s - 0.4) }
// -> cb(err, { file, path, seconds, clips, skipped })
function buildReel(rec, opts, cb) {
  if (!rec.ffmpeg()) return cb(new Error("ffmpeg isn't on this computer"));
  var clips = (opts.clips || []).filter(function (c) { return c && c.to > c.from; });
  if (!clips.length) return cb(new Error("no clips"));
  var size = sizeFor(opts.aspect, opts.size), sound = !!opts.sound;
  var outDir = opts.outDir || path.join(rec.root(), "Highlights");
  fs.mkdirSync(outDir, { recursive: true });
  var tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pmc-reel-"));
  // (carry: the score card before - { card (its PNG), strips [{ file, r }] (its numbers - landed),
  // k, x, y, fade } - laid over the next clip's start as it fades off)
  var segs = [], skipped = [], seconds = 0, i = 0, carry = null;
  var fade = typeof opts.fade === "number" && isFinite(opts.fade) ? Math.max(0, Math.min(2, opts.fade)) : 0.4;
  var SOUND_OUT = 0.6, SOUND_CUT = 0.15;
  function done(err, result) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    cb(err, result);
  }
  (function next() {
    if (i === clips.length) {
      if (!segs.length) return done(new Error("no recording covers those moments"));
      var name = reelFileName(opts.name), out = path.join(outDir, name);
      var listFile = path.join(tmpDir, "reel.txt");
      fs.writeFileSync(listFile, segs.map(function (f) { return "file '" + f.replace(/'/g, "'\\''") + "'"; }).join("\n"));
      return rec.runFfmpeg(["-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", "-movflags", "+faststart", out], function (err) {
        done(err, err ? null : { file: name, path: out, seconds: Math.round(seconds * 10) / 10, clips: segs.length, skipped: skipped });
      });
    }
    var clip = clips[i], n = i, card = clip.card && clip.card.length ? clip.card : null, cardSecs = card ? clip.cardSecs || 3 : 0;
    var cardOut = carry, end = n === clips.length - 1, f = card ? Math.min(fade, cardSecs / 2) : 0;
    i++;
    // (a score card: the recording after the clip too, under it)
    clipSource(rec, card ? { from: clip.from, to: clip.to + cardSecs * 1000 } : clip, tmpDir, n, function (err, src) {
      if (err) { skipped.push(n); return next(); }
      hasAudio(rec, src.file, function (audio) {
        var seg = path.join(tmpDir, "seg-" + n + ".mp4");
        // (the card from where the clip ends; all of it: the clip and the card)
        var cardAt = card ? Math.max(0.5, Math.min(src.dur, (clip.to - src.at) / 1000)) : 0, total = card ? cardAt + cardSecs : src.dur;
        var num = function (v) { return v.toFixed(3); };
        var args = ["-ss", num(src.from), "-t", num(src.dur), "-i", src.file];
        var inputs = 1, bugInput = -1, silenceInput = -1, mine = null;
        var still = function (buf, name, secs) {
          var file = path.join(tmpDir, name + "-" + n + ".png");
          fs.writeFileSync(file, buf);
          args.push("-loop", "1", "-framerate", "30", "-t", num(secs), "-i", file);
          return { file: file, input: inputs++ };
        };
        if (clip.bug && clip.bug.length) {
          var bugFile = path.join(tmpDir, "bug-" + n + ".png");
          fs.writeFileSync(bugFile, clip.bug);
          args.push("-i", bugFile);
          bugInput = inputs++;
        }
        // the card: where it goes (its own size - smaller should the video be), its pieces - the
        // strips that roll (the score's, the Q-Scores')
        if (card) {
          mine = placeCard(card, size);
          mine.card = still(card, "card", total);
          mine.strips = [];
          if (clip.roll) {
            mine.strips.push({ r: clip.roll, s: still(clip.roll.strip, "strip", total) });
            if (clip.roll.flash) mine.flash = still(clip.roll.flash, "flash", total);
          }
          (clip.qroll || []).forEach(function (q, k) { mine.strips.push({ r: q, s: still(q.strip, "q" + k, total), q: true }); });
        }
        // (the card before, fading off this clip: its own, its numbers landed)
        var before = cardOut ? { k: cardOut.k, x: cardOut.x, y: cardOut.y } : null;
        if (before) {
          before.card = { input: inputs++ };
          args.push("-loop", "1", "-framerate", "30", "-t", num(cardOut.fade + 0.1), "-i", cardOut.card);
          before.strips = cardOut.strips.map(function (st) {
            args.push("-loop", "1", "-framerate", "30", "-t", num(cardOut.fade + 0.1), "-i", st.file);
            return { r: st.r, input: inputs++ };
          });
        }
        if (sound && !audio) {
          args.push("-f", "lavfi", "-t", num(total), "-i", "anullsrc=r=48000:cl=stereo");
          silenceInput = inputs++;
        }
        // the picture: filled and centred (a card: the last picture held, should the recording
        // stop first), the bug over the bottom left (till the card)
        var graph = "[0:v]scale=" + size.w + ":" + size.h + ":force_original_aspect_ratio=increase,crop=" + size.w + ":" + size.h + ",setsar=1,fps=30,format=yuv420p" + (card ? ",tpad=stop_mode=clone:stop_duration=" + num(total) : "") + "[v0]";
        var last = "v0", label = 0;
        // lays [in] (a still, how it's to look - fades) over the picture at (x, y) -> graph
        var lay = function (input, look, x, y, extra) {
          var tag = "l" + (label++), outTag = "o" + label;
          graph += ";[" + input + ":v]format=rgba" + look + "[" + tag + "];[" + last + "][" + tag + "]overlay=x=" + Math.round(x) + ":y=" + Math.round(y) + ":format=auto" + (extra || "") + "[" + outTag + "]";
          last = outTag;
        };
        var scaled = function (k) { return k < 1 ? ",scale=iw*" + k.toFixed(4) + ":-1" : ""; };
        var dimOf = function (d) { return "color=c=black@0.6:s=" + size.w + "x" + size.h + ":r=30:d=" + num(d) + ",format=rgba"; };
        if (bugInput !== -1) {
          graph += ";[" + bugInput + ":v]scale=w='min(iw," + Math.round(size.w * 0.9) + ")':h=-1[bug];[" + last + "][bug]overlay=x=" + Math.round(size.w * 0.035) + ":y=main_h-overlay_h-" + Math.round(size.h * 0.045) + ":format=auto" + (card ? ":enable='lt(t," + num(cardAt) + ")'" : "") + "[vb]";
          last = "vb";
        }
        // the card before: fading off this clip's start, the dark with it
        if (before) {
          var going = ",fade=t=out:st=0:d=" + num(cardOut.fade) + ":alpha=1";
          graph += ";" + dimOf(cardOut.fade + 0.1) + going + "[dimout];[" + last + "][dimout]overlay=format=auto:eof_action=pass[vo]";
          last = "vo";
          lay(before.card.input, scaled(before.k) + going, before.x, before.y, ":eof_action=pass");
          before.strips.forEach(function (st) {
            lay(st.input, ",crop=" + st.r.w + ":" + st.r.h + ":0:" + st.r.h + scaled(before.k) + going, before.x + st.r.x * before.k, before.y + st.r.y * before.k, ":eof_action=pass");
          });
        }
        // the card: the video darker, the card fading in over the middle
        if (card) {
          // (no fade: there at once)
          var coming = f > 0 ? ",fade=t=in:st=" + num(cardAt) + ":d=" + num(f) + ":alpha=1" : "", from = f > 0 ? "" : ":enable='gte(t," + num(cardAt) + ")'";
          graph += ";" + dimOf(total) + coming + "[dim];[" + last + "][dim]overlay=format=auto" + from + "[vd]";
          last = "vd";
          lay(mine.card.input, scaled(mine.k) + coming, mine.x, mine.y, from);
          // the old score turning into the new: the winner's number rolling up (a box of the
          // strip, moving down it - eased), its panel flashing gold as the new one lands; then the
          // Q-Scores, all at once (no score rolling: they go first)
          var rollAt = cardAt + Math.min(f + 0.3, cardSecs * 0.3), d = Math.min(0.6, cardSecs * 0.25), landed = rollAt + d;
          var qAt = mine.strips.some(function (st) { return !st.q; }) ? landed + Math.min(0.15, cardSecs * 0.05) : rollAt;
          mine.strips.forEach(function (st) {
            var r = st.r, at = st.q ? qAt : rollAt, p = "(t-" + num(at) + ")/" + num(d);
            var y = "if(lt(t," + num(at) + "),0,if(gt(t," + num(at + d) + ")," + r.h + "," + r.h + "*" + p + "*" + p + "*(3-2*" + p + ")))";
            lay(st.s.input, ",crop=" + r.w + ":" + r.h + ":0:'" + y + "'" + scaled(mine.k) + coming, mine.x + r.x * mine.k, mine.y + r.y * mine.k, from);
            if (!st.q && mine.flash) lay(mine.flash.input, scaled(mine.k) + ",fade=t=in:st=" + num(landed - 0.05) + ":d=0.12:alpha=1,fade=t=out:st=" + num(landed + 0.15) + ":d=0.7:alpha=1", mine.x + r.fx * mine.k, mine.y + r.fy * mine.k);
          });
        }
        // (a card after the last clip: the video ends - to black)
        graph += ";[" + last + "]" + (card && end && f > 0 ? "fade=t=out:st=" + num(total - f) + ":d=" + num(f) + "," : "") + "format=yuv420p[v]";
        if (sound) {
          // (the sound: a moment's turn at the cut after a card - the end: fading out)
          var af = ["aresample=48000", "aformat=sample_fmts=fltp:channel_layouts=stereo"];
          if (card) af.push("apad");
          if (cardOut) af.push("afade=t=in:st=0:d=" + SOUND_CUT);
          if (card) af.push("afade=t=out:st=" + num(total - (end ? SOUND_OUT : SOUND_CUT)) + ":d=" + (end ? SOUND_OUT : SOUND_CUT));
          graph += ";[" + (silenceInput !== -1 ? silenceInput : 0) + ":a]" + af.join(",") + "[a]";
        }
        args.push("-filter_complex", graph, "-map", "[v]");
        if (sound) args.push("-map", "[a]", "-c:a", "aac", "-b:a", "128k");
        else args.push("-an");
        args.push("-t", num(total), "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-r", "30", "-g", "60", "-pix_fmt", "yuv420p", seg);
        rec.runFfmpeg(args, function (err2) {
          if (err2) { skipped.push(n); return next(); }
          segs.push(seg);
          seconds += total;
          carry = card && f > 0 ? { card: mine.card.file, strips: mine.strips.map(function (st) { return { file: st.s.file, r: st.r }; }), k: mine.k, x: mine.x, y: mine.y, fade: f } : null;
          next();
        });
      });
    });
  })();
}

module.exports = { buildReel: buildReel, reelFileName: reelFileName, sizeFor: sizeFor };
