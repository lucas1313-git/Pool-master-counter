// The pool day (js/lib/pool-day.js): 5 a.m. to 5 a.m., local time.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../../js/lib/pool-day.js");
const at = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi || 0);

test("a night's last rack at 4:59 a.m. belongs to the evening before", () => {
  assert.equal(P.localDateStrFromTs(at(2026, 10, 30, 4, 59).getTime()), "2026-10-29");
});
test("5:00 a.m. starts the new pool day", () => {
  assert.equal(P.localDateStrFromTs(at(2026, 10, 30, 5, 0).getTime()), "2026-10-30");
});
test("an ISO timestamp string is read in local time too", () => {
  assert.equal(P.localDateStrFromTs(at(2026, 10, 29, 23, 30).toISOString()), "2026-10-29");
});
test("a night across the end of the month stays in the month it started", () => {
  assert.equal(P.localDateStrFromTs(at(2026, 11, 1, 2, 0).getTime()), "2026-10-31");
});
test("a night across New Year stays in the old year", () => {
  assert.equal(P.localDateStrFromTs(at(2027, 1, 1, 3, 0).getTime()), "2026-12-31");
});
test("months and days are zero-padded", () => {
  assert.equal(P.localDateStrFromTs(at(2026, 3, 7, 12).getTime()), "2026-03-07");
});
test("poolDayStart: in the afternoon, 5 a.m. today", () => {
  assert.deepEqual(P.poolDayStart(at(2026, 10, 29, 15)), at(2026, 10, 29, 5));
});
test("poolDayStart: at 2 a.m., 5 a.m. yesterday", () => {
  assert.deepEqual(P.poolDayStart(at(2026, 10, 30, 2)), at(2026, 10, 29, 5));
});
test("periodStartDate today = the pool day's start", () => {
  assert.deepEqual(P.periodStartDate("today", at(2026, 10, 30, 1)), at(2026, 10, 29, 5));
});
test("periodStartDate week = the last 7 pool days, today included", () => {
  assert.deepEqual(P.periodStartDate("week", at(2026, 10, 29, 20)), at(2026, 10, 23, 5));
});
test("periodStartDate month = the last 30 pool days", () => {
  assert.deepEqual(P.periodStartDate("month", at(2026, 10, 29, 20)), at(2026, 9, 30, 5));
});
test("periodStartDate year = the 1st of January; all time = no start", () => {
  assert.deepEqual(P.periodStartDate("year", at(2026, 10, 29, 20)), at(2026, 1, 1, 0));
  assert.equal(P.periodStartDate("all", at(2026, 10, 29, 20)), null);
});
