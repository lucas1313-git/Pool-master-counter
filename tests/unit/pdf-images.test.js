// js/lib/pdf-images.js - a PDF of pictures, one per page (the leaderboard's 📤 player report). The
// bytes stand in for JPEGs here: what's checked is the PDF around them - every object where the
// cross-reference table says, each picture whole, the page count, the title in any language.
// tests/probe_leaderboard_report.js opens a real one.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../../js/lib/pdf-images.js");

const latin1 = (bytes) => Buffer.from(bytes).toString("latin1");
const fake = (n, fill) => ({ jpeg: new Uint8Array(n).fill(fill), width: 1240, height: 1754 });

test("two pages: header, objects where the xref says, trailer, %%EOF", () => {
  const pdf = P.imagesToPdf([fake(500, 0x41), fake(300, 0x42)], { title: "Luc Martin" });
  const s = latin1(pdf);
  assert.ok(s.startsWith("%PDF-1.4\n"));
  assert.ok(s.endsWith("%%EOF\n"));
  const startxref = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(s)[1]);
  assert.ok(s.slice(startxref).startsWith("xref\n0 10\n"));
  const rows = s.slice(startxref).split("\n").slice(3, 12);
  rows.forEach((row, i) => {
    assert.match(row, /^\d{10} 00000 n $/);
    assert.ok(s.slice(Number(row.slice(0, 10))).startsWith(i + 1 + " 0 obj\n"), "object " + (i + 1));
  });
  assert.match(s, /\/Type \/Pages \/Kids \[4 0 R 7 0 R\] \/Count 2 >>/);
  assert.match(s, /trailer\n<< \/Size 10 \/Root 1 0 R \/Info 3 0 R >>/);
});

test("each picture whole, as long as it says, drawn over the whole A4 page", () => {
  const s = latin1(P.imagesToPdf([fake(500, 0x41), fake(300, 0x42)]));
  const a = /\/Width 1240 \/Height 1754 \/ColorSpace \/DeviceRGB \/BitsPerComponent 8 \/Filter \/DCTDecode \/Length 500 >>\nstream\n(A+)\nendstream/.exec(s);
  assert.ok(a && a[1].length === 500);
  const b = /\/Length 300 >>\nstream\n(B+)\nendstream/.exec(s);
  assert.ok(b && b[1].length === 300);
  assert.match(s, /\/MediaBox \[0 0 595.28 841.89\]/);
  const draw = /<< \/Length (\d+) >>\nstream\n(q 595.28 0 0 841.89 0 0 cm \/Im0 Do Q)\nendstream/.exec(s);
  assert.ok(draw && Number(draw[1]) === draw[2].length);
});

test("the title in any language: UTF-16 with its byte order mark", () => {
  assert.equal(P.pdfText("Aé"), "<FEFF004100E9>");
  const s = latin1(P.imagesToPdf([fake(10, 0)], { title: "陳大文 #1" }));
  assert.ok(s.includes("/Title " + P.pdfText("陳大文 #1")));
  assert.ok(s.includes("/Producer " + P.pdfText("Pool Master Counter")));
});
