// js/lib/pool-day.js
// The pool day: 5 a.m. to 5 a.m., so a night that runs past midnight is one day - its date, its 
// start, and the start of the stats periods (today, the last 7 / 30 days, 6 months, this year).
// Pure: no page, no storage, no app state - js/app.js calls it through
// PMCLib.poolDay (loaded before it), and the unit tests (tests/unit/) load it in Node.
// Moved out of js/app.js as it was (P29).
(function (root) {
  "use strict";

  // The "pool day" a moment belongs to: local time (never UTC - a UTC
  // slice reads as "tomorrow" for anyone west of UTC by the evening), and
  // a day runs from 5 a.m. to 5 a.m., so a night that goes past midnight
  // is still one night - its stats, its Day Report, its notes, its place
  // in the report archive (the camera's "new day" starts at 5 a.m. too).
  // Every date here goes through these two, and periodStartDate("today")
  // starts at the same 5 a.m.
  var POOL_DAY_START_HOUR = 5;

  function todayDateStr() {
    return localDateStrFromTs(new Date());
  }

  function localDateStrFromTs(ts) {
    var d = new Date(ts);
    if (d.getHours() < POOL_DAY_START_HOUR) d.setDate(d.getDate() - 1);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  // 5 a.m. of the pool day `now` is in.
  function poolDayStart(now) {
    var start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), POOL_DAY_START_HOUR);
    if (now < start) start.setDate(start.getDate() - 1);
    return start;
  }

  function periodStartDate(period, now) {
    now = now || new Date(); // (a fixed moment: tests)
    var dayStart = poolDayStart(now);
    if (period === "today") {
      return dayStart;
    }
    // Rolling windows, not calendar Monday/1st-of-month - "This Week"/
    // "This Month" (Player Stats, Leaderboard, All Players alike) mean
    // the last 7/30 days INCLUDING today, regardless of what day of the
    // week or month it currently is - so the window never shrinks to
    // almost nothing right after a Monday or the 1st. The "-6"/"-29" (not
    // "-7"/"-30") is what makes today count as one of the 7/30 days.
    if (period === "week") {
      return new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate() - 6, POOL_DAY_START_HOUR);
    }
    if (period === "month") {
      return new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate() - 29, POOL_DAY_START_HOUR);
    }
    if (period === "6month") {
      return new Date(now.getFullYear(), now.getMonth() - 6, now.getDate());
    }
    if (period === "year") {
      return new Date(now.getFullYear(), 0, 1);
    }
    return null;
  }

  var api = {
    POOL_DAY_START_HOUR: POOL_DAY_START_HOUR,
    todayDateStr: todayDateStr,
    localDateStrFromTs: localDateStrFromTs,
    poolDayStart: poolDayStart,
    periodStartDate: periodStartDate
  };
  root.PMCLib = root.PMCLib || {};
  root.PMCLib.poolDay = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
