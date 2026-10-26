// Cutting a clip out of a recording, in the browser - for recording on a
// device with no local server (an iPad on the GitHub site), where there's
// no ffmpeg to do it. A browser's MediaRecorder writes a fragmented MP4
// (ftyp, moov, then moof+mdat pairs as it goes). This reads one and writes
// the stretch asked for as an ordinary MP4 (ftyp, moov, mdat - the index
// first, so it opens and shares anywhere), copying the frames as they are:
// no re-encoding, like `ffmpeg -c copy`. The clip starts on the last key
// frame at or before the start asked for.
//
//   new Mp4Clip.Indexer()         fed the recording's bytes as they come
//     .push(bytes)                (any sizes) - notes where each fragment
//     .fragments                  starts and when: [{ offset, size, time }]
//     .initEnd                    (time: the video's decode time, seconds);
//                                 initEnd: where ftyp+moov end
//   Mp4Clip.cut(init, frags, startSec, endSec) -> { bytes, start, end }
//     init: the ftyp+moov bytes; frags: the bytes of whole moof+mdat
//     fragments covering the stretch (from Indexer offsets)
//   Mp4Clip.pick(fragments, startSec, endSec) -> { from, to } byte range to read
// Works in a browser (window.Mp4Clip) and in Node (require) for tests.
(function (root) {
  "use strict";

  // ---- reading boxes ----
  function u32(b, o) { return ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3]; }
  function u64(b, o) { return u32(b, o) * 4294967296 + u32(b, o + 4); }
  function i32(b, o) { var v = u32(b, o); return v > 0x7fffffff ? v - 0x100000000 : v; }
  function type(b, o) { return String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]); }
  // boxes within [start, end): [{ type, start, end, body }] (body: where the content begins)
  function boxes(b, start, end) {
    var out = [], o = start;
    while (o + 8 <= end) {
      var size = u32(b, o), t = type(b, o + 4), head = 8;
      if (size === 1) { size = u64(b, o + 8); head = 16; }
      else if (size === 0) size = end - o;
      if (size < head || o + size > end) break;
      out.push({ type: t, start: o, end: o + size, body: o + head });
      o += size;
    }
    return out;
  }
  function child(b, box, t) { var list = boxes(b, box.body, box.end); for (var i = 0; i < list.length; i++) if (list[i].type === t) return list[i]; return null; }
  function path(b, box, types) { var x = box; for (var i = 0; i < types.length && x; i++) x = child(b, x, types[i]); return x; }

  // the movie's tracks, from ftyp+moov
  function readInit(b) {
    var top = boxes(b, 0, b.length), moov = null;
    top.forEach(function (x) { if (x.type === "moov") moov = x; });
    if (!moov) throw new Error("no moov");
    var tracks = [], trex = {};
    var mvex = child(b, moov, "mvex");
    if (mvex) boxes(b, mvex.body, mvex.end).forEach(function (x) {
      if (x.type !== "trex") return;
      var p = x.body + 4;
      trex[u32(b, p)] = { duration: u32(b, p + 8), size: u32(b, p + 12), flags: u32(b, p + 16) };
    });
    boxes(b, moov.body, moov.end).forEach(function (trak) {
      if (trak.type !== "trak") return;
      var tkhd = child(b, trak, "tkhd"), mdhd = path(b, trak, ["mdia", "mdhd"]), hdlr = path(b, trak, ["mdia", "hdlr"]);
      var stsd = path(b, trak, ["mdia", "minf", "stbl", "stsd"]);
      if (!tkhd || !mdhd || !hdlr || !stsd) return;
      var tv = b[tkhd.body], id = u32(b, tkhd.body + (tv === 1 ? 20 : 12));
      var mv = b[mdhd.body], timescale = u32(b, mdhd.body + (mv === 1 ? 20 : 12));
      var handler = type(b, hdlr.body + 8);
      var w = 0, h = 0;
      var wh = tkhd.body + (tv === 1 ? 88 : 76);
      if (wh + 8 <= tkhd.end) { w = u32(b, wh) / 65536; h = u32(b, wh + 4) / 65536; }
      tracks.push({ id: id, handler: handler, timescale: timescale, stsd: b.slice(stsd.start, stsd.end), width: w, height: h, trex: trex[id] || { duration: 0, size: 0, flags: 0 } });
    });
    return tracks;
  }

  // a moof+mdat: each track's samples { dts, duration, size, flags, cts, data }
  function readFragment(b, moofStart, moofEnd, tracksById, want) {
    var moof = { start: moofStart, end: moofEnd, body: moofStart + 8 };
    var out = {};
    boxes(b, moof.body, moof.end).forEach(function (traf) {
      if (traf.type !== "traf") return;
      var tfhd = child(b, traf, "tfhd");
      if (!tfhd) return;
      var tf = u32(b, tfhd.body) & 0xffffff, p = tfhd.body + 4;
      var id = u32(b, p); p += 4;
      var track = tracksById[id];
      if (!track) return;
      var base = moofStart; // (default-base-is-moof, and MediaRecorder's way)
      if (tf & 0x1) { p += 8; }
      if (tf & 0x2) p += 4;
      var defDur = track.trex.duration, defSize = track.trex.size, defFlags = track.trex.flags;
      if (tf & 0x8) { defDur = u32(b, p); p += 4; }
      if (tf & 0x10) { defSize = u32(b, p); p += 4; }
      if (tf & 0x20) { defFlags = u32(b, p); p += 4; }
      var tfdt = child(b, traf, "tfdt"), dts = 0;
      if (tfdt) dts = b[tfdt.body] === 1 ? u64(b, tfdt.body + 4) : u32(b, tfdt.body + 4);
      var samples = out[id] || (out[id] = []);
      boxes(b, traf.body, traf.end).forEach(function (trun) {
        if (trun.type !== "trun") return;
        var ver = b[trun.body], fl = u32(b, trun.body) & 0xffffff, q = trun.body + 4;
        var count = u32(b, q); q += 4;
        var dataOffset = 0;
        if (fl & 0x1) { dataOffset = i32(b, q); q += 4; }
        var firstFlags = null;
        if (fl & 0x4) { firstFlags = u32(b, q); q += 4; }
        var off = base + dataOffset;
        for (var i = 0; i < count; i++) {
          var dur = defDur, size = defSize, flags = i === 0 && firstFlags !== null ? firstFlags : defFlags, cts = 0;
          if (fl & 0x100) { dur = u32(b, q); q += 4; }
          if (fl & 0x200) { size = u32(b, q); q += 4; }
          if (fl & 0x400) { flags = u32(b, q); q += 4; if (i === 0 && firstFlags !== null) flags = firstFlags; }
          if (fl & 0x800) { cts = ver === 0 ? u32(b, q) : i32(b, q); q += 4; }
          var s = { dts: dts, duration: dur, size: size, sync: !(flags & 0x10000), cts: cts };
          if (want) s.data = b.subarray(off, off + size);
          samples.push(s);
          dts += dur;
          off += size;
        }
      });
    });
    return out;
  }

  // ---- the indexer: fed the recording as it comes ----
  function Indexer() {
    this.pos = 0;          // where the next top-level box starts
    this.tail = null;      // bytes from pos on, not yet looked at
    this.skip = 0;         // bytes of a big box (mdat) still to pass
    this.initEnd = 0;      // where ftyp+moov end (the first moof's offset)
    this.init = null;      // the ftyp+moov bytes
    this.tracks = null;
    this.videoId = null;
    this.fragments = [];   // { offset, size, time } - the video's decode time at its start (seconds)
    this.received = 0;
    this._head = [];       // ftyp+moov bytes, gathered until the first moof
  }
  Indexer.prototype.push = function (bytes) {
    bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    this.received += bytes.length;
    if (!this.tracks) this._head.push(bytes);
    if (this.skip) {
      if (bytes.length <= this.skip) { this.skip -= bytes.length; return; }
      bytes = bytes.subarray(this.skip);
      this.skip = 0;
    }
    var buf = this.tail ? concat([this.tail, bytes]) : bytes, o = 0;
    while (buf.length - o >= 8) {
      var size = u32(buf, o), t = type(buf, o + 4), head = 8;
      if (size === 1) { if (buf.length - o < 16) break; size = u64(buf, o + 8); head = 16; }
      if (size < head) throw new Error("bad box");
      if (t === "moof" || t === "moov" || t === "ftyp") {
        if (buf.length - o < size) break; // (wait for the whole box)
        if (t === "moof") {
          if (!this.tracks) this._readInit(this.pos);
          var frag = readFragment(buf.subarray(o, o + size), 0, size, this._byId, false);
          var v = frag[this.videoId] || [];
          var track = this._byId[this.videoId];
          var start = v.length ? v[0].dts / track.timescale : (this.fragments.length ? this.fragments[this.fragments.length - 1].time : 0);
          this.fragments.push({ offset: this.pos, size: size, time: start, sync: v.length ? v[0].sync : false });
        }
        o += size; this.pos += size;
        continue;
      }
      // mdat (or anything else): its size is enough - its bytes go by
      if (t === "mdat" && this.fragments.length) this.fragments[this.fragments.length - 1].size += size;
      if (buf.length - o >= size) { o += size; this.pos += size; continue; }
      this.skip = size - (buf.length - o);
      this.pos += size;
      o = buf.length;
    }
    this.tail = o < buf.length ? buf.slice(o) : null;
  };
  Indexer.prototype._readInit = function (end) {
    var all = concat(this._head).subarray(0, end);
    this.init = all.slice(0, end);
    this.initEnd = end;
    this._head = null;
    this.tracks = readInit(this.init);
    this._byId = {};
    var self = this;
    this.tracks.forEach(function (t) { self._byId[t.id] = t; if (t.handler === "vide" && self.videoId === null) self.videoId = t.id; });
    if (this.videoId === null && this.tracks.length) this.videoId = this.tracks[0].id;
  };
  // the recording's length so far (seconds) - the last fragment's start
  Indexer.prototype.duration = function () { return this.fragments.length ? this.fragments[this.fragments.length - 1].time : 0; };

  // which bytes to read for [startSec, endSec]: from the last fragment
  // starting on a key frame at or before the start, to the end of the
  // last fragment starting before the end
  // (a recording whose fragments don't start on key frames: never read from
  // further back than a minute - cut() then starts on a key frame inside)
  function pick(fragments, startSec, endSec) {
    if (!fragments.length) return null;
    var keyed = -1, any = 0, last = -1;
    for (var i = 0; i < fragments.length; i++) {
      if (fragments[i].time <= startSec + 0.001) { any = i; if (fragments[i].sync) keyed = i; }
      if (fragments[i].time < endSec) last = i;
    }
    var first = keyed;
    if (first < 0 || startSec - fragments[first].time > 60) {
      first = any;
      for (var k = any; k >= 0 && startSec - fragments[k].time <= 10; k--) first = k;
    }
    if (last < first) last = first;
    return { from: fragments[first].offset, to: fragments[last].offset + fragments[last].size, first: first, last: last };
  }

  // ---- cutting: the samples in [startSec, endSec] -> an ordinary MP4 ----
  function cut(initBytes, fragBytes, startSec, endSec) {
    var init = initBytes instanceof Uint8Array ? initBytes : new Uint8Array(initBytes);
    var b = fragBytes instanceof Uint8Array ? fragBytes : new Uint8Array(fragBytes);
    var tracks = readInit(init), byId = {};
    tracks.forEach(function (t) { byId[t.id] = t; t.samples = []; });
    boxes(b, 0, b.length).forEach(function (x) {
      if (x.type !== "moof") return;
      var frag = readFragment(b, x.start, x.end, byId, true);
      Object.keys(frag).forEach(function (id) { Array.prototype.push.apply(byId[id].samples, frag[id]); });
    });
    var video = tracks.filter(function (t) { return t.handler === "vide"; })[0] || tracks[0];
    if (!video || !video.samples.length) throw new Error("no video in that stretch");
    // the video: from the last key frame at or before the start
    // (no key frame at or before the start in what was read: the first one after it)
    var vs = video.samples, from = -1;
    for (var i = 0; i < vs.length; i++) { if (vs[i].sync && vs[i].dts / video.timescale <= startSec + 0.001) from = i; }
    if (from < 0) for (var j = 0; j < vs.length; j++) { if (vs[j].sync) { from = j; break; } }
    if (from < 0) throw new Error("no key frame in that stretch");
    var t0 = vs[from].dts / video.timescale;
    var keep = [];
    tracks.forEach(function (t) {
      var list = t.samples.filter(function (s, k) {
        var sec = s.dts / t.timescale;
        if (t === video) return k >= from && sec < endSec;
        return sec >= t0 - 0.0001 && sec < endSec;
      });
      if (list.length) keep.push({ track: t, samples: list });
    });
    var startAt = t0, endAt = 0;
    keep.forEach(function (k) { var s = k.samples[k.samples.length - 1]; endAt = Math.max(endAt, (s.dts + s.duration) / k.track.timescale); });
    return { bytes: writeMp4(keep, t0), start: startAt, end: endAt };
  }

  // ---- writing an ordinary MP4 ----
  function concat(list) {
    var n = 0; list.forEach(function (a) { n += a.length; });
    var out = new Uint8Array(n), o = 0;
    list.forEach(function (a) { out.set(a, o); o += a.length; });
    return out;
  }
  function be32(v) { return [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]; }
  function str(s) { return [s.charCodeAt(0), s.charCodeAt(1), s.charCodeAt(2), s.charCodeAt(3)]; }
  function box(t, parts) {
    var body = concat(parts.map(function (p) { return p instanceof Uint8Array ? p : new Uint8Array(p); }));
    return concat([new Uint8Array(be32(body.length + 8).concat(str(t))), body]);
  }
  function full(t, version, flags, parts) { return box(t, [new Uint8Array([version, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255])].concat(parts)); }
  var MATRIX = [].concat(be32(0x10000), be32(0), be32(0), be32(0), be32(0x10000), be32(0), be32(0), be32(0), be32(0x40000000));
  function writeMp4(keep, t0) {
    var MOVIE_TS = 1000, trakBoxes = [], mdatParts = [], chunkOffsetPatches = [], movieDur = 0;
    keep.forEach(function (k, n) {
      var t = k.track, s = k.samples, ts = t.timescale;
      var base = s[0].dts;
      var dur = 0; s.forEach(function (x) { dur += x.duration; });
      var movieTrackDur = Math.round(dur / ts * MOVIE_TS);
      movieDur = Math.max(movieDur, movieTrackDur);
      // stts: runs of equal durations
      var stts = [], last = null;
      s.forEach(function (x) { if (last && last[1] === x.duration) last[0]++; else { last = [1, x.duration]; stts.push(last); } });
      var anyCts = s.some(function (x) { return x.cts !== 0; }), negCts = s.some(function (x) { return x.cts < 0; });
      var ctts = [], lc = null;
      if (anyCts) s.forEach(function (x) { if (lc && lc[1] === x.cts) lc[0]++; else { lc = [1, x.cts]; ctts.push(lc); } });
      var allSync = s.every(function (x) { return x.sync; });
      var stssList = []; if (!allSync) s.forEach(function (x, i) { if (x.sync) stssList.push(i + 1); });
      var bytes = 0; s.forEach(function (x) { bytes += x.size; });
      var stbl = box("stbl", [
        t.stsd,
        full("stts", 0, 0, [new Uint8Array(be32(stts.length))].concat(stts.map(function (r) { return new Uint8Array(be32(r[0]).concat(be32(r[1]))); }))),
        anyCts ? full("ctts", negCts ? 1 : 0, 0, [new Uint8Array(be32(ctts.length))].concat(ctts.map(function (r) { return new Uint8Array(be32(r[0]).concat(be32(r[1] >>> 0))); }))) : new Uint8Array(0),
        allSync ? new Uint8Array(0) : full("stss", 0, 0, [new Uint8Array(be32(stssList.length))].concat(stssList.map(function (v) { return new Uint8Array(be32(v)); }))),
        full("stsc", 0, 0, [new Uint8Array(be32(1).concat(be32(1), be32(s.length), be32(1)))]),
        full("stsz", 0, 0, [new Uint8Array(be32(0).concat(be32(s.length)))].concat(s.map(function (x) { return new Uint8Array(be32(x.size)); }))),
        full("stco", 0, 0, [new Uint8Array(be32(1).concat(be32(0)))])
      ]);
      var vide = t.handler === "vide";
      var minf = box("minf", [
        vide ? full("vmhd", 0, 1, [new Uint8Array(8)]) : full("smhd", 0, 0, [new Uint8Array(4)]),
        box("dinf", [full("dref", 0, 0, [new Uint8Array(be32(1)), full("url ", 0, 1, [])])]),
        stbl
      ]);
      var mdia = box("mdia", [
        full("mdhd", 0, 0, [new Uint8Array([].concat(be32(0), be32(0), be32(ts), be32(dur), [0x55, 0xc4, 0, 0]))]),
        full("hdlr", 0, 0, [new Uint8Array([].concat(be32(0), str(t.handler), be32(0), be32(0), be32(0), [80, 77, 67, 0]))]),
        minf
      ]);
      var tkhd = full("tkhd", 0, 3, [new Uint8Array([].concat(be32(0), be32(0), be32(n + 1), be32(0), be32(movieTrackDur), be32(0), be32(0), [0, 0, 0, 0], [vide ? 0 : 1, 0, 0, 0], MATRIX, be32(Math.round(t.width * 65536)), be32(Math.round(t.height * 65536))))]);
      // the first frame shown at its composition time (B-frames): an edit list
      var first = s[0].cts;
      var edts = vide && first > 0 ? box("edts", [full("elst", 0, 0, [new Uint8Array([].concat(be32(1), be32(movieTrackDur), be32(first), [0, 1, 0, 0]))])]) : new Uint8Array(0);
      trakBoxes.push({ box: box("trak", [tkhd, edts, mdia]), bytes: bytes });
      mdatParts.push(s.map(function (x) { return x.data; }));
    });
    var ftyp = box("ftyp", [new Uint8Array([].concat(str("isom"), be32(0x200), str("isom"), str("iso2"), str("avc1"), str("mp41")))]);
    var mvhd = full("mvhd", 0, 0, [new Uint8Array([].concat(be32(0), be32(0), be32(MOVIE_TS), be32(movieDur), be32(0x10000), [1, 0], [0, 0], be32(0), be32(0), MATRIX, be32(0), be32(0), be32(0), be32(0), be32(0), be32(0), be32(keep.length + 1)))]);
    var moov = box("moov", [mvhd].concat(trakBoxes.map(function (x) { return x.box; })));
    // the chunk offsets: each track's samples one after the other in mdat
    var mdatBody = 0; trakBoxes.forEach(function (x) { mdatBody += x.bytes; });
    var mdatHead = mdatBody + 8 > 0xffffffff ? 16 : 8;
    var offset = ftyp.length + moov.length + mdatHead;
    var found = 0;
    for (var i = 0; i + 8 <= moov.length; i++) {
      if (moov[i + 4] === 0x73 && moov[i + 5] === 0x74 && moov[i + 6] === 0x63 && moov[i + 7] === 0x6f && u32(moov, i) === 20) { // "stco", 20 bytes
        moov.set(be32(offset), i + 16);
        offset += trakBoxes[found].bytes;
        found++;
      }
    }
    var mdatHeader = mdatHead === 8 ? new Uint8Array(be32(mdatBody + 8).concat(str("mdat"))) : new Uint8Array(be32(1).concat(str("mdat"), be32(Math.floor((mdatBody + 16) / 4294967296)), be32((mdatBody + 16) >>> 0)));
    var parts = [ftyp, moov, mdatHeader];
    mdatParts.forEach(function (list) { list.forEach(function (d) { parts.push(d); }); });
    return concat(parts);
  }

  var api = { Indexer: Indexer, pick: pick, cut: cut, readInit: readInit };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Mp4Clip = api;
})(typeof window !== "undefined" ? window : this);
