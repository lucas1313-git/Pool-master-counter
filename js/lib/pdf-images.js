// js/lib/pdf-images.js
// A PDF made of pictures, one per page (2026-11-19, the leaderboard's 📤 player report: "generate a
// exportable document that I could share"). The app draws each page on a canvas - its own fonts,
// emoji and every language as the device shows them - and this wraps the JPEGs into a plain PDF, no
// library: a catalog, the pages, and per page a content stream drawing its picture full-page.
// imagesToPdf([{ jpeg: Uint8Array, width, height }], { title, pageWidth, pageHeight }) -> Uint8Array
// (A4 in points by default).
(function (root) {
  "use strict";

  var A4_WIDTH = 595.28;
  var A4_HEIGHT = 841.89;

  function ascii(s) {
    var out = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
    return out;
  }

  // a text string any reader shows in every language: UTF-16BE with its byte order mark, in hex
  function pdfText(s) {
    var hex = "FEFF";
    for (var i = 0; i < s.length; i++) hex += ("000" + s.charCodeAt(i).toString(16).toUpperCase()).slice(-4);
    return "<" + hex + ">";
  }

  function num(n) {
    return String(Math.round(n * 100) / 100);
  }

  function imagesToPdf(pages, opts) {
    opts = opts || {};
    var pw = opts.pageWidth || A4_WIDTH;
    var ph = opts.pageHeight || A4_HEIGHT;
    var chunks = [];
    var length = 0;
    var offsets = [];
    var push = function (bytes) {
      chunks.push(bytes);
      length += bytes.length;
    };
    var object = function (id, parts) {
      offsets[id] = length;
      push(ascii(id + " 0 obj\n"));
      parts.forEach(function (p) {
        push(typeof p === "string" ? ascii(p) : p);
      });
      push(ascii("\nendobj\n"));
    };
    // 1 catalog, 2 pages, 3 info, then 3 per page: the page, its content, its picture
    var kids = pages.map(function (p, i) {
      return 4 + i * 3 + " 0 R";
    });
    push(ascii("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n"));
    object(1, ["<< /Type /Catalog /Pages 2 0 R >>"]);
    object(2, ["<< /Type /Pages /Kids [" + kids.join(" ") + "] /Count " + pages.length + " >>"]);
    object(3, ["<< /Producer " + pdfText("Pool Master Counter") + (opts.title ? " /Title " + pdfText(opts.title) : "") + " >>"]);
    pages.forEach(function (p, i) {
      var id = 4 + i * 3;
      var draw = "q " + num(pw) + " 0 0 " + num(ph) + " 0 0 cm /Im0 Do Q";
      object(id, ["<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + num(pw) + " " + num(ph) + "] /Resources << /XObject << /Im0 " + (id + 2) + " 0 R >> >> /Contents " + (id + 1) + " 0 R >>"]);
      object(id + 1, ["<< /Length " + draw.length + " >>\nstream\n" + draw + "\nendstream"]);
      object(id + 2, ["<< /Type /XObject /Subtype /Image /Width " + p.width + " /Height " + p.height + " /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length " + p.jpeg.length + " >>\nstream\n", p.jpeg, "\nendstream"]);
    });
    var count = 4 + pages.length * 3;
    var xref = length;
    var table = "xref\n0 " + count + "\n0000000000 65535 f \n";
    for (var id = 1; id < count; id++) table += ("000000000" + offsets[id]).slice(-10) + " 00000 n \n";
    push(ascii(table + "trailer\n<< /Size " + count + " /Root 1 0 R /Info 3 0 R >>\nstartxref\n" + xref + "\n%%EOF\n"));
    var out = new Uint8Array(length);
    var at = 0;
    chunks.forEach(function (c) {
      out.set(c, at);
      at += c.length;
    });
    return out;
  }

  // a canvas's picture as JPEG bytes (quality 0-1)
  function canvasJpeg(canvas, quality) {
    var d = canvas.toDataURL("image/jpeg", quality || 0.9);
    var bin = atob(d.slice(d.indexOf(",") + 1));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { jpeg: bytes, width: canvas.width, height: canvas.height };
  }

  var api = { imagesToPdf: imagesToPdf, canvasJpeg: canvasJpeg, pdfText: pdfText, A4_WIDTH: A4_WIDTH, A4_HEIGHT: A4_HEIGHT };
  root.PMCLib = root.PMCLib || {};
  root.PMCLib.pdfImages = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
