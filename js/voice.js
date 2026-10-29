// Voice commands - hold to talk, English sentences.
//
// Hold the 🎤 Talk button on the score section (or the number pad's "."
// key), say one sentence, let go. A tap on the button shows the sentences. The browser's own speech
// recognition (Chrome sends the sound to Google, so it needs internet)
// turns it into text; this file turns the text into a command and hands
// it to the scoreboard (window.PMCVoiceBridge in js/app.js), which does
// what its own buttons and number pad do.
//
// Only while the button/key is held is the microphone open - the earlier
// always-listening version (removed 2026-10-02, b997e00b) heard the room
// and the app's own sounds.
//
// The sentences are fixed, listed in SHEET below - the same list the
// "Voice commands" sheet shows, so the sheet and what's understood never
// drift apart. tests/test_voice_parser.js runs the parser in Node.
(function (root) {
  "use strict";

  // ---------------------------------------------------------------------
  // The key sentences (the sheet). English on purpose - the voice is
  // English only for now; titles and notes follow the app's language.
  // ---------------------------------------------------------------------
  var SHEET = [
    { title: "voice.section.game", note: "voice.note.game", lines: [
      "Play 8-ball", "Now playing straight pool", "Play 9-ball race to 5", "Race to 7", "Target 100 points"
    ] },
    { title: "voice.section.rotation", note: "voice.note.rotation", lines: [
      "Rotation 8-ball and 9-ball", "Add 10-ball to the rotation", "Remove 9-ball from the rotation",
      "Change game every 2 games", "Rotation on", "Single game", "Clear the rotation"
    ] },
    { title: "voice.section.players", note: "voice.note.players", lines: [
      "Add Luigi to the session", "Luigi is playing", "Luigi is standby", "Luigi plays against Luc"
    ] },
    { title: "voice.section.teams", note: "voice.note.teams", lines: [
      "Luigi and Luc against Bob and Chris", "Luigi and Luc are team A against Bob and Chris as team B"
    ] },
    { title: "voice.section.scoring", note: "voice.note.scoring", lines: [
      "Add one point to Luc", "Add 3 points to Luigi", "Take one point from Luc", "Add one point",
      "Luigi wins the game with 5 balls left on the table", "5 balls left", "Nice game", "Undo", "Yes / No"
    ] },
    { title: "voice.section.session", note: "voice.note.session", lines: [
      "Set session, race to 5, rotate every 2, players are Luigi, Luc, Bob and Chris, Luigi and Luc are playing",
      "Set session, race to 7, rotation 8-ball and 9-ball, players are Luigi and Luc"
    ] },
    { title: "voice.section.recording", note: "voice.note.recording", lines: [
      "Mark", "Finish", "Auto cue"
    ] },
    { title: "voice.section.questions", note: "voice.note.questions", lines: [
      "What is Luigi's Q-score today?", "What's the score?", "Help"
    ] }
  ];

  // ---------------------------------------------------------------------
  // Text -> words: lower case, no punctuation, numbers as digits
  // ---------------------------------------------------------------------
  var SMALL = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
  var TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

  function has(obj, key) { return Object.prototype.hasOwnProperty.call(obj, key); }

  function readTens(words, j) {
    var w = words[j];
    if (has(TENS, w)) {
      var u = words[j + 1];
      if (u && has(SMALL, u) && SMALL[u] > 0 && SMALL[u] < 10) return { value: TENS[w] + SMALL[u], next: j + 2 };
      return { value: TENS[w], next: j + 1 };
    }
    if (has(SMALL, w)) return { value: SMALL[w], next: j + 1 };
    return null;
  }

  // "five" -> 5, "twenty five" -> 25, "a hundred" / "one hundred and fifty" -> 100 / 150
  function readNumber(words, i) {
    var w = words[i];
    var lead = w === "a" ? 1 : has(SMALL, w) && SMALL[w] > 0 && SMALL[w] < 10 ? SMALL[w] : /^[1-9]$/.test(w || "") ? parseInt(w, 10) : null;
    if (lead !== null && words[i + 1] === "hundred") {
      var value = lead * 100, j = i + 2;
      if (words[j] === "and" && (has(TENS, words[j + 1]) || has(SMALL, words[j + 1]))) j++;
      var rest = readTens(words, j);
      if (rest) { value += rest.value; j = rest.next; }
      return { value: value, next: j };
    }
    if (w === "hundred") return { value: 100, next: i + 1 };
    return readTens(words, i);
  }

  function baseNormalize(text) {
    var s = String(text || "").toLowerCase();
    if (s.normalize) s = s.normalize("NFD").replace(/[̀-ͯ]/g, "");
    s = s.replace(/[‘’`]/g, "'");
    s = s.replace(/\b(what|that|it|there|who|where|how|let|he|she)'s\b/g, "$1s"); // what's -> whats
    s = s.replace(/([a-z0-9])'s\b/g, "$1 s");   // luigi's -> luigi s
    s = s.replace(/'/g, "");                      // what's -> whats
    s = s.replace(/(\d)\.(\d)/g, "$1 $2");        // 14.1 -> 14 1
    s = s.replace(/&/g, " and ").replace(/\+/g, " plus ");
    s = s.replace(/[^a-z0-9 ]+/g, " ");           // hyphens, commas, ?
    s = s.replace(/(\d)(balls?)\b/g, "$1 $2");    // 8ball -> 8 ball
    var words = s.split(/\s+/).filter(Boolean), out = [];
    for (var i = 0; i < words.length;) {
      var r = readNumber(words, i);
      if (r) { out.push(String(r.value)); i = r.next; } else { out.push(words[i]); i++; }
    }
    return out.join(" ");
  }

  // ---------------------------------------------------------------------
  // Game names -> "g_<id>" tokens
  // ---------------------------------------------------------------------
  var BASE_GAME_ALIASES = {
    "8ballrotation": ["8 ball rotation"],
    "8ballpunishment": ["8 ball punishment"],
    "15ballrotation": ["15 ball rotation", "15 ball"],
    "8ball": ["8 ball", "eightball", "8 bowl"],
    "9ball": ["9 ball", "nineball", "9 bowl"],
    "10ball": ["10 ball", "tenball", "10 bowl"],
    straight: ["straight pool", "14 1 continuous", "14 1", "straight"],
    onepocket: ["1 pocket", "onepocket"],
    snooker: ["snooker"],
    custom: ["custom game"]
  };

  function gameAliasList(gameTypes) {
    var list = [], seen = {};
    function add(alias, id) {
      alias = baseNormalize(alias);
      if (!alias || seen[alias]) return;
      seen[alias] = true;
      list.push({ alias: alias, id: id });
    }
    Object.keys(BASE_GAME_ALIASES).forEach(function (id) {
      BASE_GAME_ALIASES[id].forEach(function (a) { add(a, id); });
    });
    (gameTypes || []).forEach(function (t) { if (t && t.id && t.label) add(t.label, t.id); });
    list.sort(function (a, b) { return b.alias.length - a.alias.length; });
    return list;
  }

  function tokenizeGames(s, gameTypes) {
    var padded = " " + s + " ";
    gameAliasList(gameTypes).forEach(function (g) {
      var re = new RegExp(" " + g.alias.replace(/ /g, " ") + "(?= )", "g");
      padded = padded.replace(re, " g_" + g.id.replace(/[^a-z0-9]/g, ""));
    });
    return padded.trim().replace(/\s+/g, " ");
  }

  function gamesIn(span, gameTypes) {
    var ids = [], m, re = /g_([a-z0-9]+)/g;
    while ((m = re.exec(span))) ids.push(gameIdFromToken(m[1], gameTypes));
    return ids;
  }
  function gameIdFromToken(token, gameTypes) {
    var hit = (gameTypes || []).filter(function (t) { return t.id.replace(/[^a-z0-9]/g, "") === token; })[0];
    return hit ? hit.id : token;
  }

  var FILLER_START = /^(?:ok|okay|hey|please|so|alright|all right|lets|let us|can you|could you|would you|i want to|we want to|i would like to|we would like to|we are|were|we re|i said|now)\s+(?=\S)/;
  var FILLER_END = /\s+(?:please|thanks|thank you)$/;

  function normalize(text, gameTypes) {
    var s = baseNormalize(text);
    s = (" " + s + " ").replace(/ (?:q|queue|cue|kyu|que|kew) ?scores? /g, " qscore ").trim();
    s = tokenizeGames(s, gameTypes);
    var before;
    do {
      before = s;
      s = s.replace(FILLER_START, "").replace(FILLER_END, "");
    } while (s !== before);
    return s.trim();
  }

  // ---------------------------------------------------------------------
  // Names: spans of words -> players
  // ---------------------------------------------------------------------
  function cleanSpan(span) {
    var s = " " + String(span || "") + " ";
    s = s.replace(/^ (?:the|player|mister|mr|mrs|ms|miss|to) /, " ");
    return s.trim();
  }

  function splitNames(span) {
    return String(span || "").split(/ and | with | plus /).map(cleanSpan).filter(Boolean);
  }

  function nameKey(s) {
    s = String(s || "").toLowerCase();
    if (s.normalize) s = s.normalize("NFD").replace(/[̀-ͯ]/g, "");
    return s.replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  }

  // A rough "sounds like" key - Luc/Luke -> "lk", Chris/Kris -> "krs".
  function soundKey(s) {
    s = nameKey(s).replace(/[^a-z]/g, "");
    if (!s) return "";
    s = s.replace(/^(?:kn|gn|pn|wr)/, function (m) { return m.charAt(1); })
      .replace(/x/g, "ks").replace(/ph/g, "f").replace(/chr/g, "kr").replace(/ck/g, "k")
      .replace(/sch/g, "sk").replace(/(?:ch|sh)/g, "x").replace(/c(?=[eiy])/g, "s").replace(/c/g, "k")
      .replace(/q/g, "k").replace(/dg(?=[eiy])/g, "j").replace(/gh/g, "").replace(/g(?=[eiy])/g, "j")
      .replace(/z/g, "s").replace(/y/g, "i");
    var first = s.charAt(0), rest = s.slice(1).replace(/[aeiouhw]/g, "");
    var code = (/[aeiou]/.test(first) ? "a" : first) + rest;
    return code.replace(/(.)\1+/g, "$1");
  }

  function editDistance(a, b) {
    var prev = [], cur, i, j;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) {
      cur = [i];
      for (j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1));
      }
      prev = cur;
    }
    return prev[b.length];
  }
  function closeness(a, b) {
    if (!a || !b) return 0;
    return 1 - editDistance(a, b) / Math.max(a.length, b.length);
  }

  function nameScore(span, candidate) {
    var s = nameKey(span), c = nameKey(candidate);
    if (!s || !c) return 0;
    if (s === c) return 1;
    var first = c.split(" ")[0];
    if (s === first) return 0.97;
    var best = Math.max(closeness(s, c), closeness(s, first) * 0.97);
    var ss = soundKey(s), sc = soundKey(c), sf = soundKey(first);
    if (ss && ss.length >= 2 && ss === sc) best = Math.max(best, 0.92);
    if (ss && ss.length >= 2 && ss === sf) best = Math.max(best, 0.9);
    return best;
  }

  var NAME_SURE = 0.75, NAME_MAYBE = 0.6;
  // never part of a new player's name - a sentence that didn't parse right
  var NOT_A_NAME = /\b(?:are|is|am|team|the|and|as|on|in|to|for|from|plays?|playing|against|with|game|games|points?|balls?|rack|wins?|won|standby|session|rotation)\b/;

  function titleCase(span) {
    return nameKey(span).split(" ").map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1); }).join(" ");
  }

  // -> { name } | { name, isNew: true } | { error: "unknown"|"ambiguous", span, options }
  function resolveName(span, candidates, allowNew) {
    var cleaned = cleanSpan(span);
    var tries = [cleaned];
    if (/ s$/.test(cleaned)) tries.push(cleaned.replace(/ s$/, ""));      // "luigi s" (possessive)
    if (/[a-z]s$/.test(cleaned)) tries.push(cleaned.replace(/s$/, ""));  // "luigis"
    var scored = {}, seen = {};
    (candidates || []).forEach(function (c) {
      var k = nameKey(c);
      if (!k || seen[k]) return;
      seen[k] = true;
      var best = 0;
      tries.forEach(function (t) { best = Math.max(best, nameScore(t, c)); });
      scored[c] = best;
    });
    var ranked = Object.keys(scored).sort(function (a, b) { return scored[b] - scored[a]; });
    var top = ranked[0], second = ranked[1];
    if (top && scored[top] >= NAME_SURE) {
      if (second && scored[second] >= NAME_SURE && scored[top] - scored[second] < 0.04 && scored[top] < 1) {
        return { error: "ambiguous", span: cleaned, options: [top, second] };
      }
      return { name: top };
    }
    if (top && scored[top] >= NAME_MAYBE) return { error: "ambiguous", span: cleaned, options: [top] };
    if (allowNew && /^[a-z][a-z ]*$/.test(nameKey(cleaned)) && nameKey(cleaned).split(" ").length <= 3 && !NOT_A_NAME.test(nameKey(cleaned))) {
      return { name: titleCase(cleaned), isNew: true };
    }
    return { error: "unknown", span: cleaned, options: [] };
  }

  // ---------------------------------------------------------------------
  // Sentences -> commands
  // ---------------------------------------------------------------------
  var NUM = "(\\d+|a|an)";
  function num(token) {
    if (token === undefined || token === null || token === "") return 1;
    if (token === "a" || token === "an") return 1;
    if (token === "no") return 0;
    return parseInt(token, 10);
  }
  function hasGame(span) { return /g_[a-z0-9]+/.test(span); }
  function hasDigit(span) { return /\d/.test(span); }
  function nameSpanOk(span) { return !!span && !hasGame(span) && !hasDigit(span) && !/\b(?:rotation|race|target|qscore|score)\b/.test(span); }

  function unitOf(word) {
    if (!word) return null;
    if (/^points?$/.test(word)) return "points";
    if (/^balls?$/.test(word)) return "balls";
    if (/^racks?$/.test(word)) return "rack";
    if (/^(?:games?|wins?)$/.test(word)) return "games";
    return null;
  }

  var VS_SEP = / (?:is playing against|are playing against|playing against|plays against|play against|against|versus|verses|vs|v) /;
  var TEAM_A_TAIL = / (?:(?:are|is|as|on|in)(?: the| a)? )?team(?: a)?$| (?:are|is) playing$| plays$| play$/;
  var TEAM_B_TAIL = / (?:(?:are|is|as|on|in)(?: the| a)? )?team(?: b)?$/;

  // Each rule: [regex, function(match, s) -> command or null]. First hit wins.
  var RULES = [
    // --- help, questions, the win window ---
    [/^(?:help|commands|voice commands|what can i say|show (?:me )?(?:the )?(?:voice )?(?:commands|sentences|sheet))$/, function () { return { type: "help" }; }],
    // --- a whole session in one sentence ---
    [/^(?:set|setup|set up|start|new)(?: up)?(?: the| a| new| our)? session\b(.*)$/, function (m, s, ctx) { return parseSession(m[1], ctx); }],
    // --- the recording page's cues ---
    [/^(?:mark|mark (?:it|that|this|the shot)|cue (?:it|that)|start (?:a |the )?(?:mark|cue|clip)|bookmark(?: (?:it|that|this))?)$/, function () { return { type: "recMark" }; }],
    [/^(?:finish|finish (?:it|that|the mark|the cue|the clip)|end (?:the )?(?:mark|cue|clip)|stop (?:the )?(?:mark|cue|clip)|cut(?: it| that)?)$/, function () { return { type: "recFinish" }; }],
    // (the camera finds the shot - "cue" is often heard as "q" or "queue")
    [/^(?:auto|automatic|smart|otto) (?:cue|q|queue|mark|clip)(?: (?:it|that|the shot|this shot))?$/, function () { return { type: "recAuto" }; }],
    [/^(?:(?:what is|whats|tell me|say|give me|read)(?: me)?(?: the)? )?scores?$/, function () { return { type: "score" }; }],
    [/^(?:nice|nice game|good game|confirm|register(?: the)? game|ok|okay|done|close|close it|thats it|great game)$/, function () { return { type: "confirmWin" }; }],
    [/^(?:undo|cancel|undo that|cancel that|take it back|undo the win|cancel the win)$/, function () { return { type: "undoWin" }; }],
    [/^(?:yes|yeah|yep|sure|correct|confirm it)$/, function () { return { type: "answer", yes: true }; }],
    [/^(?:no|nope|dont|do not)$/, function () { return { type: "answer", yes: false }; }],

    // --- Q-score ---
    [/^(?:(?:what is|whats|what|tell me|give me|how much is|say|read)(?: me)?(?: the)? )?(?:qscore|rating) (?:of|for) (.+?)(?: (?:today|for today|now|right now))?$/, function (m, s) {
      return nameSpanOk(m[1]) ? { type: "qscore", name: m[1], today: / today$/.test(s) } : null;
    }],
    [/^(?:(?:what is|whats|what|tell me|give me|how much is|say|read)(?: me)?(?: the)? )?(.+?) (?:qscore|rating)(?: (?:today|for today|now|right now))?$/, function (m, s) {
      return nameSpanOk(m[1]) ? { type: "qscore", name: m[1], today: / today$/.test(s) } : null;
    }],

    // --- balls left (the win window) ---
    [/^(?:with |and )?(\d+|no) (?:balls?|bowls?)(?: (?:left|remaining))?(?: (?:on|in) the table)?$/, function (m) {
      return { type: "ballsLeft", n: num(m[1]) };
    }],

    // --- a win: "luigi wins the game with 5 balls left on the table" ---
    [/^(.+?) (?:wins|won|win|takes|took|has won|is the winner)(?: the)?(?: (?:game|rack|match|frame))?(?: (?:with |and |leaving )?(\d+|no) (?:balls?|bowls?)(?: (?:left|remaining))?(?: (?:on|in) the table)?)?$/, function (m) {
      if (!nameSpanOk(m[1])) return null;
      return { type: "win", name: m[1], ballsLeft: m[2] === undefined ? null : num(m[2]) };
    }],

    // --- points ---
    [new RegExp("^(?:add|at|give|plus|put) " + NUM + " (points?|balls?) (?:to|for|2) (.+)$"), function (m) {
      return nameSpanOk(m[3]) ? { type: "points", n: num(m[1]), name: m[3] } : null;
    }],
    [new RegExp("^" + NUM + " (?:points?|balls?) (?:to|for) (.+)$"), function (m) {
      return nameSpanOk(m[2]) ? { type: "points", n: num(m[1]), name: m[2] } : null;
    }],
    [/^(?:points?|a point) (?:to|for) (.+)$/, function (m) {
      return nameSpanOk(m[1]) ? { type: "points", n: 1, name: m[1] } : null;
    }],
    [new RegExp("^(?:give|add) (.+?) " + NUM + " (?:points?|balls?)$"), function (m) {
      return nameSpanOk(m[1]) ? { type: "points", n: num(m[2]), name: m[1] } : null;
    }],
    [new RegExp("^(?:add|at|give|plus)(?: " + NUM + ")? (?:points?|balls?)$"), function (m) {
      return { type: "points", n: num(m[1]), name: null };
    }],
    [new RegExp("^(?:take away|take|remove|subtract|minus|deduct)(?: " + NUM + ")? (?:points?|balls?) (?:from|off|for|to) (.+)$"), function (m) {
      return nameSpanOk(m[2]) ? { type: "points", n: -num(m[1]), name: m[2] } : null;
    }],
    [new RegExp("^(?:take away|take|remove|subtract|minus|deduct)(?: " + NUM + ")? (?:points?|balls?)$"), function (m) {
      return { type: "points", n: -num(m[1]), name: null };
    }],
    [/^(?:plus|add) (\d+)$/, function (m) { return { type: "points", n: num(m[1]), name: null }; }],
    [/^minus (\d+)$/, function (m) { return { type: "points", n: -num(m[1]), name: null }; }],
    [/^(.+?) (plus|minus) (\d+)(?: (?:points?|balls?))?$/, function (m) {
      return nameSpanOk(m[1]) ? { type: "points", n: (m[2] === "minus" ? -1 : 1) * num(m[3]), name: m[1] } : null;
    }],

    // --- rotation ---
    [/^(?:clear|empty|reset|delete|erase|remove) (?:the |all the |all )?rotation(?: games)?$/, function () { return { type: "rotationClear" }; }],
    [/^(?:add|put|include) (.+?) (?:to|in|into|on|onto) (?:the )?rotation$/, function (m, s, ctx) {
      var games = gamesIn(m[1], ctx.gameTypes);
      return games.length ? { type: "rotationAdd", games: games } : null;
    }],
    [/^(?:remove|take out|take|delete|drop) (.+?) (?:from|out of|off|off of) (?:the )?rotation$/, function (m, s, ctx) {
      var games = gamesIn(m[1], ctx.gameTypes);
      return games.length ? { type: "rotationRemove", games: games } : null;
    }],
    [/^(?:(?:change|switch|rotate|next)(?: the)?(?: games?)? every|rotation every|every) (\d+)(?: (?:games?|racks?))?$/, function (m) {
      return { type: "rotationEvery", n: num(m[1]) };
    }],
    [/^(\d+) games? (?:each|per game|each game|per game type)$/, function (m) { return { type: "rotationEvery", n: num(m[1]) }; }],
    [/^(?:(?:set|make)(?: the| a)? rotation(?: to| with| of)?|(?:the )?rotation(?: is| will be| of| with| to)?|new rotation(?: of| with)?|rotate(?: between)?|game rotation(?: of| with)?) (.*g_.*)$/, function (m, s, ctx) {
      var games = gamesIn(m[1], ctx.gameTypes);
      return games.length ? { type: "rotationSet", games: games } : null;
    }],
    [/^(?:rotation on|(?:turn|switch|put) (?:the )?rotation on|(?:turn|switch|put) on (?:the )?rotation|rotation mode|use (?:the )?rotation|start (?:the )?rotation|game rotation|rotation)$/, function () {
      return { type: "rotationMode", on: true };
    }],
    [/^(?:rotation off|(?:turn|switch) (?:the )?rotation off|(?:turn|switch) off (?:the )?rotation|single game(?: mode)?|stop (?:the )?rotation|no rotation|single|one game)$/, function () {
      return { type: "rotationMode", on: false };
    }],

    // --- the game, the race, the target ---
    [/^(?:play|playing|plays|switch to|change to|change (?:the )?game to|set (?:the )?game to|(?:the )?game is|next game is|game|start|start a|new game|a game of|game of|its) (g_[a-z0-9]+)(?: (?:game|games))?(?: (race to|race 2|race|to|first to|target|target is) (\d+)(?: (points?|balls?|racks?|games?|wins?))?)?$/, function (m, s, ctx) {
      return gameCommand(m[1], m[2], m[3], m[4], ctx);
    }],
    [/^(g_[a-z0-9]+)(?: (race to|race 2|race|to|first to|target) (\d+)(?: (points?|balls?|racks?|games?|wins?))?)?$/, function (m, s, ctx) {
      return gameCommand(m[1], m[2], m[3], m[4], ctx);
    }],
    [/^(?:set (?:the )?race to|make it (?:a )?race to|change (?:the )?race to|its a race to|race to|race too|raced to|race 2|race) (\d+)(?: (points?|balls?|racks?|games?|wins?))?$/, function (m) {
      var u = unitOf(m[2]);
      return u === "points" || u === "balls" ? { type: "target", n: num(m[1]), unit: u } : { type: "race", n: num(m[1]) };
    }],
    [/^(?:set (?:the )?target(?: to)?|change (?:the )?target(?: to)?|target is|target|the target is|points to win) (\d+)(?: (points?|balls?|racks?))?$/, function (m) {
      return { type: "target", n: num(m[1]), unit: unitOf(m[2]) };
    }],
    [/^(?:play to|first to|go to|game to|up to|play up to) (\d+)(?: (points?|balls?|racks?|games?|wins?))?$/, function (m) {
      var u = unitOf(m[2]);
      if (u === "games") return { type: "race", n: num(m[1]) };
      if (u) return { type: "target", n: num(m[1]), unit: u };
      return { type: "raceOrTarget", n: num(m[1]) };
    }],

    // --- teams and match-ups ---
    [/^team a (.+?) (?:and )?team b (.+)$/, function (m) { return versusCommand(m[1], m[2]); }],
    [VS_SEP, function (m, s) {
      var i = s.search(VS_SEP), sep = s.match(VS_SEP)[0];
      return versusCommand(s.slice(0, i), s.slice(i + sep.length));
    }],

    // --- playing / standby ---
    [/^(?:put |set |move |bench |sit )?(.+?) (?:is on standby|are on standby|is standby|are standby|on standby|to standby|in standby|standby|stand by|is standing by|sits out|sits down|sits|sit out|sit down|is sitting out|are sitting out|is sitting|are sitting|is out|are out|is resting|are resting|rests|is benched|are benched|benched|takes a break|is taking a break)$/, function (m) {
      var names = splitNames(m[1]);
      return names.length && names.every(nameSpanOk) ? { type: "setPlaying", names: names, playing: false } : null;
    }],
    [/^(?:bench|sit out|rest) (.+)$/, function (m) {
      var names = splitNames(m[1]);
      return names.length && names.every(nameSpanOk) ? { type: "setPlaying", names: names, playing: false } : null;
    }],
    [/^(?:put |seat )?(.+?) (?:is playing|are playing|plays|play|is in|are in|is in the game|are in the game|in the game|joins|join|joins the game|to the table|at the table|is at the table|are at the table)$/, function (m) {
      var names = splitNames(m[1]);
      return names.length && names.every(nameSpanOk) ? { type: "setPlaying", names: names, playing: true } : null;
    }],

    // --- adding players ---
    [/^(?:add|welcome|new player|add player|add new player|add the player) (.+?)(?: (?:to|in|into|on) (?:the )?(?:session|game|list|roster|players|scoreboard|table|tonight|players list))?$/, function (m) {
      var names = splitNames(m[1]);
      return names.length && names.every(nameSpanOk) ? { type: "addPlayers", names: names } : null;
    }],

    // --- "luigi plays luc" ---
    [/^(.+?) (?:plays|play|vs|faces) (.+)$/, function (m) {
      return nameSpanOk(m[1]) && nameSpanOk(m[2]) ? versusCommand(m[1], m[2]) : null;
    }]
  ];

  // "Set session, race to 5, rotate every 2, players are Luigi Luc Bob and
  // Chris, Luigi and Luc are playing" - each part optional, in any order,
  // with or without commas (the recognizer rarely puts any): the parts with
  // a number or a game are taken out first, what's left is the players.
  function parseSession(rest, ctx) {
    var cmd = { type: "session" }, s = " " + String(rest || "").trim() + " ";
    var take = function (re, fn) { s = s.replace(re, function () { fn.apply(null, arguments); return " "; }); };
    take(/ (?:and )?(?:race to|race too|raced to|race 2|race) (\d+)(?: games?| racks?)?(?= )/, function (all, n) { cmd.race = num(n); });
    take(/ (?:and )?(?:(?:rotate|rotation|rotating|change(?: the)?(?: games?)?|switch(?: the)?(?: games?)?|next game) )?every (\d+)(?: games?| racks?)?(?= )/, function (all, n) { cmd.every = num(n); });
    take(/ (?:and )?(?:the )?(?:rotation(?: is| of)?|rotate between|games are) ((?:g_[a-z0-9]+ (?:and )?)+)/, function (all, g) { cmd.rotation = gamesIn(g, ctx.gameTypes); });
    take(/ (?:and )?(?:play|playing|the game is|game is|game) (g_[a-z0-9]+)(?= )/, function (all, g) { cmd.game = gameIdFromToken(g.slice(2), ctx.gameTypes); });
    s = s.replace(/\s+/g, " ").trim();
    var playingAtEnd = / (?:are|is) (?:playing|in)$| playing$/.test(" " + s);
    var m = (" " + s).match(/ (?:the )?players (?:are |is |will be )?(.*)$/);
    var text = m ? m[1] : s;
    text = text.replace(/ ?(?:(?:are|is) (?:playing|in)|playing)$/, "").trim();
    if (m) cmd.playersSaid = true;
    if (text && (m || playingAtEnd)) { cmd.namesText = text; cmd.playingSaid = playingAtEnd; }
    if (!cmd.race && !cmd.every && !cmd.rotation && !cmd.game && !cmd.namesText) return null;
    return cmd;
  }

  // A run of spoken names, no commas ("luigi luc bob and chris") -> the
  // names, by the players known: each one or two or three words that make a
  // name, best fit overall. Words that make nobody are kept as unknown.
  function segmentNames(text, pool) {
    var words = String(text || "").split(" ").filter(function (w) { return w && !/^(?:and|with|plus|also|then|too|the)$/.test(w); });
    var best = [{ score: 0, items: [] }];
    for (var i = 1; i <= words.length; i++) {
      best[i] = null;
      for (var len = 1; len <= 3 && len <= i; len++) {
        var prev = best[i - len];
        if (!prev) continue;
        var span = words.slice(i - len, i).join(" "), r = resolveName(span, pool, false);
        var score = prev.score + (r.name ? 2 - 0.01 * len : len === 1 ? -3 : -100);
        if (!best[i] || score > best[i].score) best[i] = { score: score, items: prev.items.concat([r.name ? { span: span, name: r.name } : { span: span, name: null, error: r }]) };
      }
    }
    return best[words.length] ? best[words.length].items : [];
  }

  function gameCommand(token, keyword, n, unitWord, ctx) {
    var cmd = { type: "game", game: gameIdFromToken(token.slice(2), ctx.gameTypes) };
    if (n !== undefined) {
      var u = unitOf(unitWord);
      cmd.n = num(n);
      if (u === "points" || u === "balls") { cmd.kind = "target"; cmd.unit = u; }
      else if (u === "games" || /^race/.test(keyword || "")) cmd.kind = "race";
      else if (keyword === "target" || keyword === "target is") { cmd.kind = "target"; cmd.unit = u; }
      else cmd.kind = "either";
    }
    return cmd;
  }

  function versusCommand(left, right) {
    left = String(left || "").replace(TEAM_A_TAIL, "").replace(/^team a /, "");
    right = String(right || "").replace(TEAM_B_TAIL, "").replace(/^(?:team b|the team of) /, "");
    var a = splitNames(left), b = splitNames(right);
    if (!a.length || !b.length || !a.concat(b).every(nameSpanOk)) return null;
    return { type: "versus", sides: [a, b] };
  }

  function parse(text, ctx) {
    ctx = ctx || {};
    var s = normalize(text, ctx.gameTypes);
    if (!s) return null;
    for (var i = 0; i < RULES.length; i++) {
      var m = s.match(RULES[i][0]);
      if (!m) continue;
      var cmd = RULES[i][1](m, s, ctx);
      if (cmd) { cmd.heard = s; return cmd; }
    }
    return null;
  }

  // ---------------------------------------------------------------------
  // Commands -> players resolved against the scoreboard's names
  // ---------------------------------------------------------------------
  function union() {
    var out = [], seen = {};
    Array.prototype.forEach.call(arguments, function (list) {
      (list || []).forEach(function (n) {
        var k = nameKey(n);
        if (k && !seen[k]) { seen[k] = true; out.push(n); }
      });
    });
    return out;
  }

  // -> { cmd } with names filled in, or { error }
  function resolve(cmd, ctx) {
    // nicknames (the Contact Sheet's) answer for their player
    var nicks = {}, nickNames = [];
    (ctx.nicknames || []).forEach(function (x) { if (x && x.nick && x.name) { nicks[nameKey(x.nick)] = x.name; nickNames.push(x.nick); } });
    var real = function (n) { return n && nicks[nameKey(n)] ? nicks[nameKey(n)] : n; };
    var session = ctx.sessionNames || [], playing = ctx.playingNames || [];
    var everyone = union(session, ctx.knownNames, nickNames);
    var out = JSON.parse(JSON.stringify(cmd)), err = null;
    function one(span, pool, allowNew) {
      var r = resolveName(span, union(pool, nickNames), allowNew);
      if (r.error && !err) err = r;
      return real(r.name) || null;
    }
    function many(spans, pool, allowNew) { return spans.map(function (s) { return one(s, pool, allowNew); }); }
    switch (cmd.type) {
      case "points":
      case "win":
        if (cmd.name) out.name = one(cmd.name, union(playing, session), false);
        break;
      case "qscore":
        out.name = one(cmd.name, union(session, ctx.knownNames, ctx.ratedNames), false);
        break;
      case "setPlaying":
        out.names = many(cmd.names, cmd.playing ? everyone : session, !!cmd.playing);
        break;
      case "addPlayers":
        out.names = many(cmd.names, everyone, true);
        break;
      case "session":
        if (cmd.namesText) {
          var seg = segmentNames(cmd.namesText, everyone);
          var bad = seg.filter(function (x) { return !x.name; })[0];
          if (bad || !seg.length) { err = bad ? (bad.error.error ? bad.error : { error: "unknown", span: bad.span, options: [] }) : { error: "unknown", span: cmd.namesText, options: [] }; break; }
          var names = seg.map(function (x) { return real(x.name); });
          // a name said a second time starts the "are playing" part
          var k = -1;
          names.forEach(function (n, i) { if (k === -1 && names.slice(0, i).some(function (q) { return nameKey(q) === nameKey(n); })) k = i; });
          if (cmd.playersSaid) {
            out.players = k === -1 ? names : names.slice(0, k);
            out.playing = k !== -1 ? names.slice(k) : cmd.playingSaid ? names.slice() : null;
          } else {
            out.players = null;
            out.playing = names;
          }
          delete out.namesText;
        }
        break;
      case "versus":
        out.sides = [many(cmd.sides[0], everyone, true), many(cmd.sides[1], everyone, true)];
        if (!err) {
          var all = out.sides[0].concat(out.sides[1]).map(nameKey);
          if (all.some(function (k, i) { return all.indexOf(k) !== i; })) err = { error: "twice", span: "" };
        }
        break;
    }
    return err ? { error: err } : { cmd: out };
  }

  // Tries each of the recognizer's alternatives in turn.
  // -> { cmd } | { error, heard } | { none: true, heard }
  function understand(alternatives, ctx) {
    var firstError = null;
    for (var i = 0; i < alternatives.length; i++) {
      var cmd = parse(alternatives[i], ctx);
      if (!cmd) continue;
      var r = resolve(cmd, ctx);
      if (r.cmd) return { cmd: r.cmd, heard: alternatives[i] };
      if (!firstError) firstError = { error: r.error, heard: alternatives[i] };
    }
    return firstError || { none: true, heard: alternatives[0] || "" };
  }

  var api = { SHEET: SHEET, segmentNames: segmentNames, normalize: normalize, parse: parse, resolve: resolve, resolveName: resolveName, understand: understand, soundKey: soundKey };
  root.PMCVoiceParser = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;

  if (typeof document === "undefined") return;

  // =====================================================================
  // In the page: hold to talk, the live line, the sheet
  // =====================================================================
  var Recognition = root.SpeechRecognition || root.webkitSpeechRecognition || null;
  var HOLD_KEY_CODE = "NumpadDecimal";
  var MAX_HOLD_MS = 20000;

  var rec = null, listening = false, ended = false, pressedAt = 0, source = null, finals = [], interim = "", lastError = null;
  var finishTimer = null, maxTimer = null, liveHideTimer = null, session = 0;

  function bridge() { return root.PMCVoiceBridge || null; }
  function t(key, vars) { var b = bridge(); return b ? b.t(key, vars) : key; }
  function el(id) { return document.getElementById(id); }

  function isNativeApp() {
    return !!(root.Capacitor && typeof root.Capacitor.isNativePlatform === "function" && root.Capacitor.isNativePlatform());
  }
  function supported() { return !!Recognition && !isNativeApp(); }

  function showLive(text, state) {
    var live = el("voice-live");
    if (!live) return;
    clearTimeout(liveHideTimer);
    live.textContent = text;
    live.className = "voice-live" + (state ? " " + state : "");
  }
  function hideLive(afterMs) {
    var live = el("voice-live");
    if (!live) return;
    clearTimeout(liveHideTimer);
    liveHideTimer = setTimeout(function () { live.className = "voice-live hidden"; }, afterMs || 0);
  }
  function setButtonListening(on) {
    var btn = el("btn-voice-hold");
    if (btn) btn.classList.toggle("listening", !!on);
  }

  // from: "button" | "key"
  function start(from) {
    if (listening) return;
    if (!supported()) return;
    if (rec) { try { rec.abort(); } catch (e) {} rec = null; }
    clearTimeout(finishTimer);
    var my = ++session;
    finals = []; interim = ""; lastError = null; ended = false;
    try { if (root.speechSynthesis) root.speechSynthesis.cancel(); } catch (e) {}
    var r;
    try {
      r = new Recognition();
      r.lang = "en-US";
      r.continuous = true;
      r.interimResults = true;
      r.maxAlternatives = 5;
    } catch (e) { return; }
    r.onresult = function (e) {
      if (my !== session) return;
      interim = "";
      for (var i = e.resultIndex; i < e.results.length; i++) {
        var res = e.results[i];
        if (res.isFinal) {
          var alts = [];
          for (var k = 0; k < res.length; k++) alts.push(res[k].transcript);
          finals.push(alts);
        } else {
          interim += res[0].transcript;
        }
      }
      var shown = finals.map(function (a) { return a[0]; }).join(" ") + (interim ? " " + interim : "");
      showLive("🎤 " + shown.trim(), "listening");
    };
    r.onerror = function (e) { if (my === session) lastError = e && e.error; };
    // (the recognizer can end by itself - silence, no network - before
    // the button is let go; the result is handled on letting go)
    r.onend = function () {
      if (my !== session) return;
      ended = true;
      if (!listening) finish(my);
    };
    rec = r;
    try { r.start(); } catch (e) { rec = null; return; }
    listening = true;
    source = from || "key";
    pressedAt = Date.now();
    setButtonListening(true);
    showLive("🎤 " + t("voice.listening"), "listening");
    clearTimeout(maxTimer);
    maxTimer = setTimeout(stop, MAX_HOLD_MS);
  }

  function stop() {
    if (!listening) return;
    listening = false;
    clearTimeout(maxTimer);
    setButtonListening(false);
    var my = session;
    if (Date.now() - pressedAt < 250 && !finals.length) {
      // a tap, not a hold: the button's shows the sentences
      session++;
      try { rec.abort(); } catch (e) {}
      rec = null;
      if (source === "button") { hideLive(0); openSheet(); return; }
      showLive(t("voice.holdHint"), "hint");
      hideLive(2500);
      return;
    }
    if (ended) { finish(my); return; }
    showLive("🎤 …", "working");
    try { rec.stop(); } catch (e) {}
    // the final words can arrive a moment after letting go
    finishTimer = setTimeout(function () { finish(my); }, 3000);
  }

  function finish(my) {
    if (my !== session || listening) return;
    session++;
    clearTimeout(finishTimer);
    rec = null;
    var alternatives = [];
    if (finals.length === 1) alternatives = finals[0].slice();
    else if (finals.length > 1) alternatives = [finals.map(function (a) { return a[0]; }).join(" ")];
    if (!alternatives.length && interim) alternatives = [interim];
    alternatives = alternatives.map(function (a) { return String(a || "").trim(); }).filter(Boolean);
    if (!alternatives.length) {
      var key = lastError === "not-allowed" || lastError === "service-not-allowed" ? "voice.err.micBlocked"
        : lastError === "network" ? "voice.err.needsInternet"
        : lastError === "audio-capture" ? "voice.err.noMic"
        : "voice.err.heardNothing";
      report({ ok: false, text: t(key) });
      hideLive(0);
      return;
    }
    handleAlternatives(alternatives);
  }

  // remote: from a Siri Shortcut - Siri speaks the answer, not the page
  function report(result, remote) {
    var b = bridge();
    if (!b || !result) return;
    if (result.text) b.toast(result.text, "🎤 ");
    if (result.ok === false) b.missSound();
    if (remote) return;
    if (result.text && result.speak === "always") b.speak(result.text, true);
    else if (result.text && result.speak === "ifOn") b.speak(result.text, false);
  }

  function errorText(err) {
    var e = err.error || {};
    if (e.error === "ambiguous" && e.options.length > 1) return t("voice.err.whichName", { name: e.span, a: e.options[0], b: e.options[1] });
    if (e.error === "ambiguous") return t("voice.err.didYouMean", { name: e.span, a: e.options[0] });
    if (e.error === "twice") return t("voice.err.twice");
    return t("voice.err.unknownName", { name: e.span });
  }

  // The whole path from what was heard to what happened - also what the
  // tests call (PMCVoice.handleText), skipping the microphone.
  function handleAlternatives(alternatives, opts) {
    var remote = !!(opts && opts.remote);
    var b = bridge();
    if (!b) return null;
    var ctx = b.context();
    var u = understand(alternatives, ctx);
    showLive("🎤 “" + (u.heard || alternatives[0]) + "”", u.cmd ? "heard" : "missed");
    hideLive(2500);
    var result;
    if (u.none) result = { ok: false, text: t("voice.err.notUnderstood", { text: u.heard }) };
    else if (u.error) result = { ok: false, text: errorText(u) };
    else if (u.cmd.type === "help") { openSheet(); result = { ok: true, text: null }; }
    else result = b.execute(u.cmd) || { ok: false, text: null };
    report(result, remote);
    return { heard: u.heard, cmd: u.cmd || null, result: result };
  }

  // ---- Siri: sentences from the computer's server (server/voice-relay.js) ----
  // What Siri says back: the same words as the toast, without the symbols.
  function speakable(text) {
    return String(text || "")
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, "")
      .replace(/\s*\u2192\s*/g, ", now ")
      .replace(/(^|\s)\+(\d)/g, "$1plus $2")
      .replace(/(^|\s)-(\d)/g, "$1minus $2")
      .replace(/[\u201C\u201D"]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }
  function speechFor(out) {
    if (!out) return "The scoreboard isn't ready yet.";
    var r = out.result || {};
    if (out.cmd && out.cmd.type === "help") return "The sentences are on the scoreboard's screen.";
    if (r.text) return speakable(r.text);
    return r.ok === false ? "Sorry, that didn't work." : "Done.";
  }

  function post(path, data) {
    try {
      fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data), keepalive: true }).catch(function () {});
    } catch (e) {}
  }

  // Only where the page comes from the computer's own server (not the iOS
  // app, not a plain file); anywhere else /voice/events isn't there and
  // the EventSource just gives up.
  function connectRemote() {
    if (!root.EventSource || isNativeApp() || !/^https?:$/.test(location.protocol)) return;
    var client = null, lastUsedSent = 0, es;
    try { es = new EventSource("voice/events"); } catch (e) { return; }
    function reportActive(used) {
      if (client) post("voice/active", { client: client, visible: document.visibilityState === "visible", used: !!used });
    }
    es.addEventListener("hello", function (e) {
      try { client = JSON.parse(e.data).client; } catch (err) {}
      reportActive(false);
    });
    es.addEventListener("command", function (e) {
      var m;
      try { m = JSON.parse(e.data); } catch (err) { return; }
      var out = handleAlternatives([String(m.text || "")], { remote: true });
      post("voice/result", { id: m.id, ok: !!(out && out.result && out.result.ok !== false), speech: speechFor(out) });
    });
    document.addEventListener("visibilitychange", function () { reportActive(false); });
    // the scoreboard being used: it's the one Siri talks to
    ["pointerdown", "keydown"].forEach(function (type) {
      document.addEventListener(type, function () {
        var now = Date.now();
        if (now - lastUsedSent < 5000) return;
        lastUsedSent = now;
        reportActive(true);
      }, true);
    });
  }

  // ---- the sheet ----
  function buildSheet() {
    var body = el("voice-sheet-body");
    if (!body) return;
    body.innerHTML = "";
    var intro = document.createElement("p");
    intro.className = "help-intro";
    intro.textContent = t("voice.sheetIntro");
    body.appendChild(intro);
    SHEET.forEach(function (section) {
      var wrap = document.createElement("section");
      wrap.className = "voice-sheet-section";
      var h = document.createElement("h3");
      h.textContent = t(section.title);
      wrap.appendChild(h);
      var note = document.createElement("p");
      note.className = "voice-sheet-note";
      note.textContent = t(section.note);
      wrap.appendChild(note);
      var ul = document.createElement("ul");
      ul.className = "voice-sheet-lines";
      section.lines.forEach(function (line) {
        var li = document.createElement("li");
        li.textContent = "“" + line + "”";
        ul.appendChild(li);
      });
      wrap.appendChild(ul);
      body.appendChild(wrap);
    });
    if (/^https?:$/.test(location.protocol) && !isNativeApp()) body.appendChild(buildSiriSection());
  }

  // How to make the Siri Shortcut, with this computer's address in it.
  function buildSiriSection() {
    var wrap = document.createElement("section");
    wrap.className = "voice-sheet-section voice-sheet-siri hidden"; // (shown once the server answers)
    var h = document.createElement("h3");
    h.textContent = t("voice.section.siri");
    wrap.appendChild(h);
    var intro = document.createElement("p");
    intro.className = "voice-sheet-note";
    intro.textContent = t("voice.siri.intro");
    wrap.appendChild(intro);
    var ol = document.createElement("ol");
    ol.className = "voice-sheet-lines voice-sheet-steps";
    var urlItem = document.createElement("li");
    function setUrl(url) { urlItem.textContent = t("voice.siri.step2", { url: url }); }
    [t("voice.siri.step1"), null, t("voice.siri.step3")].forEach(function (text) {
      if (text === null) { setUrl(location.origin + "/voice"); ol.appendChild(urlItem); return; }
      var li = document.createElement("li");
      li.textContent = text;
      ol.appendChild(li);
    });
    wrap.appendChild(ol);
    var note = document.createElement("p");
    note.className = "voice-sheet-note";
    note.textContent = t("voice.siri.note");
    wrap.appendChild(note);
    // the address another device reaches this computer at (not "localhost")
    // and this server's app token, which lets the Shortcut in (the server
    // only answers paired devices - see server/pairing.js)
    try {
      Promise.all([
        fetch("api/lan-info").then(function (r) { return r.ok ? r.json() : null; }),
        fetch("api/pair/app-token").then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
      ]).then(function (got) {
        var info = got[0], app = got[1];
        if (!info || !info.port) return;
        setUrl("http://" + (info.addresses && info.addresses.length ? info.addresses[0] : location.hostname) + ":" + info.port + "/voice" + (app && app.token ? "?device=" + app.token : ""));
        wrap.classList.remove("hidden");
      }).catch(function () {});
    } catch (e) {}
    return wrap;
  }
  function openSheet() {
    var overlay = el("voice-sheet-overlay");
    if (!overlay) return;
    buildSheet();
    overlay.classList.remove("hidden");
  }
  function closeSheet() {
    var overlay = el("voice-sheet-overlay");
    if (overlay) overlay.classList.add("hidden");
  }
  function sheetOpen() {
    var overlay = el("voice-sheet-overlay");
    return !!overlay && !overlay.classList.contains("hidden");
  }

  function typingInText(target) {
    if (!target) return false;
    if (target.isContentEditable || target.tagName === "TEXTAREA") return true;
    return target.tagName === "INPUT" && target.type !== "number" && target.type !== "checkbox" && target.type !== "radio";
  }

  function init() {
    connectRemote(); // (Siri doesn't need the browser's speech recognition)
    var group = el("voice-command-group");
    var holdBtn = el("btn-voice-hold");
    if (!group || !holdBtn) return;
    if (!supported()) return; // (stays hidden: no speech recognition here, or the iOS app)
    group.classList.remove("hidden");

    holdBtn.addEventListener("pointerdown", function (e) {
      if (e.button !== undefined && e.button !== 0) return;
      e.preventDefault();
      try { holdBtn.setPointerCapture(e.pointerId); } catch (err) {}
      start("button");
    });
    ["pointerup", "pointercancel", "lostpointercapture"].forEach(function (type) {
      holdBtn.addEventListener(type, function () { stop(); });
    });
    holdBtn.addEventListener("contextmenu", function (e) { e.preventDefault(); });
    holdBtn.addEventListener("click", function (e) { e.preventDefault(); });

    var closeBtn = el("btn-voice-sheet-close");
    if (closeBtn) closeBtn.addEventListener("click", closeSheet);
    var overlay = el("voice-sheet-overlay");
    if (overlay) overlay.addEventListener("click", function (e) { if (e.target === overlay) closeSheet(); });

    // The number pad's "." key, held. Capture phase: the win window
    // focuses its balls-left number field, which would otherwise take
    // the "." - and the keypad shortcuts never see this key.
    document.addEventListener("keydown", function (e) {
      if (sheetOpen() && (e.key === "Escape" || e.key === "Enter")) {
        e.preventDefault();
        e.stopPropagation();
        closeSheet();
        return;
      }
      if (e.code !== HOLD_KEY_CODE || typingInText(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) start("key");
    }, true);
    document.addEventListener("keyup", function (e) {
      if (e.code !== HOLD_KEY_CODE || typingInText(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      stop();
    }, true);
    root.addEventListener("blur", function () { stop(); });
  }

  root.PMCVoice = {
    handleText: function (text) { return handleAlternatives([].concat(text)); },
    openSheet: openSheet,
    closeSheet: closeSheet,
    isSheetOpen: sheetOpen,
    supported: supported,
    holdKeyCode: HOLD_KEY_CODE
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})(typeof window !== "undefined" ? window : globalThis);
