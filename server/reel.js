// Tonight's highlights (P35) on the Mac: a reel cut from the recordings with ffmpeg - each clip
// re-encoded to one size (16:9 1920x1080 or 9:16 1080x1920, the picture filled and centred),
// its score bug (a PNG the app draws - this ffmpeg has no text filter) laid over the bottom
// left, sound only when asked for, then the clips joined. The clips are chosen by the app (it
// knows the scores, the runs, who said yes - js/lib/highlights.js); this only cuts.
// A clip with a score card (🎞 One video's winning shots - js/cue-viewer.js, another PNG the app
// draws): the video goes on under it for its seconds (the last picture held if the recording
// stops), darkened, the card fading in over the middle; then straight to the next clip, the card
// and the dark fading off it as it starts (2026-11-26, the user: "make sure that the transition
// from the score card goes straight to the next clip") - after the last clip, all to black.
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
// or null (its score card after it), cardSecs }],
// aspect "16:9" | "9:16", sound (false), size (the short side, 1080),
// name, outDir (default <recordings>/Highlights) }
// -> cb(err, { file, path, seconds, clips, skipped })
function buildReel(rec, opts, cb) {
  if (!rec.ffmpeg()) return cb(new Error("ffmpeg isn't on this computer"));
  var clips = (opts.clips || []).filter(function (c) { return c && c.to > c.from; });
  if (!clips.length) return cb(new Error("no clips"));
  var size = sizeFor(opts.aspect, opts.size), sound = !!opts.sound;
  var outDir = opts.outDir || path.join(rec.root(), "Highlights");
  fs.mkdirSync(outDir, { recursive: true });
  var tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pmc-reel-"));
  // (carry: the score card before - its PNG, laid over the next clip's start as it fades off)
  var segs = [], skipped = [], seconds = 0, i = 0, carry = null;
  var CARD_IN = 0.15, CARD_FADE = 0.4, DIM_FADE = 0.35, TO_BLACK = 0.45, SOUND_OUT = 0.6, SOUND_CUT = 0.15;
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
    var cardOut = carry, end = n === clips.length - 1;
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
        var inputs = 1, bugInput = -1, cardInput = -1, outInput = -1, silenceInput = -1, cardFile = null;
        if (clip.bug && clip.bug.length) {
          var bugFile = path.join(tmpDir, "bug-" + n + ".png");
          fs.writeFileSync(bugFile, clip.bug);
          args.push("-i", bugFile);
          bugInput = inputs++;
        }
        if (card) {
          cardFile = path.join(tmpDir, "card-" + n + ".png");
          fs.writeFileSync(cardFile, card);
          args.push("-loop", "1", "-framerate", "30", "-t", num(total), "-i", cardFile);
          cardInput = inputs++;
        }
        if (cardOut) {
          args.push("-loop", "1", "-framerate", "30", "-t", num(CARD_FADE + 0.1), "-i", cardOut);
          outInput = inputs++;
        }
        if (sound && !audio) {
          args.push("-f", "lavfi", "-t", num(total), "-i", "anullsrc=r=48000:cl=stereo");
          silenceInput = inputs++;
        }
        // the picture: filled and centred (a card: the last picture held, should the recording
        // stop first), the bug over the bottom left (till the card)
        var graph = "[0:v]scale=" + size.w + ":" + size.h + ":force_original_aspect_ratio=increase,crop=" + size.w + ":" + size.h + ",setsar=1,fps=30,format=yuv420p" + (card ? ",tpad=stop_mode=clone:stop_duration=" + num(total) : "") + "[v0]";
        var last = "v0";
        if (bugInput !== -1) {
          graph += ";[" + bugInput + ":v]scale=w='min(iw," + Math.round(size.w * 0.9) + ")':h=-1[bug];[v0][bug]overlay=x=" + Math.round(size.w * 0.035) + ":y=main_h-overlay_h-" + Math.round(size.h * 0.045) + ":format=auto" + (card ? ":enable='lt(t," + num(cardAt) + ")'" : "") + "[vb]";
          last = "vb";
        }
        var dimOf = function (d) { return "color=c=black@0.6:s=" + size.w + "x" + size.h + ":r=30:d=" + num(d) + ",format=rgba"; };
        var cardOf = function (k) { return "[" + k + ":v]scale=w='min(iw," + Math.round(size.w * 0.9) + ")':h=-1,format=rgba"; };
        var centre = "x=(main_w-overlay_w)/2:y=(main_h-overlay_h)/2:format=auto";
        // the card before: fading off this clip's start, the dark with it
        if (outInput !== -1) {
          graph += ";" + dimOf(CARD_FADE + 0.1) + ",fade=t=out:st=0:d=" + CARD_FADE + ":alpha=1[dimout];[" + last + "][dimout]overlay=format=auto:eof_action=pass[vo]";
          graph += ";" + cardOf(outInput) + ",fade=t=out:st=0:d=" + CARD_FADE + ":alpha=1[cardout];[vo][cardout]overlay=" + centre + ":eof_action=pass[vp]";
          last = "vp";
        }
        // the card: the video darker, the card fading in over the middle
        if (card) {
          graph += ";" + dimOf(total) + ",fade=t=in:st=" + num(cardAt) + ":d=" + DIM_FADE + ":alpha=1[dim];[" + last + "][dim]overlay=format=auto[vd]";
          graph += ";" + cardOf(cardInput) + ",fade=t=in:st=" + num(cardAt + CARD_IN) + ":d=" + CARD_FADE + ":alpha=1[card];[vd][card]overlay=" + centre + "[vc]";
          last = "vc";
        }
        // (a card after the last clip: the video ends - to black)
        graph += ";[" + last + "]" + (card && end ? "fade=t=out:st=" + num(total - TO_BLACK) + ":d=" + TO_BLACK + "," : "") + "format=yuv420p[v]";
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
          carry = cardFile;
          next();
        });
      });
    });
  })();
}

module.exports = { buildReel: buildReel, reelFileName: reelFileName, sizeFor: sizeFor };
