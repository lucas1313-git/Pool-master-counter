// js/lib/brackets.js
// Elimination brackets: the standard seed order, matches, the winners' and losers' bracket rounds 
// (byes to the top seeds, the losers' bracket template), pairing names up, and where a bracket 
// stands.
// Pure: no page, no storage, no app state - js/app.js calls it through
// PMCLib.brackets (loaded before it), and the unit tests (tests/unit/) load it in Node.
// Moved out of js/app.js as it was (P29).
(function (root) {
  "use strict";

  // (the same match ids as js/app.js's uid(): the date, the second, a random tail)
  function uid() {
    var now = new Date();
    return now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0") + "-" + Math.floor(now.getTime() / 1000) + "-" + Math.random().toString(36).slice(2, 6);
  }

  function nextPow2(n) {
    var p = 1;
    while (p < n) p *= 2;
    return p;
  }

  // Standard tournament seeding order (1v4/2v3 for a 4-bracket, 1v8/4v5/
  // 2v7/3v6 for an 8-bracket, etc.) — used so byes land spread across the
  // draw instead of clustered together.
  function seedOrder(size) {
    if (size === 1) return [1];
    var prev = seedOrder(size / 2);
    var result = [];
    prev.forEach(function (s) {
      result.push(s);
      result.push(size + 1 - s);
    });
    return result;
  }

  // feederA/feederB (optional) are the specific match objects whose
  // winner became this match's .a/.b - only ever set for losers-bracket
  // matches (see pairUpNames), so the losers bracket can be drawn as a
  // real connected tree instead of flat labeled columns. Winners-bracket
  // matches don't need this: their feeders are always computable from
  // position alone, t.wb[ri-1][mi*2] and [mi*2+1] - the second one just
  // won't exist for a pendingBye match (see buildWinnersBracketRounds),
  // which only ever has the one.
  function createBracketMatch(a, b, tag, feederA, feederB) {
    return {
      id: uid(),
      a: a || null,
      b: b || null,
      winner: null,
      loser: null,
      // The final race tally, stamped by reportBracketResult once the
      // match ends - relative to a/b (not winner/loser), so it stays
      // meaningful regardless of who won. null until then. This is the
      // only permanent record of an exact score anywhere in the app -
      // state.gameHistory logs individual rack wins, not a match total.
      scoreA: null,
      scoreB: null,
      tag: tag,
      collected: false,
      feederA: feederA || null,
      feederB: feederB || null,
      table: null
    };
  }

  // Pairs up consecutive { name, feeder } entries (feeder is the match
  // that produced that name, or null if it has none - e.g. round robin
  // never uses this) into new matches, stamping each with where its two
  // sides actually came from. leftover carries its own feeder through
  // too, so it's never lost if this name has to wait another round
  // before finally getting paired.
  function pairUpNames(entries, tag) {
    var matches = [];
    var i = 0;
    while (i + 1 < entries.length) {
      matches.push(createBracketMatch(entries[i].name, entries[i + 1].name, tag, entries[i].feeder, entries[i + 1].feeder));
      i += 2;
    }
    var leftover = i < entries.length ? [entries[i]] : [];
    return { matches: matches, leftover: leftover };
  }

  function wbRoundComplete(t, ri) {
    return t.wb[ri].every(function (m) {
      return m.winner !== null;
    });
  }

  function pendingLbMatches(t) {
    var out = [];
    t.lbRounds.forEach(function (rnd) {
      rnd.forEach(function (m) {
        if (m.a !== null && m.b !== null && m.winner === null) out.push(m);
      });
    });
    return out;
  }

  // Shuffles the field (or takes the organizer's / the ratings' order) and
  // builds the winners bracket the standard way: a power-of-two draw, so the
  // byes it needs (the next power of two minus the players) all fall in
  // round 1, at most one each - to the top seeds, placed by seedOrder so
  // seed 1 and seed 2 can only meet in the final. Every later round is full.
  // (Before, rounds were sized to the players left, which let one player's
  // bye be followed by more free passes - a walk into the final.)
  // seededOrder (optional): a real 1..N ranking (getTournamentSeeds) instead
  // of the random draw. pairAdjacent: "Match Similar Ratings" - seededOrder
  // is strongest first and neighbours play each other in round 1 (the
  // strongest face off at once, as that mode promises), the byes going to
  // the lowest-rated; the winners of neighbouring matches meet next.
  function buildWinnersBracketRounds(playerNames, seededOrder, pairAdjacent) {
    var shuffled;
    if (seededOrder) {
      shuffled = seededOrder.slice();
    } else {
      shuffled = playerNames.slice();
      for (var i = shuffled.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var tmp = shuffled[i];
        shuffled[i] = shuffled[j];
        shuffled[j] = tmp;
      }
    }
    var n = shuffled.length;
    var size = nextPow2(Math.max(2, n));
    var byes = size - n;
    var slots = [];
    if (pairAdjacent) {
      var playing = shuffled.slice(0, n - byes);
      playing.forEach(function (name) {
        slots.push(name);
      });
      shuffled.slice(n - byes).forEach(function (name) {
        slots.push(name, null);
      });
    } else {
      seedOrder(size).forEach(function (seed) {
        slots.push(seed <= n ? shuffled[seed - 1] : null);
      });
    }

    var wb = [];
    var r1 = [];
    for (var k = 0; k < slots.length; k += 2) {
      r1.push(createBracketMatch(slots[k], slots[k + 1], "Winners R1"));
    }
    wb.push(r1);
    while (wb[wb.length - 1].length > 1) {
      var cur = [];
      for (var m = 0; m < wb[wb.length - 1].length; m += 2) {
        cur.push(createBracketMatch(null, null, "Winners R" + (wb.length + 1)));
      }
      wb.push(cur);
    }
    // a bye resolves at once: its one player goes through
    wb[0].forEach(function (match) {
      if ((match.a === null) !== (match.b === null)) {
        match.winner = match.a !== null ? match.a : match.b;
        match.loser = null;
      }
    });
    return { shuffled: shuffled, size: size, wb: wb };
  }

  // The losers bracket of a double elimination, laid out in full from the
  // start (the standard template): round 1 pairs the winners-round-1 losers;
  // then, for each later winners round, one round where its losers drop in
  // against the losers-bracket survivors, and one where the survivors play
  // each other - down to the losers final (against the winners final's
  // loser). Drop-ins come in reversed, then half-swapped, alternately, so
  // nobody meets the player who just beat them, and everyone's path is
  // known ("if you lose, you go to..."). The longest path is the standard
  // 2 x (rounds - 1) matches. Slots a round-1 bye leaves empty are worked
  // out here and taken out: a match with one real side passes that side
  // straight on, one with none disappears.
  // Each match keeps where its two sides come from (srcA/srcB: a winners
  // match's loser, or a losers match's winner) - advanceBracketV2 fills them
  // in - and feederA/feederB point at those matches (by id) for drawing.
  function buildLosersBracketRounds(wb) {
    var EMPTY = null;
    // (only round 1 has byes - a later winners match always has a loser)
    function wbLoser(match, firstRound) {
      return firstRound && (match.a === null || match.b === null) ? EMPTY : { kind: "wbLoser", match: match };
    }
    function dropOrder(list, dropRound) {
      if (list.length < 2) return list.slice();
      if (dropRound % 2 === 1) return list.slice().reverse();
      var half = list.length / 2;
      return list.slice(half).concat(list.slice(0, half));
    }
    // a source through any taken-out match: what it really carries
    function through(src) {
      while (src && src.kind === "lbWinner" && src.match.passThrough !== undefined) src = src.match.passThrough;
      return src;
    }
    var rounds = [];
    if (wb.length < 2) return rounds;
    var first = [];
    for (var i = 0; i < wb[0].length; i += 2) first.push({ srcA: wbLoser(wb[0][i], true), srcB: wbLoser(wb[0][i + 1], true) });
    rounds.push(first);
    for (var r = 1; r < wb.length; r++) {
      var drops = dropOrder(wb[r], r);
      var minor = rounds[rounds.length - 1].map(function (prev, idx) {
        return { srcA: { kind: "lbWinner", match: prev }, srcB: wbLoser(drops[idx], false) };
      });
      rounds.push(minor);
      if (r < wb.length - 1) {
        var major = [];
        for (var q = 0; q < minor.length; q += 2) major.push({ srcA: { kind: "lbWinner", match: minor[q] }, srcB: { kind: "lbWinner", match: minor[q + 1] } });
        rounds.push(major);
      }
    }
    // take out the matches a bye leaves empty or one-sided, round by round
    var kept = [];
    rounds.forEach(function (round) {
      var real = [];
      round.forEach(function (m) {
        m.srcA = through(m.srcA);
        m.srcB = through(m.srcB);
        if (!m.srcA || !m.srcB) {
          m.passThrough = m.srcA || m.srcB || EMPTY;
          return;
        }
        real.push(m);
      });
      if (real.length) kept.push(real);
    });
    return kept.map(function (round, ri) {
      return round.map(function (m) {
        var match = createBracketMatch(null, null, "Losers R" + (ri + 1));
        m.built = match;
        return match;
      });
    }).map(function (round, ri) {
      kept[ri].forEach(function (m, mi) {
        var match = round[mi];
        ["A", "B"].forEach(function (side) {
          var src = m["src" + side];
          var from = src.kind === "wbLoser" ? src.match : src.match.built;
          match["src" + side] = { kind: src.kind, id: from.id };
          match["feeder" + side] = { id: from.id, tag: from.tag };
        });
      });
      return round;
    });
  }

  // Only single/double elimination tournaments ever have a grandFinal
  // array at all - round robin and swiss can never have a "grand final"
  // match by definition, so treat a missing grandFinal as "no", not a
  // crash (this used to throw for every non-elimination format).
  function isGrandFinalMatch(t, match) {
    return !!t.grandFinal && t.grandFinal.indexOf(match) !== -1;
  }

  var api = {
    nextPow2: nextPow2,
    seedOrder: seedOrder,
    createBracketMatch: createBracketMatch,
    buildWinnersBracketRounds: buildWinnersBracketRounds,
    buildLosersBracketRounds: buildLosersBracketRounds,
    pairUpNames: pairUpNames,
    wbRoundComplete: wbRoundComplete,
    pendingLbMatches: pendingLbMatches,
    isGrandFinalMatch: isGrandFinalMatch
  };
  root.PMCLib = root.PMCLib || {};
  root.PMCLib.brackets = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
