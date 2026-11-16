// js/lib/day-races.js
// A day's races, to reset one (2026-11-16, the user: "i need to be able to reset a race to in
// particular in a particular day. by example, i need to reset the last race to as it was not
// rightly recorded"): the day's racks put back together into the races they were played in -
// which racks, the race to, how it ended (won, ⏹ stopped, or never finished), the score.
// A rack saved since then carries its race (raceId - see currentRaceId in js/app.js): exact. An
// older one is placed by the score kept with it (raceTally: each seated player's wins in the race
// just after it): it goes on the race its score follows on from; one whose score can't be a race's
// first rack (someone already past 0 but the winner at 1) never starts one - a rack edited or
// deleted since left the scores after it out of step, and that was still the same race; a race
// ends at its winning (or stopped) rack; a rack of open play (no race) ends any race still going.
// Pieces still apart: joined by hand (🔗 - the same raceId written on all their racks).
// Pure: no page, no storage - js/app.js calls it through PMCLib.dayRaces, the unit tests in Node.
(function (root) {
  "use strict";

  function key(n) { return String(n || "").replace(/\s+/g, " ").trim().toLowerCase(); }
  function isRaceRack(g) { return (g.raceTarget || 1) > 1 || !!g.timedSession; }
  function endOf(g) { return g.raceInterrupted ? "stopped" : g.wonRace ? "won" : null; }

  // How well a rack's score follows on from a race's: 0 it doesn't (someone's wins jump or go
  // back), 1 it could (nobody in it has played this race yet), 2 it does (and someone has);
  // null: the rack kept no score.
  function follows(last, g) {
    var t = g.raceTally;
    if (!t || typeof t !== "object") return null;
    var winners = (g.winnerNames || []).map(key), known = false, ok = true;
    Object.keys(t).forEach(function (n) {
      var k = key(n), before = last[k];
      if (before !== undefined) known = true;
      if (t[n] !== (before || 0) + (winners.indexOf(k) !== -1 ? 1 : 0)) ok = false;
    });
    return ok ? (known ? 2 : 1) : 0;
  }
  // A race's first rack: the winners at 1, everyone else at 0 (no score kept: can't tell - yes)
  function couldStart(g) {
    var t = g.raceTally;
    if (!t || typeof t !== "object") return true;
    var winners = (g.winnerNames || []).map(key);
    return Object.keys(t).every(function (n) { return t[n] === (winners.indexOf(key(n)) !== -1 ? 1 : 0); });
  }
  // how many of the rack's players have played the race
  function knownIn(last, g) {
    return Object.keys(g.raceTally || {}).filter(function (n) { return last[key(n)] !== undefined; }).length;
  }
  function note(race, g) {
    race.racks.push(g);
    if (g.raceTally && typeof g.raceTally === "object") {
      Object.keys(g.raceTally).forEach(function (n) { race.last[key(n)] = g.raceTally[n]; });
    }
    if (isRaceRack(g)) race.raceTo = g.raceTarget || race.raceTo;
    var end = endOf(g);
    if (end) { race.end = end; race.closed = true; }
  }

  // racks: the day's racks, once each, any order - as the app keeps them: { ts, winnerNames,
  //   opponentNames (the losing side), isTeam, raceTarget, wonRace, raceInterrupted, raceTally,
  //   raceId, timedSession, timedMinutes, gameLabel }.
  // -> [{ racks[] (oldest first), raceTo, timedMinutes, from, to (ts), end "won" | "stopped" |
  //   null, winners[] (when won), sides [{ names[], wins }] (the most wins first) }], oldest first.
  // Racks of open play (no race) are in none - unless a race carried on from them (its raceId).
  function races(racks) {
    var sorted = (racks || []).filter(function (g) { return g && g.ts && g.winnerNames; }).slice().sort(function (a, b) { return a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0; });
    var out = [];
    // racks saved with their race: by it
    var byId = {};
    sorted.forEach(function (g) {
      if (!g.raceId) return;
      var r = byId[g.raceId];
      if (!r) { r = byId[g.raceId] = { racks: [], last: {}, raceTo: null, end: null, closed: false }; out.push(r); }
      note(r, g);
    });
    out = out.filter(function (r) { return r.racks.some(isRaceRack); });
    // older racks: by their score
    var open = [];
    sorted.forEach(function (g) {
      if (g.raceId) return;
      if (!isRaceRack(g)) {
        open.forEach(function (r) { r.closed = true; });
        open = [];
        return;
      }
      var into = null;
      if (g.raceTally) {
        // the newest race it follows on from (one it only could: a new race - two new
        // players are a race of their own, a second race at once, or the next race)
        for (var i = open.length - 1; i >= 0 && !into; i--) if (follows(open[i].last, g) === 2) into = open[i];
        // ...or two races that turn out to be one (all new players had come in - Winner Stays'
        // "max in a row" - and now someone from before is back)
        for (var a = open.length - 1; a >= 0 && !into; a--) {
          for (var b = a - 1; b >= 0 && !into; b--) {
            var both = Object.assign({}, open[b].last, open[a].last);
            if (follows(both, g) === 2 && follows(open[a].last, g) === 0 && follows(open[b].last, g) === 0) {
              open[b].racks = open[b].racks.concat(open[a].racks).sort(function (x, y) { return x.ts < y.ts ? -1 : 1; });
              open[b].last = both;
              out.splice(out.indexOf(open[a]), 1);
              open.splice(a, 1);
              into = open[b];
            }
          }
        }
      } else {
        // (no score kept: the race going on, if it's the same race to)
        var newest = open[open.length - 1];
        if (newest && (newest.raceTo === g.raceTarget || !g.raceTarget)) into = newest;
      }
      // (a score that can't start a race: the race going on it has most players of - the newest)
      if (!into && open.length && !couldStart(g)) {
        into = open[open.length - 1];
        open.forEach(function (r) { if (knownIn(r.last, g) > knownIn(into.last, g)) into = r; });
      }
      if (!into) {
        into = { racks: [], last: {}, raceTo: null, end: null, closed: false };
        open.push(into);
        out.push(into);
      }
      note(into, g);
      if (into.closed) open.splice(open.indexOf(into), 1);
    });
    out.sort(function (x, y) { return x.racks[0].ts < y.racks[0].ts ? -1 : 1; });
    return out.map(function (r) {
      var lastRack = r.racks[r.racks.length - 1];
      // each side's racks won in the race
      var sides = {};
      r.racks.forEach(function (g) {
        [g.winnerNames || [], g.opponentNames || []].forEach(function (names, i) {
          // (a free-for-all's losers are each a side of their own)
          var groups = i === 0 || g.isTeam ? [names] : names.map(function (n) { return [n]; });
          groups.forEach(function (group) {
            if (!group.length) return;
            var k = group.map(key).sort().join("+");
            if (!sides[k]) sides[k] = { names: group.slice(), wins: 0, firstSeen: g.ts };
            if (i === 0) sides[k].wins += 1;
          });
        });
      });
      return {
        racks: r.racks,
        raceTo: r.raceTo || lastRack.raceTarget || null,
        timedMinutes: lastRack.timedSession ? lastRack.timedMinutes || null : null,
        from: r.racks[0].ts,
        to: lastRack.ts,
        // (how its last rack left it - a race joined by hand ends where the later piece did)
        end: endOf(lastRack),
        winners: endOf(lastRack) && lastRack.wonRace ? (lastRack.winnerNames || []).slice() : [],
        sides: Object.keys(sides).map(function (k) { return sides[k]; }).sort(function (x, y) { return y.wins - x.wins || (x.firstSeen < y.firstSeen ? -1 : 1); }).map(function (s) { return { names: s.names, wins: s.wins }; })
      };
    });
  }

  var api = { races: races, follows: follows };
  root.PMCLib = root.PMCLib || {};
  root.PMCLib.dayRaces = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
