(function () {
  "use strict";

  var STORAGE_KEY = "poolMasterCounter.state.v2";
  var OLD_STORAGE_KEY = "poolMasterCounter.state.v1";
  var VOICE_PITCHES = [1.0, 1.26, 1.5, 0.79, 1.89, 0.63];

  var GAME_TYPES = {};
  var GAME_TYPE_LIST = [];
  var DEFAULT_GAME_TYPES = [
    { id: "8ball", label: "8-Ball", defaultTarget: 1, unit: "rack" },
    { id: "8ballrotation", label: "8 Ball Rotation", defaultTarget: 1, unit: "rack" },
    { id: "8ballpunishment", label: "8 Ball Punishment", defaultTarget: 1, unit: "rack" },
    { id: "9ball", label: "9-Ball", defaultTarget: 1, unit: "rack" },
    { id: "straight", label: "Straight Pool", defaultTarget: 100, unit: "points" },
    { id: "onepocket", label: "One Pocket", defaultTarget: 8, unit: "balls" },
    { id: "custom", label: "Custom", defaultTarget: 1, unit: "points" }
  ];

  // ---------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------

  var state = loadState();
  var toastTimer = null;

  // "No Statistic will be recorded" mode — a purely in-memory session with
  // nothing written to localStorage: no state, no PLAYER_STATS, no
  // PLAYER_RATINGS. Never persisted itself (always starts off on reload),
  // toggled from the scoreboard checkbox or preset by the wizard's "Only a
  // temporary counter" checkbox. The live scoreboard/session win-tracking/
  // Recent Games still work normally in memory for the current tab — only
  // the underlying save calls become no-ops.
  var noStatsMode = false;

  // Quick Counter mode — the scoreboard becomes a bare point tally: no
  // game type, no target, no rotation, no win/loss detection. Entered via
  // the wizard's "Start Game Now" button (Step 1, only shown once No
  // Statistic is checked). Player names are edited inline and players can
  // be added/removed right from the scoreboard cards. Always implies
  // noStatsMode, since there's nothing meaningful to save in this mode
  // anyway (no completed games, ever).
  var quickCounterMode = false;

  // Self-healing pass for names saved before capitalization was enforced
  // everywhere (or from a device/import that predates it): fixes casing in
  // place on state.players and every gameHistory entry's winner/opponent/
  // MVP names, so a bad casing saved once doesn't keep resurfacing forever
  // (buildNameCasingMap would otherwise treat it as the "known" casing and
  // keep reusing it — see resolvePlayerName). Runs before any rendering.
  (function migrateNameCapitalizationOnBoot() {
    var changed = false;
    function fixName(n) {
      var fixed = capitalizeName(n);
      if (fixed !== n) changed = true;
      return fixed;
    }
    function fixList(list) {
      return (list || []).map(fixName);
    }
    (state.players || []).forEach(function (p) {
      if (p && p.name) p.name = fixName(p.name);
    });
    (state.gameHistory || []).forEach(function (entry) {
      if (!entry || typeof entry === "string") return;
      if (entry.winnerNames) entry.winnerNames = fixList(entry.winnerNames);
      if (entry.opponentNames) entry.opponentNames = fixList(entry.opponentNames);
      if (entry.mvpName) entry.mvpName = fixName(entry.mvpName);
    });
    if (changed) saveState();
  })();

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // Player names are treated as case-insensitive everywhere: "Bob" and
  // "bob" are the same person. This is the single normalization key used
  // to compare/group names; the actual display casing is decided by
  // resolvePlayerName / consolidateCaseVariantPlayerStats below.
  function normalizeNameKey(name) {
    return (name || "").trim().toLowerCase();
  }

  // Generic chevron collapse/expand for any element carrying the
  // .collapsible-panel class — a panel, or (for Focus Mode) a smaller
  // in-scoreboard block. Reused by every collapsible section on the page.
  function wireCollapsiblePanel(panelElId, buttonElId) {
    var panel = document.getElementById(panelElId);
    var btn = document.getElementById(buttonElId);
    btn.addEventListener("click", function () {
      var willExpand = panel.classList.contains("collapsed");
      panel.classList.toggle("collapsed");
      btn.setAttribute("aria-expanded", willExpand ? "true" : "false");
    });
  }

  // Updates the one-line "what's inside" sentence shown only while a
  // collapsible panel is collapsed (id="<panelElId>-summary").
  function setPanelSummary(panelElId, text) {
    var el = document.getElementById(panelElId + "-summary");
    if (el) el.textContent = text;
  }

  function defaultState() {
    return {
      players: [],
      playerWins: {},
      teamWins: {},
      teamMvpWins: {},
      raceToWinsTarget: 5,
      currentGame: { gameType: "8ball", target: 1, unit: "rack", mode: "individual", startedAt: new Date().toISOString() },
      gameHistory: [],
      rotation: { enabled: false, order: [], every: 1 },
      gamesPlayedCount: 0
    };
  }

  function migrateFromOldMatches(oldState) {
    var next = defaultState();
    next.players = (oldState.players || []).map(function (p, i) {
      return {
        id: p.id,
        name: p.name,
        voice: typeof p.voice === "number" ? p.voice : i % VOICE_PITCHES.length,
        playing: false,
        teamId: null,
        balls: 0
      };
    });

    (oldState.matches || []).forEach(function (m) {
      var participants = m.participants || [];
      if (m.teamsEnabled) {
        ["A", "B"].forEach(function (teamId) {
          var members = participants.filter(function (pt) {
            return pt.teamId === teamId;
          });
          if (!members.length) return;
          var wins = m.mode === "games" ? m.games && m.games[teamId] : m.status === "completed" && m.winnerId === teamId ? 1 : 0;
          wins = wins || 0;
          if (!wins) return;
          var key = members
            .map(function (pt) {
              return pt.playerId;
            })
            .sort()
            .join("|");
          next.teamWins[key] = (next.teamWins[key] || 0) + wins;
          members.forEach(function (pt) {
            next.playerWins[pt.playerId] = (next.playerWins[pt.playerId] || 0) + wins;
          });
        });
      } else {
        participants.forEach(function (pt) {
          var wins = m.mode === "games" ? (m.games && m.games[pt.playerId]) || 0 : m.status === "completed" && m.winnerId === pt.playerId ? 1 : 0;
          if (!wins) return;
          next.playerWins[pt.playerId] = (next.playerWins[pt.playerId] || 0) + wins;
        });
      }
    });

    return next;
  }

  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.players)) {
          parsed.players.forEach(function (p, i) {
            if (typeof p.voice !== "number") p.voice = i % VOICE_PITCHES.length;
            if (typeof p.playing !== "boolean") p.playing = false;
            if (typeof p.teamId === "undefined") p.teamId = null;
            if (typeof p.balls !== "number") p.balls = 0;
          });
          if (!parsed.playerWins) parsed.playerWins = {};
          if (!parsed.teamWins) parsed.teamWins = {};
          if (!parsed.teamMvpWins) parsed.teamMvpWins = {};
          if (typeof parsed.raceToWinsTarget !== "number") parsed.raceToWinsTarget = 5;
          if (!parsed.currentGame) parsed.currentGame = { gameType: "8ball", target: 1, mode: "individual" };
          if (!parsed.currentGame.startedAt) parsed.currentGame.startedAt = new Date().toISOString();
          if (typeof parsed.currentGame.unit !== "string" || !parsed.currentGame.unit) parsed.currentGame.unit = null;
          var EIGHTBALL_FAMILY = ["8ball", "8ballrotation", "8ballpunishment"];
          if (parsed.currentGame.target === 8 && EIGHTBALL_FAMILY.indexOf(parsed.currentGame.gameType) !== -1) {
            parsed.currentGame.target = 1;
          } else if (parsed.currentGame.target === 9 && parsed.currentGame.gameType === "9ball") {
            parsed.currentGame.target = 1;
          }
          if (!Array.isArray(parsed.gameHistory)) parsed.gameHistory = [];
          if (!parsed.rotation) parsed.rotation = { enabled: false, order: [], every: 1 };
          if (!Array.isArray(parsed.rotation.order)) parsed.rotation.order = [];
          if (typeof parsed.rotation.every !== "number") parsed.rotation.every = 1;
          if (typeof parsed.rotation.enabled !== "boolean") parsed.rotation.enabled = false;
          if (typeof parsed.gamesPlayedCount !== "number") parsed.gamesPlayedCount = 0;
          return parsed;
        }
      }
      var oldRaw = localStorage.getItem(OLD_STORAGE_KEY);
      if (oldRaw) {
        var oldParsed = JSON.parse(oldRaw);
        if (oldParsed && Array.isArray(oldParsed.players)) {
          return migrateFromOldMatches(oldParsed);
        }
      }
    } catch (e) {
      console.warn("Could not read saved state, starting fresh.", e);
    }
    return defaultState();
  }

  function saveState() {
    if (noStatsMode) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn("Could not save state.", e);
    }
  }

  function getPlayer(id) {
    for (var i = 0; i < state.players.length; i++) {
      if (state.players[i].id === id) return state.players[i];
    }
    return null;
  }

  function getPlayerIdByName(name) {
    var key = normalizeNameKey(name);
    for (var i = 0; i < state.players.length; i++) {
      if (normalizeNameKey(state.players[i].name) === key) return state.players[i].id;
    }
    return null;
  }

  function activePlayers() {
    return state.players.filter(function (p) {
      return p.playing;
    });
  }

  // The player currently targeted by the 1-9 keypad shortcut - see
  // handleKeypadShortcut. Not persisted; always starts cleared on reload.
  var keypadSelectedPlayerId = null;

  // Player ids in keypad-number order (index 0 = number 1, etc.) - filled
  // in by refreshKeypadNumbering() after every scoreboard render, since
  // numbering follows the ON-SCREEN grid position rather than roster
  // order (see that function), and that depends on how many columns the
  // responsive grid actually rendered at the current viewport width.
  var keypadOrderedPlayerIds = [];

  // Appended to a player's card/panel by every builder that has one
  // (buildIndividualPanel, buildMemberCard, buildQuickCounterPanel): a
  // marker plus an (initially empty) number badge - refreshKeypadNumbering
  // fills in the actual number and highlight state once every card for
  // this render is in the DOM and laid out.
  function markAsKeypadTarget(el, player) {
    el.dataset.keypadPlayerId = player.id;
    var badge = document.createElement("span");
    badge.className = "keypad-number-badge";
    el.appendChild(badge);
  }

  // Recomputes which number (1-9) each currently-playing player's card
  // shows, and refreshes every card's highlight state. Individual mode's
  // grid can wrap into any number of columns depending on viewport width,
  // so numbering follows actual rendered position, boustrophedon-style -
  // row 1 left to right, row 2 right to left, row 3 left to right, and
  // so on - so the reading direction always continues smoothly into the
  // next row instead of jumping back across the screen. Team mode's
  // two-column-of-vertically-stacked-members layout doesn't break into
  // "rows" the same way, so it just keeps DOM order there (team A top to
  // bottom, then team B top to bottom).
  function refreshKeypadNumbering() {
    var cards = Array.prototype.slice.call(scoreboard.querySelectorAll("[data-keypad-player-id]"));
    var ordered;
    if (state.currentGame.mode === "teams" || cards.length === 0) {
      ordered = cards;
    } else {
      var withRects = cards.map(function (el) {
        var r = el.getBoundingClientRect();
        return { el: el, top: r.top, left: r.left };
      });
      var rows = [];
      withRects.forEach(function (item) {
        var row = rows.filter(function (r) {
          return Math.abs(r.top - item.top) < 10;
        })[0];
        if (!row) {
          row = { top: item.top, items: [] };
          rows.push(row);
        }
        row.items.push(item);
      });
      rows.sort(function (a, b) {
        return a.top - b.top;
      });
      ordered = [];
      rows.forEach(function (row, i) {
        row.items.sort(function (a, b) {
          return i % 2 === 0 ? a.left - b.left : b.left - a.left;
        });
        row.items.forEach(function (item) {
          ordered.push(item.el);
        });
      });
    }

    keypadOrderedPlayerIds = [];
    ordered.forEach(function (el, i) {
      var num = i < 9 ? i + 1 : null;
      var badge = el.querySelector(".keypad-number-badge");
      if (num) keypadOrderedPlayerIds.push(el.dataset.keypadPlayerId);
      if (badge) badge.textContent = num || "";
      el.classList.toggle("is-keypad-selected", el.dataset.keypadPlayerId === keypadSelectedPlayerId);
    });
  }

  function teamMembersLive(teamId) {
    return activePlayers().filter(function (p) {
      return p.teamId === teamId;
    });
  }

  function teamComboKey(teamId) {
    return teamMembersLive(teamId)
      .map(function (p) {
        return p.id;
      })
      .sort()
      .join("|");
  }

  function teamLabelLive(teamId) {
    var names = teamMembersLive(teamId)
      .map(function (p) {
        return p.name;
      })
      .join(" & ");
    return T(teamId === "A" ? "gameSetup.teamA" : "gameSetup.teamB") + (names ? " (" + names + ")" : "");
  }

  function sumTeamBalls(teamId) {
    return teamMembersLive(teamId).reduce(function (sum, p) {
      return sum + (p.balls || 0);
    }, 0);
  }

  // ---------------------------------------------------------------------
  // Sound (synthesized via Web Audio API — no external files needed)
  // ---------------------------------------------------------------------

  var audioCtx = null;
  var echoSend = null;

  // A short slapback-style delay with damped feedback, shared by every
  // sound in the app — gives each tone a natural little tail instead of
  // cutting off flat. echoSend is the node every tone's gain also patches
  // into; the wet path loops back through a lowpass so repeats get
  // progressively warmer/duller rather than just quieter copies.
  function setupEchoBus(ctx) {
    echoSend = ctx.createGain();
    echoSend.gain.value = 1;
    var delay = ctx.createDelay(1.0);
    delay.delayTime.value = 0.15;
    var feedback = ctx.createGain();
    feedback.gain.value = 0.3;
    var damping = ctx.createBiquadFilter();
    damping.type = "lowpass";
    damping.frequency.value = 2200;
    var wet = ctx.createGain();
    wet.gain.value = 0.32;

    echoSend.connect(delay);
    delay.connect(damping);
    damping.connect(feedback);
    feedback.connect(delay);
    damping.connect(wet);
    wet.connect(ctx.destination);
  }

  function getAudioCtx() {
    if (!audioCtx) {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      audioCtx = new Ctx();
      setupEchoBus(audioCtx);
    }
    if (audioCtx.state === "suspended") {
      audioCtx.resume();
    }
    return audioCtx;
  }

  // iOS Safari can silently drop the very first sound of a page load if
  // the AudioContext hasn't finished unlocking by the time a tone actually
  // needs to play - most noticeable in games like 8-Ball, where the very
  // first "+" tap already IS the win fanfare (target is 1 rack), so
  // there's no earlier, lower-stakes tap that would have already unlocked
  // it. Warm the context up (and play a silent buffer, which is what
  // actually flips iOS's audio-unlock flag) on the very first tap
  // anywhere on the page, well before any score button gets pressed.
  function unlockAudioOnFirstInteraction() {
    var unlock = function () {
      document.removeEventListener("pointerdown", unlock);
      var ctx = getAudioCtx();
      var buffer = ctx.createBuffer(1, 1, 22050);
      var source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start(0);
    };
    document.addEventListener("pointerdown", unlock);
  }

  // Every tone is two voices: the requested pitch/waveform, plus a quiet
  // octave-up triangle partner that decays faster — that second voice is
  // what turns a flat single-frequency beep into something with a bit of
  // body/shimmer, and it's always a soft waveform even when the main tone
  // uses a harsher one (sawtooth/square), which rounds off the edge
  // without losing that tone's identity. Both voices feed the shared echo
  // bus alongside the dry signal.
  function tone(freq, startTime, duration, type, peakGain) {
    var ctx = getAudioCtx();

    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = type || "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(peakGain, startTime + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    if (echoSend) gain.connect(echoSend);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.02);

    var overtoneDuration = duration * 0.7;
    var osc2 = ctx.createOscillator();
    var gain2 = ctx.createGain();
    osc2.type = "triangle";
    osc2.frequency.value = freq * 2;
    osc2.detune.value = 6;
    gain2.gain.setValueAtTime(0, startTime);
    gain2.gain.linearRampToValueAtTime(peakGain * 0.18, startTime + 0.015);
    gain2.gain.exponentialRampToValueAtTime(0.0008, startTime + overtoneDuration);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    if (echoSend) gain2.connect(echoSend);
    osc2.start(startTime);
    osc2.stop(startTime + overtoneDuration + 0.02);
  }

  function voicePitch(voice) {
    if (typeof voice !== "number") return 1;
    return VOICE_PITCHES[voice % VOICE_PITCHES.length];
  }

  function playPositiveSound(voice) {
    var mult = voicePitch(voice);
    var ctx = getAudioCtx();
    var now = ctx.currentTime;
    tone(660 * mult, now, 0.09, "triangle", 0.22);
    tone(990 * mult, now + 0.07, 0.14, "triangle", 0.2);
  }

  // A single droopy "sad trombone" note: pitch bends downward over its
  // whole duration (osc.frequency.exponentialRampToValueAtTime) instead of
  // holding steady, plus a quiet sub-octave sine underneath for a low,
  // mournful groan. Shares the echo bus with everything else.
  function sadTone(freq, startTime, duration, bendTo) {
    var ctx = getAudioCtx();

    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(freq, startTime);
    osc.frequency.exponentialRampToValueAtTime(freq * bendTo, startTime + duration);
    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(0.2, startTime + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    if (echoSend) gain.connect(echoSend);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.05);

    var subOsc = ctx.createOscillator();
    var subGain = ctx.createGain();
    subOsc.type = "sine";
    subOsc.frequency.setValueAtTime(freq / 2, startTime);
    subOsc.frequency.exponentialRampToValueAtTime((freq * bendTo) / 2, startTime + duration);
    subGain.gain.setValueAtTime(0, startTime);
    subGain.gain.linearRampToValueAtTime(0.12, startTime + 0.03);
    subGain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
    subOsc.connect(subGain);
    subGain.connect(ctx.destination);
    if (echoSend) subGain.connect(echoSend);
    subOsc.start(startTime);
    subOsc.stop(startTime + duration + 0.05);
  }

  // "Sad trombone": a slow descending minor motif, each note drooping
  // downward, ending on a long, low, fading groan — very sad on purpose.
  function playNegativeSound(voice) {
    var mult = voicePitch(voice);
    var now = getAudioCtx().currentTime;
    var notes = [
      { f: 392.0, t: 0.0, d: 0.32, bend: 0.94 },
      { f: 369.99, t: 0.28, d: 0.32, bend: 0.94 },
      { f: 349.23, t: 0.56, d: 0.32, bend: 0.92 },
      { f: 293.66, t: 0.84, d: 1.2, bend: 0.72 }
    ];
    notes.forEach(function (n) {
      sadTone(n.f * mult, now + n.t, n.d, n.bend);
    });
  }

  // Two alternate victory fanfares, picked at random on each win so a run
  // of single-rack games doesn't hear the same thing every time — Queen's
  // "We Are the Champions" (from published easy-piano letter notes for the
  // "we are the champions, my friend" hook) and "Another One Bites the
  // Dust" (from published bass tab for the main riff), both dropped into
  // a low register per request, and both drenched in the shared slapback
  // echo bus AND their own dedicated reverb send (like
  // playTournamentChampionSound's, just shorter) for a big, low, anthemic
  // wash. Plays on every game win. voice picks the per-player pitch
  // multiplier (VOICE_PITCHES) so different winners land at different
  // pitches, same as before.
  function playWinSound(voice) {
    var mult = voicePitch(voice);
    var ctx = getAudioCtx();
    var now = ctx.currentTime;

    var convolver = ctx.createConvolver();
    convolver.buffer = buildReverbImpulse(ctx, 2.4, 2.2);
    var reverbSend = ctx.createGain();
    reverbSend.gain.value = 0.6;
    reverbSend.connect(convolver);
    convolver.connect(ctx.destination);

    function anthemTone(freq, t, duration, peakGain) {
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(peakGain, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      if (echoSend) gain.connect(echoSend);
      gain.connect(reverbSend);
      osc.start(t);
      osc.stop(t + duration + 0.08);

      var sub = ctx.createOscillator();
      var subGain = ctx.createGain();
      sub.type = "triangle";
      sub.frequency.value = freq / 2;
      subGain.gain.setValueAtTime(0, t);
      subGain.gain.linearRampToValueAtTime(peakGain * 0.4, t + 0.02);
      subGain.gain.exponentialRampToValueAtTime(0.001, t + duration);
      sub.connect(subGain);
      subGain.connect(ctx.destination);
      if (echoSend) subGain.connect(echoSend);
      subGain.connect(reverbSend);
      sub.start(t);
      sub.stop(t + duration + 0.08);
    }

    // The "We are the champions... of the world" refrain specifically
    // (not the shorter "my friend" line) - transcribed from published
    // easy-piano letter notes: "We are the champions!" (G F# G F#-E) then
    // dropping a register for "Of the world...!" (D B D). A 9th note (a
    // low G tonic) added at the end for a full cadence, since the source
    // phrase itself only runs 8. Raised an octave from an earlier pass
    // that was too low to recognize - still sits a step below the
    // original vocal register, but this is the floor for staying
    // recognizable.
    function playChampionsSong() {
      var freqs = { G4: 392.0, Fs4: 369.99, E4: 329.63, D3: 146.83, B3: 246.94, G3: 196.0 };
      var run = [
        { n: "G4", t: 0.0, d: 0.2 },
        { n: "Fs4", t: 0.18, d: 0.2 },
        { n: "G4", t: 0.36, d: 0.2 },
        { n: "Fs4", t: 0.54, d: 0.16 },
        { n: "E4", t: 0.68, d: 0.24 },
        { n: "D3", t: 0.94, d: 0.26 },
        { n: "B3", t: 1.22, d: 0.24 },
        { n: "D3", t: 1.48, d: 0.26 },
        { n: "G3", t: 1.76, d: 0.9 }
      ];
      run.forEach(function (note) {
        anthemTone(freqs[note.n] * mult, now + note.t, note.d, 0.22);
      });
    }

    // The famous bass riff, transcribed from published bass tab (E minor,
    // all on the low E string: frets 0-0-0-0-0-3-0-5, i.e. E E E E E G E A)
    // - a 9th note (E, the loop point) added at the end since the source
    // riff is 8 notes and repeats from there. Raised an octave from an
    // earlier pass that was too low to recognize - still sits below the
    // Champions melody's register (it's the bass line, after all).
    function playBitesTheDustSong() {
      var freqs = { E3: 164.81, G3: 196.0, A3: 220.0 };
      var run = [
        { n: "E3", t: 0.0, d: 0.13 },
        { n: "E3", t: 0.16, d: 0.13 },
        { n: "E3", t: 0.32, d: 0.13 },
        { n: "E3", t: 0.48, d: 0.13 },
        { n: "E3", t: 0.64, d: 0.13 },
        { n: "G3", t: 0.8, d: 0.15 },
        { n: "E3", t: 0.98, d: 0.13 },
        { n: "A3", t: 1.14, d: 0.3 },
        { n: "E3", t: 1.46, d: 0.7 }
      ];
      run.forEach(function (note) {
        anthemTone(freqs[note.n] * mult, now + note.t, note.d, 0.24);
      });
    }

    [playChampionsSong, playBitesTheDustSong][Math.floor(Math.random() * 2)]();
  }

  // A gentle 14-note pastoral phrase evoking the Beatles' recorder
  // introduction to "Fool on the Hill" (an homage rather than a literal
  // transcription) — a soft sine "recorder" timbre with both the shared
  // slapback echo bus AND its own dedicated reverb send, for a spacious,
  // dreamy feel fitting a quiet warning rather than a fanfare.
  function playOnHillSound() {
    var ctx = getAudioCtx();
    var now = ctx.currentTime;

    var convolver = ctx.createConvolver();
    convolver.buffer = buildReverbImpulse(ctx, 2.8, 2.8);
    var reverbSend = ctx.createGain();
    reverbSend.gain.value = 0.55;
    reverbSend.connect(convolver);
    convolver.connect(ctx.destination);

    function recorderTone(freq, t, duration, peakGain) {
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(peakGain, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      if (echoSend) gain.connect(echoSend);
      gain.connect(reverbSend);
      osc.start(t);
      osc.stop(t + duration + 0.06);
    }

    var freqs = { D4: 293.66, E4: 329.63, Fs4: 369.99, G4: 392.0, A4: 440.0, Cs5: 554.37, D5: 587.33 };
    var melody = ["D4", "E4", "Fs4", "G4", "Fs4", "E4", "D4", "A4", "G4", "Fs4", "E4", "D4", "Cs5", "D5"];
    var noteDur = 0.27;
    melody.forEach(function (name, i) {
      var duration = i === melody.length - 1 ? noteDur * 2.4 : noteDur * 0.95;
      recorderTone(freqs[name], now + i * noteDur, duration, 0.16);
    });
  }

  // Builds a synthetic reverb impulse response — exponentially decaying
  // stereo noise, no external audio file needed — used only by
  // playTournamentChampionSound for a big, cathedral-like tail. Much
  // wetter/longer than the shared slapback echo bus (setupEchoBus)
  // every other sound uses, on purpose: this fanfare should feel like
  // it's ringing out in a huge hall.
  function buildReverbImpulse(ctx, duration, decay) {
    var rate = ctx.sampleRate;
    var length = Math.max(1, Math.floor(rate * duration));
    var impulse = ctx.createBuffer(2, length, rate);
    for (var ch = 0; ch < 2; ch++) {
      var data = impulse.getChannelData(ch);
      for (var i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
      }
    }
    return impulse;
  }

  // Winning a whole Tournament — a bracket Tournament's champion, or a
  // main-scoreboard "race to N wins" session — gets its own fanfare: the
  // full main theme of Beethoven's 9th Symphony ("Ode to Joy"), played
  // low and drenched in reverb for a deep, triumphant, slightly ominous
  // feel — deliberately different from playWinSound's bright single-rack
  // fanfare. Every note is scheduled a full second after this is called
  // (ctx.currentTime + 1) so it lands just after the champion banner/
  // milestone overlay appears, not on top of it.
  function playTournamentChampionSound() {
    var ctx = getAudioCtx();
    var now = ctx.currentTime;
    var start = now + 1;

    var convolver = ctx.createConvolver();
    convolver.buffer = buildReverbImpulse(ctx, 3.2, 2.4);
    var reverbSend = ctx.createGain();
    reverbSend.gain.value = 0.9;
    reverbSend.connect(convolver);
    convolver.connect(ctx.destination);

    // A low sawtooth note plus a sub-octave sine underneath for weight —
    // both fed into the big reverb send above (not the shared echo bus).
    function lowReverbTone(freq, t, duration, peakGain) {
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(peakGain, t + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      gain.connect(reverbSend);
      osc.start(t);
      osc.stop(t + duration + 0.1);

      var sub = ctx.createOscillator();
      var subGain = ctx.createGain();
      sub.type = "sine";
      sub.frequency.value = freq / 2;
      subGain.gain.setValueAtTime(0, t);
      subGain.gain.linearRampToValueAtTime(peakGain * 0.65, t + 0.025);
      subGain.gain.exponentialRampToValueAtTime(0.001, t + duration);
      sub.connect(subGain);
      subGain.connect(ctx.destination);
      subGain.connect(reverbSend);
      sub.start(t);
      sub.stop(t + duration + 0.1);
    }

    // C3-rooted "Ode to Joy" main theme, all 30 notes of its full 8-bar
    // form (the complete "Freude, schöner Götterfunken..." melody, both
    // 4-bar halves): mi mi fa sol / sol fa mi re / do do re mi / mi re re
    // // mi mi fa sol / sol fa mi re / do do re mi / re do do.
    var freqs = { C: 130.81, D: 146.83, E: 164.81, F: 174.61, G: 196.0 };
    var melody = [
      "E", "E", "F", "G", "G", "F", "E", "D", "C", "C", "D", "E", "E", "D", "D",
      "E", "E", "F", "G", "G", "F", "E", "D", "C", "C", "D", "E", "D", "C", "C"
    ];
    var step = 0.24;
    melody.forEach(function (deg, i) {
      var isLast = i === melody.length - 1;
      lowReverbTone(freqs[deg], start + i * step, isLast ? 1.0 : 0.21, isLast ? 0.24 : 0.2);
    });
  }

  // ---------------------------------------------------------------------
  // Theme — five color/font palettes, applied as a data-theme attribute
  // on <html> so every CSS custom property cascades from there. The
  // choice persists to localStorage; a tiny inline script in <head>
  // applies it synchronously on load (before the stylesheet paints) so
  // there's no flash of the default theme first.
  // ---------------------------------------------------------------------

  var THEME_KEY = "poolMasterCounter.theme.v1";
  var THEME_STATUS_COLORS = {
    "crimson-felt": "#1a0a0a",
    "emerald-rail": "#071a10",
    "neon-arcade": "#0a0a12",
    "midnight-ivory": "#0e1218",
    "sunset-chalk": "#1a0f08",
    "obsidian-break": "#08090a",
    "daybreak-chalk": "#f5f1e8",
    "pearl-lounge": "#f4f2f6",
    "blackout-contrast": "#000000",
    "paper-contrast": "#ffffff"
  };

  var themeSelect = document.getElementById("theme-select");

  function applyTheme(id, persist) {
    document.documentElement.setAttribute("data-theme", id);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta && THEME_STATUS_COLORS[id]) meta.setAttribute("content", THEME_STATUS_COLORS[id]);
    if (persist) {
      try {
        localStorage.setItem(THEME_KEY, id);
      } catch (e) {
        console.warn("Could not save theme.", e);
      }
    }
  }

  applyTheme(document.documentElement.getAttribute("data-theme") || "crimson-felt", false);
  themeSelect.value = document.documentElement.getAttribute("data-theme") || "crimson-felt";
  themeSelect.addEventListener("change", function () {
    applyTheme(themeSelect.value, true);
  });

  // ---------------------------------------------------------------------
  // Language / i18n
  //
  // Every user-facing string lives in languages/<name>.json, keyed by a
  // dotted name (e.g. "backup.exportAll"). languages/manifest.json is the
  // list the selector reads - a plain static site can't ask the server
  // "what files exist in this folder" over HTTP, so the manifest IS the
  // directory listing; adding a language means adding both its JSON file
  // and a manifest entry (see languages/README.md). English is always
  // loaded as a fallback dictionary, so a key missing from a
  // partially-translated language falls back to English instead of
  // showing a raw key. Switching languages persists the choice and
  // reloads the page - simplest way to guarantee every screen (including
  // ones not currently visible) re-renders in the new language, and since
  // all real app state already lives in localStorage, nothing is lost.
  // ---------------------------------------------------------------------

  var LANGUAGE_KEY = "poolMasterCounter.language.v1";
  var DEFAULT_LANGUAGE_CODE = "english";
  var activeLanguageCode = DEFAULT_LANGUAGE_CODE;
  var LANG_MANIFEST = [{ code: "english", file: "english.json", label: "English", flag: "🇬🇧" }];
  var LANG_DICT_EN = {};
  var LANG_DICT_ACTIVE = {};
  var missingTranslationKeysWarned = {};

  var languageSelect = document.getElementById("language-select");

  function loadLanguageCodeFromStorage() {
    try {
      return localStorage.getItem(LANGUAGE_KEY) || DEFAULT_LANGUAGE_CODE;
    } catch (e) {
      return DEFAULT_LANGUAGE_CODE;
    }
  }

  function saveLanguageCodeToStorage(code) {
    try {
      localStorage.setItem(LANGUAGE_KEY, code);
    } catch (e) {
      console.warn("Could not save language.", e);
    }
  }

  // Looks up key in the active language, falling back to English, then to
  // the key itself (warning once, not on every call, so a genuinely
  // missing key can't spam the console or look like a real JS error).
  // vars supports {{name}} interpolation, e.g. T("wonGame", {name: "Bob"}).
  function T(key, vars) {
    var str = LANG_DICT_ACTIVE[key];
    if (str === undefined) str = LANG_DICT_EN[key];
    if (str === undefined) {
      if (!missingTranslationKeysWarned[key]) {
        missingTranslationKeysWarned[key] = true;
        console.warn("Missing translation key:", key);
      }
      return key;
    }
    if (vars) {
      Object.keys(vars).forEach(function (name) {
        str = str.split("{{" + name + "}}").join(vars[name]);
      });
    }
    return str;
  }

  // Translates a raw unit value ("rack"/"balls"/"points", as stored on
  // state.currentGame/rotation entries) for display - the value itself
  // stays an untranslated internal identifier, only the shown label
  // changes with the active language.
  function unitLabel(unit) {
    if (unit === "rack") return T("units.rack");
    if (unit === "balls") return T("units.balls");
    if (unit === "points") return T("units.points");
    return unit;
  }

  // Applies the active dictionary to every static data-i18n[-*] element
  // under root - called once after boot, and whenever DOM is rebuilt by a
  // template that predates a language switch (rare, since switching
  // reloads the page; kept general so it also works for content injected
  // before boot() runs, e.g. nothing today, but safe for future use).
  function applyDomTranslations(root) {
    root.querySelectorAll("[data-i18n]").forEach(function (el) {
      el.textContent = T(el.getAttribute("data-i18n"));
    });
    root.querySelectorAll("[data-i18n-html]").forEach(function (el) {
      el.innerHTML = T(el.getAttribute("data-i18n-html"));
    });
    root.querySelectorAll("[data-i18n-placeholder]").forEach(function (el) {
      el.setAttribute("placeholder", T(el.getAttribute("data-i18n-placeholder")));
    });
    root.querySelectorAll("[data-i18n-aria-label]").forEach(function (el) {
      el.setAttribute("aria-label", T(el.getAttribute("data-i18n-aria-label")));
    });
    root.querySelectorAll("[data-i18n-label]").forEach(function (el) {
      el.setAttribute("label", T(el.getAttribute("data-i18n-label")));
    });
  }

  function fetchLanguageJSON(file) {
    return fetchFresh("languages/" + file)
      .then(function (res) {
        return res.ok ? res.json() : {};
      })
      .catch(function () {
        return {};
      });
  }

  function loadLanguageManifest() {
    return fetchFresh("languages/manifest.json")
      .then(function (res) {
        return res.ok ? res.json() : [];
      })
      .catch(function () {
        return [];
      });
  }

  function populateLanguageSelect() {
    languageSelect.innerHTML = "";
    LANG_MANIFEST.forEach(function (entry) {
      var opt = document.createElement("option");
      opt.value = entry.code;
      opt.textContent = entry.flag + " " + entry.label;
      languageSelect.appendChild(opt);
    });
    languageSelect.value = activeLanguageCode;
  }

  // Loads the manifest, then English (always, as the fallback dict) and
  // the active language (if different) in parallel. Resolves once both
  // dictionaries and the selector are ready - awaited alongside
  // gameTypesPromise/migrateFromRepoIfNeeded() below, before boot().
  var languagePromise = loadLanguageManifest().then(function (manifest) {
    if (Array.isArray(manifest) && manifest.length) LANG_MANIFEST = manifest;
    activeLanguageCode = loadLanguageCodeFromStorage();
    if (
      !LANG_MANIFEST.some(function (e) {
        return e.code === activeLanguageCode;
      })
    ) {
      activeLanguageCode = DEFAULT_LANGUAGE_CODE;
    }
    var englishEntry =
      LANG_MANIFEST.filter(function (e) {
        return e.code === DEFAULT_LANGUAGE_CODE;
      })[0] || { file: "english.json" };
    var activeEntry =
      LANG_MANIFEST.filter(function (e) {
        return e.code === activeLanguageCode;
      })[0] || englishEntry;
    return Promise.all([
      fetchLanguageJSON(englishEntry.file),
      activeLanguageCode === DEFAULT_LANGUAGE_CODE ? Promise.resolve(null) : fetchLanguageJSON(activeEntry.file)
    ]).then(function (dicts) {
      LANG_DICT_EN = dicts[0] || {};
      LANG_DICT_ACTIVE = dicts[1] || LANG_DICT_EN;
      populateLanguageSelect();
    });
  });

  languageSelect.addEventListener("change", function () {
    saveLanguageCodeToStorage(languageSelect.value);
    location.reload();
  });

  // ---------------------------------------------------------------------
  // DOM refs
  // ---------------------------------------------------------------------

  var btnExportAllData = document.getElementById("btn-export-all-data");
  var btnImportAllData = document.getElementById("btn-import-all-data");
  var importFileInput = document.getElementById("import-file-input");
  var btnResetAllPlayerStats = document.getElementById("btn-reset-all-player-stats");
  var btnResetRosterLists = document.getElementById("btn-reset-roster-lists");
  var backupPanel = document.getElementById("backup-panel");
  var btnToggleBackupPanel = document.getElementById("btn-toggle-backup-panel");

  var addPlayerForm = document.getElementById("add-player-form");
  var newPlayerName = document.getElementById("new-player-name");
  var newPlayerRatingInput = document.getElementById("new-player-rating");
  var newPlayerNameRequirement = document.getElementById("new-player-name-requirement");
  var btnAddPlayer = document.getElementById("btn-add-player");
  var rosterList = document.getElementById("roster-list");
  var rosterLoadSelect = document.getElementById("roster-load-select");
  var btnRosterLoad = document.getElementById("btn-roster-load");
  var btnExportRosterLists = document.getElementById("btn-export-roster-lists");
  var btnImportRosterLists = document.getElementById("btn-import-roster-lists");
  var importRosterListsFileInput = document.getElementById("import-roster-lists-file-input");

  var helpOverlay = document.getElementById("help-overlay");
  var btnHelpClose = document.getElementById("btn-help-close");
  var helpNavLinks = document.querySelectorAll(".help-nav-link");
  var btnOpenHelpButtons = [
    document.getElementById("btn-open-help"),
    document.getElementById("btn-open-help-all-players"),
    document.getElementById("btn-open-help-tournament"),
    document.getElementById("btn-open-help-player-page"),
    document.getElementById("btn-open-help-wizard")
  ];

  var btnTestOnboarding = document.getElementById("btn-test-onboarding");
  var btnOpenWizard = document.getElementById("btn-open-wizard");
  var wizardOverlay = document.getElementById("wizard-overlay");
  var btnWizardClose = document.getElementById("btn-wizard-close");
  var wizardProgress = document.getElementById("wizard-progress");
  var wizardProgressDots = document.getElementById("wizard-progress-dots");
  var wizardGameTypeSelect = document.getElementById("wizard-game-type");
  var wizardFormatRadios = document.getElementsByName("wizard-format");
  var wizardRaceToRow = document.getElementById("wizard-raceto-row");
  var wizardRaceToInput = document.getElementById("wizard-race-to");
  var wizardRosterLoadSelect = document.getElementById("wizard-roster-load-select");
  var btnWizardRosterLoad = document.getElementById("wizard-btn-roster-load");
  var wizardNewPlayerNameRequirement = document.getElementById("wizard-new-player-name-requirement");
  var wizardAddPlayerForm = document.getElementById("wizard-add-player-form");
  var wizardNewPlayerName = document.getElementById("wizard-new-player-name");
  var wizardNewPlayerRatingInput = document.getElementById("wizard-new-player-rating");
  var btnWizardAddPlayer = document.getElementById("wizard-btn-add-player");
  var wizardPlayerChips = document.getElementById("wizard-player-chips");
  var wizardPlayingList = document.getElementById("wizard-playing-list");
  var wizardPlayingWarning = document.getElementById("wizard-playing-warning");
  var wizardRotationEnabledRadios = document.getElementsByName("wizard-rotation-enabled");
  var wizardRotationDetail = document.getElementById("wizard-rotation-detail");
  var wizardRotationLoadSelect = document.getElementById("wizard-rotation-load-select");
  var btnWizardRotationLoad = document.getElementById("wizard-btn-rotation-load");
  var wizardRotationAddType = document.getElementById("wizard-rotation-add-type");
  var wizardRotationAddTarget = document.getElementById("wizard-rotation-add-target");
  var wizardRotationAddUnit = document.getElementById("wizard-rotation-add-unit");
  var btnWizardRotationAdd = document.getElementById("wizard-btn-rotation-add");
  var wizardRotationList = document.getElementById("wizard-rotation-list");
  var wizardRotationEveryInput = document.getElementById("wizard-rotation-every");
  var wizardSummary = document.getElementById("wizard-summary");
  var btnWizardBack = document.getElementById("wizard-btn-back");
  var btnWizardCancel = document.getElementById("wizard-btn-cancel");
  var btnWizardNext = document.getElementById("wizard-btn-next");
  var btnWizardStart = document.getElementById("wizard-btn-start");
  var wizardTempCounterCheckbox = document.getElementById("wizard-temp-counter-checkbox");
  var btnWizardStartQuickCounter = document.getElementById("btn-wizard-start-quick-counter");

  var onboardingOverlay = document.getElementById("onboarding-overlay");
  var onboardingHeading = document.getElementById("onboarding-heading");
  var onboardingProgress = document.getElementById("onboarding-progress");
  var onboardingProgressDots = document.getElementById("onboarding-progress-dots");
  var onboardingNameRequirement = document.getElementById("onboarding-name-requirement");
  var onboardingNameInput = document.getElementById("onboarding-name-input");
  var onboardingRatingInput = document.getElementById("onboarding-rating-input");
  var onboardingEmailInput = document.getElementById("onboarding-email-input");
  var onboardingReportOptInCheckbox = document.getElementById("onboarding-report-optin-checkbox");
  var onboardingPlayChoiceRadios = document.getElementsByName("onboarding-play-choice");
  var onboardingStandardFooter = document.getElementById("onboarding-standard-footer");
  var btnOnboardingCancel = document.getElementById("btn-onboarding-cancel");
  var btnOnboardingGo = document.getElementById("btn-onboarding-go");
  var btnOnboardingRunWizard = document.getElementById("btn-onboarding-run-wizard");
  var btnOnboardingManual = document.getElementById("btn-onboarding-manual");
  var onboardingStep = 1;

  var btnToggleFocus = document.getElementById("btn-toggle-focus");
  var focusPlayersWrap = document.getElementById("focus-players-wrap");
  var btnToggleFocusPlayers = document.getElementById("btn-toggle-focus-players");
  var focusPlayersSummary = document.getElementById("focus-players-summary");
  var focusPlayersList = document.getElementById("focus-players-list");
  var appRoot = document.getElementById("app");
  var playerPageView = document.getElementById("view-player-page");
  var playerPageName = document.getElementById("player-page-name");
  var playerPageAdded = document.getElementById("player-page-added");
  var playerPageCurrentBody = document.getElementById("player-page-current-body");
  var playerPageHistoryList = document.getElementById("player-page-history-list");
  var btnPlayerPageBack = document.getElementById("btn-player-page-back");
  var btnPlayerPageExport = document.getElementById("btn-player-page-export");
  var btnPlayerPageReset = document.getElementById("btn-player-page-reset");
  var playerPagePeriodFilter = document.getElementById("player-page-period-filter");
  var playerPageGraphBody = document.getElementById("player-page-graph-body");
  var playerPagePeriodButtons = playerPagePeriodFilter.querySelectorAll(".period-btn");
  var playerPageSynopsisBody = document.getElementById("player-page-synopsis-body");
  var playerPageH2hList = document.getElementById("player-page-h2h-list");
  var btnReturnToGlobalStats = document.getElementById("btn-return-to-global-stats");
  var playerPageSwitcher = document.getElementById("player-page-switcher");

  var btnOpenAllPlayers = document.getElementById("btn-open-all-players");
  var allPlayersPageView = document.getElementById("view-all-players-page");
  var btnAllPlayersBack = document.getElementById("btn-all-players-back");
  var allPlayersSortSelect = document.getElementById("all-players-sort");
  var allPlayersPeriodSelect = document.getElementById("all-players-period");
  var btnToggleAllPlayersView = document.getElementById("btn-toggle-all-players-view");
  var btnToggleRosterFilter = document.getElementById("btn-toggle-roster-filter");
  var allPlayersList = document.getElementById("all-players-list");
  var allPlayersViewMode = "bars";
  var allPlayersRosterOnly = false;

  var btnOpenTournament = document.getElementById("btn-open-tournament");
  var tournamentPageView = document.getElementById("view-tournament-page");
  var btnTournamentBack = document.getElementById("btn-tournament-back");
  var tournamentSetupPanel = document.getElementById("tournament-setup-panel");
  var tournamentActivePanel = document.getElementById("tournament-active-panel");
  var tournamentFormatRadios = document.getElementsByName("tournament-format");
  var tournamentWbSection = document.getElementById("tournament-wb-section");
  var tournamentLbSection = document.getElementById("tournament-lb-section");
  var tournamentGfSection = document.getElementById("tournament-gf-section");
  var tournamentRrSection = document.getElementById("tournament-rr-section");
  var tournamentGameTypeSelect = document.getElementById("tournament-game-type");
  var tournamentTargetInput = document.getElementById("tournament-target");
  var tournamentTargetUnit = document.getElementById("tournament-target-unit");
  var tournamentRaceToInput = document.getElementById("tournament-race-to");
  var tournamentPlayerChecklist = document.getElementById("tournament-player-checklist");
  var btnTournamentStart = document.getElementById("btn-tournament-start");
  var btnTournamentAbandon = document.getElementById("btn-tournament-abandon");
  var tournamentChampionBanner = document.getElementById("tournament-champion-banner");
  var tournamentCurrentMatchPanel = document.getElementById("tournament-current-match-panel");
  var tournamentReadyList = document.getElementById("tournament-ready-list");
  var tournamentWbEl = document.getElementById("tournament-wb");
  var tournamentLbEl = document.getElementById("tournament-lb");
  var tournamentGfEl = document.getElementById("tournament-gf");
  var tournamentRrStandingsEl = document.getElementById("tournament-rr-standings");
  var tournamentRrMatchesEl = document.getElementById("tournament-rr-matches");

  var gameTypeSelect = document.getElementById("game-type");
  var gameTargetInput = document.getElementById("game-target");
  var gameTargetUnitSelect = document.getElementById("game-target-unit-select");
  var modeRadios = document.getElementsByName("game-mode");
  var raceToWinsInput = document.getElementById("race-to-wins");
  var noStatsCheckbox = document.getElementById("no-stats-checkbox");

  var btnResetGame = document.getElementById("btn-reset-game");
  var btnUndoWin = document.getElementById("btn-undo-win");
  var btnShare = document.getElementById("btn-share");
  var btnExportSession = document.getElementById("btn-export-session");

  var rotationEnabledCheckbox = document.getElementById("rotation-enabled");
  var rotationLoadSelect = document.getElementById("rotation-load-select");
  var btnRotationLoad = document.getElementById("btn-rotation-load");
  var rotationAddType = document.getElementById("rotation-add-type");
  var rotationAddTarget = document.getElementById("rotation-add-target");
  var rotationAddUnit = document.getElementById("rotation-add-unit");
  var btnRotationAdd = document.getElementById("btn-rotation-add");
  var rotationList = document.getElementById("rotation-list");
  var rotationEveryInput = document.getElementById("rotation-every");
  var rotationStatus = document.getElementById("rotation-status");
  var rotationPositionRow = document.getElementById("rotation-position-row");
  var rotationPositionTrack = document.getElementById("rotation-position-track");
  var rotationPositionText = document.getElementById("rotation-position-text");
  var btnRotationPositionPrev = document.getElementById("btn-rotation-position-prev");
  var btnRotationPositionNext = document.getElementById("btn-rotation-position-next");

  var winToast = document.getElementById("win-toast");
  var scoreboard = document.getElementById("scoreboard");
  var historyList = document.getElementById("history-list");
  var standingsTitle = document.getElementById("standings-title");
  var teamStandingsList = document.getElementById("team-standings-list");
  var playerStandingsList = document.getElementById("player-standings-list");

  var dayNotesTextarea = document.getElementById("day-notes-textarea");
  var btnDayReportCopy = document.getElementById("btn-day-report-copy");
  var btnDayReportEmail = document.getElementById("btn-day-report-email");
  var btnDayReportSms = document.getElementById("btn-day-report-sms");
  var dayReportRecipientsLine = document.getElementById("day-report-recipients-line");

  var milestoneOverlay = document.getElementById("milestone-overlay");
  var milestoneHeadline = document.getElementById("milestone-headline");
  var milestoneDetails = document.getElementById("milestone-details");
  var btnMilestoneClose = document.getElementById("btn-milestone-close");
  var btnMilestoneUndo = document.getElementById("btn-milestone-undo");

  var gamewinOverlay = document.getElementById("gamewin-overlay");
  var gamewinMessage = document.getElementById("gamewin-message");
  var gamewinDetails = document.getElementById("gamewin-details");
  var btnGamewinClose = document.getElementById("btn-gamewin-close");
  var btnGamewinUndo = document.getElementById("btn-gamewin-undo");

  var forceResetOverlay = document.getElementById("force-reset-overlay");
  var forceResetMessage = document.getElementById("force-reset-message");
  var btnForceResetClose = document.getElementById("btn-force-reset-close");

  var btnResetTodayStats = document.getElementById("btn-reset-today-stats");

  // Optional "balls left on the table" marker for whichever game the
  // gamewin overlay is currently showing — unset (null) unless the +/-
  // counter is used. Tracks which game record to patch once the dialog
  // closes (see showGameWinOverlay/closeGameWinOverlay below).
  var gamewinBallsLeftValue = null;
  var gamewinPendingTs = null;
  var gamewinPendingOnClose = null;

  var onHillOverlay = document.getElementById("onhill-overlay");
  var onHillMessage = document.getElementById("onhill-message");
  var btnOnHillClose = document.getElementById("btn-onhill-close");

  var gameChangeOverlay = document.getElementById("gamechange-overlay");
  var gameChangeMessage = document.getElementById("gamechange-message");
  var btnGameChangeClose = document.getElementById("btn-gamechange-close");
  var nowPlayingBanner = document.getElementById("now-playing-banner");

  var saveSessionOverlay = document.getElementById("save-session-overlay");
  var saveSessionMessage = document.getElementById("save-session-message");
  var btnSaveSessionSave = document.getElementById("btn-save-session-save");
  var btnSaveSessionSkip = document.getElementById("btn-save-session-skip");
  var btnSaveSessionCancel = document.getElementById("btn-save-session-cancel");

  var ratingEditOverlay = document.getElementById("rating-edit-overlay");
  var ratingEditPlayerName = document.getElementById("rating-edit-player-name");
  var ratingEditInput = document.getElementById("rating-edit-input");
  var btnRatingEditSave = document.getElementById("btn-rating-edit-save");
  var btnRatingEditCancel = document.getElementById("btn-rating-edit-cancel");
  var btnResetAllRatings = document.getElementById("btn-reset-all-ratings");

  var removedPlayersOverlay = document.getElementById("removed-players-overlay");
  var removedPlayersChecklist = document.getElementById("removed-players-checklist");
  var btnRemovedPlayersContinue = document.getElementById("btn-removed-players-continue");

  var recoverDataList = document.getElementById("recover-data-list");
  var btnRecoverImportFile = document.getElementById("btn-recover-import-file");
  var recoverImportFileInput = document.getElementById("recover-import-file-input");
  var recoverDetailOverlay = document.getElementById("recover-detail-overlay");
  var recoverDetailTitle = document.getElementById("recover-detail-title");
  var recoverDetailExplain = document.getElementById("recover-detail-explain");
  var recoverPlayersSection = document.getElementById("recover-players-section");
  var recoverPlayersChecklist = document.getElementById("recover-players-checklist");
  var recoverGamesSection = document.getElementById("recover-games-section");
  var recoverGamesChecklist = document.getElementById("recover-games-checklist");
  var recoverRostersSection = document.getElementById("recover-rosters-section");
  var recoverRostersChecklist = document.getElementById("recover-rosters-checklist");
  var btnRecoverRestore = document.getElementById("btn-recover-restore");
  var btnRecoverCancel = document.getElementById("btn-recover-cancel");
  var btnResetSessionTournament = document.getElementById("btn-reset-session-tournament");
  var ratingEditTargetName = null;

  var confirmModalOverlay = document.getElementById("confirm-modal-overlay");
  var confirmModalMessage = document.getElementById("confirm-modal-message");
  var confirmModalInputRow = document.getElementById("confirm-modal-input-row");
  var confirmModalInput = document.getElementById("confirm-modal-input");
  var btnConfirmModalOk = document.getElementById("btn-confirm-modal-ok");
  var btnConfirmModalCancel = document.getElementById("btn-confirm-modal-cancel");

  // ---------------------------------------------------------------------
  // Generic modal alert/confirm/prompt - replaces native alert()/
  // confirm()/prompt(), which freeze the whole page behind browser
  // chrome instead of feeling like part of the app. One shared overlay,
  // reconfigured per call; only one is ever open at a time.
  // ---------------------------------------------------------------------

  var confirmModalOnConfirm = null;
  var confirmModalOnCancel = null;

  function closeConfirmModal() {
    confirmModalOverlay.classList.add("hidden");
    confirmModalOnConfirm = null;
    confirmModalOnCancel = null;
  }

  function openConfirmModal(message, showCancel, showInput, inputValue) {
    confirmModalMessage.textContent = message;
    confirmModalMessage.classList.toggle("is-long-text", message.length > 200 || message.indexOf("\n") !== -1);
    confirmModalInputRow.classList.toggle("hidden", !showInput);
    confirmModalInput.value = showInput ? inputValue || "" : "";
    btnConfirmModalCancel.classList.toggle("hidden", !showCancel);
    confirmModalOverlay.classList.remove("hidden");
    if (showInput) {
      confirmModalInput.focus();
      confirmModalInput.select();
    } else {
      btnConfirmModalOk.focus();
    }
  }

  // Replaces `alert(msg)`. onClose (optional) runs once the user
  // dismisses it, whether via OK or the backdrop - there's no
  // "cancelled" state for a single-button alert.
  function alertModal(message, onClose) {
    var cb = onClose || null;
    confirmModalOnConfirm = cb;
    confirmModalOnCancel = cb;
    openConfirmModal(message, false, false);
  }

  // Replaces `if (!confirm(msg)) return; ...rest`. Move ...rest into
  // onYes; onNo (optional) runs on Cancel/backdrop-dismiss.
  function confirmModal(message, onYes, onNo) {
    confirmModalOnConfirm = onYes;
    confirmModalOnCancel = onNo || null;
    openConfirmModal(message, true, false);
  }

  // Replaces `prompt(msg, defaultValue)`. onSubmit receives the entered
  // string; onCancel (optional) runs on Cancel/backdrop-dismiss instead
  // (there's no null-return case here the way native prompt() has one).
  function promptModal(message, defaultValue, onSubmit, onCancel) {
    confirmModalOnConfirm = function () {
      onSubmit(confirmModalInput.value);
    };
    confirmModalOnCancel = onCancel || null;
    openConfirmModal(message, true, true, defaultValue);
  }

  btnConfirmModalOk.addEventListener("click", function () {
    var cb = confirmModalOnConfirm;
    closeConfirmModal();
    if (cb) cb();
  });
  btnConfirmModalCancel.addEventListener("click", function () {
    var cb = confirmModalOnCancel;
    closeConfirmModal();
    if (cb) cb();
  });
  confirmModalOverlay.addEventListener("click", function (e) {
    if (e.target !== confirmModalOverlay) return;
    var cb = confirmModalOnCancel;
    closeConfirmModal();
    if (cb) cb();
  });
  document.addEventListener("keydown", function (e) {
    if (confirmModalOverlay.classList.contains("hidden")) return;
    if (e.key === "Enter") {
      e.preventDefault();
      btnConfirmModalOk.click();
    } else if (e.key === "Escape") {
      e.preventDefault();
      (btnConfirmModalCancel.classList.contains("hidden") ? btnConfirmModalOk : btnConfirmModalCancel).click();
    }
  });

  function isTypingIntoField(el) {
    if (!el) return false;
    var tag = el.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
  }

  function isAnyOverlayOpen() {
    return [
      helpOverlay,
      wizardOverlay,
      onboardingOverlay,
      milestoneOverlay,
      gamewinOverlay,
      forceResetOverlay,
      onHillOverlay,
      gameChangeOverlay,
      saveSessionOverlay,
      ratingEditOverlay,
      confirmModalOverlay
    ].some(function (el) {
      return el && !el.classList.contains("hidden");
    });
  }

  // Lets a keyboard (or a numeric keypad) drive scoring without touching
  // the screen: a digit 1-9 selects (and highlights) the Nth currently-
  // playing player's card, top to bottom - individual panels and team
  // member cards numbered in one shared sequence; +/- then adjusts that
  // selected player's score exactly as tapping their own +/- buttons
  // would (same adjustScore call, so wins, team mode, and Quick Counter
  // all just work as normal). Selection persists across repeated +/-
  // presses until a different digit is pressed, Escape is pressed, the
  // selected player stops playing, or the scoreboard isn't the visible
  // screen (an overlay is open, a text field has focus, or a different
  // page like Tournament/All Players/Player Stats is showing).
  function handleKeypadShortcut(e) {
    if (isTypingIntoField(document.activeElement)) return;
    if (isAnyOverlayOpen()) return;
    if (appRoot.classList.contains("hidden")) return;

    if (e.key === "Escape") {
      if (keypadSelectedPlayerId) {
        keypadSelectedPlayerId = null;
        renderScoreboard();
      }
      return;
    }

    if (/^[1-9]$/.test(e.key)) {
      var targetId = keypadOrderedPlayerIds[parseInt(e.key, 10) - 1];
      if (!targetId) return;
      e.preventDefault();
      keypadSelectedPlayerId = targetId;
      renderScoreboard();
      return;
    }

    if (e.key === "+" || e.key === "-") {
      if (!keypadSelectedPlayerId) return;
      var stillActive = activePlayers().some(function (p) {
        return p.id === keypadSelectedPlayerId;
      });
      if (!stillActive) {
        keypadSelectedPlayerId = null;
        return;
      }
      e.preventDefault();
      adjustScore(keypadSelectedPlayerId, e.key === "+" ? 1 : -1);
    }
  }

  document.addEventListener("keydown", handleKeypadShortcut);

  // Enter/Escape for every other overlay in the app (the generic
  // confirm/alert/prompt modal already handles its own, right above -
  // this skips whenever that one's open so it's never double-handled).
  // Each entry is [overlay, primaryButton, cancelButton] - Enter clicks
  // the primary button, Escape clicks the cancel button (falling back to
  // the primary one for overlays that only have a single dismiss
  // button). The wizard is the one special case: it has its own text
  // inputs (add-player, etc.) with their own Enter-submits-the-form
  // behavior, which must win over advancing the wizard step.
  var OVERLAY_KEY_TARGETS = [
    [saveSessionOverlay, btnSaveSessionSave, btnSaveSessionCancel],
    [ratingEditOverlay, btnRatingEditSave, btnRatingEditCancel],
    [removedPlayersOverlay, btnRemovedPlayersContinue, btnRemovedPlayersContinue],
    [recoverDetailOverlay, btnRecoverRestore, btnRecoverCancel],
    [onboardingOverlay, btnOnboardingGo, btnOnboardingCancel],
    [milestoneOverlay, btnMilestoneClose, btnMilestoneClose],
    [gamewinOverlay, btnGamewinClose, btnGamewinClose],
    [forceResetOverlay, btnForceResetClose, btnForceResetClose],
    [onHillOverlay, btnOnHillClose, btnOnHillClose],
    [gameChangeOverlay, btnGameChangeClose, btnGameChangeClose],
    [helpOverlay, btnHelpClose, btnHelpClose]
  ];

  function handleOverlayEnterEscape(e) {
    if (e.key !== "Enter" && e.key !== "Escape") return;
    if (confirmModalOverlay && !confirmModalOverlay.classList.contains("hidden")) return;

    if (!wizardOverlay.classList.contains("hidden")) {
      if (e.key === "Escape") {
        e.preventDefault();
        btnWizardClose.click();
        return;
      }
      if (isTypingIntoField(document.activeElement)) return;
      e.preventDefault();
      (btnWizardStart.classList.contains("hidden") ? btnWizardNext : btnWizardStart).click();
      return;
    }

    for (var i = 0; i < OVERLAY_KEY_TARGETS.length; i++) {
      var overlay = OVERLAY_KEY_TARGETS[i][0];
      if (!overlay || overlay.classList.contains("hidden")) continue;
      e.preventDefault();
      (e.key === "Enter" ? OVERLAY_KEY_TARGETS[i][1] : OVERLAY_KEY_TARGETS[i][2]).click();
      return;
    }
  }

  document.addEventListener("keydown", handleOverlayEnterEscape);

  function populateGameTypeSelects() {
    [gameTypeSelect, rotationAddType, tournamentGameTypeSelect, wizardGameTypeSelect, wizardRotationAddType].forEach(function (select) {
      select.innerHTML = "";
      GAME_TYPE_LIST.forEach(function (t) {
        var opt = document.createElement("option");
        opt.value = t.id;
        opt.textContent = t.label;
        select.appendChild(opt);
      });
    });
  }

  // ---------------------------------------------------------------------
  // Focus mode (hide settings/statistics panels, show only the scoreboard)
  // ---------------------------------------------------------------------

  var FOCUS_MODE_KEY = "poolMasterCounter.focusMode";

  function setFocusMode(on) {
    appRoot.classList.toggle("focus-mode", on);
    btnToggleFocus.textContent = T(on ? "scoreboard.showAll" : "scoreboard.focusMode");
    try {
      localStorage.setItem(FOCUS_MODE_KEY, on ? "1" : "0");
    } catch (e) {
      console.warn("Could not save focus mode preference.", e);
    }
  }

  // ---------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------

  function renderAll() {
    renderRoster();
    renderScoreboard();
    renderHistory();
    renderStandings();
    renderRotation();
    renderWizardIfOpen();
    updateDayNotesSummary();
    updateDayReportRecipientsLine();
    renderRecoverDataList();
  }

  // A rotation entry is { gameType, target, unit } — its own rule, not
  // just a game type — so the same game type can appear more than once in
  // an order with different rules (e.g. "8-Ball — 1 rack" and "8-Ball — 3
  // racks" as distinct steps).
  function rotationEntryLabel(entry) {
    var type = GAME_TYPES[entry.gameType];
    var label = type ? type.label : entry.gameType;
    var rawUnit = entry.unit || (type ? type.unit : "rack");
    var unit = rawUnit === "rack" && entry.target !== 1 ? T("units.racks") : unitLabel(rawUnit);
    return label + " — " + entry.target + " " + unit;
  }

  // Normalizes one rotation-order entry to the { gameType, target, unit }
  // shape, filling in a game type's defaults for anything missing —
  // handles both brand-new entries and legacy ones saved as a bare game
  // type string before per-entry rules existed. Requires GAME_TYPES to
  // already be populated.
  function normalizeRotationEntry(entry) {
    var gameType = typeof entry === "string" ? entry : entry && entry.gameType;
    if (!gameType) return null;
    var type = GAME_TYPES[gameType];
    var target = entry && typeof entry === "object" && typeof entry.target === "number" && entry.target > 0
      ? entry.target
      : type ? type.defaultTarget : 1;
    var unit = entry && typeof entry === "object" && typeof entry.unit === "string" && entry.unit
      ? entry.unit
      : type ? type.unit : "rack";
    return { gameType: gameType, target: target, unit: unit };
  }

  // Fills in state.currentGame.unit and normalizes every rotation entry
  // (live and saved) into the { gameType, target, unit } shape. Runs once
  // at boot, after GAME_TYPES is loaded — rotation entries can't be
  // normalized any earlier since GAME_TYPES isn't populated yet when
  // loadState() runs.
  function normalizeGameTypeDependentData() {
    if (!state.currentGame.unit) {
      var currentType = GAME_TYPES[state.currentGame.gameType];
      state.currentGame.unit = currentType ? currentType.unit : "rack";
    }
    state.rotation.order = state.rotation.order.map(normalizeRotationEntry).filter(Boolean);
    saveState();

    var rostersChanged = false;
    SAVED_ROTATIONS.forEach(function (r) {
      if ((r.order || []).some(function (e) { return typeof e === "string"; })) rostersChanged = true;
      r.order = (r.order || []).map(normalizeRotationEntry).filter(Boolean);
    });
    if (rostersChanged) saveRotationsToStorage(SAVED_ROTATIONS);
  }

  // Builds one rotation-order <li> (position, game type, editable target +
  // unit, up/down/remove controls). Shared by the main Game Order panel
  // and the wizard's rotation step so both stay visually and behaviorally
  // identical. The target/unit are edited in place instead of needing to
  // remove and re-add the entry to change its goal.
  function buildRotationRow(entry, i, total) {
    var li = document.createElement("li");
    li.className = "rotation-row";

    var pos = document.createElement("span");
    pos.className = "rotation-position";
    pos.textContent = i + 1 + ".";

    var type = GAME_TYPES[entry.gameType];
    var name = document.createElement("span");
    name.className = "rotation-name";
    name.textContent = type ? type.label : entry.gameType;

    var targetInput = document.createElement("input");
    targetInput.type = "number";
    targetInput.className = "rotation-target-input";
    targetInput.min = "1";
    targetInput.max = "500";
    targetInput.value = entry.target;
    targetInput.setAttribute("aria-label", "Target for " + name.textContent);
    targetInput.addEventListener("change", function () {
      var val = parseInt(targetInput.value, 10);
      if (val > 0) updateRotationItem(i, { target: val });
      else targetInput.value = entry.target;
    });

    var unitSelect = document.createElement("select");
    unitSelect.className = "rotation-unit-select";
    unitSelect.setAttribute("aria-label", "Unit for " + name.textContent);
    ["rack", "balls", "points"].forEach(function (u) {
      var opt = document.createElement("option");
      opt.value = u;
      opt.textContent = u;
      unitSelect.appendChild(opt);
    });
    unitSelect.value = entry.unit;
    unitSelect.addEventListener("change", function () {
      updateRotationItem(i, { unit: unitSelect.value });
    });

    var controls = document.createElement("div");
    controls.className = "rotation-controls";

    var upBtn = document.createElement("button");
    upBtn.type = "button";
    upBtn.textContent = "↑";
    upBtn.disabled = i === 0;
    upBtn.addEventListener("click", function () {
      moveRotationItem(i, -1);
    });

    var downBtn = document.createElement("button");
    downBtn.type = "button";
    downBtn.textContent = "↓";
    downBtn.disabled = i === total - 1;
    downBtn.addEventListener("click", function () {
      moveRotationItem(i, 1);
    });

    var removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.setAttribute("aria-label", "Remove from rotation");
    removeBtn.textContent = "×";
    removeBtn.addEventListener("click", function () {
      removeRotationItem(i);
    });

    controls.appendChild(upBtn);
    controls.appendChild(downBtn);
    controls.appendChild(removeBtn);

    li.appendChild(pos);
    li.appendChild(name);
    li.appendChild(targetInput);
    li.appendChild(unitSelect);
    li.appendChild(controls);
    return li;
  }

  function renderRotationListInto(listEl) {
    listEl.innerHTML = "";
    if (state.rotation.order.length === 0) {
      var hint = document.createElement("li");
      hint.className = "empty-hint";
      hint.textContent = T("rotation.noGameTypesYet");
      listEl.appendChild(hint);
      return;
    }
    state.rotation.order.forEach(function (entry, i) {
      listEl.appendChild(buildRotationRow(entry, i, state.rotation.order.length));
    });
  }

  function renderRotation() {
    rotationEnabledCheckbox.checked = state.rotation.enabled;
    rotationEveryInput.value = state.rotation.every;

    renderRotationListInto(rotationList);

    rotationStatus.classList.remove("is-warning");
    var info = rotationStatusInfo();
    if (info) {
      rotationStatus.innerHTML = "";
      rotationStatus.appendChild(document.createTextNode(T("rotation.statusNowLabel")));
      var nowStrong = document.createElement("strong");
      nowStrong.textContent = info.currentLabel;
      rotationStatus.appendChild(nowStrong);
      rotationStatus.appendChild(
        document.createTextNode(
          T(info.untilSwitch === 1 ? "rotation.statusSwitchesInOne" : "rotation.statusSwitchesInMany", {
            next: info.nextLabel,
            count: info.untilSwitch
          })
        )
      );
    } else if (state.rotation.enabled && state.rotation.order.length === 1) {
      rotationStatus.classList.add("is-warning");
      rotationStatus.textContent = T("rotation.warningOneType");
    } else if (state.rotation.enabled) {
      rotationStatus.classList.add("is-warning");
      rotationStatus.textContent = T("rotation.warningEmpty");
    } else {
      rotationStatus.textContent = "";
    }

    setPanelSummary("rotation-panel", computeRotationSummary());
  }

  function computeRotationSummary() {
    if (!state.rotation.enabled) {
      var currentType = GAME_TYPES[state.currentGame.gameType];
      return T("rotation.summaryOff", { game: currentType ? currentType.label : state.currentGame.gameType });
    }
    if (state.rotation.order.length < 2) {
      return T("rotation.summaryNotSetUp");
    }
    return T(state.rotation.every === 1 ? "rotation.summaryRotatingOne" : "rotation.summaryRotatingMany", {
      label: rotationLabelFor(state.rotation.order),
      count: state.rotation.every
    });
  }

  function addRotationItem(gameType, target, unit) {
    var type = GAME_TYPES[gameType];
    state.rotation.order.push({
      gameType: gameType,
      target: target > 0 ? target : (type ? type.defaultTarget : 1),
      unit: unit || (type ? type.unit : "rack")
    });
    saveState();
    saveRotationSnapshotIfNew(true);
    applyRotationIfDue();
    renderRotation();
    renderScoreboard();
    renderWizardIfOpen();
  }

  function removeRotationItem(index) {
    state.rotation.order.splice(index, 1);
    saveState();
    saveRotationSnapshotIfNew(true);
    applyRotationIfDue();
    renderRotation();
    renderScoreboard();
    renderWizardIfOpen();
  }

  function moveRotationItem(index, delta) {
    var newIndex = index + delta;
    if (newIndex < 0 || newIndex >= state.rotation.order.length) return;
    var arr = state.rotation.order;
    var tmp = arr[index];
    arr[index] = arr[newIndex];
    arr[newIndex] = tmp;
    saveState();
    saveRotationSnapshotIfNew(true);
    applyRotationIfDue();
    renderRotation();
    renderScoreboard();
    renderWizardIfOpen();
  }

  // Edits an existing rotation entry's target and/or unit in place — the
  // list-row equivalent of addRotationItem, so changing a game's goal
  // doesn't require removing and re-adding it.
  function updateRotationItem(index, changes) {
    var entry = state.rotation.order[index];
    if (!entry) return;
    if (typeof changes.target === "number") entry.target = changes.target;
    if (typeof changes.unit === "string") entry.unit = changes.unit;
    saveState();
    saveRotationSnapshotIfNew(true);
    applyRotationIfDue();
    renderRotation();
    renderScoreboard();
    renderWizardIfOpen();
  }

  function syncGameTypeUI() {
    gameTypeSelect.value = state.currentGame.gameType;
    gameTargetInput.value = state.currentGame.target;
    gameTargetUnitSelect.value = state.currentGame.unit;
    updateCurrentGameSummary();
  }

  function updateCurrentGameSummary() {
    var type = GAME_TYPES[state.currentGame.gameType];
    var modeLabel = state.currentGame.mode === "teams" ? T("gameSetup.teams") : T("gameSetup.individual");
    setPanelSummary(
      "game-setup-panel",
      T("gameSetup.summaryLine", {
        game: type ? type.label : state.currentGame.gameType,
        target: state.currentGame.target,
        unit: unitLabel(state.currentGame.unit),
        mode: modeLabel,
        raceTo: state.raceToWinsTarget
      })
    );
  }

  // The rotation's current step is purely a function of how many games
  // have been played: floor(gamesPlayedCount / every), wrapped to the
  // order's length. moveRotationPosition (the ◀/▶ control) hand-drives
  // that same counter one game at a time - it doesn't jump straight to
  // a different game type, it just ticks gamesPlayedCount by ±1, same
  // as a real win/undo would, and lets this formula do what it already
  // does. So within a leg, a click or two just moves the countdown
  // toward the next switch; only crossing an `every` boundary actually
  // changes the active game type.
  function rotationCurrentIndex() {
    var len = state.rotation.order.length;
    if (len === 0) return 0;
    var every = Math.max(1, state.rotation.every || 1);
    return Math.floor(state.gamesPlayedCount / every) % len;
  }

  function rotationStatusInfo() {
    if (!(state.rotation.enabled && state.rotation.order.length >= 2)) return null;
    var every = Math.max(1, state.rotation.every || 1);
    var playedInLeg = state.gamesPlayedCount % every;
    var untilSwitch = every - playedInLeg;
    var currentIndex = rotationCurrentIndex();
    var nextIndex = (currentIndex + 1) % state.rotation.order.length;
    return {
      currentLabel: rotationEntryLabel(state.rotation.order[currentIndex]),
      nextLabel: rotationEntryLabel(state.rotation.order[nextIndex]),
      playedInLeg: playedInLeg,
      every: every,
      untilSwitch: untilSwitch
    };
  }

  function applyRotationIfDue() {
    if (!state.rotation.enabled || state.rotation.order.length === 0) return;
    var entry = state.rotation.order[rotationCurrentIndex()];
    if (GAME_TYPES[entry.gameType] && (entry.gameType !== state.currentGame.gameType || entry.target !== state.currentGame.target || entry.unit !== state.currentGame.unit)) {
      state.currentGame.gameType = entry.gameType;
      state.currentGame.target = entry.target;
      state.currentGame.unit = entry.unit;
      syncGameTypeUI();
    }
  }

  // The ◀/▶ control: hand-drives gamesPlayedCount by ±1, exactly as if
  // one more (or one fewer) game had been played toward the rotation's
  // switch-every countdown - no win/loss is credited to anyone, no
  // score changes, only the rotation's own counter moves. Reuses
  // applyRotationIfDue so a click that crosses an `every` boundary
  // switches the active game type immediately, same as a real win
  // would.
  function moveRotationPosition(direction) {
    if (!state.rotation.enabled || state.rotation.order.length < 2) return;
    state.gamesPlayedCount = Math.max(0, state.gamesPlayedCount + direction);
    applyRotationIfDue();
    saveState();
    renderAll();
  }

  function buildStandingsRow(name, wins, memberNames) {
    var target = state.raceToWinsTarget;
    var reached = wins >= target;
    var li = document.createElement("li");
    li.className = "standings-row" + (reached ? " is-reached" : "");

    var top = document.createElement("div");
    top.className = "standings-row-top";
    var nameEl = document.createElement("span");
    nameEl.className = "standings-name";
    nameEl.textContent = name;
    (memberNames || []).forEach(function (n) {
      nameEl.appendChild(buildRatingBadge(n));
      nameEl.appendChild(buildPlayerLinkIcon(n));
      var member = state.players.filter(function (p) {
        return p.name === n;
      })[0];
      if (member) {
        var status = document.createElement("span");
        status.className = "standings-status" + (member.playing ? " is-playing" : "");
        status.textContent = T(member.playing ? "players.playing" : "players.standby");
        nameEl.appendChild(status);
      }
    });
    var countEl = document.createElement("span");
    countEl.className = "standings-count";
    countEl.textContent = wins + " / " + target + (reached ? " 🏁" : "");
    top.appendChild(nameEl);
    top.appendChild(countEl);
    li.appendChild(top);

    var track = document.createElement("div");
    track.className = "standings-bar-track";
    var fill = document.createElement("div");
    fill.className = "standings-bar-fill";
    fill.style.width = Math.min(100, (wins / target) * 100) + "%";
    track.appendChild(fill);
    li.appendChild(track);

    return li;
  }

  function renderStandings() {
    // The team section only makes sense in Teams mode - a player keeps
    // their teamId after switching back to Individual (nothing clears it,
    // since a later switch back to Teams should remember it), so without
    // this gate teamMembersLive() would keep surfacing them under "Team
    // A"/"Team B" even while actually playing individually.
    var isTeamsMode = state.currentGame.mode === "teams";
    standingsTitle.classList.toggle("hidden", !isTeamsMode);
    teamStandingsList.classList.toggle("hidden", !isTeamsMode);

    if (isTeamsMode) {
      standingsTitle.textContent = T("standings.raceToTeams", { target: state.raceToWinsTarget });

      // Teams are tracked per slot ("A"/"B"), not per exact roster combo, so
      // this always shows exactly the two live team slots - a sub joining or
      // leaving mid-race just relabels the row, it doesn't spawn a new one.
      var teamRows = ["A", "B"].filter(function (teamId) {
        return (state.teamWins[teamId] || 0) > 0 || teamMembersLive(teamId).length > 0;
      });

      teamStandingsList.innerHTML = "";
      if (teamRows.length === 0) {
        var teamHint = document.createElement("li");
        teamHint.className = "empty-hint";
        teamHint.textContent = T("standings.noTeamPairings");
        teamStandingsList.appendChild(teamHint);
      } else {
        teamRows
          .map(function (teamId) {
            var namesList = teamMembersLive(teamId).map(function (p) {
              return p.name;
            });
            var names = namesList.length ? namesList.join(" & ") : T(teamId === "A" ? "gameSetup.teamA" : "gameSetup.teamB");
            return { teamId: teamId, names: names, namesList: namesList, wins: state.teamWins[teamId] || 0 };
          })
          .sort(function (a, b) {
            return b.wins - a.wins || a.teamId.localeCompare(b.teamId);
          })
          .forEach(function (row) {
            teamStandingsList.appendChild(buildStandingsRow(row.names, row.wins, row.namesList));
          });
      }
    }

    playerStandingsList.innerHTML = "";
    if (state.players.length === 0) {
      var playerHint = document.createElement("li");
      playerHint.className = "empty-hint";
      playerHint.textContent = T("standings.noPlayersYet");
      playerStandingsList.appendChild(playerHint);
    } else {
      state.players
        .slice()
        .sort(function (a, b) {
          return (state.playerWins[b.id] || 0) - (state.playerWins[a.id] || 0) || a.name.localeCompare(b.name);
        })
        .forEach(function (p) {
          playerStandingsList.appendChild(buildStandingsRow(p.name, state.playerWins[p.id] || 0, [p.name]));
        });
    }

    setPanelSummary("standings-panel", computeStandingsSummary());
  }

  function computeStandingsSummary() {
    if (state.players.length === 0) return T("standings.noPlayersYet");
    var sorted = state.players.slice().sort(function (a, b) {
      return (state.playerWins[b.id] || 0) - (state.playerWins[a.id] || 0) || a.name.localeCompare(b.name);
    });
    var leader = sorted[0];
    var leaderWins = state.playerWins[leader.id] || 0;
    if (leaderWins === 0) return T("standings.noGamesWonYet");
    return T(leaderWins === 1 ? "standings.leaderSummaryOne" : "standings.leaderSummaryMany", {
      name: leader.name,
      wins: leaderWins,
      target: state.raceToWinsTarget
    });
  }

  function computePlayersSummary() {
    if (state.players.length === 0) return T("players.noPlayersYetSummary");
    var playingCount = state.players.filter(function (p) {
      return p.playing;
    }).length;
    var names = state.players
      .map(function (p) {
        return p.name;
      })
      .join(", ");
    return T(state.players.length === 1 ? "players.summaryOne" : "players.summaryMany", {
      count: state.players.length,
      playing: playingCount,
      names: names
    });
  }

  // Above ~20 games per leg, individual nodes stop being useful (too
  // cramped to read) - the track falls back to a plain proportional fill
  // instead of one node per game.
  var ROTATION_TRACK_MAX_NODES = 20;

  // A little dot-and-line track between the ◀/▶ buttons: one node per
  // game in the current leg, with the game just played (playedInLeg)
  // shown as a bigger, accent-colored node so a glance shows exactly
  // where the countdown to the next switch stands.
  function renderRotationPositionTrack(info) {
    rotationPositionTrack.innerHTML = "";
    if (info.every > ROTATION_TRACK_MAX_NODES) {
      var fill = document.createElement("div");
      fill.className = "rotation-position-fill-track";
      var bar = document.createElement("div");
      bar.className = "rotation-position-fill-bar";
      bar.style.width = (info.playedInLeg / info.every) * 100 + "%";
      fill.appendChild(bar);
      rotationPositionTrack.appendChild(fill);
      return;
    }
    for (var i = 0; i < info.every; i++) {
      if (i > 0) {
        var connector = document.createElement("span");
        connector.className = "rotation-position-connector";
        rotationPositionTrack.appendChild(connector);
      }
      var node = document.createElement("span");
      node.className = "rotation-position-node" + (i === info.playedInLeg ? " is-current" : "");
      rotationPositionTrack.appendChild(node);
    }
  }

  // Shows the current rotation step (with ◀/▶ hand-correction buttons)
  // right under the "Now Playing" banner - see moveRotationPosition.
  // Hidden whenever rotation isn't actually running (off, or fewer
  // than 2 game types to rotate through).
  function renderRotationPositionControl() {
    var info = rotationStatusInfo();
    rotationPositionRow.classList.toggle("hidden", !info);
    if (!info) return;
    renderRotationPositionTrack(info);
    rotationPositionText.textContent = T("players.rotationPosition", {
      label: info.currentLabel,
      played: info.playedInLeg,
      every: info.every
    });
  }

  function renderRoster() {
    rosterList.innerHTML = "";
    if (state.players.length === 0) {
      var hint = document.createElement("li");
      hint.className = "empty-hint";
      hint.textContent = T("players.addToGetStarted");
      rosterList.appendChild(hint);
      setPanelSummary("players-panel", computePlayersSummary());
      renderPlayingToggleListInto(focusPlayersList, T("players.noPlayersYetPanel"));
      focusPlayersSummary.textContent = T("players.heading");
      return;
    }
    var showTeamToggle = state.currentGame.mode === "teams";

    state.players.forEach(function (p) {
      var row = document.createElement("li");
      row.className = "roster-row" + (p.playing ? " is-playing" : "");

      var name = document.createElement("span");
      name.className = "roster-name";
      buildPlayerNameLabel(name, p.name, false);
      row.appendChild(name);
      row.appendChild(buildRatingBadge(p.name));

      var editRatingBtn = document.createElement("button");
      editRatingBtn.type = "button";
      editRatingBtn.className = "roster-edit-rating-btn";
      editRatingBtn.setAttribute("aria-label", T("common.editRatingFor", { name: p.name }));
      editRatingBtn.textContent = "✏️";
      editRatingBtn.addEventListener("click", function () {
        openRatingEditPopup(p.name);
      });
      row.appendChild(editRatingBtn);

      var playBtn = document.createElement("button");
      playBtn.type = "button";
      playBtn.className = "btn-playing" + (p.playing ? " is-on" : "");
      playBtn.textContent = T(p.playing ? "players.playing" : "players.standby");
      playBtn.addEventListener("click", function () {
        togglePlaying(p.id);
      });
      row.appendChild(playBtn);

      if (showTeamToggle && p.playing) {
        var toggle = document.createElement("div");
        toggle.className = "team-toggle";
        ["A", "B"].forEach(function (teamId) {
          var btn = document.createElement("button");
          btn.type = "button";
          btn.textContent = teamId;
          if (p.teamId === teamId) btn.classList.add("is-selected");
          btn.addEventListener("click", function () {
            setPlayerTeam(p.id, teamId);
          });
          toggle.appendChild(btn);
        });
        row.appendChild(toggle);
      }

      var statsBtn = document.createElement("button");
      statsBtn.type = "button";
      statsBtn.className = "roster-stats-btn";
      statsBtn.setAttribute("aria-label", "View stats for " + p.name);
      statsBtn.textContent = "📊";
      statsBtn.addEventListener("click", function () {
        openPlayerStatsPage(p.name);
      });
      row.appendChild(statsBtn);

      var removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "roster-remove";
      removeBtn.setAttribute("aria-label", "Remove " + p.name);
      removeBtn.textContent = "×";
      removeBtn.addEventListener("click", function () {
        removePlayer(p.id);
      });
      row.appendChild(removeBtn);

      rosterList.appendChild(row);
    });

    setPanelSummary("players-panel", computePlayersSummary());
    renderPlayingToggleListInto(focusPlayersList, T("players.noPlayersYetPanel"));
    var playingCount = state.players.filter(function (p) {
      return p.playing;
    }).length;
    focusPlayersSummary.textContent = T("players.playingOfTotal", { playing: playingCount, total: state.players.length });
  }

  function buildFlagSpan() {
    var flag = document.createElement("span");
    flag.className = "flag";
    flag.textContent = "🏁";
    return flag;
  }

  function buildStatMini(label, value, milestoneReached, extraClass) {
    var el = document.createElement("div");
    el.className = "stat-mini" + (extraClass ? " " + extraClass : "");
    var strong = document.createElement("strong");
    strong.textContent = value;
    el.appendChild(document.createTextNode(label + ": "));
    el.appendChild(strong);
    if (milestoneReached) el.appendChild(buildFlagSpan());
    return el;
  }

  function buildBallControls(player, disabled) {
    var controls = document.createElement("div");
    controls.className = "ball-controls";

    var minusBtn = document.createElement("button");
    minusBtn.type = "button";
    minusBtn.className = "btn-ball minus";
    minusBtn.textContent = "−";
    minusBtn.setAttribute("aria-label", "Remove point for " + player.name);
    var minusAllowNegative = quickCounterMode || state.currentGame.unit !== "rack";
    minusBtn.disabled = disabled || (!minusAllowNegative && (player.balls || 0) <= 0);
    minusBtn.addEventListener("click", function () {
      adjustScore(player.id, -1);
    });

    var plusBtn = document.createElement("button");
    plusBtn.type = "button";
    plusBtn.className = "btn-ball plus";
    plusBtn.textContent = "+";
    plusBtn.setAttribute("aria-label", "Add point for " + player.name);
    plusBtn.disabled = disabled;
    plusBtn.addEventListener("click", function () {
      adjustScore(player.id, 1);
    });

    controls.appendChild(minusBtn);
    controls.appendChild(plusBtn);
    return controls;
  }

  // Commits an inline rename from a Quick Counter name field. Routes
  // through the same resolvePlayerName/duplicate-check path as adding a
  // player normally, so casing and uniqueness rules stay identical.
  function renamePlayerInline(id, newName) {
    var player = getPlayer(id);
    if (!player) return;
    var resolved = resolvePlayerName(newName);
    if (!resolved || resolved === player.name) {
      renderAll();
      return;
    }
    if (normalizeNameKey(resolved) !== normalizeNameKey(player.name) && isDuplicatePlayerName(resolved)) {
      showToast(T("toast.alreadyInRoster", { name: resolved }));
      renderAll();
      return;
    }
    player.name = resolved;
    saveState();
    renderAll();
  }

  // Quick Counter's version of a player card: editable name, a plain
  // running tally (no target, no win detection — see adjustScore), and a
  // dedicated remove-this-player control distinct from the −/+ tally
  // buttons. Reuses buildBallControls since adjustScore already branches
  // on quickCounterMode.
  function buildQuickCounterPanel(player) {
    var panel = document.createElement("div");
    panel.className = "player-panel quick-counter-panel";

    var nameRow = document.createElement("div");
    nameRow.className = "quick-counter-name-row";

    var nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "quick-counter-name-input";
    nameInput.value = player.name;
    nameInput.autocomplete = "off";
    nameInput.setAttribute("aria-label", "Rename " + player.name);
    nameInput.addEventListener("change", function () {
      renamePlayerInline(player.id, nameInput.value);
    });
    nameInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        nameInput.blur();
      }
    });
    nameRow.appendChild(nameInput);

    var removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "quick-counter-remove-player";
    removeBtn.textContent = "−";
    removeBtn.setAttribute("aria-label", "Remove " + player.name);
    removeBtn.addEventListener("click", function () {
      removePlayer(player.id);
    });
    nameRow.appendChild(removeBtn);

    panel.appendChild(nameRow);

    var value = document.createElement("div");
    value.className = "stat-value";
    value.textContent = player.balls || 0;
    panel.appendChild(value);

    panel.appendChild(buildBallControls(player, false));
    markAsKeypadTarget(panel, player);

    return panel;
  }

  // The "+" side of Quick Counter: a name field plus an Add button, always
  // rendered at the end of the scoreboard grid so a new player can be
  // dropped in without leaving the focus view. Added players start
  // "Playing" immediately — there's no separate roster panel in this mode.
  function buildQuickCounterAddRow() {
    var row = document.createElement("div");
    row.className = "quick-counter-add-row";

    var input = document.createElement("input");
    input.type = "text";
    input.className = "quick-counter-add-input";
    input.placeholder = T("players.namePlaceholder");
    input.autocomplete = "off";

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-primary quick-counter-add-btn";
    btn.textContent = T("players.addPlayerBtn");

    function submit() {
      var name = input.value.trim();
      if (!name) return;
      // A name that matches someone already on standby (e.g. dropped by a
      // list load) reactivates them instead of being rejected as a
      // duplicate — otherwise there'd be no way to bring them back from
      // this minimal view.
      var key = normalizeNameKey(resolvePlayerName(name));
      var existing = state.players.filter(function (p) {
        return normalizeNameKey(p.name) === key;
      })[0];
      if (existing) {
        if (existing.playing) {
          showToast(T("toast.alreadyInRoster", { name: existing.name }));
          return;
        }
        existing.playing = true;
        saveState();
        renderAll();
        return;
      }
      var player = addPlayer(name);
      if (!player) return;
      player.playing = true;
      saveState();
      renderAll();
    }

    btn.addEventListener("click", submit);
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        submit();
      }
    });

    row.appendChild(input);
    row.appendChild(btn);
    return row;
  }

  // Quick Counter's "Load Player List": picks a saved list and makes the
  // active set match it exactly (see loadPlayerListForQuickCounter) — the
  // fast way to swap in a known group instead of adding everyone by hand.
  // Always renders (disabled with an explanatory option when there's
  // nothing saved yet) rather than disappearing outright, so the control
  // doesn't look missing — mirrors the main page's roster-load row.
  function buildQuickCounterLoadRow() {
    var row = document.createElement("div");
    row.className = "quick-counter-load-row";

    var select = document.createElement("select");
    select.className = "quick-counter-load-select";

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-ghost quick-counter-load-btn";
    btn.textContent = T("players.loadPlayerListBtn");

    if (SAVED_ROSTERS.length === 0) {
      var opt = document.createElement("option");
      opt.value = "";
      opt.textContent = T("players.noSavedListsYet");
      select.appendChild(opt);
      select.disabled = true;
      btn.disabled = true;
    } else {
      SAVED_ROSTERS.forEach(function (r, i) {
        var o = document.createElement("option");
        o.value = String(i);
        o.textContent = r.label;
        select.appendChild(o);
      });
      btn.addEventListener("click", function () {
        loadPlayerListForQuickCounter(select.value);
      });
    }

    var resetBtn = document.createElement("button");
    resetBtn.type = "button";
    resetBtn.className = "btn btn-ghost quick-counter-reset-btn";
    resetBtn.textContent = T("players.resetAllToZero");
    resetBtn.addEventListener("click", function () {
      resetGameBalls();
      saveState();
      renderAll();
    });

    row.appendChild(select);
    row.appendChild(btn);
    row.appendChild(resetBtn);
    return row;
  }

  function buildIndividualPanel(player) {
    var panel = document.createElement("div");
    panel.className = "player-panel";

    var name = document.createElement("div");
    name.className = "player-name";
    buildPlayerNameLabel(name, player.name, false);
    name.appendChild(buildRatingBadge(player.name));
    name.appendChild(buildPlayerLinkIcon(player.name));
    panel.appendChild(name);

    var wins = state.playerWins[player.id] || 0;

    // A single-rack game (the common case - standard 8-Ball etc.) has no
    // meaningful "current rack progress" number to show (it's just 0
    // until the rack is won, then resets) - show the session win count
    // big and prominent instead. Anything else (multiple racks to win
    // one game, or a balls/points game) still shows the ball/point
    // count toward this game's target, with the win count as a small
    // badge above it.
    var isSingleRackGame = state.currentGame.unit === "rack" && state.currentGame.target === 1;

    if (!isSingleRackGame) {
      panel.appendChild(buildStatMini(T("scoreboard.tourneyWin"), wins, wins >= state.raceToWinsTarget, "stat-mini-tourney"));
    }

    var block = document.createElement("div");
    block.className = "stat-block";
    var label = document.createElement("div");
    label.className = "stat-label";
    var value = document.createElement("div");
    value.className = "stat-value";
    if (isSingleRackGame) {
      label.textContent = T("scoreboard.tourneyWin");
      value.textContent = wins;
      if (wins >= state.raceToWinsTarget) value.appendChild(buildFlagSpan());
    } else {
      label.textContent = T("scoreboard.gameTargetLabel", { game: GAME_TYPES[state.currentGame.gameType].label, target: state.currentGame.target });
      value.textContent = player.balls || 0;
    }
    block.appendChild(label);
    block.appendChild(value);
    panel.appendChild(block);

    panel.appendChild(buildBallControls(player, false));
    markAsKeypadTarget(panel, player);

    return panel;
  }

  function buildMemberCard(player, disabled) {
    var card = document.createElement("div");
    card.className = "member-card";

    var name = document.createElement("div");
    name.className = "member-name";
    buildPlayerNameLabel(name, player.name, false);
    name.appendChild(buildPlayerLinkIcon(player.name));
    card.appendChild(name);

    // Not the team's win count (that's the team panel's own badge) - this
    // tracks how many times THIS member specifically potted the winning
    // ball for the team (see the mvp selection in creditWin).
    var mvpWins = state.teamMvpWins[player.id] || 0;
    card.appendChild(buildStatMini(T("scoreboard.tourneyWin"), mvpWins, mvpWins >= state.raceToWinsTarget, "stat-mini-tourney"));

    var value = document.createElement("div");
    value.className = "stat-value small";
    value.textContent = player.balls || 0;
    card.appendChild(value);

    card.appendChild(buildBallControls(player, disabled));
    markAsKeypadTarget(card, player);

    return card;
  }

  // opponentEmpty: the other team ("A"/"B") currently has nobody on it -
  // a team can't play (or score) alone, so this shows a warning instead of
  // the usual win-progress stat and disables every member's +/- (the real
  // enforcement is adjustScore's own check; this is just the matching UI).
  function buildTeamPanel(teamId, members, opponentEmpty) {
    var panel = document.createElement("div");
    panel.className = "team-panel";

    var name = document.createElement("div");
    name.className = "team-name";
    name.textContent = teamLabelLive(teamId);
    panel.appendChild(name);

    if (opponentEmpty) {
      var warning = document.createElement("div");
      warning.className = "team-needs-opponent-warning";
      warning.textContent = T("scoreboard.teamNeedsOpponent");
      panel.appendChild(warning);
    }

    var wins = state.teamWins[teamId] || 0;

    // A single-rack game (the common case - standard 8-Ball etc.) has no
    // meaningful "current rack progress" number to show (it's just 0 until
    // the rack is won, then resets) - show the session win count big and
    // prominent instead. Anything else (multiple racks to win one game, or
    // a balls/points game) still shows the team's current-game total.
    var isSingleRackGame = state.currentGame.unit === "rack" && state.currentGame.target === 1;

    if (!isSingleRackGame) {
      panel.appendChild(buildStatMini(T("scoreboard.pairedSessionWin"), wins, wins >= state.raceToWinsTarget));
    }

    var block = document.createElement("div");
    block.className = "stat-block";
    var label = document.createElement("div");
    label.className = "stat-label";
    var value = document.createElement("div");
    value.className = "stat-value";
    if (isSingleRackGame) {
      label.textContent = T("scoreboard.pairedSessionWinScore");
      value.textContent = wins;
      if (wins >= state.raceToWinsTarget) value.appendChild(buildFlagSpan());
    } else {
      label.textContent = T("scoreboard.gameTargetLabel", { game: GAME_TYPES[state.currentGame.gameType].label, target: state.currentGame.target });
      value.textContent = sumTeamBalls(teamId);
    }
    block.appendChild(label);
    block.appendChild(value);
    panel.appendChild(block);

    var memberWrap = document.createElement("div");
    memberWrap.className = "team-members";
    members.forEach(function (p) {
      memberWrap.appendChild(buildMemberCard(p, opponentEmpty));
    });
    panel.appendChild(memberWrap);

    return panel;
  }

  function renderNowPlayingBanner() {
    var type = GAME_TYPES[state.currentGame.gameType];
    nowPlayingBanner.innerHTML = "";
    nowPlayingBanner.appendChild(document.createTextNode(T("scoreboard.nowPlayingBanner", { label: type.label })));
    var note = document.createElement("span");
    note.className = "target-note";
    note.textContent = T("gameSetup.targetNote", { target: state.currentGame.target, unit: state.currentGame.unit });
    nowPlayingBanner.appendChild(note);

    var rotationInfo = rotationStatusInfo();
    if (rotationInfo) {
      var rotationNote = document.createElement("span");
      rotationNote.className = "rotation-note";
      rotationNote.textContent = T(rotationInfo.untilSwitch === 1 ? "rotation.statusSwitchesInOne" : "rotation.statusSwitchesInMany", {
        next: rotationInfo.nextLabel,
        count: rotationInfo.untilSwitch
      });
      nowPlayingBanner.appendChild(rotationNote);
    }
    renderRotationPositionControl();

    var duration = document.createElement("span");
    duration.className = "game-duration-live";
    duration.id = "game-duration-live";
    nowPlayingBanner.appendChild(duration);
    updateGameDurationDisplay();
  }

  function updateGameDurationDisplay() {
    var el = document.getElementById("game-duration-live");
    if (!el || !state.currentGame.startedAt) return;
    var startedAt = new Date(state.currentGame.startedAt).getTime();
    if (isNaN(startedAt)) return;
    el.textContent = T("scoreboard.durationLive", { time: formatDuration(Date.now() - startedAt) });
  }

  function renderScoreboard() {
    var active = activePlayers();

    if (quickCounterMode) {
      nowPlayingBanner.innerHTML = "";
      rotationPositionRow.classList.add("hidden");
      scoreboard.innerHTML = "";
      scoreboard.className = "scoreboard scoreboard-quick";
      var loadRow = buildQuickCounterLoadRow();
      if (loadRow) scoreboard.appendChild(loadRow);
      active.forEach(function (p) {
        scoreboard.appendChild(buildQuickCounterPanel(p));
      });
      scoreboard.appendChild(buildQuickCounterAddRow());
      refreshKeypadNumbering();
      return;
    }

    renderNowPlayingBanner();
    scoreboard.innerHTML = "";

    if (active.length === 0) {
      scoreboard.className = "scoreboard";
      var hint = document.createElement("div");
      hint.className = "empty-hint";
      hint.textContent = T("scoreboard.markPlayingHint");
      scoreboard.appendChild(hint);
      refreshKeypadNumbering();
      return;
    }

    if (state.currentGame.mode === "teams") {
      scoreboard.className = "scoreboard scoreboard-teams";
      var teamAMembers = teamMembersLive("A");
      var teamBMembers = teamMembersLive("B");
      [
        { id: "A", members: teamAMembers, opponentEmpty: teamBMembers.length === 0 },
        { id: "B", members: teamBMembers, opponentEmpty: teamAMembers.length === 0 }
      ].forEach(function (team) {
        if (!team.members.length) return;
        scoreboard.appendChild(buildTeamPanel(team.id, team.members, team.opponentEmpty));
      });
    } else {
      scoreboard.className = "scoreboard";
      active.forEach(function (p) {
        scoreboard.appendChild(buildIndividualPanel(p));
      });
    }
    refreshKeypadNumbering();
  }

  function formatTimestamp(ts, includeDate) {
    var d = new Date(ts);
    if (!ts || isNaN(d.getTime())) return "";
    var timePart = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    if (!includeDate) return timePart;
    return formatDateISO(d) + " · " + timePart;
  }

  function formatDuration(ms) {
    if (typeof ms !== "number" || isNaN(ms)) return "";
    var totalSec = Math.round(ms / 1000);
    var m = Math.floor(totalSec / 60);
    var s = totalSec % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  // Today's games, most-recent first — spans however many races/sessions
  // have already been completed (and auto-saved) today, not just the
  // still-open live one, so this list doesn't go back to empty every time
  // someone reaches the race target and startNewSession() clears
  // state.gameHistory for the next race.
  function recentHistoryGames() {
    return computeDayReportData(todayDateStr()).games.slice().reverse();
  }

  function computeHistorySummary() {
    var n = recentHistoryGames().length;
    return n === 0 ? "No games in the last 24 hours." : n + " game" + (n === 1 ? "" : "s") + " in the last 24 hours.";
  }

  function renderHistory() {
    historyList.innerHTML = "";
    var games = recentHistoryGames();
    setPanelSummary("history-panel", computeHistorySummary());
    if (games.length === 0) {
      var hint = document.createElement("li");
      hint.className = "empty-hint";
      hint.textContent = T("history.noGamesToday");
      historyList.appendChild(hint);
      return;
    }
    games.forEach(function (entry) {
      var li = document.createElement("li");
      if (entry.wonRace) li.classList.add("history-race-win-item");
      var timeSpan = document.createElement("span");
      timeSpan.className = "history-date";
      timeSpan.textContent = formatTimestamp(entry.ts, true);
      li.appendChild(timeSpan);
      var durationText = formatDuration(entry.durationMs);
      if (durationText) {
        var durationSpan = document.createElement("span");
        durationSpan.className = "history-duration";
        durationSpan.textContent = T("common.duration", { time: durationText });
        li.appendChild(durationSpan);
      }
      var winner = document.createElement("strong");
      winner.className = "history-winner";
      winner.appendChild(document.createTextNode("🏆 "));
      entry.winnerNames.forEach(function (n, i) {
        if (i > 0) winner.appendChild(document.createTextNode(" & "));
        winner.appendChild(document.createTextNode(n));
        winner.appendChild(buildRatingBadge(n));
        var delta = getPlayerRatingDeltaForGame(n, entry.ts);
        if (delta !== null) {
          var deltaSpan = document.createElement("span");
          deltaSpan.className = "history-rating-delta " + (delta > 0 ? "is-up" : delta < 0 ? "is-down" : "");
          deltaSpan.textContent = delta > 0 ? " (▲" + delta + ")" : delta < 0 ? " (▼" + delta + ")" : " (—)";
          winner.appendChild(deltaSpan);
        }
      });
      li.appendChild(winner);
      li.appendChild(document.createTextNode(" " + T("history.wonGameTarget", { game: entry.gameLabel, target: entry.target })));
      if (entry.isTeam && entry.mvpName) {
        li.appendChild(document.createTextNode(" · " + T("history.pottedIt", { name: entry.mvpName })));
        li.appendChild(buildRatingBadge(entry.mvpName));
      }
      if (entry.wonRace) {
        var raceBanner = document.createElement("div");
        raceBanner.className = "history-race-banner";
        raceBanner.textContent = T("history.wonRaceSession", { names: entry.winnerNames.join(" & "), target: entry.raceTarget });
        li.appendChild(raceBanner);
      }
      historyList.appendChild(li);
    });
  }

  // ---------------------------------------------------------------------
  // Player management
  // ---------------------------------------------------------------------

  // Maps every name we've ever seen (any case) to one canonical display
  // casing, so "Bob" and "bob" always resolve to the same person. The
  // live roster's casing wins ties (checked last), since that's what's
  // currently on screen; PLAYER_STATS and unsaved game history fill in
  // anyone not currently on the roster.
  function buildNameCasingMap() {
    var map = {};
    Object.keys(PLAYER_STATS).forEach(function (n) {
      map[normalizeNameKey(n)] = n;
    });
    (state.gameHistory || []).forEach(function (entry) {
      if (!entry || typeof entry === "string") return;
      (entry.winnerNames || []).concat(entry.opponentNames || []).forEach(function (n) {
        map[normalizeNameKey(n)] = n;
      });
    });
    state.players.forEach(function (p) {
      map[normalizeNameKey(p.name)] = p.name;
    });
    return map;
  }

  // Capitalizes the first letter of every word without touching the rest
  // ("bob smith" -> "Bob Smith"), so intentional casing elsewhere in a
  // name (e.g. "McDonald") is left alone.
  function capitalizeName(name) {
    return (name || "").replace(/\S+/g, function (word) {
      return word.charAt(0).toUpperCase() + word.slice(1);
    });
  }

  // Reuses an existing name's casing if this is the same person under a
  // different case ("bob" typed when "Bob" is already known), otherwise
  // capitalizes the typed name to become the new canonical form. The known
  // casing is still run through capitalizeName — old data saved before
  // capitalization was enforced everywhere could have a lowercase "known"
  // entry, and matching on identity should never resurrect that casing.
  function resolvePlayerName(name) {
    var trimmed = capitalizeName((name || "").trim());
    if (!trimmed) return trimmed;
    var known = buildNameCasingMap()[normalizeNameKey(trimmed)];
    return known ? capitalizeName(known) : trimmed;
  }

  // True if this name (any case) already belongs to someone on the live
  // roster — used to block adding a second player under the same nickname.
  function isDuplicatePlayerName(name) {
    var key = normalizeNameKey(name);
    if (!key) return false;
    return state.players.some(function (p) {
      return normalizeNameKey(p.name) === key;
    });
  }

  // Live-updates the Add button + the red requirement note as the name
  // field changes, so a duplicate (or empty) name can never be submitted.
  // The note only shows when there's an actual conflict to report.
  function validateNewPlayerNameInput() {
    var trimmed = newPlayerName.value.trim();
    var duplicate = trimmed && isDuplicatePlayerName(trimmed);
    btnAddPlayer.disabled = !trimmed || duplicate;
    if (duplicate) {
      newPlayerNameRequirement.textContent =
        T("players.duplicateNameHint", { name: capitalizeName(trimmed) });
      newPlayerNameRequirement.classList.remove("hidden");
    } else {
      newPlayerNameRequirement.classList.add("hidden");
    }
  }

  // startingRating (optional): a known rating from outside this device
  // (another league, another tournament) — applied only if this exact
  // name has never been automatically rated here before, so it can never
  // overwrite a rating this app has already been tracking.
  function addPlayer(name, startingRating) {
    name = resolvePlayerName(name);
    if (!name) return null;
    var player = {
      id: uid(),
      name: name,
      voice: state.players.length % VOICE_PITCHES.length,
      playing: false,
      teamId: null,
      balls: 0
    };
    state.players.push(player);
    saveState();
    recordPlayerAddedIfNew(name);
    clearPlayerRemoved(name);
    if (typeof startingRating === "number" && !isNaN(startingRating) && !findRatingKey(name)) {
      var entry = ensureRatingEntry(name);
      entry.rating = startingRating;
      saveRatingsToStorage(PLAYER_RATINGS);
    }
    return player;
  }

  // Just takes them off today's active list — their saved career stats
  // and game history stay on this device and still show up on the All
  // Players page, so there's nothing here worth confirming. Doesn't touch
  // the saved player lists (see saveRosterSnapshotIfNew) - that only
  // happens when a new game/session actually starts, not on every roster
  // edit. Does record the removal (see markPlayerRemoved) so a later
  // import of an old backup that still lists this name won't silently
  // re-add them.
  function removePlayer(id) {
    var player = getPlayer(id);
    state.players = state.players.filter(function (p) {
      return p.id !== id;
    });
    delete state.playerWins[id];
    delete state.teamMvpWins[id];
    saveState();
    if (player) markPlayerRemoved(player.name);
    validateNewPlayerNameInput();
    renderAll();
  }

  function togglePlaying(id) {
    var p = getPlayer(id);
    if (!p) return;
    p.playing = !p.playing;
    p.balls = 0;
    if (p.playing && !p.teamId) p.teamId = "A";
    saveState();
    renderAll();
  }

  function setPlayerTeam(id, teamId) {
    var p = getPlayer(id);
    if (!p) return;
    p.teamId = teamId;
    saveState();
    renderAll();
  }

  // ---------------------------------------------------------------------
  // Scoring
  // ---------------------------------------------------------------------

  function showToast(message) {
    winToast.textContent = "🏆 " + message;
    winToast.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      winToast.classList.add("hidden");
    }, 4500);
  }

  function creditWin(isTeam, key, winnerVoice) {
    var typeLabel = GAME_TYPES[state.currentGame.gameType].label;
    var summary;
    var winnerNames;
    var winnerIds;
    var opponentNames;
    var teamComboKeyValue = null;
    var milestoneNames = null;
    var milestoneCount = 0;
    var onHillNames = null;
    var target = state.raceToWinsTarget;
    var mvpId = null;
    var mvpName = null;
    if (isTeam) {
      var members = teamMembersLive(key);
      var otherTeamId = key === "A" ? "B" : "A";
      opponentNames = teamMembersLive(otherTeamId).map(function (p) {
        return p.name;
      });
      winnerNames = members.map(function (p) {
        return p.name;
      });
      winnerIds = members.map(function (p) {
        return p.id;
      });
      // Tallied by team slot ("A"/"B"), not by the exact roster combo, so a
      // sub joining/leaving mid-race (add player, standby toggle, team
      // reassignment) doesn't fragment the running win count into a "new"
      // pairing starting at 0 - see the session-reset bug this fixed.
      teamComboKeyValue = teamComboKey(key);
      var newTeamWins = (state.teamWins[key] || 0) + 1;
      state.teamWins[key] = newTeamWins;
      members.forEach(function (p) {
        state.playerWins[p.id] = (state.playerWins[p.id] || 0) + 1;
      });
      var mvp = members.reduce(function (best, p) {
        return !best || (p.balls || 0) > (best.balls || 0) ? p : best;
      }, null);
      if (mvp) {
        mvpId = mvp.id;
        mvpName = mvp.name;
        state.teamMvpWins[mvp.id] = (state.teamMvpWins[mvp.id] || 0) + 1;
      }
      summary = teamLabelLive(key) + " won " + typeLabel + " (target " + state.currentGame.target + ")";
      if (target > 0 && newTeamWins % target === 0) {
        milestoneNames = winnerNames.join(" & ");
        milestoneCount = newTeamWins;
      } else if (target > 1 && newTeamWins % target === target - 1) {
        onHillNames = teamLabelLive(key);
      }
    } else {
      winnerNames = [getPlayer(key).name];
      winnerIds = [key];
      mvpId = key;
      mvpName = getPlayer(key).name;
      opponentNames = activePlayers()
        .filter(function (p) {
          return p.id !== key;
        })
        .map(function (p) {
          return p.name;
        });
      var newPlayerWins = (state.playerWins[key] || 0) + 1;
      state.playerWins[key] = newPlayerWins;
      summary = getPlayer(key).name + " won " + typeLabel + " (target " + state.currentGame.target + ")";
      if (target > 0 && newPlayerWins % target === 0) {
        milestoneNames = getPlayer(key).name;
        milestoneCount = newPlayerWins;
      } else if (target > 1 && newPlayerWins % target === target - 1) {
        onHillNames = getPlayer(key).name;
      }
    }
    var startedAt = state.currentGame.startedAt ? new Date(state.currentGame.startedAt).getTime() : null;
    var durationMs = startedAt ? Math.max(0, Date.now() - startedAt) : null;
    var ts = new Date().toISOString();
    state.gameHistory.unshift({
      ts: ts,
      gameType: state.currentGame.gameType,
      gameLabel: typeLabel,
      target: state.currentGame.target,
      winnerNames: winnerNames,
      winnerIds: winnerIds,
      isTeam: isTeam,
      teamId: isTeam ? key : null,
      teamComboKey: teamComboKeyValue,
      opponentNames: opponentNames,
      mvpId: mvpId,
      mvpName: mvpName,
      durationMs: durationMs,
      summary: summary,
      wonRace: !!milestoneNames,
      raceTarget: target,
      raceCount: milestoneCount,
      ballsLeftOnTable: null
    });
    if (state.gameHistory.length > 200) state.gameHistory.length = 200;
    if (!noStatsMode) {
      if (isTeam) {
        applyTeamRatingResult(winnerNames, opponentNames, ts);
      } else {
        opponentNames.forEach(function (opponentName) {
          applyPairwiseRatingResult(winnerNames[0], opponentName, ts);
        });
      }
      saveRatingsToStorage(PLAYER_RATINGS);
    }
    state.gamesPlayedCount += 1;
    saveRotationSnapshotIfNew(true);
    var previousGameType = state.currentGame.gameType;
    var previousTarget = state.currentGame.target;
    var previousUnit = state.currentGame.unit;
    applyRotationIfDue();
    var gameTypeChanged = state.currentGame.gameType !== previousGameType ||
      state.currentGame.target !== previousTarget || state.currentGame.unit !== previousUnit;

    resetGameBalls();
    saveState();
    playWinSound(winnerVoice);
    renderAll();

    showToast(summary);
    // The balls-left counter needs to be set (or skipped) before any of
    // these run, since celebrateTournamentWin archives this exact game
    // and resets the session — deferred to showGameWinOverlay's onClose.
    showGameWinOverlay(summary, ts, function () {
      if (milestoneNames) {
        celebrateTournamentWin(milestoneNames, milestoneCount);
      } else if (onHillNames) {
        announceOnHill(onHillNames);
      } else if (gameTypeChanged) {
        announceGameChange(
          GAME_TYPES[state.currentGame.gameType].label + " (" + state.currentGame.target + " " + unitLabel(state.currentGame.unit) + ")"
        );
      }
    });
    return summary;
  }

  // Reverses every rating-history entry stamped with this exact game's ts,
  // for everyone whose rating it touched (winner(s) and opponent(s)) - the
  // exact inverse of bumpPlayerRating. A free-for-all win against N
  // opponents stamps the winner with N separate pairwise entries at the
  // same ts (one per applyPairwiseRatingResult call in recordWin), so this
  // pops all of them for that player, not just one.
  function retrogradeRatingsForGame(entry) {
    var names = (entry.winnerNames || []).concat(entry.opponentNames || []);
    var seen = {};
    var changed = false;
    names.forEach(function (name) {
      if (seen[name]) return;
      seen[name] = true;
      var key = findRatingKey(name);
      if (!key) return;
      var ratingEntry = PLAYER_RATINGS[key];
      var history = ratingEntry.history || [];
      while (history.length && history[history.length - 1].ts === entry.ts) {
        var popped = history.pop();
        ratingEntry.rating -= popped.delta;
        if (popped.fromGame) ratingEntry.gamesPlayed = Math.max(0, ratingEntry.gamesPlayed - 1);
        changed = true;
      }
    });
    if (changed) saveRatingsToStorage(PLAYER_RATINGS);
  }

  // Undoes every rating change (from a game or a hand-entered override)
  // stamped at or after this instant, for every rated player - used by
  // "reset today's stats" so a day restarted from scratch also restarts
  // today's rating movement, not just the win/loss counts.
  // Returns name -> popped history entries (newest first), so callers
  // that need a recovery snapshot (see resetTodayStats) know exactly what
  // was reverted, instead of having to diff PLAYER_RATINGS before/after.
  function revertRatingsChangedSince(startMs) {
    var changed = false;
    var popped = {};
    Object.keys(PLAYER_RATINGS).forEach(function (key) {
      var entry = PLAYER_RATINGS[key];
      var history = entry.history || [];
      while (history.length) {
        var last = history[history.length - 1];
        var t = last.ts ? new Date(last.ts).getTime() : NaN;
        if (isNaN(t) || t < startMs) break;
        history.pop();
        entry.rating -= last.delta;
        if (last.fromGame) entry.gamesPlayed = Math.max(0, entry.gamesPlayed - 1);
        changed = true;
        if (!popped[key]) popped[key] = [];
        popped[key].push(last);
      }
    });
    if (changed) saveRatingsToStorage(PLAYER_RATINGS);
    return popped;
  }

  // Reverses the win-count, rating, rotation-position and history
  // bookkeeping for state.gameHistory[0] and removes it - the shared core
  // behind every "undo the last game" entry point (the standalone button,
  // the win popup's, and the tournament popup's) so ratings and
  // gamesPlayedCount stay correct no matter which one was clicked. No
  // confirm dialog or UI feedback of its own - callers own that. Returns
  // the undone entry, or null if there was nothing to undo.
  function retrogradeLastGame() {
    var entry = state.gameHistory[0];
    if (!entry || typeof entry === "string" || !entry.winnerIds) return null;
    entry.winnerIds.forEach(function (id) {
      state.playerWins[id] = Math.max(0, (state.playerWins[id] || 0) - 1);
    });
    if (entry.isTeam && entry.teamId) {
      state.teamWins[entry.teamId] = Math.max(0, (state.teamWins[entry.teamId] || 0) - 1);
      if (entry.mvpId) {
        state.teamMvpWins[entry.mvpId] = Math.max(0, (state.teamMvpWins[entry.mvpId] || 0) - 1);
      }
    }
    retrogradeRatingsForGame(entry);
    state.gameHistory.shift();
    state.gamesPlayedCount = Math.max(0, state.gamesPlayedCount - 1);
    applyRotationIfDue();
    return entry;
  }

  function undoLastWin() {
    var entry = state.gameHistory[0];
    if (!entry || typeof entry === "string" || !entry.winnerIds) {
      showToast(T("toast.noWinToUndo"));
      return;
    }
    confirmModal(T("confirm.undoWin", { summary: entry.summary }), function () {
      var undone = retrogradeLastGame();
      saveState();
      showToast(T("toast.undidGame", { summary: undone.summary }));
      renderAll();
    });
  }

  // Auto-dismisses on its own after 5s if nobody closes it by hand first -
  // cleared and restarted on every fresh announcement, and cleared on any
  // manual close (the button, the backdrop, Enter/Escape, or another
  // overlay force-closing it) so it never fires late against whatever's
  // showing by then.
  var onHillAutoCloseTimer = null;

  function announceOnHill(names) {
    onHillMessage.textContent = names + " is ON THE HILL — one more win takes the race to " + state.raceToWinsTarget + "! Better step up. 👀";
    onHillOverlay.classList.remove("hidden");
    playOnHillSound();
    if (onHillAutoCloseTimer) clearTimeout(onHillAutoCloseTimer);
    onHillAutoCloseTimer = setTimeout(function () {
      onHillAutoCloseTimer = null;
      closeOnHill();
    }, 5000);
  }

  function closeOnHill() {
    if (onHillAutoCloseTimer) {
      clearTimeout(onHillAutoCloseTimer);
      onHillAutoCloseTimer = null;
    }
    onHillOverlay.classList.add("hidden");
  }

  function announceGameChange(label) {
    gameChangeMessage.textContent = T("gamechange.nowPlaying", { label: label });
    gameChangeOverlay.classList.remove("hidden");
    playPositiveSound(null);
  }

  function closeGameChange() {
    gameChangeOverlay.classList.add("hidden");
  }

  // Reflects the current counter value into the dialog and disables "-"
  // once it can't go any lower than unset.
  function renderBallsLeftValue(valueInput, minusBtn) {
    valueInput.value = gamewinBallsLeftValue === null ? "" : String(gamewinBallsLeftValue);
    minusBtn.disabled = gamewinBallsLeftValue === null;
  }

  // Writes the current balls-left value straight onto the game it belongs
  // to and refreshes any player-stats view already open behind the
  // overlay, the instant it changes - rather than waiting for the dialog
  // to close (closeGameWinOverlay's own patch-back stays as a harmless,
  // redundant safety net for it).
  function persistBallsLeftLive() {
    if (state.gameHistory[0] && state.gameHistory[0].ts === gamewinPendingTs) {
      state.gameHistory[0].ballsLeftOnTable = gamewinBallsLeftValue;
      saveState();
      if (currentStatsPlayerName) {
        currentStatsSessions = getPlayerSessions(currentStatsPlayerName);
        renderPlayerHistoryList(currentStatsSessions);
      }
    }
  }

  // Optional +/- counter (also directly typeable on a real keyboard) for
  // how many balls were left on the table when this game ended. Starts
  // unset (null) - "+" from unset goes to 0, "-" from 0 goes back to
  // unset, and clearing the field by hand does the same, so leaving it
  // alone never records a value. Lives in the per-game win overlay
  // (showGameWinOverlay), not the tournament/milestone one - it's a
  // property of the specific game just played, not the race as a whole.
  function buildBallsLeftRow() {
    var row = document.createElement("div");
    row.className = "player-stats-row balls-left-row";
    var label = document.createElement("span");
    label.className = "label";
    label.textContent = T("ballsLeft.label");

    var stepper = document.createElement("div");
    stepper.className = "balls-left-stepper";
    var minusBtn = document.createElement("button");
    minusBtn.type = "button";
    minusBtn.className = "balls-left-btn minus";
    minusBtn.textContent = "−";
    minusBtn.setAttribute("aria-label", T("ballsLeft.decrease"));

    var valueInput = document.createElement("input");
    valueInput.type = "number";
    valueInput.inputMode = "numeric";
    valueInput.min = "0";
    valueInput.placeholder = T("ballsLeft.unset");
    valueInput.className = "balls-left-value balls-left-input";
    valueInput.setAttribute("aria-label", T("ballsLeft.label"));

    var plusBtn = document.createElement("button");
    plusBtn.type = "button";
    plusBtn.className = "balls-left-btn plus";
    plusBtn.textContent = "+";
    plusBtn.setAttribute("aria-label", T("ballsLeft.increase"));

    minusBtn.addEventListener("click", function () {
      if (gamewinBallsLeftValue === null) return;
      gamewinBallsLeftValue = gamewinBallsLeftValue === 0 ? null : gamewinBallsLeftValue - 1;
      renderBallsLeftValue(valueInput, minusBtn);
      persistBallsLeftLive();
    });
    plusBtn.addEventListener("click", function () {
      gamewinBallsLeftValue = gamewinBallsLeftValue === null ? 0 : gamewinBallsLeftValue + 1;
      renderBallsLeftValue(valueInput, minusBtn);
      persistBallsLeftLive();
    });
    valueInput.addEventListener("input", function () {
      if (valueInput.value === "") {
        gamewinBallsLeftValue = null;
      } else {
        var n = parseInt(valueInput.value, 10);
        gamewinBallsLeftValue = isNaN(n) ? null : Math.max(0, n);
      }
      minusBtn.disabled = gamewinBallsLeftValue === null;
      persistBallsLeftLive();
    });

    stepper.appendChild(minusBtn);
    stepper.appendChild(valueInput);
    stepper.appendChild(plusBtn);
    row.appendChild(label);
    row.appendChild(stepper);
    renderBallsLeftValue(valueInput, minusBtn);
    return row;
  }

  // Shown for every credited win (not just a race-ending one) so the
  // balls-left marker can be set for that specific game before anything
  // else happens - in particular, before a race-ending win archives the
  // game and resets the session in celebrateTournamentWin. onClose runs
  // whatever should happen next (milestone/on-hill/game-change), deferred
  // until this dialog is dismissed.
  function showGameWinOverlay(summary, ts, onClose) {
    gamewinBallsLeftValue = null;
    gamewinPendingTs = ts;
    gamewinPendingOnClose = onClose;
    gamewinMessage.textContent = summary;
    gamewinDetails.innerHTML = "";
    gamewinDetails.appendChild(buildBallsLeftRow());
    gamewinOverlay.classList.remove("hidden");
    // Focus the balls-left field so a number key works right away, with
    // no click needed first - can only happen once the overlay is no
    // longer .hidden (an element can't take focus while display:none).
    var ballsLeftInput = gamewinDetails.querySelector(".balls-left-input");
    if (ballsLeftInput) ballsLeftInput.focus();
  }

  function closeGameWinOverlay() {
    // The just-credited game is still the front of gameHistory at this
    // point (nothing else can run while this dialog is up) - patch the
    // marker directly onto it so it's already there by the time any
    // archiving (celebrateTournamentWin's exportAllPlayerStats) reads it.
    if (gamewinBallsLeftValue !== null && state.gameHistory[0] && state.gameHistory[0].ts === gamewinPendingTs) {
      state.gameHistory[0].ballsLeftOnTable = gamewinBallsLeftValue;
      saveState();
    }
    gamewinOverlay.classList.add("hidden");
    var onClose = gamewinPendingOnClose;
    gamewinBallsLeftValue = null;
    gamewinPendingTs = null;
    gamewinPendingOnClose = null;
    if (onClose) onClose();
  }

  // Dismisses the win overlay after a quick-action (undo) has already
  // changed the game it was celebrating out from under it - skips both the
  // balls-left patch-back and the queued onClose chain (milestone/on-hill/
  // game-change), since neither still applies.
  function dismissGameWinOverlaySilently() {
    gamewinOverlay.classList.add("hidden");
    gamewinBallsLeftValue = null;
    gamewinPendingTs = null;
    gamewinPendingOnClose = null;
  }

  // A large, unmissable confirmation that a forced correction actually
  // happened - shown after the win popup's or tournament popup's "Undo
  // this win" instead of just a toast, since these fire mid-dispute in
  // front of a table of people who all need to see it landed.
  function showForceResetNotice(message) {
    forceResetMessage.textContent = message;
    forceResetOverlay.classList.remove("hidden");
  }

  function closeForceResetNotice() {
    forceResetOverlay.classList.add("hidden");
  }

  // Lets a misclick be corrected right from the win popup instead of
  // hunting for "Undo Last Win" elsewhere - undoes the exact win this
  // dialog is celebrating (still the front of gameHistory at this point,
  // same as undoLastWin's own precondition) and closes the dialog without
  // running its queued follow-up.
  function undoWinFromGameWinOverlay() {
    var entry = state.gameHistory[0];
    if (!entry || typeof entry === "string" || !entry.winnerIds) {
      showToast(T("toast.noWinToUndo"));
      return;
    }
    confirmModal(T("confirm.undoWin", { summary: entry.summary }), function () {
      var undone = retrogradeLastGame();
      saveState();
      dismissGameWinOverlaySilently();
      renderAll();
      showForceResetNotice(T("forceReset.gameMessage", { summary: undone.summary }));
    });
  }

  // Wipes every game recorded today - both the still-live session and any
  // tournaments already archived into PLAYER_STATS earlier today - and
  // rewinds every player's rating to what it was before today's play,
  // leaving every earlier day untouched. Lives in the Reset section
  // (Backup & Transfer), for when the whole day's session needs a do-over.
  // Rebuilds the live session win tallies from state.gameHistory as it
  // currently stands, rather than adjusting counters by hand - used both
  // by resetTodayStats (after pruning today's entries) and by the Recover
  // Data restore flow (after merging archived games back in), so both
  // stay self-consistent with whatever's actually in the game log.
  function recomputeLiveWinsFromGameHistory() {
    state.playerWins = {};
    state.teamWins = {};
    state.teamMvpWins = {};
    state.gameHistory.forEach(function (entry) {
      if (!entry || typeof entry === "string" || !entry.winnerIds) return;
      entry.winnerIds.forEach(function (id) {
        state.playerWins[id] = (state.playerWins[id] || 0) + 1;
      });
      if (entry.isTeam && entry.teamId) {
        state.teamWins[entry.teamId] = (state.teamWins[entry.teamId] || 0) + 1;
        if (entry.mvpId) {
          state.teamMvpWins[entry.mvpId] = (state.teamMvpWins[entry.mvpId] || 0) + 1;
        }
      }
    });
    state.gamesPlayedCount = state.gameHistory.length;
  }

  function resetTodayStats() {
    confirmModal(T("confirm.resetTodayStats"), function () {
      exportAllData();
      var today = todayDateStr();
      var todayStartMs = periodStartDate("today").getTime();

      var prunedSessions = {};
      Object.keys(PLAYER_STATS).forEach(function (key) {
        var entry = PLAYER_STATS[key];
        if (!entry || !Array.isArray(entry.sessions)) return;
        var todaysSessions = entry.sessions.filter(function (s) {
          return s.date === today;
        });
        if (todaysSessions.length) prunedSessions[key] = todaysSessions;
        entry.sessions = entry.sessions.filter(function (s) {
          return s.date !== today;
        });
      });
      savePlayerStatsToStorage(PLAYER_STATS);

      // Keeps any stray earlier-day entries from a session left open across
      // midnight, then rebuilds the live win counters from what's left
      // instead of just zeroing them, so that carryover isn't lost.
      var todaysGameHistory = (state.gameHistory || []).filter(function (entry) {
        return entry && entry.ts && localDateStrFromTs(entry.ts) === today;
      });
      state.gameHistory = (state.gameHistory || []).filter(function (entry) {
        return !(entry && entry.ts && localDateStrFromTs(entry.ts) === today);
      });
      var prevPlayerWins = JSON.parse(JSON.stringify(state.playerWins));
      var prevTeamWins = JSON.parse(JSON.stringify(state.teamWins));
      var prevTeamMvpWins = JSON.parse(JSON.stringify(state.teamMvpWins));
      recomputeLiveWinsFromGameHistory();
      resetGameBalls();
      saveState();

      var poppedRatingHistory = revertRatingsChangedSince(todayStartMs);

      saveResetSnapshot("todayStats", T("resetSnapshot.todayStatsLabel", { date: today }), {
        date: today,
        prunedSessions: prunedSessions,
        gameHistory: todaysGameHistory,
        playerWins: prevPlayerWins,
        teamWins: prevTeamWins,
        teamMvpWins: prevTeamMvpWins,
        ratingHistory: poppedRatingHistory
      });

      if (currentStatsPlayerName) {
        currentStatsSessions = getPlayerSessions(currentStatsPlayerName);
        renderPlayerHistoryList(currentStatsSessions);
      }

      renderAll();
      showToast(T("toast.todayStatsCleared"));
    });
  }

  // In-memory only (never persisted, same as gamewinPendingOnClose) -
  // captured fresh at the top of every celebrateTournamentWin call, and
  // only ever reachable through the "Undo this win" button living inside
  // the milestone overlay it was captured for, so a stale snapshot can
  // never be applied after that overlay has closed.
  var lastTournamentWinSnapshot = null;

  function celebrateTournamentWin(names, count) {
    var target = state.raceToWinsTarget;

    // A win one game earlier can leave the on-hill overlay open (it has no
    // reason to auto-close on its own) — without this it stacks visually
    // behind the milestone overlay that's about to show.
    closeOnHill();

    // Everything below this line rewrites state.gameHistory/PLAYER_STATS -
    // snapshot first so "Undo this win" can restore the tournament exactly
    // as it stood right after the winning game was credited, then retrograde
    // that one game on top of the restored state to land one game earlier.
    lastTournamentWinSnapshot = {
      gameHistory: JSON.parse(JSON.stringify(state.gameHistory)),
      playerWins: JSON.parse(JSON.stringify(state.playerWins)),
      teamWins: JSON.parse(JSON.stringify(state.teamWins)),
      teamMvpWins: JSON.parse(JSON.stringify(state.teamMvpWins)),
      gamesPlayedCount: state.gamesPlayedCount,
      currentGame: JSON.parse(JSON.stringify(state.currentGame)),
      playerStats: JSON.parse(JSON.stringify(PLAYER_STATS))
    };

    // Save this tournament's game history to per-player stats before the
    // reset below wipes state.gameHistory, then start the next one fresh.
    exportAllPlayerStats();
    startNewSession(true);

    var playerNames = activePlayers().map(function (p) {
      return p.name;
    });
    var info = rotationStatusInfo();

    milestoneHeadline.textContent = T("milestone.headline", { names: names, count: count, target: target });

    milestoneDetails.innerHTML = "";
    milestoneDetails.appendChild(playerStatsListRow(T("milestone.players"), playerNames, true));
    milestoneDetails.appendChild(playerStatsRow(T("milestone.tournamentGoal"), T("milestone.raceToWins", { target: target })));
    if (state.rotation.enabled && state.rotation.order.length > 0) {
      var rotationLabels = state.rotation.order.map(rotationEntryLabel);
      milestoneDetails.appendChild(playerStatsListRow(T("milestone.gameRotation"), rotationLabels));
      if (info) {
        milestoneDetails.appendChild(
          playerStatsRow(
            T("milestone.nextSwitch"),
            T(info.untilSwitch === 1 ? "milestone.nextSwitchDetailOne" : "milestone.nextSwitchDetailMany", {
              current: info.currentLabel,
              next: info.nextLabel,
              count: info.untilSwitch
            })
          )
        );
      }
    }

    milestoneOverlay.classList.remove("hidden");
    playTournamentChampionSound();
  }

  function closeMilestone() {
    milestoneOverlay.classList.add("hidden");
    lastTournamentWinSnapshot = null;
  }

  // Undoes the entire just-finished tournament's archiving/new-session
  // reset (via the pre-celebration snapshot) and then retrogrades the
  // winning game on top of that restored state, landing exactly one game
  // before the win - as if the celebration never happened.
  function undoTournamentWinFromMilestoneOverlay() {
    if (!lastTournamentWinSnapshot) {
      showToast(T("toast.noWinToUndo"));
      return;
    }
    var snapshot = lastTournamentWinSnapshot;
    confirmModal(T("confirm.undoTournamentWin"), function () {
      state.gameHistory = snapshot.gameHistory;
      state.playerWins = snapshot.playerWins;
      state.teamWins = snapshot.teamWins;
      state.teamMvpWins = snapshot.teamMvpWins;
      state.gamesPlayedCount = snapshot.gamesPlayedCount;
      state.currentGame = snapshot.currentGame;
      PLAYER_STATS = snapshot.playerStats;
      savePlayerStatsToStorage(PLAYER_STATS);

      var undone = retrogradeLastGame();
      saveState();
      lastTournamentWinSnapshot = null;
      milestoneOverlay.classList.add("hidden");
      syncGameTypeUI();
      renderAll();
      showForceResetNotice(T("forceReset.tournamentMessage", { summary: undone.summary }));
    });
  }

  function resetGameBalls() {
    state.players.forEach(function (p) {
      p.balls = 0;
    });
    state.currentGame.startedAt = new Date().toISOString();
  }

  function adjustScore(playerId, delta) {
    var player = getPlayer(playerId);
    if (!player || !player.playing) return;

    // A team can't play (or score) against nobody - blocks both +/- here,
    // not just the win-credit at target, and is the authoritative check
    // (buildBallControls also disables the buttons for this, but this is
    // what actually stops the keypad shortcut too).
    if (!quickCounterMode && state.currentGame.mode === "teams" && player.teamId) {
      var otherTeamId = player.teamId === "A" ? "B" : "A";
      if (teamMembersLive(otherTeamId).length === 0) {
        showToast(T("toast.teamNeedsOpponent"));
        return;
      }
    }

    // Quick Counter: just tally, never check a target or credit a win.
    // Free-form point counter — negative scores are allowed (e.g. golf-
    // style games, point penalties), so no clamping to 0 here.
    if (quickCounterMode) {
      player.balls = (player.balls || 0) + delta;
      saveState();
      if (delta > 0) playPositiveSound(player.voice);
      else playNegativeSound(player.voice);
      renderAll();
      return;
    }

    var allowNegative = state.currentGame.unit !== "rack";
    var next = (player.balls || 0) + delta;
    if (next < 0 && !allowNegative) next = 0;
    player.balls = next;

    if (delta > 0) {
      var target = state.currentGame.target;
      var isTeamMode = state.currentGame.mode === "teams" && player.teamId;
      var reached = isTeamMode ? sumTeamBalls(player.teamId) >= target : next >= target;

      if (reached) {
        var winnerVoice = isTeamMode ? null : player.voice;
        creditWin(isTeamMode, isTeamMode ? player.teamId : playerId, winnerVoice);
        return;
      }

      saveState();
      playPositiveSound(player.voice);
    } else {
      saveState();
      playNegativeSound(player.voice);
    }
    renderAll();
  }

  function resetCurrentGame() {
    confirmModal(T("confirm.resetGame"), function () {
      resetGameBalls();
      saveState();
      renderAll();
    });
  }

  function resetSessionAndTournament() {
    var hasTournament = !!TOURNAMENT;
    if (state.gameHistory.length === 0) {
      var msg = hasTournament ? T("confirm.resetSessionAndTournament") : T("confirm.startNewSession");
      confirmModal(msg, function () {
        startNewSession(false);
        endTournamentSilently();
      });
      return;
    }
    var count = state.gameHistory.length;
    var message = T(count === 1 ? "saveSession.messageOne" : "saveSession.messageMany", { count: count });
    if (hasTournament) message += " " + T("confirm.alsoEndsTournamentNote");
    saveSessionMessage.textContent = message;
    saveSessionOverlay.classList.remove("hidden");
  }

  function endTournamentSilently() {
    TOURNAMENT = null;
    saveTournamentToStorage(null);
    renderTournamentPage();
  }

  function closeSaveSessionPopup() {
    saveSessionOverlay.classList.add("hidden");
  }

  function startNewSession(saveRoster) {
    if (saveRoster) maybeSaveRosterOnNewSession();
    state.playerWins = {};
    state.teamWins = {};
    state.teamMvpWins = {};
    state.gameHistory = [];
    state.gamesPlayedCount = 0;
    resetGameBalls();
    saveState();
    applyRotationIfDue();
    renderAll();
  }

  // ---------------------------------------------------------------------
  // Sharing by email
  // ---------------------------------------------------------------------

  // Deliberately NOT run through T() - this is shared out of the app as a
  // message to other people (email/SMS), same as the day report and every
  // export, so it stays in a consistent language (English) regardless of
  // the sender's UI language. See buildDayReportText below for the same
  // rule applied to the day report.
  function shareStandings() {
    var lines = ["Pool Master Counter — Standings", ""];
    lines.push("Player session wins:");
    state.players.forEach(function (p) {
      lines.push("  " + p.name + ": " + (state.playerWins[p.id] || 0));
    });
    var teamKeys = ["A", "B"].filter(function (teamId) {
      return (state.teamWins[teamId] || 0) > 0;
    });
    if (teamKeys.length) {
      lines.push("");
      lines.push("Team pairing wins:");
      teamKeys.forEach(function (key) {
        var namesList = teamMembersLive(key).map(function (p) {
          return p.name;
        });
        var names = namesList.length ? namesList.join(" & ") : "Team " + key;
        lines.push("  " + names + ": " + state.teamWins[key]);
      });
    }
    if (state.gameHistory.length) {
      lines.push("");
      lines.push("Recent games:");
      state.gameHistory.slice(0, 15).forEach(function (entry) {
        lines.push("  " + (typeof entry === "string" ? entry : entry.summary));
      });
    }
    var body = lines.join("\n");
    var href = "mailto:?subject=" + encodeURIComponent("Pool Master Counter — Standings") + "&body=" + encodeURIComponent(body);
    window.location.href = href;
  }

  // ---------------------------------------------------------------------
  // Today's Notes & Day Report — free-text notes about today's live play,
  // saved per calendar date, plus a plain-text end-of-day synopsis (who
  // played, results, rating movement, and the notes) ready to copy, email,
  // or text.
  // ---------------------------------------------------------------------

  var DAY_NOTES_KEY = "poolMasterCounter.dayNotes.v1";

  function loadDayNotesFromStorage() {
    try {
      var raw = localStorage.getItem(DAY_NOTES_KEY);
      var parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  function saveDayNotesToStorage(notes) {
    try {
      localStorage.setItem(DAY_NOTES_KEY, JSON.stringify(notes));
    } catch (e) {
      console.warn("Could not save day notes.", e);
    }
  }

  var DAY_NOTES = loadDayNotesFromStorage();

  // Local calendar day (not UTC) - a UTC slice reads as "tomorrow" for
  // anyone west of UTC once local evening crosses into UTC's next day,
  // which silently mis-buckets that session's "today" stats. Matches
  // periodStartDate("today")'s local-midnight boundary below.
  function todayDateStr() {
    return localDateStrFromTs(new Date());
  }

  function localDateStrFromTs(ts) {
    var d = new Date(ts);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function getDayNotes(dateStr) {
    return DAY_NOTES[dateStr] || "";
  }

  function setDayNotes(dateStr, text) {
    if (text) DAY_NOTES[dateStr] = text;
    else delete DAY_NOTES[dateStr];
    saveDayNotesToStorage(DAY_NOTES);
  }

  // Every distinct game played in the last 24 hours (deduped by timestamp
  // across however many players' individual game lists it shows up in —
  // live session plus any earlier session saved recently) and each
  // player's win/loss/rating tally for that window. Deliberately a
  // rolling 24h window rather than a UTC-calendar-day match: the latter
  // silently drops evening games in any timezone behind UTC, since
  // ts.slice(0, 10) would already read as "tomorrow". Each game is kept
  // from its *winning* side's perspective (result === "won") so
  // winnerNames / opponentNames are neutral (winning side / losing side)
  // rather than relative to whichever player happened to be iterated
  // last. Also flagged with isLive: true when it's part of the
  // still-open current session (state.gameHistory), false when it only
  // exists in a session already saved within the window.
  function computeDayReportData(dateStr) {
    var names = getAllKnownPlayerNames();
    var cutoffTs = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    var liveTsSet = {};
    (state.gameHistory || []).forEach(function (entry) {
      if (entry && entry.ts) liveTsSet[entry.ts] = true;
    });
    var gamesByTs = {};
    var players = [];
    names.forEach(function (name) {
      var games = allGamesForPlayerName(name).filter(function (g) {
        return g.ts && g.ts >= cutoffTs;
      });
      if (!games.length) return;
      var wins = 0;
      games.forEach(function (g) {
        if (g.result === "won") wins += 1;
        var existing = gamesByTs[g.ts];
        if (!existing || (existing.result !== "won" && g.result === "won")) {
          gamesByTs[g.ts] = g;
        }
      });
      players.push({
        name: name,
        played: games.length,
        wins: wins,
        losses: games.length - wins,
        rating: getPlayerRating(name),
        ratingDelta: computeRatingPeriodDelta(name, "today")
      });
    });
    players.sort(function (a, b) {
      return b.wins - a.wins || a.name.localeCompare(b.name);
    });
    var games = Object.keys(gamesByTs)
      .sort()
      .map(function (ts) {
        var g = gamesByTs[ts];
        g.isLive = !!liveTsSet[ts];
        return g;
      });
    return { date: dateStr, games: games, players: players };
  }

  function joinNamesForReport(names) {
    names = names || [];
    if (names.length === 0) return "";
    if (names.length === 1) return names[0];
    if (names.length === 2) return names[0] + " and " + names[1];
    return names.slice(0, -1).join(", ") + ", and " + names[names.length - 1];
  }

  function formatReportGameTime(ts) {
    try {
      return new Date(ts).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    } catch (e) {
      return "";
    }
  }

  // Collapses repeat matchups (same winning side, same losing side, same
  // game type) into one grouped entry with a count, so a lopsided session
  // where one pair plays the same game a dozen times doesn't repeat the
  // same sentence a dozen times in the report. winnerNames/opponentNames
  // are kept as full arrays (both members of a team on each side) so
  // grouping and display both cover team games correctly.
  function groupReportGames(games) {
    var order = [];
    var byKey = {};
    (games || []).forEach(function (g) {
      var key =
        (g.winnerNames || []).slice().sort().join(",") + "|" + (g.opponentNames || []).slice().sort().join(",") + "|" + g.gameLabel;
      if (!byKey[key]) {
        byKey[key] = { winnerNames: g.winnerNames, opponentNames: g.opponentNames, gameLabel: g.gameLabel, ts: g.ts, count: 0 };
        order.push(key);
      }
      byKey[key].count += 1;
    });
    return order.map(function (k) {
      return byKey[k];
    });
  }

  function formatReportGameGroupLine(group) {
    var winners = joinNamesForReport(group.winnerNames || []);
    var losers = joinNamesForReport(group.opponentNames || []);
    if (group.count === 1) {
      var time = formatReportGameTime(group.ts);
      var text = winners + " won " + group.gameLabel;
      if (losers) text += " against " + losers;
      return (time ? time + " — " : "") + text;
    }
    var text2 = winners + " won " + group.count + " games of " + group.gameLabel;
    if (losers) text2 += " against " + losers;
    return text2;
  }

  // Fixed-width padding for the day report's plain-text tables. Pads by
  // UTF-16 length, so CJK names (double-width in a monospace font) won't
  // line up as precisely as Latin ones - an accepted limitation of a
  // plain-text-only report with no real table rendering.
  function padReportText(str, width, alignRight) {
    str = String(str);
    var pad = "";
    for (var i = str.length; i < width; i++) pad += " ";
    return alignRight ? pad + str : str + pad;
  }

  function formatReportRatingDelta(delta) {
    if (delta === null) return "—";
    if (delta > 0) return "▲" + delta;
    if (delta < 0) return "▼" + Math.abs(delta);
    return "—";
  }

  function formatReportGameTableRow(group, winnerColWidth, loserColWidth) {
    var winners = joinNamesForReport(group.winnerNames || []);
    var losers = joinNamesForReport(group.opponentNames || []);
    var timeCol = group.count === 1 ? formatReportGameTime(group.ts) : "—";
    var label = group.gameLabel + (group.count > 1 ? " ×" + group.count : "");
    // "def.  " is 6 chars - keep the label column aligned even when there's
    // no recorded opponent to name (e.g. a solo/practice win).
    var verbSegment = losers ? "def.  " + padReportText(losers, loserColWidth) : padReportText("", 6 + loserColWidth);
    return padReportText(timeCol, 8) + "  " + padReportText(winners, winnerColWidth) + "  " + verbSegment + "  " + label;
  }

  // Always YYYY-MM-DD, regardless of the active language - dates are a
  // global format standardization, not a per-language style. Accepts a
  // Date, an ISO timestamp string, or a bare YYYY-MM-DD date string.
  function formatDateISO(input) {
    var d = input instanceof Date ? input : new Date(input);
    if (isNaN(d.getTime())) return "";
    var y = d.getFullYear();
    var m = d.getMonth() + 1;
    var day = d.getDate();
    return y + "-" + (m < 10 ? "0" + m : m) + "-" + (day < 10 ? "0" + day : day);
  }

  function formatReportDateHeading(dateStr) {
    return formatDateISO(dateStr + "T00:00:00");
  }

  function buildDayReportText(dateStr) {
    var data = computeDayReportData(dateStr);
    var divider = "──────────";
    var lines = ["🎱 POOL MASTER COUNTER — DAY REPORT", formatReportDateHeading(dateStr), ""];
    if (data.players.length === 0) {
      lines.push("No games recorded today.");
    } else {
      var nameWidth = data.players.reduce(function (max, p) { return Math.max(max, p.name.length); }, "Player".length);
      var winWidth = data.players.reduce(function (max, p) { return Math.max(max, String(p.wins).length); }, 1);
      var lossWidth = data.players.reduce(function (max, p) { return Math.max(max, String(p.losses).length); }, 1);
      var ratingWidth = data.players.reduce(function (max, p) { return Math.max(max, String(p.rating).length); }, "Rating".length);
      var deltaWidth = data.players.reduce(function (max, p) { return Math.max(max, formatReportRatingDelta(p.ratingDelta).length); }, 1);

      lines.push(
        padReportText("Player", nameWidth) +
          "   " +
          padReportText("W", winWidth, true) +
          "   " +
          padReportText("L", lossWidth, true) +
          "   " +
          padReportText("Rating", ratingWidth, true) +
          "   " +
          padReportText("Δ", deltaWidth, true)
      );
      lines.push(
        padReportText("", nameWidth).replace(/ /g, "-") +
          "   " +
          padReportText("", winWidth).replace(/ /g, "-") +
          "   " +
          padReportText("", lossWidth).replace(/ /g, "-") +
          "   " +
          padReportText("", ratingWidth).replace(/ /g, "-") +
          "   " +
          padReportText("", deltaWidth).replace(/ /g, "-")
      );
      data.players.forEach(function (p) {
        lines.push(
          padReportText(p.name, nameWidth) +
            "   " +
            padReportText(p.wins, winWidth, true) +
            "   " +
            padReportText(p.losses, lossWidth, true) +
            "   " +
            padReportText(p.rating, ratingWidth, true) +
            "   " +
            padReportText(formatReportRatingDelta(p.ratingDelta), deltaWidth, true)
        );
      });
      lines.push("");
      var gameTypeCounts = {};
      data.games.forEach(function (g) {
        gameTypeCounts[g.gameLabel] = (gameTypeCounts[g.gameLabel] || 0) + 1;
      });
      var typesSummary = Object.keys(gameTypeCounts)
        .map(function (label) {
          return label + " ×" + gameTypeCounts[label];
        })
        .join(", ");
      lines.push("Total games: " + data.games.length + (typesSummary ? "   |   " + typesSummary : ""));

      var earlierGames = data.games.filter(function (g) {
        return !g.isLive;
      });
      var liveGames = data.games.filter(function (g) {
        return g.isLive;
      });
      var hasBothGroups = earlierGames.length > 0 && liveGames.length > 0;

      if (data.games.length > 0) {
        var winnerColWidth = data.games.reduce(function (max, g) {
          return Math.max(max, joinNamesForReport(g.winnerNames || []).length);
        }, 0);
        var loserColWidth = data.games.reduce(function (max, g) {
          return Math.max(max, joinNamesForReport(g.opponentNames || []).length);
        }, 0);
        lines.push("");
        lines.push("Game Log");
        lines.push(divider);
        if (hasBothGroups) {
          lines.push("Earlier session:");
          groupReportGames(earlierGames).forEach(function (g) {
            lines.push(formatReportGameTableRow(g, winnerColWidth, loserColWidth));
          });
          lines.push("");
          lines.push("Current session:");
          groupReportGames(liveGames).forEach(function (g) {
            lines.push(formatReportGameTableRow(g, winnerColWidth, loserColWidth));
          });
        } else {
          groupReportGames(data.games).forEach(function (g) {
            lines.push(formatReportGameTableRow(g, winnerColWidth, loserColWidth));
          });
        }
      }
    }
    var notes = getDayNotes(dateStr);
    if (notes) {
      lines.push("");
      lines.push("Notes");
      lines.push(divider);
      lines.push(notes);
    }
    return lines.join("\n");
  }

  function updateDayNotesSummary() {
    var data = computeDayReportData(todayDateStr());
    var notes = getDayNotes(todayDateStr());
    var parts = [];
    parts.push(data.games.length + " game" + (data.games.length === 1 ? "" : "s") + " today");
    parts.push(data.players.length + " player" + (data.players.length === 1 ? "" : "s"));
    parts.push(notes ? notes.length + " character note" : "no notes yet");
    setPanelSummary("day-notes-panel", parts.join(" · "));
  }

  function updateDayReportRecipientsLine() {
    var contacts = reportOptedInContacts();
    dayReportRecipientsLine.textContent = contacts.length
      ? T("dayNotes.recipientsSome", { names: contacts.map(function (c) { return c.name; }).join(", ") })
      : T("dayNotes.recipientsNone");
  }

  // ---------------------------------------------------------------------
  // Export session snapshot
  // ---------------------------------------------------------------------

  function exportSession() {
    var playerWins = state.players
      .map(function (p) {
        return { name: p.name, wins: state.playerWins[p.id] || 0 };
      })
      .sort(function (a, b) {
        return b.wins - a.wins;
      });

    var teamWins = ["A", "B"]
      .filter(function (teamId) {
        return (state.teamWins[teamId] || 0) > 0;
      })
      .map(function (key) {
        var namesList = teamMembersLive(key).map(function (p) {
          return p.name;
        });
        var members = namesList.length ? namesList.join(" & ") : "Team " + key;
        return { members: members, wins: state.teamWins[key] };
      })
      .sort(function (a, b) {
        return b.wins - a.wins;
      });

    var snapshot = {
      exportedAt: new Date().toISOString(),
      raceToWinsTarget: state.raceToWinsTarget,
      currentGame: state.currentGame,
      players: state.players.map(function (p) {
        return { id: p.id, name: p.name };
      }),
      playerWins: playerWins,
      teamWins: teamWins,
      gameHistory: state.gameHistory
    };

    var filename = "pool-session-" + snapshot.exportedAt.slice(0, 10) + ".json";
    downloadJSON(filename, snapshot);
  }

  function downloadJSON(filename, data) {
    var json = JSON.stringify(data, null, 2);
    var blob = new Blob([json], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    // Revoking the blob URL immediately can race with the browser's save
    // step on some mobile browsers (notably iOS Safari), producing an empty
    // or missing download. Give it a moment before cleaning up.
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1000);
  }

  function fetchFresh(url) {
    var buster = (url.indexOf("?") === -1 ? "?" : "&") + "v=" + Date.now();
    return fetch(url + buster, { cache: "no-store" });
  }

  // ---------------------------------------------------------------------
  // Local storage-backed persistence (rosters + player stats)
  // Everything lives on this device only. Use Export All Data / Import
  // Data (see below) to move it to another device.
  // ---------------------------------------------------------------------

  var ROSTERS_KEY = "poolMasterCounter.rosters.v1";
  var ROTATIONS_KEY = "poolMasterCounter.rotations.v1";
  var PLAYER_STATS_KEY = "poolMasterCounter.playerStats.v1";
  var RATINGS_KEY = "poolMasterCounter.ratings.v1";
  var PLAYER_ADDED_KEY = "poolMasterCounter.playerAdded.v1";

  function loadRostersFromStorage() {
    try {
      var raw = localStorage.getItem(ROSTERS_KEY);
      var parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function saveRostersToStorage(rosters) {
    if (noStatsMode) return;
    try {
      localStorage.setItem(ROSTERS_KEY, JSON.stringify(rosters));
    } catch (e) {
      console.warn("Could not save rosters.", e);
    }
  }

  function loadRotationsFromStorage() {
    try {
      var raw = localStorage.getItem(ROTATIONS_KEY);
      var parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function saveRotationsToStorage(rotations) {
    if (noStatsMode) return;
    try {
      localStorage.setItem(ROTATIONS_KEY, JSON.stringify(rotations));
    } catch (e) {
      console.warn("Could not save rotations.", e);
    }
  }

  function loadPlayerStatsFromStorage() {
    try {
      var raw = localStorage.getItem(PLAYER_STATS_KEY);
      var parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  function savePlayerStatsToStorage(allStats) {
    if (noStatsMode) return;
    try {
      localStorage.setItem(PLAYER_STATS_KEY, JSON.stringify(allStats));
    } catch (e) {
      console.warn("Could not save player stats.", e);
    }
  }

  function loadRatingsFromStorage() {
    try {
      var raw = localStorage.getItem(RATINGS_KEY);
      var parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  function saveRatingsToStorage(ratings) {
    if (noStatsMode) return;
    try {
      localStorage.setItem(RATINGS_KEY, JSON.stringify(ratings));
    } catch (e) {
      console.warn("Could not save ratings.", e);
    }
  }

  // Name -> ISO timestamp of the first time that name was ever added to
  // this device (see addPlayer / backfillMissingAddedDates below).
  function loadPlayerAddedFromStorage() {
    try {
      var raw = localStorage.getItem(PLAYER_ADDED_KEY);
      var parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  function savePlayerAddedToStorage(added) {
    if (noStatsMode) return;
    try {
      localStorage.setItem(PLAYER_ADDED_KEY, JSON.stringify(added));
    } catch (e) {
      console.warn("Could not save player added dates.", e);
    }
  }

  // Name -> { languageCode: "translated name" }. Names don't machine-
  // translate (they're not phrases with a canonical target-language
  // equivalent), so this is a manually-entered per-player, per-language
  // nickname rather than anything automatic - see buildPlayerNameLabel.
  var PLAYER_NAME_TRANSLATIONS_KEY = "poolMasterCounter.playerNameTranslations.v1";

  function loadPlayerNameTranslationsFromStorage() {
    try {
      var raw = localStorage.getItem(PLAYER_NAME_TRANSLATIONS_KEY);
      var parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  function savePlayerNameTranslationsToStorage(translations) {
    if (noStatsMode) return;
    try {
      localStorage.setItem(PLAYER_NAME_TRANSLATIONS_KEY, JSON.stringify(translations));
    } catch (e) {
      console.warn("Could not save player name translations.", e);
    }
  }

  // Name -> { email, reportOptIn }. Collected (optionally) once, in the
  // onboarding wizard - not exposed on the regular Add Player form.
  var CONTACTS_KEY = "poolMasterCounter.contacts.v1";

  function loadContactsFromStorage() {
    try {
      var raw = localStorage.getItem(CONTACTS_KEY);
      var parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  function saveContactsToStorage(contacts) {
    if (noStatsMode) return;
    try {
      localStorage.setItem(CONTACTS_KEY, JSON.stringify(contacts));
    } catch (e) {
      console.warn("Could not save player contacts.", e);
    }
  }

  // Name -> { removedAt }. removePlayer only drops someone from the live
  // roster (their PLAYER_STATS/PLAYER_RATINGS stay put), so this isn't
  // about protecting data - it's about remembering the removal was
  // deliberate, so importAllData doesn't silently re-add them just
  // because an older backup still lists them.
  var REMOVED_PLAYERS_KEY = "poolMasterCounter.removedPlayers.v1";

  function loadRemovedPlayersFromStorage() {
    try {
      var raw = localStorage.getItem(REMOVED_PLAYERS_KEY);
      var parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  function saveRemovedPlayersToStorage(removed) {
    if (noStatsMode) return;
    try {
      localStorage.setItem(REMOVED_PLAYERS_KEY, JSON.stringify(removed));
    } catch (e) {
      console.warn("Could not save removed players.", e);
    }
  }

  // Capped local history of what each reset button just wiped, so it can
  // be recovered from the Recover Data panel without hunting for a
  // downloaded backup file. Newest first, oldest dropped once full.
  var RESET_SNAPSHOTS_KEY = "poolMasterCounter.resetSnapshots.v1";
  var RESET_SNAPSHOTS_CAP = 12;

  function loadResetSnapshotsFromStorage() {
    try {
      var raw = localStorage.getItem(RESET_SNAPSHOTS_KEY);
      var parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function saveResetSnapshotsToStorage(snapshots) {
    if (noStatsMode) return;
    try {
      localStorage.setItem(RESET_SNAPSHOTS_KEY, JSON.stringify(snapshots));
    } catch (e) {
      console.warn("Could not save reset snapshots.", e);
    }
  }

  // One-time-per-load cleanup: if PLAYER_STATS already has separate entries
  // for the same person under different casing (e.g. "Bob" and "bob" from
  // before names were treated as case-insensitive), merge their sessions
  // into a single canonical entry so career stats and the All Players page
  // never split one person into two rows. Canonical casing is whichever
  // variant has the most recorded wins; ties go alphabetically.
  function consolidateCaseVariantPlayerStats(stats) {
    var groups = {};
    Object.keys(stats).forEach(function (name) {
      var key = normalizeNameKey(name);
      if (!groups[key]) groups[key] = [];
      groups[key].push(name);
    });
    var changed = false;
    var result = {};
    Object.keys(groups).forEach(function (key) {
      var names = groups[key];
      if (names.length === 1) {
        var soloName = capitalizeName(names[0]);
        if (soloName !== names[0]) {
          changed = true;
          result[soloName] = { name: soloName, sessions: stats[names[0]].sessions };
        } else {
          result[soloName] = stats[names[0]];
        }
        return;
      }
      changed = true;
      var mergedSessions = [];
      var totalWins = {};
      names.forEach(function (n) {
        var sessions = stats[n] && Array.isArray(stats[n].sessions) ? stats[n].sessions : [];
        mergedSessions = mergeSessionLists(mergedSessions, sessions);
        totalWins[n] = sessions.reduce(function (sum, s) {
          return sum + (s.wins || 0);
        }, 0);
      });
      // Whichever variant wins the vote, run it through capitalizeName so
      // an all-lowercase import (e.g. "bob") never becomes the stored
      // canonical casing just by having more recorded wins.
      var canonical = capitalizeName(
        names.slice().sort(function (a, b) {
          return totalWins[b] - totalWins[a] || a.localeCompare(b);
        })[0]
      );
      result[canonical] = { name: canonical, sessions: mergedSessions };
    });
    return { stats: result, changed: changed };
  }

  var PLAYER_STATS = loadPlayerStatsFromStorage();
  (function consolidatePlayerStatsCasingOnBoot() {
    var result = consolidateCaseVariantPlayerStats(PLAYER_STATS);
    PLAYER_STATS = result.stats;
    if (result.changed) savePlayerStatsToStorage(PLAYER_STATS);
  })();

  // ---------------------------------------------------------------------
  // Player ratings — an Elo-style rating inspired by the publicly
  // documented behavior of FargoRate (the rating system behind USA Pool
  // League and most competitive USA pool leagues): a roughly 0-900 scale
  // where each 100-point gap between two players corresponds to about a
  // 2:1 expected win ratio, doubling every 100 points. This is NOT a
  // reverse-engineered clone of Fargo's proprietary global-optimization
  // algorithm (which considers every player's games together and is
  // recomputed from scratch daily) — that's neither public nor practical
  // to replicate client-side. It's a standard, well-understood per-game
  // update rule tuned to land on the same scale and odds Fargo publishes.
  //
  // Ratings are entirely automatic: every credited game updates both
  // players' ratings immediately, and there is no UI to edit a rating by
  // hand. New players start at DEFAULT_RATING, the middle of the range
  // FargoRate describes as where most league/tournament players fall.
  // Ratings live in their own name-keyed store (like PLAYER_STATS), so
  // they persist for a player even after they're removed from the roster.
  // ---------------------------------------------------------------------

  var DEFAULT_RATING = 400;
  var RATING_PROVISIONAL_GAMES = 20;
  var RATING_K_PROVISIONAL = 24;
  var RATING_K_ESTABLISHED = 8;
  var RATING_HISTORY_CAP = 500;

  // Same case-variant cleanup as consolidateCaseVariantPlayerStats, applied
  // to the ratings store — merges any "bob"/"Bob" split, dedupes their
  // history by timestamp, and recomputes the current rating from the
  // merged, time-sorted history so an old lowercase import never leaves a
  // player with two separate rating tracks or an un-capitalized name.
  function consolidateCaseVariantRatings(ratings) {
    var groups = {};
    Object.keys(ratings).forEach(function (name) {
      var key = normalizeNameKey(name);
      if (!groups[key]) groups[key] = [];
      groups[key].push(name);
    });
    var changed = false;
    var result = {};
    Object.keys(groups).forEach(function (key) {
      var names = groups[key];
      if (names.length === 1) {
        var soloName = capitalizeName(names[0]);
        if (soloName !== names[0]) {
          changed = true;
          var solo = ratings[names[0]];
          result[soloName] = { name: soloName, rating: solo.rating, gamesPlayed: solo.gamesPlayed, history: solo.history };
        } else {
          result[soloName] = ratings[names[0]];
        }
        return;
      }
      changed = true;
      var seen = {};
      var mergedHistory = [];
      names.forEach(function (n) {
        (ratings[n].history || []).forEach(function (h) {
          if (seen[h.ts]) return;
          seen[h.ts] = true;
          mergedHistory.push(h);
        });
      });
      mergedHistory.sort(function (a, b) {
        return a.ts.localeCompare(b.ts);
      });
      var canonical = capitalizeName(names[0]);
      result[canonical] = {
        name: canonical,
        rating: mergedHistory.length ? mergedHistory[mergedHistory.length - 1].rating : DEFAULT_RATING,
        gamesPlayed: mergedHistory.length,
        history: mergedHistory
      };
    });
    return { ratings: result, changed: changed };
  }

  var PLAYER_RATINGS = loadRatingsFromStorage();
  (function consolidateRatingsCasingOnBoot() {
    var result = consolidateCaseVariantRatings(PLAYER_RATINGS);
    PLAYER_RATINGS = result.ratings;
    if (result.changed) saveRatingsToStorage(PLAYER_RATINGS);
  })();

  // Finds an existing PLAYER_RATINGS key matching this name regardless of
  // case, mirroring findPlayerStatsKey.
  function findRatingKey(name) {
    var key = normalizeNameKey(name);
    var match = Object.keys(PLAYER_RATINGS).filter(function (k) {
      return normalizeNameKey(k) === key;
    });
    return match.length ? match[0] : null;
  }

  // The rating to use for someone who hasn't played a rated game yet —
  // shows DEFAULT_RATING without creating a stored entry for them.
  function getPlayerRating(name) {
    var key = findRatingKey(name);
    return key ? PLAYER_RATINGS[key].rating : DEFAULT_RATING;
  }

  function getPlayerRatingEntry(name) {
    var key = findRatingKey(name);
    return key ? PLAYER_RATINGS[key] : null;
  }

  var PLAYER_ADDED = loadPlayerAddedFromStorage();

  function findPlayerAddedKey(name) {
    var key = normalizeNameKey(name);
    var match = Object.keys(PLAYER_ADDED).filter(function (k) {
      return normalizeNameKey(k) === key;
    });
    return match.length ? match[0] : null;
  }

  // The ISO timestamp this name was first added to the app, or null if
  // unknown (never recorded and no game history to infer it from).
  function getPlayerAddedAt(name) {
    var key = findPlayerAddedKey(name);
    return key ? PLAYER_ADDED[key] : null;
  }

  // Records "now" as name's added date, but only the first time this
  // exact name is ever seen — re-adding an existing player (e.g. after
  // removing them from today's roster) must not reset it.
  function recordPlayerAddedIfNew(name) {
    if (findPlayerAddedKey(name)) return;
    PLAYER_ADDED[name] = new Date().toISOString();
    savePlayerAddedToStorage(PLAYER_ADDED);
  }

  var PLAYER_CONTACTS = loadContactsFromStorage();

  function findContactKey(name) {
    var key = normalizeNameKey(name);
    var match = Object.keys(PLAYER_CONTACTS).filter(function (k) {
      return normalizeNameKey(k) === key;
    });
    return match.length ? match[0] : null;
  }

  function setPlayerContact(name, email, reportOptIn) {
    var key = findContactKey(name) || name;
    PLAYER_CONTACTS[key] = { email: email, reportOptIn: !!reportOptIn };
    saveContactsToStorage(PLAYER_CONTACTS);
  }

  // Every stored email opted in to the day report, deduped - used to
  // pre-fill the report's mailto "to" field.
  function reportOptedInContacts() {
    return Object.keys(PLAYER_CONTACTS)
      .map(function (name) {
        return { name: name, contact: PLAYER_CONTACTS[name] };
      })
      .filter(function (entry) {
        return entry.contact && entry.contact.reportOptIn && entry.contact.email;
      });
  }

  // Local settings win on conflict (this device's own opt-in choice is
  // more current than whatever an older backup says); anything imported
  // for a name this device has never heard of gets added.
  function mergeContactsData(localContacts, importedContacts) {
    var merged = {};
    Object.keys(importedContacts || {}).forEach(function (name) {
      merged[name] = importedContacts[name];
    });
    Object.keys(localContacts || {}).forEach(function (name) {
      merged[name] = localContacts[name];
    });
    return merged;
  }

  var REMOVED_PLAYERS = loadRemovedPlayersFromStorage();

  function findRemovedPlayerKey(name) {
    var key = normalizeNameKey(name);
    var match = Object.keys(REMOVED_PLAYERS).filter(function (k) {
      return normalizeNameKey(k) === key;
    });
    return match.length ? match[0] : null;
  }

  function markPlayerRemoved(name) {
    var key = findRemovedPlayerKey(name) || name;
    REMOVED_PLAYERS[key] = { removedAt: new Date().toISOString() };
    saveRemovedPlayersToStorage(REMOVED_PLAYERS);
  }

  function isPlayerRemoved(name) {
    return !!findRemovedPlayerKey(name);
  }

  // Called whenever a name becomes an active player again - a deliberate
  // manual re-add (typed into Add Player, or restored from an import
  // conflict prompt) means the removal no longer applies.
  function clearPlayerRemoved(name) {
    var key = findRemovedPlayerKey(name);
    if (!key) return;
    delete REMOVED_PLAYERS[key];
    saveRemovedPlayersToStorage(REMOVED_PLAYERS);
  }

  var RESET_SNAPSHOTS = loadResetSnapshotsFromStorage();

  // `data` should already be a plain deep-cloned object (JSON.parse(
  // JSON.stringify(...)), same pattern celebrateTournamentWin's undo
  // snapshot uses) holding only the slice that reset is about to wipe.
  function saveResetSnapshot(type, label, data) {
    RESET_SNAPSHOTS.unshift({ id: uid(), type: type, ts: new Date().toISOString(), label: label, data: data });
    RESET_SNAPSHOTS = RESET_SNAPSHOTS.slice(0, RESET_SNAPSHOTS_CAP);
    saveResetSnapshotsToStorage(RESET_SNAPSHOTS);
  }

  var PLAYER_NAME_TRANSLATIONS = loadPlayerNameTranslationsFromStorage();

  function findPlayerNameTranslationKey(name) {
    var key = normalizeNameKey(name);
    var match = Object.keys(PLAYER_NAME_TRANSLATIONS).filter(function (k) {
      return normalizeNameKey(k) === key;
    });
    return match.length ? match[0] : null;
  }

  function getPlayerNameTranslation(name, languageCode) {
    var key = findPlayerNameTranslationKey(name);
    if (!key) return null;
    return PLAYER_NAME_TRANSLATIONS[key][languageCode] || null;
  }

  function setPlayerNameTranslation(name, languageCode, translatedName) {
    var key = findPlayerNameTranslationKey(name) || name;
    if (!PLAYER_NAME_TRANSLATIONS[key]) PLAYER_NAME_TRANSLATIONS[key] = {};
    if (translatedName) PLAYER_NAME_TRANSLATIONS[key][languageCode] = translatedName;
    else delete PLAYER_NAME_TRANSLATIONS[key][languageCode];
    savePlayerNameTranslationsToStorage(PLAYER_NAME_TRANSLATIONS);
  }

  // Builds "Bob (Bobby)" - the plain name, plus a smaller/dimmer
  // parenthesized translation if one exists for the active language (never
  // fabricated; English shows just the plain name). Appends directly to
  // container so call sites can keep using it like a plain name element.
  // When editable is true (only meaningful on the Player Stats page, where
  // there's room), also appends a small ✏️ button to set/change the
  // translation for the active language - names don't machine-translate,
  // so this is the "if possible" path: a manually-entered nickname per
  // language rather than anything automatic.
  function buildPlayerNameLabel(container, name, editable) {
    container.appendChild(document.createTextNode(name));
    if (activeLanguageCode === DEFAULT_LANGUAGE_CODE) return;
    var translated = getPlayerNameTranslation(name, activeLanguageCode);
    if (translated) {
      var span = document.createElement("span");
      span.className = "player-name-translated";
      span.textContent = "(" + translated + ")";
      container.appendChild(span);
    }
    if (editable) {
      var editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "player-name-edit-btn";
      editBtn.textContent = "✏️";
      editBtn.title = T("playerPage.editTranslatedName");
      editBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        promptModal(T("playerPage.editTranslatedNamePrompt", { name: name }), translated || "", function (entered) {
          setPlayerNameTranslation(name, activeLanguageCode, entered.trim());
          renderAll();
          if (typeof renderPlayerSynopsis === "function" && currentStatsPlayerName === name) {
            openPlayerStatsPage(name, true);
          }
        });
      });
      container.appendChild(editBtn);
    }
  }

  // The exact rating change this one player got from one specific game —
  // bumpPlayerRating stamps every history entry with the same ts as the
  // gameHistory entry that caused it, so this is just a lookup. Returns
  // null if there's no matching entry (e.g. the game was played with No
  // Statistic mode on, so no rating history was ever recorded for it).
  function getPlayerRatingDeltaForGame(name, ts) {
    var key = findRatingKey(name);
    if (!key || !ts) return null;
    var history = PLAYER_RATINGS[key].history || [];
    for (var i = history.length - 1; i >= 0; i--) {
      if (history[i].ts === ts) return history[i].delta;
    }
    return null;
  }

  function ensureRatingEntry(name) {
    var key = findRatingKey(name) || name;
    if (!PLAYER_RATINGS[key]) {
      PLAYER_RATINGS[key] = { name: key, rating: DEFAULT_RATING, gamesPlayed: 0, history: [] };
    }
    return PLAYER_RATINGS[key];
  }

  // A hand-entered override, not a game result - recorded as its own
  // history point (so the rating graph reflects it) but doesn't count
  // toward gamesPlayed, since no game was actually played.
  function setPlayerRatingManually(name, newRating) {
    var entry = ensureRatingEntry(name);
    var ts = new Date().toISOString();
    var delta = newRating - entry.rating;
    entry.rating = newRating;
    entry.history.push({ ts: ts, rating: newRating, delta: delta });
    if (entry.history.length > RATING_HISTORY_CAP) entry.history.shift();
    saveRatingsToStorage(PLAYER_RATINGS);
  }

  // Resets every player currently on the roster back to the default
  // starting rating (see the "Player ratings" comment above DEFAULT_RATING
  // for why 400 on this 0-900 scale) - as if they were freshly added,
  // with no rating history at all.
  function resetAllPlayersOfficialRating() {
    confirmModal(T("confirm.resetAllRatingsExplain", { rating: DEFAULT_RATING }), function () {
      confirmModal(T("confirm.areYouSure"), function () {
        saveResetSnapshot("allRatings", T("resetSnapshot.allRatingsLabel"), {
          ratings: JSON.parse(JSON.stringify(PLAYER_RATINGS))
        });
        state.players.forEach(function (p) {
          var key = findRatingKey(p.name) || p.name;
          PLAYER_RATINGS[key] = { name: key, rating: DEFAULT_RATING, gamesPlayed: 0, history: [] };
        });
        saveRatingsToStorage(PLAYER_RATINGS);
        renderAll();
        showToast(T("toast.allRatingsReset"));
      });
    });
  }

  function openRatingEditPopup(name) {
    ratingEditTargetName = name;
    ratingEditPlayerName.textContent = name;
    ratingEditInput.value = getPlayerRating(name);
    ratingEditOverlay.classList.remove("hidden");
  }

  function closeRatingEditPopup() {
    ratingEditTargetName = null;
    ratingEditOverlay.classList.add("hidden");
  }

  function saveRatingEditPopup() {
    if (!ratingEditTargetName) return;
    var value = parseInt(ratingEditInput.value, 10);
    if (isNaN(value)) {
      closeRatingEditPopup();
      return;
    }
    setPlayerRatingManually(ratingEditTargetName, value);
    closeRatingEditPopup();
    renderAll();
  }

  // Reads the optional "starting rating" field on an add-player form —
  // null if left blank or not a usable number.
  function parseStartingRatingInput(inputEl) {
    var raw = inputEl.value.trim();
    if (!raw) return null;
    var n = parseInt(raw, 10);
    return isNaN(n) ? null : n;
  }

  // Win probability for A over B given the two ratings — a 100-point gap
  // is a 2:1 expected win ratio, matching FargoRate's published scale.
  function eloExpectedScore(ratingA, ratingB) {
    return 1 / (1 + Math.pow(2, (ratingB - ratingA) / 100));
  }

  // New/lightly-rated players move faster (a "provisional" period) so a
  // handful of games can correct a bad starting estimate quickly; once
  // established, ratings move more slowly and stay stable session to
  // session — the same shape FargoRate describes (a starter estimate
  // that's blended out as real games accumulate), simplified to a
  // two-step K-factor instead of a continuous blend.
  function ratingKFor(gamesPlayed) {
    return gamesPlayed < RATING_PROVISIONAL_GAMES ? RATING_K_PROVISIONAL : RATING_K_ESTABLISHED;
  }

  function bumpPlayerRating(name, delta, ts) {
    var entry = ensureRatingEntry(name);
    entry.rating += delta;
    entry.gamesPlayed += 1;
    // fromGame distinguishes this from a hand-entered override (see
    // setPlayerRatingManually) so a revert (retrogradeRatingsForGame /
    // revertRatingsChangedSince) knows whether to also undo the
    // gamesPlayed bump - a manual edit never touched it, so undoing one
    // must not decrement it either.
    entry.history.push({ ts: ts, rating: entry.rating, delta: delta, fromGame: true });
    if (entry.history.length > RATING_HISTORY_CAP) entry.history.shift();
    return entry;
  }

  // One pairwise result: winnerName beat loserName. Both ratings update
  // from their pre-game values (the expected score is computed once,
  // before either is touched).
  function applyPairwiseRatingResult(winnerName, loserName, ts) {
    var winnerEntry = ensureRatingEntry(winnerName);
    var loserEntry = ensureRatingEntry(loserName);
    var expectedWinner = eloExpectedScore(winnerEntry.rating, loserEntry.rating);
    var winnerDelta = Math.round(ratingKFor(winnerEntry.gamesPlayed) * (1 - expectedWinner));
    var loserDelta = Math.round(ratingKFor(loserEntry.gamesPlayed) * -(1 - expectedWinner));
    bumpPlayerRating(winnerName, winnerDelta, ts);
    bumpPlayerRating(loserName, loserDelta, ts);
  }

  function averageRating(names) {
    if (!names.length) return DEFAULT_RATING;
    var sum = names.reduce(function (total, n) {
      return total + getPlayerRating(n);
    }, 0);
    return sum / names.length;
  }

  // Team result: treats each side's average rating as a single "player"
  // for the win-probability calculation, then applies that same delta to
  // every member of each side — a common, simple approximation for team
  // Elo (not as rigorous as e.g. TrueSkill, but transparent and fair).
  function applyTeamRatingResult(winnerNames, loserNames, ts) {
    var winnerAvg = averageRating(winnerNames);
    var loserAvg = averageRating(loserNames);
    var expectedWinner = eloExpectedScore(winnerAvg, loserAvg);
    var winnerDelta = Math.round(RATING_K_PROVISIONAL * (1 - expectedWinner));
    var loserDelta = Math.round(RATING_K_PROVISIONAL * -(1 - expectedWinner));
    winnerNames.forEach(function (n) {
      bumpPlayerRating(n, winnerDelta, ts);
    });
    loserNames.forEach(function (n) {
      bumpPlayerRating(n, loserDelta, ts);
    });
  }

  // Ratings only ever update live, at the moment a game is credited — a
  // player restored from the bundled players/*.json backup (or an
  // imported backup) arrives with full game history but no rating
  // history, so their badge shows the flat DEFAULT_RATING no matter their
  // actual record. This replays every game that's missing from the
  // ratings' timestamp record (found via each winning side's own game
  // entry, which always carries the complete winnerNames/opponentNames
  // for that game) in chronological order, so the rating ends up exactly
  // where it would have if the game had been rated live. Already-rated
  // games are skipped by ts, so this is safe to run on every boot.
  function backfillMissingRatingsFromHistory() {
    var alreadyRated = {};
    Object.keys(PLAYER_RATINGS).forEach(function (key) {
      (PLAYER_RATINGS[key].history || []).forEach(function (h) {
        alreadyRated[h.ts] = true;
      });
    });

    var byTs = {};
    getAllKnownPlayerNames().forEach(function (name) {
      allGamesForPlayerName(name).forEach(function (g) {
        if (g.result !== "won" || !g.ts || alreadyRated[g.ts] || byTs[g.ts]) return;
        byTs[g.ts] = { ts: g.ts, isTeam: !!g.isTeam, winnerNames: g.winnerNames || [], loserNames: g.opponentNames || [] };
      });
    });

    var toApply = Object.keys(byTs)
      .map(function (ts) {
        return byTs[ts];
      })
      .sort(function (a, b) {
        return a.ts.localeCompare(b.ts);
      });
    if (!toApply.length) return;

    toApply.forEach(function (g) {
      if (!g.winnerNames.length || !g.loserNames.length) return;
      if (g.isTeam) {
        applyTeamRatingResult(g.winnerNames, g.loserNames, g.ts);
      } else {
        g.loserNames.forEach(function (loserName) {
          applyPairwiseRatingResult(g.winnerNames[0], loserName, g.ts);
        });
      }
    });
    saveRatingsToStorage(PLAYER_RATINGS);
  }

  // Fills in an "added" date for any known player who doesn't have one —
  // players restored from the bundled backup or an imported one were never
  // routed through addPlayer, so there's no true "first added" moment on
  // record. The earliest game on file is the closest honest estimate;
  // players with neither an added date nor any games are left alone (no
  // date is shown for them until they actually play or get re-added).
  function backfillMissingAddedDates() {
    var changed = false;
    getAllKnownPlayerNames().forEach(function (name) {
      if (findPlayerAddedKey(name)) return;
      var earliest = null;
      allGamesForPlayerName(name).forEach(function (g) {
        if (g.ts && (earliest === null || g.ts < earliest)) earliest = g.ts;
      });
      if (earliest) {
        PLAYER_ADDED[name] = earliest;
        changed = true;
      }
    });
    if (changed) savePlayerAddedToStorage(PLAYER_ADDED);
  }

  // Net rating change within a period, e.g. for the All Players page. null
  // means "no rating history at all" (never played a rated game).
  function computeRatingPeriodDelta(name, period) {
    var entry = getPlayerRatingEntry(name);
    if (!entry || entry.history.length === 0) return null;
    var periodStart = periodStartDate(period);
    var startRating = DEFAULT_RATING;
    if (periodStart) {
      var startMs = periodStart.getTime();
      for (var i = entry.history.length - 1; i >= 0; i--) {
        if (new Date(entry.history[i].ts).getTime() < startMs) {
          startRating = entry.history[i].rating;
          break;
        }
      }
    }
    return entry.rating - startRating;
  }

  // A small "412" badge next to a player's name, used everywhere a name
  // is shown (roster, scoreboard, All Players, player stats page).
  function buildRatingBadge(name) {
    var badge = document.createElement("span");
    badge.className = "rating-badge";
    badge.textContent = getPlayerRating(name);
    badge.title = T("common.ratingBadgeTitle");
    return badge;
  }

  // A small icon-only button that jumps straight to a player's single-
  // stat page — dropped in next to a player's name wherever one appears
  // (scoreboard cards, standings, tournament bracket cards, All Players),
  // alongside (not instead of) whatever else that name already does.
  function buildPlayerLinkIcon(name) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-ghost player-link-icon";
    btn.setAttribute("aria-label", "View " + name + "'s single-player stats");
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      openPlayerStatsPage(name);
    });
    return btn;
  }

  // Formats a period rating change as "▲ +18", "▼ −9", "— no change", or
  // null (never rated) for the All Players page.
  function formatRatingPeriodDelta(name, period) {
    var delta = computeRatingPeriodDelta(name, period);
    if (delta === null) return null;
    if (delta > 0) return "▲ +" + delta;
    if (delta < 0) return "▼ " + delta;
    return "— no change";
  }

  // Finds an existing PLAYER_STATS key matching this name regardless of
  // case, so a lookup for "bob" still finds stats saved under "Bob".
  function findPlayerStatsKey(name) {
    var key = normalizeNameKey(name);
    var match = Object.keys(PLAYER_STATS).filter(function (k) {
      return normalizeNameKey(k) === key;
    });
    return match.length ? match[0] : null;
  }

  function getPlayerSessions(name) {
    var entry = PLAYER_STATS[findPlayerStatsKey(name) || name];
    return entry && Array.isArray(entry.sessions) ? entry.sessions.slice() : [];
  }

  function setPlayerSessions(name, sessions) {
    var key = findPlayerStatsKey(name) || name;
    PLAYER_STATS[key] = { name: key, sessions: sessions };
    savePlayerStatsToStorage(PLAYER_STATS);
  }

  // Clears every player's win/game history on this device - both the
  // archived PLAYER_STATS store and whatever's still live in the current
  // session (state.gameHistory/playerWins/teamWins), since a player's
  // stats page reads both together (see allGamesForPlayerName) and
  // leaving the live half untouched made this look like it did nothing.
  // Ratings are a separate, intentionally-preserved store - see
  // resetAllPlayersOfficialRating for that one.
  function resetAllPlayerStats() {
    confirmModal(T("confirm.resetAllPlayerStats"), function () {
      exportAllData();
      saveResetSnapshot("allPlayerStats", T("resetSnapshot.allPlayerStatsLabel"), {
        playerStats: JSON.parse(JSON.stringify(PLAYER_STATS)),
        gameHistory: JSON.parse(JSON.stringify(state.gameHistory)),
        playerWins: JSON.parse(JSON.stringify(state.playerWins)),
        teamWins: JSON.parse(JSON.stringify(state.teamWins)),
        teamMvpWins: JSON.parse(JSON.stringify(state.teamMvpWins))
      });
      PLAYER_STATS = {};
      savePlayerStatsToStorage(PLAYER_STATS);
      state.playerWins = {};
      state.teamWins = {};
      state.teamMvpWins = {};
      state.gameHistory = [];
      resetGameBalls();
      saveState();
      if (currentStatsPlayerName) {
        currentStatsSessions = [];
        renderPlayerHistoryList([]);
      }
      renderAll();
      showToast(T("toast.playerStatsCleared"));
    });
  }

  // Clears every saved player list AND the live roster itself, so the app
  // starts completely clean with nobody listed - not just the saved
  // presets in the "Load Player List" dropdown, which is all this used to
  // touch.
  function resetAllRosterLists() {
    if (SAVED_ROSTERS.length === 0 && state.players.length === 0) {
      showToast(T("toast.noSavedListsToReset"));
      return;
    }
    confirmModal(T("confirm.resetRosterLists"), function () {
      exportRosterLists();
      saveResetSnapshot("rosterLists", T("resetSnapshot.rosterListsLabel"), {
        rosters: JSON.parse(JSON.stringify(SAVED_ROSTERS)),
        players: JSON.parse(JSON.stringify(state.players)),
        playerWins: JSON.parse(JSON.stringify(state.playerWins)),
        teamWins: JSON.parse(JSON.stringify(state.teamWins)),
        teamMvpWins: JSON.parse(JSON.stringify(state.teamMvpWins))
      });
      SAVED_ROSTERS = [];
      saveRostersToStorage(SAVED_ROSTERS);
      populateRosterLoadSelect();
      state.players = [];
      state.playerWins = {};
      state.teamWins = {};
      state.teamMvpWins = {};
      saveState();
      validateNewPlayerNameInput();
      renderAll();
      showToast(T("toast.rosterListsCleared"));
    });
  }

  // One-time migration: the app used to store rosters/player stats as JSON
  // files committed to this GitHub repo. The first time this version boots,
  // pull in whatever's still out there so history isn't lost, then never
  // touch the repo again.
  function migrateFromRepoIfNeeded() {
    var alreadyMigrated;
    try {
      alreadyMigrated = localStorage.getItem(ROSTERS_KEY) !== null || localStorage.getItem(PLAYER_STATS_KEY) !== null;
    } catch (e) {
      alreadyMigrated = false;
    }
    if (alreadyMigrated) return Promise.resolve();

    return fetchFresh("players/rosters.json")
      .then(function (res) {
        return res.ok ? res.json() : [];
      })
      .catch(function () {
        return [];
      })
      .then(function (rosters) {
        rosters = Array.isArray(rosters) ? rosters : [];
        var nameSet = {};
        rosters.forEach(function (r) {
          (r.players || []).forEach(function (n) {
            nameSet[n] = true;
          });
        });
        state.players.forEach(function (p) {
          nameSet[p.name] = true;
        });
        var names = Object.keys(nameSet);
        return Promise.all(
          names.map(function (name) {
            return fetchFresh("players/" + playerStatsFilename(name))
              .then(function (res) {
                return res.ok ? res.json() : null;
              })
              .catch(function () {
                return null;
              })
              .then(function (data) {
                if (data && Array.isArray(data.sessions) && data.sessions.length) {
                  PLAYER_STATS[name] = { name: name, sessions: data.sessions };
                }
              });
          })
        ).then(function () {
          SAVED_ROSTERS = rosters;
          saveRostersToStorage(rosters);
          savePlayerStatsToStorage(PLAYER_STATS);
        });
      });
  }

  function exportAllData() {
    var payload = {
      exportedAt: new Date().toISOString(),
      state: state,
      rosters: SAVED_ROSTERS,
      playerStats: PLAYER_STATS,
      ratings: PLAYER_RATINGS,
      contacts: PLAYER_CONTACTS
    };
    downloadJSON("pool-master-counter-backup-" + payload.exportedAt.slice(0, 10) + ".json", payload);
  }

  // Pulls every (player, calendar date) pair referenced in an imported
  // backup's in-progress gameHistory into proper session records, so those
  // not-yet-exported games aren't silently dropped when we merge instead of
  // adopting that backup's live state wholesale.
  function summarizeGameHistoryByPlayer(gameHistory) {
    var byPlayerDates = {};
    (gameHistory || []).forEach(function (entry) {
      if (!entry || typeof entry === "string" || !entry.winnerNames || !entry.ts) return;
      var date = entry.ts.slice(0, 10);
      (entry.winnerNames || []).concat(entry.opponentNames || []).forEach(function (name) {
        if (!byPlayerDates[name]) byPlayerDates[name] = {};
        byPlayerDates[name][date] = true;
      });
    });
    var sessionsByPlayer = {};
    Object.keys(byPlayerDates).forEach(function (name) {
      var sessions = Object.keys(byPlayerDates[name])
        .map(function (date) {
          return computeSessionFromGameHistory(gameHistory, name, date);
        })
        .filter(Boolean);
      if (sessions.length) sessionsByPlayer[name] = sessions;
    });
    return sessionsByPlayer;
  }

  // Merges an imported PLAYER_STATS object, plus any extra sessions pulled
  // from the imported backup's live gameHistory, into the local one.
  function mergePlayerStatsData(localStats, importedStats, extraSessionsByPlayer) {
    var merged = {};
    Object.keys(localStats || {}).forEach(function (name) {
      merged[name] = { name: name, sessions: (localStats[name].sessions || []).slice() };
    });
    function foldIn(name, sessions) {
      if (!merged[name]) merged[name] = { name: name, sessions: [] };
      merged[name].sessions = mergeSessionLists(merged[name].sessions, sessions);
    }
    Object.keys(importedStats || {}).forEach(function (name) {
      var entry = importedStats[name];
      foldIn(name, entry && Array.isArray(entry.sessions) ? entry.sessions : []);
    });
    Object.keys(extraSessionsByPlayer || {}).forEach(function (name) {
      foldIn(name, extraSessionsByPlayer[name]);
    });
    return merged;
  }

  // Unions two rating stores by combining each player's history (deduped
  // by timestamp) and recomputing the current rating/games-played from
  // the merged, time-sorted history — rather than picking one side's
  // number — so importing a backup from another device never overwrites
  // a rating with a stale one or double-counts a game both sides know.
  function mergeRatingsData(localRatings, importedRatings) {
    var merged = {};
    Object.keys(localRatings || {}).forEach(function (name) {
      merged[name] = (localRatings[name].history || []).slice();
    });
    Object.keys(importedRatings || {}).forEach(function (name) {
      var history = importedRatings[name] && Array.isArray(importedRatings[name].history) ? importedRatings[name].history : [];
      merged[name] = (merged[name] || []).concat(history);
    });
    var result = {};
    Object.keys(merged).forEach(function (name) {
      var seen = {};
      var deduped = [];
      merged[name]
        .slice()
        .sort(function (a, b) {
          return a.ts.localeCompare(b.ts);
        })
        .forEach(function (h) {
          if (seen[h.ts]) return;
          seen[h.ts] = true;
          deduped.push(h);
        });
      result[name] = {
        name: name,
        rating: deduped.length ? deduped[deduped.length - 1].rating : DEFAULT_RATING,
        gamesPlayed: deduped.length,
        history: deduped
      };
    });
    return result;
  }

  // Unions two saved-roster-list arrays, skipping entries whose player set
  // already exists locally. Keyed purely by sorted players (not id/savedAt)
  // so re-importing the same hand-edited file — or the same backup twice —
  // never duplicates a list just because a fresh id/timestamp got assigned.
  function mergeRosterLists(localRosters, importedRosters) {
    var seen = {};
    var merged = [];
    function rosterKey(r) {
      return (r.players || []).map(normalizeNameKey).sort().join(",");
    }
    (localRosters || []).forEach(function (r) {
      var key = rosterKey(r);
      if (seen[key]) return;
      seen[key] = true;
      merged.push(r);
    });
    var added = 0;
    (importedRosters || []).forEach(function (r) {
      var key = rosterKey(r);
      if (seen[key]) return;
      seen[key] = true;
      merged.push(r);
      added += 1;
    });
    merged.sort(function (a, b) {
      return (a.savedAt || "").localeCompare(b.savedAt || "");
    });
    return { rosters: merged, added: added };
  }

  // A friendly, hand-editable export: just label + players per list, no
  // internal id/savedAt bookkeeping to get wrong when writing one by hand.
  function exportRosterLists() {
    var payload = {
      exportedAt: new Date().toISOString(),
      rosterLists: SAVED_ROSTERS.map(function (r) {
        return { label: r.label, players: r.players };
      })
    };
    downloadJSON("pool-master-counter-player-lists-" + payload.exportedAt.slice(0, 10) + ".json", payload);
  }

  // Accepts a bare array of names, a {label, players} object (the hand-
  // editable export shape), or a full saved-roster entry with id/savedAt —
  // whatever's easiest to write by hand or came from a previous export.
  function normalizeImportedRosterEntry(entry, idx) {
    var players;
    if (Array.isArray(entry)) {
      players = entry;
    } else if (entry && typeof entry === "object") {
      players = entry.players;
    } else {
      return null;
    }
    players = (Array.isArray(players) ? players : [])
      .filter(function (n) {
        return typeof n === "string" && n.trim();
      })
      .map(function (n) {
        return capitalizeName(n.trim());
      });
    if (!players.length) return null;
    var savedAt = (entry && !Array.isArray(entry) && entry.savedAt) || new Date().toISOString();
    var label = (entry && !Array.isArray(entry) && entry.label) || (savedAt.slice(0, 10) + " — " + players.join(", "));
    var id = (entry && !Array.isArray(entry) && entry.id) || ("roster-import-" + savedAt.replace(/[:.]/g, "-") + "-" + idx);
    return { id: id, label: label, players: players, savedAt: savedAt };
  }

  function importRosterListsFile(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var data;
      try {
        data = JSON.parse(reader.result);
      } catch (e) {
        alertModal(T("alert.notValidJson"));
        return;
      }
      var rawList = Array.isArray(data)
        ? data
        : Array.isArray(data.rosterLists)
        ? data.rosterLists
        : Array.isArray(data.rosters)
        ? data.rosters
        : null;
      if (!rawList) {
        alertModal(T("alert.notAPlayerListFile"));
        return;
      }
      var normalized = rawList.map(normalizeImportedRosterEntry).filter(Boolean);
      if (!normalized.length) {
        alertModal(T("alert.noValidPlayerLists"));
        return;
      }
      var merge = mergeRosterLists(SAVED_ROSTERS, normalized);
      SAVED_ROSTERS = merge.rosters;
      saveRostersToStorage(SAVED_ROSTERS);
      populateRosterLoadSelect();
      showToast(
        T(
          merge.added === 1
            ? (merge.added < normalized.length ? "toast.importedPlayerListsOne" : "toast.importedPlayerListsOneAll")
            : (merge.added < normalized.length ? "toast.importedPlayerListsMany" : "toast.importedPlayerListsManyAll"),
          { count: merge.added }
        )
      );
    };
    reader.onerror = function () {
      alertModal(T("alert.couldNotReadFile"));
    };
    reader.readAsText(file);
  }

  // Lists `names` in the removed-players conflict overlay, each defaulting
  // to unchecked (keep removed - the local device's own choice wins by
  // default). Calls onContinue with just the names the user checked to
  // restore; importAllData handles actually re-adding them.
  function showRemovedPlayersConflict(names, onContinue) {
    removedPlayersChecklist.innerHTML = "";
    names.forEach(function (name) {
      var li = document.createElement("li");
      li.className = "tournament-player-check-row";
      var label = document.createElement("label");
      var checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = name;
      var span = document.createElement("span");
      span.textContent = name;
      label.appendChild(checkbox);
      label.appendChild(span);
      li.appendChild(label);
      removedPlayersChecklist.appendChild(li);
    });
    removedPlayersOverlay.classList.remove("hidden");
    function handleContinue() {
      var restored = Array.prototype.slice
        .call(removedPlayersChecklist.querySelectorAll('input[type="checkbox"]:checked'))
        .map(function (cb) {
          return cb.value;
        });
      removedPlayersOverlay.classList.add("hidden");
      btnRemovedPlayersContinue.removeEventListener("click", handleContinue);
      onContinue(restored);
    }
    btnRemovedPlayersContinue.addEventListener("click", handleContinue);
  }

  function importAllData(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var data;
      try {
        data = JSON.parse(reader.result);
      } catch (e) {
        alertModal(T("alert.notValidJson"));
        return;
      }
      if (!data || typeof data !== "object" || !data.state) {
        alertModal(T("alert.notABackupFile"));
        return;
      }

      // A device with no players yet has nothing to lose — treat this like
      // setting up a new device from a backup and adopt it as-is. Otherwise,
      // merge: keep the in-progress game running here, and fold the
      // backup's history in without double-counting anything already known.
      var localIsFresh = state.players.length === 0;

      confirmModal(T(localIsFresh ? "confirm.importBackupFresh" : "confirm.importBackupMerge"), function () {
        try {
          var importedState = data.state && typeof data.state === "object" ? data.state : defaultState();
          var importedRosters = Array.isArray(data.rosters) ? data.rosters : [];
          var importedPlayerStats = data.playerStats && typeof data.playerStats === "object" ? data.playerStats : {};

          var extraSessions = summarizeGameHistoryByPlayer(importedState.gameHistory || []);
          var mergedPlayerStats = mergePlayerStatsData(PLAYER_STATS, importedPlayerStats, extraSessions);
          var rosterMerge = mergeRosterLists(SAVED_ROSTERS, importedRosters);
          var importedRatings = data.ratings && typeof data.ratings === "object" ? data.ratings : {};
          var mergedRatings = mergeRatingsData(PLAYER_RATINGS, importedRatings);
          var importedContacts = data.contacts && typeof data.contacts === "object" ? data.contacts : {};
          var mergedContacts = mergeContactsData(PLAYER_CONTACTS, importedContacts);

          var importedRosterPlayerNames = [];
          importedRosters.forEach(function (r) {
            (r.players || []).forEach(function (n) {
              importedRosterPlayerNames.push(n);
            });
          });

          // Names skipped because they're in REMOVED_PLAYERS - this
          // device deliberately removed them, so the import shouldn't
          // silently re-add them. Collected here and resolved after the
          // merge via the removed-players conflict overlay.
          var conflictedNames = [];
          var conflictSeen = {};
          function collectConflict(name) {
            var key = normalizeNameKey(name);
            if (conflictSeen[key]) return;
            conflictSeen[key] = true;
            conflictedNames.push(name);
          }

          var finalState;
          var newPlayerCount = 0;
          if (localIsFresh) {
            finalState = importedState;
            finalState.players = (finalState.players || []).filter(function (p) {
              if (p && p.name && isPlayerRemoved(p.name)) {
                collectConflict(p.name);
                return false;
              }
              return true;
            });
            var freshKnownNames = {};
            finalState.players.forEach(function (p) {
              freshKnownNames[normalizeNameKey(p.name)] = true;
            });
            importedRosterPlayerNames.forEach(function (name) {
              if (!name || freshKnownNames[normalizeNameKey(name)]) return;
              if (isPlayerRemoved(name)) {
                collectConflict(name);
                return;
              }
              freshKnownNames[normalizeNameKey(name)] = true;
              finalState.players.push({
                id: uid(),
                name: name,
                voice: finalState.players.length % VOICE_PITCHES.length,
                playing: false,
                teamId: null,
                balls: 0
              });
            });
          } else {
            finalState = state;
            var knownNames = {};
            finalState.players.forEach(function (p) {
              knownNames[normalizeNameKey(p.name)] = true;
            });
            var candidateNames = (Array.isArray(importedState.players) ? importedState.players : [])
              .map(function (p) {
                return p && p.name;
              })
              .concat(Object.keys(importedPlayerStats))
              .concat(Object.keys(extraSessions))
              .concat(importedRosterPlayerNames);
            candidateNames.forEach(function (name) {
              if (!name || knownNames[normalizeNameKey(name)]) return;
              if (isPlayerRemoved(name)) {
                knownNames[normalizeNameKey(name)] = true;
                collectConflict(name);
                return;
              }
              knownNames[normalizeNameKey(name)] = true;
              finalState.players.push({
                id: uid(),
                name: name,
                voice: finalState.players.length % VOICE_PITCHES.length,
                playing: false,
                teamId: null,
                balls: 0
              });
              newPlayerCount += 1;
            });
          }

          // Capitalizes every roster name at once, covering both freshly-
          // adopted importedState.players (never passed through addPlayer)
          // and any newly-pushed candidates above, so an imported backup
          // with lowercase names can't leave the roster inconsistently cased.
          finalState.players.forEach(function (p) {
            if (p && p.name) p.name = capitalizeName(p.name);
          });

          localStorage.setItem(ROSTERS_KEY, JSON.stringify(rosterMerge.rosters));
          localStorage.setItem(PLAYER_STATS_KEY, JSON.stringify(mergedPlayerStats));
          localStorage.setItem(RATINGS_KEY, JSON.stringify(mergedRatings));
          localStorage.setItem(CONTACTS_KEY, JSON.stringify(mergedContacts));

          function finishImport() {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(finalState));
            if (!localIsFresh) {
              alertModal(T("alert.mergedImport", { players: newPlayerCount, lists: rosterMerge.added }), function () {
                location.reload();
              });
            } else {
              location.reload();
            }
          }

          if (conflictedNames.length) {
            showRemovedPlayersConflict(conflictedNames, function (restoredNames) {
              restoredNames.forEach(function (name) {
                clearPlayerRemoved(name);
                finalState.players.push({
                  id: uid(),
                  name: capitalizeName(name),
                  voice: finalState.players.length % VOICE_PITCHES.length,
                  playing: false,
                  teamId: null,
                  balls: 0
                });
                if (!localIsFresh) newPlayerCount += 1;
              });
              finishImport();
            });
          } else {
            finishImport();
          }
        } catch (e) {
          alertModal(T("alert.couldNotImport", { message: e.message }));
        }
      });
    };
    reader.onerror = function () {
      alertModal(T("alert.couldNotReadFile"));
    };
    reader.readAsText(file);
  }

  // ---------------------------------------------------------------------
  // Recover Data (reset snapshots + comparison/recovery)
  // ---------------------------------------------------------------------

  // The player names a snapshot has data for, plus anyone appearing in its
  // game log (covers a name that shows up in games but has no separate
  // stats entry for some reason).
  function namesInSnapshot(type, data) {
    var names = {};
    if (type === "todayStats") {
      Object.keys(data.prunedSessions || {}).forEach(function (n) {
        names[n] = true;
      });
    } else if (type === "allPlayerStats") {
      Object.keys(data.playerStats || {}).forEach(function (n) {
        names[n] = true;
      });
    } else if (type === "allRatings") {
      Object.keys(data.ratings || {}).forEach(function (n) {
        names[n] = true;
      });
    } else if (type === "playerStats") {
      if (data.name) names[data.name] = true;
    } else if (type === "rosterLists") {
      (data.players || []).forEach(function (p) {
        if (p && p.name) names[p.name] = true;
      });
    }
    (data.gameHistory || []).forEach(function (g) {
      (g.winnerNames || []).concat(g.opponentNames || []).forEach(function (n) {
        names[n] = true;
      });
    });
    return Object.keys(names).sort(function (a, b) {
      return a.localeCompare(b);
    });
  }

  // A player's sessions as recorded in this snapshot - same shape
  // mergeSessionLists already knows how to combine, whatever the type.
  function sessionsInSnapshotForPlayer(type, data, name) {
    if (type === "todayStats") return data.prunedSessions[name] || [];
    if (type === "allPlayerStats") return (data.playerStats[name] && data.playerStats[name].sessions) || [];
    if (type === "playerStats") return data.sessions || [];
    return [];
  }

  function summarizeSnapshotPlayer(type, data, name) {
    if (type === "allRatings") {
      var r = data.ratings[name];
      return r ? T("recoverData.ratingSummary", { rating: r.rating, games: r.gamesPlayed || 0 }) : "";
    }
    if (type === "rosterLists") return "";
    var sessions = sessionsInSnapshotForPlayer(type, data, name);
    var games = 0;
    var wins = 0;
    sessions.forEach(function (s) {
      games += (s.games || []).length;
      wins += s.wins || 0;
    });
    return T("recoverData.gamesSummary", { games: games, wins: wins });
  }

  function snapshotOverallSummary(type, data) {
    if (type === "tournament") return T("recoverData.tournamentSummary");
    var names = namesInSnapshot(type, data);
    if (type === "rosterLists") {
      return T("recoverData.rosterListsSummary", { players: names.length, lists: (data.rosters || []).length });
    }
    var gameCount = (data.gameHistory || []).length;
    return gameCount
      ? T("recoverData.playersAndGamesSummary", { players: names.length, games: gameCount })
      : T("recoverData.playersSummary", { players: names.length });
  }

  function renderRecoverDataList() {
    recoverDataList.innerHTML = "";
    if (RESET_SNAPSHOTS.length === 0) {
      var hint = document.createElement("li");
      hint.className = "empty-hint";
      hint.textContent = T("recoverData.none");
      recoverDataList.appendChild(hint);
      return;
    }
    RESET_SNAPSHOTS.forEach(function (entry) {
      var li = document.createElement("li");
      li.className = "recover-data-row";
      var info = document.createElement("div");
      info.className = "recover-data-row-info";
      var label = document.createElement("span");
      label.className = "recover-data-row-label";
      label.textContent = entry.label;
      var meta = document.createElement("span");
      meta.className = "recover-data-row-meta";
      var when;
      try {
        when = new Date(entry.ts).toLocaleString();
      } catch (e) {
        when = entry.ts;
      }
      meta.textContent = when + " · " + snapshotOverallSummary(entry.type, entry.data);
      info.appendChild(label);
      info.appendChild(meta);
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-ghost";
      btn.textContent = T("recoverData.recover");
      btn.addEventListener("click", function () {
        openRecoverDetail(entry.type, entry.label, entry.data);
      });
      li.appendChild(info);
      li.appendChild(btn);
      recoverDataList.appendChild(li);
    });
  }

  var recoverDetailCurrent = null; // { type, data }

  function renderRecoverGamesChecklist(type, data) {
    if (type !== "todayStats" && type !== "allPlayerStats") {
      recoverGamesChecklist.innerHTML = "";
      return;
    }
    var checkedNames = {};
    Array.prototype.forEach.call(recoverPlayersChecklist.querySelectorAll('input[type="checkbox"]:checked'), function (cb) {
      checkedNames[cb.value] = true;
    });
    var relevantGames = (data.gameHistory || []).filter(function (g) {
      return (g.winnerNames || []).concat(g.opponentNames || []).some(function (n) {
        return checkedNames[n];
      });
    });
    recoverGamesChecklist.innerHTML = "";
    relevantGames.forEach(function (g) {
      var li = document.createElement("li");
      var label = document.createElement("label");
      var checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = g.ts;
      checkbox.checked = true;
      var span = document.createElement("span");
      var winners = joinNamesForReport(g.winnerNames || []);
      var losers = joinNamesForReport(g.opponentNames || []);
      var time = formatReportGameTime(g.ts);
      span.textContent = (time ? time + " — " : "") + winners + " won " + g.gameLabel + (losers ? " against " + losers : "");
      label.appendChild(checkbox);
      label.appendChild(span);
      li.appendChild(label);
      recoverGamesChecklist.appendChild(li);
    });
  }

  function openRecoverDetail(type, label, data) {
    recoverDetailCurrent = { type: type, data: data };
    recoverDetailTitle.textContent = label;
    recoverDetailExplain.textContent = T("recoverData.detailExplain");

    var isTournament = type === "tournament";
    var isRosterLists = type === "rosterLists";
    var hasGames = type === "todayStats" || type === "allPlayerStats";
    recoverPlayersSection.classList.toggle("hidden", isTournament);
    recoverGamesSection.classList.toggle("hidden", !hasGames);
    recoverRostersSection.classList.toggle("hidden", !isRosterLists);

    recoverPlayersChecklist.innerHTML = "";
    if (!isTournament) {
      namesInSnapshot(type, data).forEach(function (name) {
        var li = document.createElement("li");
        li.className = "tournament-player-check-row";
        var rowLabel = document.createElement("label");
        var checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.value = name;
        checkbox.addEventListener("change", function () {
          renderRecoverGamesChecklist(type, data);
        });
        var span = document.createElement("span");
        var summary = summarizeSnapshotPlayer(type, data, name);
        span.textContent = summary ? name + " — " + summary : name;
        rowLabel.appendChild(checkbox);
        rowLabel.appendChild(span);
        li.appendChild(rowLabel);
        recoverPlayersChecklist.appendChild(li);
      });
    }
    renderRecoverGamesChecklist(type, data);

    recoverRostersChecklist.innerHTML = "";
    if (isRosterLists) {
      (data.rosters || []).forEach(function (r) {
        var li = document.createElement("li");
        li.className = "tournament-player-check-row";
        var rowLabel = document.createElement("label");
        var checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.value = r.id;
        var span = document.createElement("span");
        span.textContent = r.label;
        rowLabel.appendChild(checkbox);
        rowLabel.appendChild(span);
        li.appendChild(rowLabel);
        recoverRostersChecklist.appendChild(li);
      });
    }

    recoverDetailOverlay.classList.remove("hidden");
  }

  function closeRecoverDetail() {
    recoverDetailOverlay.classList.add("hidden");
    recoverDetailCurrent = null;
  }

  // Dedupes by ts (same convention mergeRatingsData uses for rating
  // history entries), newest first, capped the same way live play caps
  // state.gameHistory in creditWin.
  function mergeGameHistoryEntries(local, restored) {
    var seen = {};
    (local || []).forEach(function (e) {
      if (e && e.ts) seen[e.ts] = true;
    });
    var merged = (local || []).slice();
    (restored || []).forEach(function (e) {
      if (!e || !e.ts || seen[e.ts]) return;
      seen[e.ts] = true;
      merged.push(e);
    });
    merged.sort(function (a, b) {
      return (b.ts || "").localeCompare(a.ts || "");
    });
    if (merged.length > 200) merged.length = 200;
    return merged;
  }

  function restoreCheckedFromSnapshot() {
    if (!recoverDetailCurrent) return;
    var type = recoverDetailCurrent.type;
    var data = recoverDetailCurrent.data;

    if (type === "tournament") {
      if (TOURNAMENT) {
        showToast(T("toast.recoverTournamentBlocked"));
        return;
      }
      TOURNAMENT = JSON.parse(JSON.stringify(data.tournament));
      saveTournamentToStorage(TOURNAMENT);
      renderTournamentPage();
      closeRecoverDetail();
      showToast(T("toast.recoverRestored"));
      return;
    }

    var checkedPlayers = Array.prototype.slice
      .call(recoverPlayersChecklist.querySelectorAll('input[type="checkbox"]:checked'))
      .map(function (cb) {
        return cb.value;
      });

    if (type === "rosterLists") {
      var checkedRosterIds = Array.prototype.slice
        .call(recoverRostersChecklist.querySelectorAll('input[type="checkbox"]:checked'))
        .map(function (cb) {
          return cb.value;
        });
      checkedPlayers.forEach(function (name) {
        var alreadyThere = state.players.some(function (p) {
          return normalizeNameKey(p.name) === normalizeNameKey(name);
        });
        if (!alreadyThere) addPlayer(name);
      });
      if (checkedRosterIds.length) {
        var toRestore = (data.rosters || []).filter(function (r) {
          return checkedRosterIds.indexOf(r.id) !== -1;
        });
        var merge = mergeRosterLists(SAVED_ROSTERS, toRestore);
        SAVED_ROSTERS = merge.rosters;
        saveRostersToStorage(SAVED_ROSTERS);
        populateRosterLoadSelect();
      }
      saveState();
      renderAll();
      closeRecoverDetail();
      showToast(T("toast.recoverRestored"));
      return;
    }

    var restoredStats = false;
    checkedPlayers.forEach(function (name) {
      var sessions = sessionsInSnapshotForPlayer(type, data, name);
      if (sessions.length) {
        var key = findPlayerStatsKey(name) || name;
        var existing = (PLAYER_STATS[key] && PLAYER_STATS[key].sessions) || [];
        PLAYER_STATS[key] = { name: key, sessions: mergeSessionLists(existing, sessions) };
        restoredStats = true;
      }
      var historyToRestore =
        type === "todayStats" && data.ratingHistory
          ? data.ratingHistory[name]
          : type === "allRatings" && data.ratings && data.ratings[name]
          ? data.ratings[name].history
          : null;
      if (historyToRestore && historyToRestore.length) {
        var importedRatingsObj = {};
        importedRatingsObj[name] = { history: historyToRestore };
        var mergedR = mergeRatingsData(PLAYER_RATINGS, importedRatingsObj);
        PLAYER_RATINGS[name] = mergedR[name];
        restoredStats = true;
      }
    });
    if (restoredStats) {
      savePlayerStatsToStorage(PLAYER_STATS);
      saveRatingsToStorage(PLAYER_RATINGS);
    }

    var checkedGameTs = Array.prototype.slice
      .call(recoverGamesChecklist.querySelectorAll('input[type="checkbox"]:checked'))
      .map(function (cb) {
        return cb.value;
      });
    if (checkedGameTs.length) {
      var gamesToRestore = (data.gameHistory || []).filter(function (g) {
        return checkedGameTs.indexOf(g.ts) !== -1;
      });
      state.gameHistory = mergeGameHistoryEntries(state.gameHistory, gamesToRestore);
      recomputeLiveWinsFromGameHistory();
      saveState();
    }

    renderAll();
    closeRecoverDetail();
    showToast(T("toast.recoverRestored"));
  }

  // A re-imported full backup file doesn't carry a reset "type" of its
  // own - treat it like an allPlayerStats snapshot (same player+game
  // checklist shape) so it flows through the identical recovery UI.
  function normalizeImportedBackupAsSnapshot(data) {
    var importedState = data.state && typeof data.state === "object" ? data.state : {};
    return {
      type: "allPlayerStats",
      data: {
        playerStats: data.playerStats && typeof data.playerStats === "object" ? data.playerStats : {},
        gameHistory: Array.isArray(importedState.gameHistory) ? importedState.gameHistory : []
      }
    };
  }

  function importFileForRecovery(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var data;
      try {
        data = JSON.parse(reader.result);
      } catch (e) {
        alertModal(T("alert.notValidJson"));
        return;
      }
      if (!data || typeof data !== "object" || !data.state) {
        alertModal(T("alert.notABackupFile"));
        return;
      }
      var normalized = normalizeImportedBackupAsSnapshot(data);
      openRecoverDetail(normalized.type, T("recoverData.importedFileLabel"), normalized.data);
    };
    reader.onerror = function () {
      alertModal(T("alert.couldNotReadFile"));
    };
    reader.readAsText(file);
  }

  // ---------------------------------------------------------------------
  // Player rosters
  // ---------------------------------------------------------------------

  var SAVED_ROSTERS = loadRostersFromStorage();
  (function migrateRosterCapitalizationOnBoot() {
    var changed = false;
    SAVED_ROSTERS.forEach(function (r) {
      if (!r || !Array.isArray(r.players)) return;
      r.players = r.players.map(function (n) {
        var fixed = capitalizeName(n);
        if (fixed !== n) changed = true;
        return fixed;
      });
    });
    if (changed) saveRostersToStorage(SAVED_ROSTERS);
  })();

  function populateRosterLoadSelect() {
    rosterLoadSelect.innerHTML = "";
    if (SAVED_ROSTERS.length === 0) {
      var opt = document.createElement("option");
      opt.value = "";
      opt.textContent = T("players.noSavedListsYet");
      rosterLoadSelect.appendChild(opt);
      rosterLoadSelect.disabled = true;
      btnRosterLoad.disabled = true;
      return;
    }
    rosterLoadSelect.disabled = false;
    btnRosterLoad.disabled = false;
    SAVED_ROSTERS.forEach(function (r, i) {
      var opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = r.label;
      rosterLoadSelect.appendChild(opt);
    });
  }

  // Adds every player from a saved roster entry who isn't already on the
  // live roster (case-insensitive), leaving everything else untouched.
  // Shared by the main "Load Player List" button and the wizard.
  function loadRosterEntry(roster) {
    if (!roster) return 0;
    var existingNames = state.players.map(function (p) {
      return normalizeNameKey(p.name);
    });
    var added = 0;
    roster.players.forEach(function (name) {
      var key = normalizeNameKey(name);
      if (existingNames.indexOf(key) === -1) {
        addPlayer(name);
        existingNames.push(key);
        added += 1;
      }
    });
    return added;
  }

  // Quick Counter's own "Load Player List": unlike loadRosterEntry (which
  // only ever adds), this makes the active set match the loaded list
  // exactly — anyone active but not on the list drops to standby (not
  // deleted, so their data stays put and typing their name back in just
  // reactivates them — see buildQuickCounterAddRow), and everyone on the
  // list is added/reactivated and marked playing.
  function loadPlayerListForQuickCounter(idx) {
    var roster = SAVED_ROSTERS[parseInt(idx, 10)];
    if (!roster || !roster.players || !roster.players.length) return;
    var listKeys = {};
    roster.players.forEach(function (name) {
      listKeys[normalizeNameKey(name)] = true;
    });
    state.players.forEach(function (p) {
      if (p.playing && !listKeys[normalizeNameKey(p.name)]) p.playing = false;
    });
    roster.players.forEach(function (name) {
      var key = normalizeNameKey(name);
      var existing = state.players.filter(function (p) {
        return normalizeNameKey(p.name) === key;
      })[0];
      if (existing) {
        existing.playing = true;
      } else {
        var player = addPlayer(name);
        if (player) player.playing = true;
      }
    });
    saveState();
    renderAll();
    showToast(
      "Loaded \"" + roster.label + "\" — " + roster.players.length + " player" + (roster.players.length === 1 ? "" : "s") + "."
    );
  }

  function loadSelectedRoster() {
    var idx = parseInt(rosterLoadSelect.value, 10);
    var roster = SAVED_ROSTERS[idx];
    if (!roster) return;
    var added = loadRosterEntry(roster);
    validateNewPlayerNameInput();
    renderAll();
    if (added === 0) {
      showToast(T("toast.allFromListAlreadyInRoster"));
    } else {
      showToast(T(added === 1 ? "toast.addedFromListOne" : "toast.addedFromListMany", { count: added, label: roster.label }));
    }
  }

  function currentRosterNames() {
    return state.players
      .map(function (p) {
        return p.name;
      })
      .sort();
  }

  // Checks the live roster against every saved list (exact same players,
  // no more, no fewer) and, if it's genuinely new, saves it and downloads
  // a fresh player-lists backup file. Runs on every game — not just the
  // first of a session — so adding/removing a player mid-session gets
  // captured as soon as the next game is credited, not just at session
  // boundaries. Dedup against every existing list keeps this from ever
  // firing twice for the same composition.
  function saveRosterSnapshotIfNew(silent) {
    if (noStatsMode) return false;
    var names = currentRosterNames();
    if (names.length === 0) return false;
    var normalizedNames = names.map(normalizeNameKey).sort();
    var alreadySaved = SAVED_ROSTERS.some(function (r) {
      var rNames = (r.players || []).map(normalizeNameKey).sort();
      return rNames.length === normalizedNames.length && rNames.every(function (n, i) {
        return n === normalizedNames[i];
      });
    });
    if (alreadySaved) {
      if (!silent) showToast(T("toast.playerListAlreadySaved"));
      return false;
    }
    var now = new Date().toISOString();
    var entry = {
      id: "roster-" + now.replace(/[:.]/g, "-"),
      label: now.slice(0, 10) + " — " + names.join(", "),
      players: names,
      savedAt: now
    };
    SAVED_ROSTERS = SAVED_ROSTERS.concat([entry]);
    saveRostersToStorage(SAVED_ROSTERS);
    populateRosterLoadSelect();
    populateWizardRosterLoadSelect();
    exportRosterLists();
    if (!silent) showToast(T("toast.savedRoster", { label: entry.label }));
    return true;
  }

  function maybeSaveRosterOnNewSession() {
    saveRosterSnapshotIfNew(false);
  }

  // ---------------------------------------------------------------------
  // Game order (rotation) setups — same save/load pattern as player
  // rosters, but the *sequence* is what defines a setup (order matters),
  // so loading one replaces the current order instead of merging it.
  // ---------------------------------------------------------------------

  var SAVED_ROTATIONS = loadRotationsFromStorage();

  function populateRotationLoadSelect() {
    rotationLoadSelect.innerHTML = "";
    if (SAVED_ROTATIONS.length === 0) {
      var opt = document.createElement("option");
      opt.value = "";
      opt.textContent = T("rotation.noSavedRotationsYet");
      rotationLoadSelect.appendChild(opt);
      rotationLoadSelect.disabled = true;
      btnRotationLoad.disabled = true;
      return;
    }
    rotationLoadSelect.disabled = false;
    btnRotationLoad.disabled = false;
    SAVED_ROTATIONS.forEach(function (r, i) {
      var opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = r.label;
      rotationLoadSelect.appendChild(opt);
    });
  }

  // Replaces the current game order outright with a saved rotation's
  // sequence — a sequence isn't something to merge like a player roster.
  // Shared by the main "Load Rotation" button and the wizard.
  function loadRotationEntry(rotation) {
    if (!rotation) return;
    state.rotation = {
      enabled: !!rotation.enabled,
      order: rotation.order.map(function (e) {
        return { gameType: e.gameType, target: e.target, unit: e.unit };
      }),
      every: rotation.every || 1
    };
    saveState();
    applyRotationIfDue();
  }

  function loadSelectedRotation() {
    var idx = parseInt(rotationLoadSelect.value, 10);
    var rotation = SAVED_ROTATIONS[idx];
    if (!rotation) return;
    loadRotationEntry(rotation);
    renderRotation();
    renderWizardIfOpen();
    showToast(T("toast.loadedRotation", { label: rotation.label }));
  }

  function rotationLabelFor(order) {
    return order.map(rotationEntryLabel).join(" → ");
  }

  function rotationEntriesEqual(a, b) {
    return a.gameType === b.gameType && a.target === b.target && a.unit === b.unit;
  }

  // Checks the current game order against every saved rotation (same
  // sequence of rules, not just same game types) and, if it's genuinely
  // new, saves it as a loadable entry. Runs whenever the order changes and
  // on every credited game, mirroring the player-list snapshot behavior.
  function saveRotationSnapshotIfNew(silent) {
    if (noStatsMode) return false;
    var order = state.rotation.order;
    if (!order || order.length === 0) return false;
    var alreadySaved = SAVED_ROTATIONS.some(function (r) {
      return r.order.length === order.length && r.order.every(function (e, i) {
        return rotationEntriesEqual(e, order[i]);
      });
    });
    if (alreadySaved) {
      if (!silent) showToast(T("toast.rotationAlreadySaved"));
      return false;
    }
    var now = new Date().toISOString();
    var entry = {
      id: "rotation-" + now.replace(/[:.]/g, "-"),
      label: rotationLabelFor(order),
      order: order.slice(),
      every: state.rotation.every,
      enabled: state.rotation.enabled,
      savedAt: now
    };
    SAVED_ROTATIONS = SAVED_ROTATIONS.concat([entry]);
    saveRotationsToStorage(SAVED_ROTATIONS);
    populateRotationLoadSelect();
    populateWizardRotationLoadSelect();
    if (!silent) showToast(T("toast.savedRotation", { label: entry.label }));
    return true;
  }

  // ---------------------------------------------------------------------
  // Setup Wizard — a step-by-step flow that walks through the same
  // controls already on the main page (game type/format, players, who's
  // playing, rotation) and applies them all when "Start Game" is hit.
  // Player and rotation changes made in the wizard are applied live via
  // the same functions the main page uses, so canceling never needs to
  // roll anything back; only the format choice from step 1 is a draft
  // until Start is pressed.
  // ---------------------------------------------------------------------

  var WIZARD_STEP_SEQUENCE_DEFAULT = [1, 2, 3, 4, 5];
  var WIZARD_STEP_SEQUENCE_TOURNAMENT = [1, 5];
  var wizardStep = 1;
  var wizardFormat = "individual";

  function wizardStepSequence() {
    return wizardFormat === "tournament" ? WIZARD_STEP_SEQUENCE_TOURNAMENT : WIZARD_STEP_SEQUENCE_DEFAULT;
  }

  function populateWizardRosterLoadSelect() {
    wizardRosterLoadSelect.innerHTML = "";
    if (SAVED_ROSTERS.length === 0) {
      var opt = document.createElement("option");
      opt.value = "";
      opt.textContent = T("players.noSavedListsYet");
      wizardRosterLoadSelect.appendChild(opt);
      wizardRosterLoadSelect.disabled = true;
      btnWizardRosterLoad.disabled = true;
      return;
    }
    wizardRosterLoadSelect.disabled = false;
    btnWizardRosterLoad.disabled = false;
    SAVED_ROSTERS.forEach(function (r, i) {
      var o = document.createElement("option");
      o.value = String(i);
      o.textContent = r.label;
      wizardRosterLoadSelect.appendChild(o);
    });
  }

  function populateWizardRotationLoadSelect() {
    wizardRotationLoadSelect.innerHTML = "";
    if (SAVED_ROTATIONS.length === 0) {
      var opt = document.createElement("option");
      opt.value = "";
      opt.textContent = T("rotation.noSavedRotationsYet");
      wizardRotationLoadSelect.appendChild(opt);
      wizardRotationLoadSelect.disabled = true;
      btnWizardRotationLoad.disabled = true;
      return;
    }
    wizardRotationLoadSelect.disabled = false;
    btnWizardRotationLoad.disabled = false;
    SAVED_ROTATIONS.forEach(function (r, i) {
      var o = document.createElement("option");
      o.value = String(i);
      o.textContent = r.label;
      wizardRotationLoadSelect.appendChild(o);
    });
  }

  function loadSelectedWizardRoster() {
    var idx = parseInt(wizardRosterLoadSelect.value, 10);
    var roster = SAVED_ROSTERS[idx];
    if (!roster) return;
    var added = loadRosterEntry(roster);
    validateWizardNewPlayerNameInput();
    renderAll();
    showToast(
      added === 0
        ? T("toast.allFromListAlreadyInRoster")
        : T(added === 1 ? "toast.addedFromListOne" : "toast.addedFromListMany", { count: added, label: roster.label })
    );
  }

  function syncWizardRotationEnabledRadios() {
    Array.prototype.forEach.call(wizardRotationEnabledRadios, function (r) {
      r.checked = (r.value === "yes") === !!state.rotation.enabled;
    });
    wizardRotationDetail.classList.toggle("hidden", !state.rotation.enabled);
  }

  function loadSelectedWizardRotation() {
    var idx = parseInt(wizardRotationLoadSelect.value, 10);
    var rotation = SAVED_ROTATIONS[idx];
    if (!rotation) return;
    loadRotationEntry(rotation);
    syncWizardRotationEnabledRadios();
    wizardRotationEveryInput.value = state.rotation.every;
    renderRotation();
    renderWizardIfOpen();
    showToast(T("toast.loadedRotation", { label: rotation.label }));
  }

  function validateWizardNewPlayerNameInput() {
    var trimmed = wizardNewPlayerName.value.trim();
    var duplicate = trimmed && isDuplicatePlayerName(trimmed);
    btnWizardAddPlayer.disabled = !trimmed || duplicate;
    if (duplicate) {
      wizardNewPlayerNameRequirement.textContent =
        T("players.duplicateNameHint", { name: capitalizeName(trimmed) });
      wizardNewPlayerNameRequirement.classList.remove("hidden");
    } else {
      wizardNewPlayerNameRequirement.classList.add("hidden");
    }
  }

  function renderWizardPlayerChips() {
    wizardPlayerChips.innerHTML = "";
    if (state.players.length === 0) {
      var hint = document.createElement("li");
      hint.className = "empty-hint";
      hint.textContent = T("wizard.noPlayersYetAddAbove");
      wizardPlayerChips.appendChild(hint);
      return;
    }
    state.players.forEach(function (p) {
      var li = document.createElement("li");
      var name = document.createElement("span");
      buildPlayerNameLabel(name, p.name, false);
      name.appendChild(buildRatingBadge(p.name));
      var removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "wizard-player-chip-remove";
      removeBtn.textContent = "×";
      removeBtn.setAttribute("aria-label", T("common.removeName", { name: p.name }));
      removeBtn.addEventListener("click", function () {
        removePlayer(p.id);
      });
      li.appendChild(name);
      li.appendChild(removeBtn);
      wizardPlayerChips.appendChild(li);
    });
  }

  // A single "name + Standby/Playing toggle" row — shared by the wizard's
  // step 3 and the Focus Mode players list, so both stay identical.
  function buildPlayingToggleRow(p) {
    var row = document.createElement("li");
    row.className = "roster-row" + (p.playing ? " is-playing" : "");

    var name = document.createElement("span");
    name.className = "roster-name";
    buildPlayerNameLabel(name, p.name, false);
    row.appendChild(name);
    row.appendChild(buildRatingBadge(p.name));

    var playBtn = document.createElement("button");
    playBtn.type = "button";
    playBtn.className = "btn-playing" + (p.playing ? " is-on" : "");
    playBtn.textContent = T(p.playing ? "players.playing" : "players.standby");
    playBtn.addEventListener("click", function () {
      togglePlaying(p.id);
    });
    row.appendChild(playBtn);

    return row;
  }

  function renderPlayingToggleListInto(listEl, emptyText) {
    listEl.innerHTML = "";
    if (state.players.length === 0) {
      var hint = document.createElement("li");
      hint.className = "empty-hint";
      hint.textContent = emptyText;
      listEl.appendChild(hint);
      return;
    }
    state.players.forEach(function (p) {
      listEl.appendChild(buildPlayingToggleRow(p));
    });
  }

  function renderWizardPlayingList() {
    renderPlayingToggleListInto(wizardPlayingList, "No players yet — go back and add some.");
    var playingCount = state.players.filter(function (p) {
      return p.playing;
    }).length;
    wizardPlayingWarning.classList.toggle("hidden", playingCount >= 2);
  }

  // Silently keeps the wizard's own step-2/3/4 content in sync whenever
  // players or the rotation change elsewhere (add/remove/toggle/load),
  // regardless of which step is currently showing.
  function renderWizardIfOpen() {
    if (!wizardOverlay || wizardOverlay.classList.contains("hidden")) return;
    renderWizardPlayerChips();
    renderWizardPlayingList();
    renderRotationListInto(wizardRotationList);
  }

  function validateWizardStepBeforeNext() {
    if (wizardStep === 1) {
      if (wizardFormat === "raceto") {
        var raceTo = parseInt(wizardRaceToInput.value, 10);
        if (!raceTo || raceTo < 1) {
          showToast(T("toast.enterRaceToWins"));
          return false;
        }
      }
      return true;
    }
    if (wizardStep === 2) {
      if (state.players.length === 0) {
        showToast(T("toast.addAtLeastOnePlayer"));
        return false;
      }
      return true;
    }
    if (wizardStep === 3) {
      var playingCount = state.players.filter(function (p) {
        return p.playing;
      }).length;
      if (playingCount < 2) {
        wizardPlayingWarning.classList.remove("hidden");
        return false;
      }
      return true;
    }
    if (wizardStep === 4) {
      var rotationOn = Array.prototype.filter.call(wizardRotationEnabledRadios, function (r) {
        return r.checked;
      })[0].value === "yes";
      if (rotationOn && state.rotation.order.length < 2) {
        showToast(T("toast.addAtLeastTwoGameTypes"));
        return false;
      }
      return true;
    }
    return true;
  }

  function renderWizardStep() {
    var seq = wizardStepSequence();
    var idx = seq.indexOf(wizardStep);

    [1, 2, 3, 4, 5].forEach(function (n) {
      document.getElementById("wizard-step-" + n).classList.toggle("hidden", n !== wizardStep);
    });

    wizardProgress.textContent = T("wizard.stepOf", { step: idx + 1, total: seq.length });

    wizardProgressDots.innerHTML = "";
    seq.forEach(function (stepNum, i) {
      var dot = document.createElement("span");
      dot.className = "wizard-dot" + (i < idx ? " is-done" : i === idx ? " is-active" : "");
      wizardProgressDots.appendChild(dot);
    });

    btnWizardBack.classList.toggle("hidden", idx === 0);
    var isLast = idx === seq.length - 1;
    btnWizardNext.classList.toggle("hidden", isLast);
    btnWizardStart.classList.toggle("hidden", !isLast);
    if (isLast) {
      btnWizardStart.textContent = T(wizardFormat === "tournament" ? "wizard.goToTournamentSetup" : "wizard.startGame");
    }

    if (wizardStep === 2) renderWizardPlayerChips();
    if (wizardStep === 3) renderWizardPlayingList();
    if (wizardStep === 4) renderRotationListInto(wizardRotationList);
    if (wizardStep === 5) renderWizardSummary();
  }

  function renderWizardSummary() {
    wizardSummary.innerHTML = "";
    function summaryRow(label, value) {
      var r = document.createElement("div");
      r.className = "wizard-summary-row";
      var l = document.createElement("span");
      l.className = "label";
      l.textContent = label;
      var v = document.createElement("span");
      v.className = "value";
      v.textContent = value;
      r.appendChild(l);
      r.appendChild(v);
      wizardSummary.appendChild(r);
    }
    var gameLabel = GAME_TYPES[wizardGameTypeSelect.value] ? GAME_TYPES[wizardGameTypeSelect.value].label : wizardGameTypeSelect.value;
    if (wizardFormat === "tournament") {
      summaryRow(T("wizard.summaryFormat"), T("wizard.summaryTournamentElimination"));
      summaryRow(T("wizard.summaryGame"), gameLabel);
      summaryRow(T("wizard.summaryPlayersOnRoster"), String(state.players.length));
      return;
    }
    summaryRow(T("wizard.summaryGame"), gameLabel);
    summaryRow(
      T("wizard.summaryFormat"),
      wizardFormat === "raceto"
        ? T("milestone.raceToWins", { target: parseInt(wizardRaceToInput.value, 10) || 5 })
        : T("wizard.summaryIndividualCasual")
    );
    var playingCount = state.players.filter(function (p) {
      return p.playing;
    }).length;
    summaryRow(T("wizard.summaryPlayersPlaying"), T("wizard.summaryOfTotal", { playing: playingCount, total: state.players.length }));
    var rotationOn = Array.prototype.filter.call(wizardRotationEnabledRadios, function (r) {
      return r.checked;
    })[0].value === "yes";
    var every = state.rotation.every || 1;
    summaryRow(
      T("wizard.summaryRotation"),
      rotationOn && state.rotation.order.length
        ? T(every === 1 ? "wizard.summaryRotationOnOne" : "wizard.summaryRotationOnMany", {
            label: rotationLabelFor(state.rotation.order),
            count: every
          })
        : T("wizard.summaryRotationOff")
    );
  }

  function wizardNext() {
    if (!validateWizardStepBeforeNext()) return;
    var seq = wizardStepSequence();
    var idx = seq.indexOf(wizardStep);
    if (idx < seq.length - 1) {
      wizardStep = seq[idx + 1];
      renderWizardStep();
    }
  }

  function wizardBack() {
    var seq = wizardStepSequence();
    var idx = seq.indexOf(wizardStep);
    if (idx > 0) {
      wizardStep = seq[idx - 1];
      renderWizardStep();
    }
  }

  function openWizard() {
    wizardStep = 1;
    wizardFormat = "individual";
    Array.prototype.forEach.call(wizardFormatRadios, function (r) {
      r.checked = r.value === "individual";
    });
    wizardRaceToRow.classList.add("hidden");
    wizardRaceToInput.value = state.raceToWinsTarget || 5;
    wizardTempCounterCheckbox.checked = false;
    btnWizardStartQuickCounter.classList.add("hidden");
    wizardGameTypeSelect.value = state.currentGame.gameType;
    syncWizardRotationEnabledRadios();
    wizardRotationEveryInput.value = state.rotation.every || 1;
    wizardNewPlayerName.value = "";
    validateWizardNewPlayerNameInput();
    populateWizardRosterLoadSelect();
    populateWizardRotationLoadSelect();
    renderWizardStep();
    wizardOverlay.classList.remove("hidden");
  }

  function closeWizard() {
    wizardOverlay.classList.add("hidden");
  }

  // ---------------------------------------------------------------------
  // First-time user flow — a short 4-step welcome shown once, only when
  // this device has no players and no history at all (see
  // isFirstTimeUser). Every step but the last has a plain Cancel/Go
  // footer; the last step's own two buttons ARE the terminal actions, so
  // it has no separate Go. Cancelling (at any step) or finishing both
  // mark it seen so it never shows again.
  // ---------------------------------------------------------------------

  var ONBOARDING_SEEN_KEY = "poolMasterCounter.onboardingSeen.v1";

  function hasSeenOnboarding() {
    try {
      return localStorage.getItem(ONBOARDING_SEEN_KEY) === "1";
    } catch (e) {
      return true;
    }
  }

  function markOnboardingSeen() {
    try {
      localStorage.setItem(ONBOARDING_SEEN_KEY, "1");
    } catch (e) {
      console.warn("Could not save onboarding-seen flag.", e);
    }
  }

  // Just the live roster - PLAYER_STATS/SAVED_ROSTERS are pre-seeded with
  // bundled example data on every device's very first boot
  // (migrateFromRepoIfNeeded), before this ever runs, so they're never a
  // reliable signal of whether a real person has set anything up yet.
  function isFirstTimeUser() {
    return state.players.length === 0;
  }

  function onboardingPlayChoice() {
    for (var i = 0; i < onboardingPlayChoiceRadios.length; i++) {
      if (onboardingPlayChoiceRadios[i].checked) return onboardingPlayChoiceRadios[i].value;
    }
    return "now";
  }

  function validateOnboardingNameInput() {
    var trimmed = onboardingNameInput.value.trim();
    var duplicate = trimmed && isDuplicatePlayerName(trimmed);
    btnOnboardingGo.disabled = onboardingStep === 2 && (!trimmed || duplicate);
    if (duplicate) {
      onboardingNameRequirement.textContent = T("players.duplicateNameHint", { name: capitalizeName(trimmed) });
      onboardingNameRequirement.classList.remove("hidden");
    } else {
      onboardingNameRequirement.classList.add("hidden");
    }
  }

  function renderOnboardingStep() {
    [1, 2, 3, 4].forEach(function (n) {
      document.getElementById("onboarding-step-" + n).classList.toggle("hidden", n !== onboardingStep);
    });
    onboardingHeading.textContent = T("onboarding.step" + onboardingStep + "Heading");
    onboardingProgress.textContent = T("wizard.stepOf", { step: onboardingStep, total: 4 });

    onboardingProgressDots.innerHTML = "";
    for (var i = 0; i < 4; i++) {
      var dot = document.createElement("span");
      dot.className = "wizard-dot" + (i < onboardingStep - 1 ? " is-done" : i === onboardingStep - 1 ? " is-active" : "");
      onboardingProgressDots.appendChild(dot);
    }

    onboardingStandardFooter.classList.toggle("hidden", onboardingStep === 4);
    if (onboardingStep === 2) validateOnboardingNameInput();
    else btnOnboardingGo.disabled = false;
  }

  function openOnboarding() {
    onboardingStep = 1;
    onboardingNameInput.value = "";
    onboardingRatingInput.value = "";
    onboardingEmailInput.value = "";
    onboardingReportOptInCheckbox.checked = false;
    onboardingReportOptInCheckbox.disabled = true;
    onboardingNameRequirement.classList.add("hidden");
    Array.prototype.forEach.call(onboardingPlayChoiceRadios, function (r) {
      r.checked = r.value === "now";
    });
    renderOnboardingStep();
    onboardingOverlay.classList.remove("hidden");
  }

  function closeOnboarding() {
    onboardingOverlay.classList.add("hidden");
    markOnboardingSeen();
  }

  // Go only ever moves forward (there's no Back on this short flow) -
  // each step does whatever work it owns (adding the player on step 2,
  // reading the now/later choice on step 3) before advancing.
  function advanceOnboarding() {
    if (onboardingStep === 1) {
      onboardingStep = 2;
      renderOnboardingStep();
      onboardingNameInput.focus();
      return;
    }
    if (onboardingStep === 2) {
      var trimmed = onboardingNameInput.value.trim();
      if (!trimmed || isDuplicatePlayerName(trimmed)) {
        validateOnboardingNameInput();
        return;
      }
      var starting = parseStartingRatingInput(onboardingRatingInput);
      var player = addPlayer(onboardingNameInput.value, starting === null ? undefined : starting);
      if (player) {
        player.playing = true;
        saveState();
        var email = onboardingEmailInput.value.trim();
        if (email) setPlayerContact(player.name, email, onboardingReportOptInCheckbox.checked);
        renderAll();
      }
      onboardingStep = 3;
      renderOnboardingStep();
      return;
    }
    if (onboardingStep === 3) {
      if (onboardingPlayChoice() === "later") {
        closeOnboarding();
        return;
      }
      onboardingStep = 4;
      renderOnboardingStep();
    }
  }

  // Picks which Help section to jump to based on whichever page/overlay is
  // currently showing, so the same Help button is contextual everywhere.
  function currentHelpSectionId() {
    if (!wizardOverlay.classList.contains("hidden")) return "help-section-wizard";
    if (!tournamentPageView.classList.contains("hidden")) return "help-section-tournament";
    if (!allPlayersPageView.classList.contains("hidden")) return "help-section-all-players";
    if (!playerPageView.classList.contains("hidden")) return "help-section-player-page";
    return "help-section-main";
  }

  // .help-header is position:sticky and floats on top of whatever
  // scrolled to the top of .help-card, so scrollIntoView({block:"start"})
  // lands a section's title right underneath it (hidden until you scroll
  // up). Scroll the card manually instead, offset by the header's actual
  // rendered height so the target lands just below it.
  function scrollHelpToSection(targetId) {
    var target = document.getElementById(targetId);
    var card = helpOverlay.querySelector(".help-card");
    var header = helpOverlay.querySelector(".help-header");
    if (!target || !card || !header) return;
    card.scrollTop = target.offsetTop - header.offsetHeight - 8;
  }

  function openHelp() {
    var targetId = currentHelpSectionId();
    Array.prototype.forEach.call(helpNavLinks, function (a) {
      a.classList.toggle("is-active", a.getAttribute("href") === "#" + targetId);
    });
    helpOverlay.classList.remove("hidden");
    scrollHelpToSection(targetId);
  }

  function closeHelp() {
    helpOverlay.classList.add("hidden");
  }

  function finalizeWizardAndStart() {
    // Quick Counter's tally is free-form (can be negative, has no
    // relation to any target) — never carry it into a real game or a
    // tournament, regardless of which format is picked next. Also undo
    // the noStatsMode it forces on — otherwise saving stays silently
    // disabled (checkbox still checked) even though the UI now shows a
    // completely normal game.
    var leavingQuickCounter = quickCounterMode;
    quickCounterMode = false;
    if (leavingQuickCounter) {
      resetGameBalls();
      noStatsMode = false;
      noStatsCheckbox.checked = false;
    }
    if (wizardFormat === "tournament") {
      closeWizard();
      openTournamentPage();
      return;
    }
    var typeId = wizardGameTypeSelect.value;
    var type = GAME_TYPES[typeId];
    var typeChanged = state.currentGame.gameType !== typeId;
    state.currentGame.gameType = typeId;
    if (typeChanged) state.currentGame.target = type.defaultTarget;
    state.currentGame.mode = "individual";
    if (wizardFormat === "raceto") {
      var raceTo = parseInt(wizardRaceToInput.value, 10);
      if (raceTo >= 1) state.raceToWinsTarget = raceTo;
    }
    saveState();

    if (typeChanged) state.currentGame.unit = type.unit;
    gameTypeSelect.value = typeId;
    gameTargetInput.value = state.currentGame.target;
    gameTargetUnitSelect.value = state.currentGame.unit;
    raceToWinsInput.value = state.raceToWinsTarget;
    Array.prototype.forEach.call(modeRadios, function (r) {
      r.checked = r.value === "individual";
    });

    applyRotationIfDue();
    renderAll();
    updateCurrentGameSummary();
    closeWizard();
    setFocusMode(true);
    showToast(T("toast.letsPlay"));
  }

  // Skips the rest of the wizard entirely and drops straight into the
  // bare-bones Quick Counter scoreboard — no game type, no target, no
  // rotation, no win/loss detection, just a per-player tally that can be
  // renamed/added/removed right from the cards. Implies noStatsMode, since
  // saveState/savePlayerStatsToStorage/saveRatingsToStorage/
  // saveRostersToStorage/saveRotationsToStorage guards make that a no-op
  // anyway and there's never a "completed game" to record here.
  function startQuickCounter() {
    noStatsMode = true;
    noStatsCheckbox.checked = true;
    quickCounterMode = true;
    resetGameBalls();
    closeWizard();
    setFocusMode(true);
    renderAll();
    showToast(T("toast.quickCounterTip"));
  }

  // ---------------------------------------------------------------------
  // Per-player stats page (players/<Name>.json)
  // ---------------------------------------------------------------------

  var currentStatsPlayerName = null;
  var currentStatsSessions = null;

  function playerStatsFilename(name) {
    return name.replace(/[^a-z0-9 _-]/gi, "").trim().replace(/\s+/g, "-") + ".json";
  }

  // Builds a session record (same shape as one saved to PLAYER_STATS) for
  // one player on one calendar date, from any gameHistory array — the
  // live in-progress one, or one pulled out of an imported backup file.
  function computeSessionFromGameHistory(gameHistory, playerName, dateStr) {
    var gamesWon = [];
    var opponentSet = {};
    var games = [];
    (gameHistory || []).forEach(function (entry) {
      if (!entry || typeof entry === "string" || !entry.winnerNames || !entry.ts) return;
      if (localDateStrFromTs(entry.ts) !== dateStr) return;
      var won = entry.winnerNames.indexOf(playerName) !== -1;
      var lost = !won && (entry.opponentNames || []).indexOf(playerName) !== -1;
      if (!won && !lost) return;
      if (won) {
        gamesWon.push(entry.gameLabel);
        (entry.opponentNames || []).forEach(function (n) {
          opponentSet[n] = true;
        });
      } else {
        entry.winnerNames.forEach(function (n) {
          opponentSet[n] = true;
        });
      }
      // Raw entry.winnerNames/opponentNames always mean "winning side" /
      // "losing side" (unlike the renamed opponentNames below, which is
      // relative to playerName). My own team's roster for this game is
      // whichever raw side I'm on — needed to tell team combos apart.
      var myRawSide = won ? entry.winnerNames : entry.opponentNames || [];
      games.push({
        ts: entry.ts,
        gameLabel: entry.gameLabel,
        target: entry.target,
        result: won ? "won" : "lost",
        winnerNames: entry.winnerNames,
        opponentNames: won ? (entry.opponentNames || []) : entry.winnerNames.slice(),
        teammateNames: entry.isTeam
          ? myRawSide.filter(function (n) {
              return n !== playerName;
            })
          : [],
        isTeam: entry.isTeam,
        mvpName: entry.mvpName,
        durationMs: entry.durationMs,
        wonRace: entry.wonRace,
        raceTarget: entry.raceTarget,
        raceCount: entry.raceCount,
        ballsLeftOnTable: entry.ballsLeftOnTable === undefined ? null : entry.ballsLeftOnTable
      });
    });
    if (games.length === 0) return null;
    return {
      date: dateStr,
      wins: games.filter(function (g) {
        return g.result === "won";
      }).length,
      gamesWon: gamesWon,
      opponents: Object.keys(opponentSet),
      games: games,
      wonTournament: false
    };
  }

  // Accepts a player NAME (not id) so it works for players still on the
  // roster and for historical players who aren't (e.g. removed since, or
  // only known from an imported backup). When the name matches a current
  // roster entry, wins/wonTournament come from the live id-based counters;
  // otherwise they're derived from the games themselves.
  function computeLiveSessionForPlayer(name) {
    var today = todayDateStr();
    var session = computeSessionFromGameHistory(state.gameHistory, name, today) || {
      date: today,
      wins: 0,
      gamesWon: [],
      opponents: [],
      games: []
    };
    var playerId = getPlayerIdByName(name);
    if (playerId) {
      var wins = state.playerWins[playerId] || 0;
      session.wins = wins;
      session.wonTournament = wins > 0 && wins >= state.raceToWinsTarget;
    } else {
      session.wonTournament = false;
    }
    return session;
  }

  function playerStatsRow(label, value) {
    var row = document.createElement("div");
    row.className = "player-stats-row";
    var l = document.createElement("span");
    l.className = "label";
    l.textContent = label;
    var v = document.createElement("span");
    v.className = "value";
    v.textContent = value;
    row.appendChild(l);
    row.appendChild(v);
    return row;
  }

  function playerStatsListRow(label, items, isPlayerNames) {
    var row = document.createElement("div");
    row.className = "player-stats-row player-stats-row-wrap";
    var l = document.createElement("span");
    l.className = "label";
    l.textContent = label;
    var v = document.createElement("span");
    v.className = "value value-list";
    if (isPlayerNames && items.length) {
      items.forEach(function (n, i) {
        if (i > 0) v.appendChild(document.createTextNode(", "));
        v.appendChild(document.createTextNode(n));
        v.appendChild(buildRatingBadge(n));
      });
    } else {
      v.textContent = items.length ? items.join(", ") : "—";
    }
    row.appendChild(l);
    row.appendChild(v);
    return row;
  }

  function playerGameLogRow(g) {
    var div = document.createElement("div");
    div.className = "player-game-log-row " + (g.result === "won" ? "is-win" : "is-loss");
    var time = document.createElement("span");
    time.className = "player-game-log-time";
    time.textContent = formatTimestamp(g.ts, false);
    var label = document.createElement("span");
    label.className = "player-game-log-label";
    label.textContent = g.gameLabel;
    var winner = document.createElement("strong");
    winner.className = "player-game-log-winner";
    winner.appendChild(document.createTextNode("🏆 "));
    (g.winnerNames || []).forEach(function (n, i) {
      if (i > 0) winner.appendChild(document.createTextNode(" & "));
      winner.appendChild(document.createTextNode(n));
      winner.appendChild(buildRatingBadge(n));
    });
    div.appendChild(time);
    div.appendChild(label);
    var durationText = formatDuration(g.durationMs);
    if (durationText) {
      var durationSpan = document.createElement("span");
      durationSpan.className = "player-game-log-duration";
      durationSpan.textContent = T("common.duration", { time: durationText });
      div.appendChild(durationSpan);
    }
    div.appendChild(document.createTextNode(" — won by "));
    div.appendChild(winner);
    if (g.isTeam && g.mvpName) {
      div.appendChild(document.createTextNode(" · 🎯 " + g.mvpName + " potted it"));
      div.appendChild(buildRatingBadge(g.mvpName));
    }
    if (g.ballsLeftOnTable !== null && g.ballsLeftOnTable !== undefined) {
      var ballsLeftSpan = document.createElement("span");
      ballsLeftSpan.className = "player-game-log-balls-left";
      ballsLeftSpan.textContent = T("history.ballsLeftOnTable", { count: g.ballsLeftOnTable });
      div.appendChild(document.createTextNode(" · "));
      div.appendChild(ballsLeftSpan);
    }
    return div;
  }

  function playerGamesLogRow(label, games) {
    var row = document.createElement("div");
    row.className = "player-stats-row player-stats-row-wrap";
    var l = document.createElement("span");
    l.className = "label";
    l.textContent = label;
    row.appendChild(l);
    if (!games || games.length === 0) {
      var v = document.createElement("span");
      v.className = "value value-list";
      v.textContent = "—";
      row.appendChild(v);
      return row;
    }
    var list = document.createElement("div");
    list.className = "player-game-log";
    games.forEach(function (g) {
      list.appendChild(playerGameLogRow(g));
    });
    row.appendChild(list);
    return row;
  }

  function renderLiveSessionForPlayer(name) {
    var live = computeLiveSessionForPlayer(name);
    playerPageCurrentBody.innerHTML = "";
    playerPageCurrentBody.appendChild(playerStatsRow(T("playerPage.winsToday"), live.wins));
    playerPageCurrentBody.appendChild(playerGamesLogRow("Games", live.games));
    playerPageCurrentBody.appendChild(playerStatsListRow(T("playerPage.opponents"), live.opponents, true));
    if (live.wonTournament) {
      var trophy = document.createElement("div");
      trophy.className = "tournament-winner-banner";
      trophy.textContent = T("history.wonTournamentToday", { name: name });
      trophy.appendChild(buildRatingBadge(name));
      playerPageCurrentBody.appendChild(trophy);
    }
  }

  // ---------------------------------------------------------------------
  // Player stats synopsis (period filter + head-to-head)
  // ---------------------------------------------------------------------

  var currentStatsPeriod = "all";

  function periodStartDate(period) {
    var now = new Date();
    if (period === "today") {
      return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    }
    if (period === "week") {
      var day = now.getDay();
      var diffToMonday = day === 0 ? 6 : day - 1;
      return new Date(now.getFullYear(), now.getMonth(), now.getDate() - diffToMonday);
    }
    if (period === "month") {
      return new Date(now.getFullYear(), now.getMonth(), 1);
    }
    if (period === "6month") {
      return new Date(now.getFullYear(), now.getMonth() - 6, now.getDate());
    }
    if (period === "year") {
      return new Date(now.getFullYear(), 0, 1);
    }
    return null;
  }

  function collectAllGamesForPlayer(name) {
    var live = computeLiveSessionForPlayer(name);
    var sessions = mergeSessionIntoList(currentStatsSessions || [], live);
    var games = [];
    sessions.forEach(function (s) {
      (s.games || []).forEach(function (g) {
        games.push(g);
      });
    });
    return games;
  }

  function filterGamesByPeriod(games, period) {
    var start = periodStartDate(period);
    if (!start) return games;
    var startMs = start.getTime();
    return games.filter(function (g) {
      var t = g.ts ? new Date(g.ts).getTime() : NaN;
      return !isNaN(t) && t >= startMs;
    });
  }

  function computeWinLossSynopsis(games) {
    var wins = 0;
    var losses = 0;
    games.forEach(function (g) {
      if (g.result === "won") wins += 1;
      else losses += 1;
    });
    var total = wins + losses;
    return {
      wins: wins,
      losses: losses,
      total: total,
      pct: total ? Math.round((wins / total) * 100) : null
    };
  }

  function computeHeadToHead(games) {
    var map = {};
    var order = [];
    games.forEach(function (g) {
      (g.opponentNames || []).forEach(function (name) {
        if (!map[name]) {
          map[name] = { name: name, wins: 0, losses: 0 };
          order.push(name);
        }
        if (g.result === "won") map[name].wins += 1;
        else map[name].losses += 1;
      });
    });
    return order
      .map(function (name) {
        var rec = map[name];
        var total = rec.wins + rec.losses;
        return {
          name: rec.name,
          wins: rec.wins,
          losses: rec.losses,
          total: total,
          pct: total ? Math.round((rec.wins / total) * 100) : null
        };
      })
      .sort(function (a, b) {
        return b.total - a.total || a.name.localeCompare(b.name);
      });
  }

  function synopsisStatRow(label, value, variant) {
    var row = document.createElement("div");
    row.className = "player-stats-row";
    var l = document.createElement("span");
    l.className = "label";
    l.textContent = label;
    var v = document.createElement("span");
    v.className = "value" + (variant ? " value-" + variant : "");
    v.textContent = value;
    row.appendChild(l);
    row.appendChild(v);
    return row;
  }

  function renderPlayerSynopsis() {
    if (!currentStatsPlayerName) return;
    var allGames = collectAllGamesForPlayer(currentStatsPlayerName);
    var filtered = filterGamesByPeriod(allGames, currentStatsPeriod);
    var synopsis = computeWinLossSynopsis(filtered);

    playerPageSynopsisBody.innerHTML = "";
    playerPageSynopsisBody.appendChild(synopsisStatRow(T("common.rating"), getPlayerRating(currentStatsPlayerName)));
    var ratingDeltaText = formatRatingPeriodDelta(currentStatsPlayerName, currentStatsPeriod);
    if (ratingDeltaText !== null) {
      playerPageSynopsisBody.appendChild(
        synopsisStatRow(
          T("playerPage.ratingThisPeriod"),
          ratingDeltaText,
          ratingDeltaText.charAt(0) === "▲" ? "win" : ratingDeltaText.charAt(0) === "▼" ? "loss" : null
        )
      );
    }
    playerPageSynopsisBody.appendChild(synopsisStatRow(T("playerPage.gamesWon"), synopsis.wins, "win"));
    playerPageSynopsisBody.appendChild(synopsisStatRow(T("playerPage.gamesLost"), synopsis.losses, "loss"));
    playerPageSynopsisBody.appendChild(
      synopsisStatRow(T("playerPage.winPct"), synopsis.pct === null ? "—" : synopsis.pct + "%")
    );

    // How many of this player's TEAM wins they personally potted the
    // winning ball for (see the mvp selection in creditWin) - their
    // individual contribution within the team's overall win count.
    var teamMvpWinCount = filtered.filter(function (g) {
      return g.result === "won" && g.mvpName === currentStatsPlayerName;
    }).length;
    playerPageSynopsisBody.appendChild(synopsisStatRow(T("playerPage.teamMvpWins"), teamMvpWinCount, "win"));

    var tournamentFiltered = filterGamesByPeriod(
      tournamentGamesForPlayerName(currentStatsPlayerName).concat(sessionRaceTournamentGames(allGames)),
      currentStatsPeriod
    );
    var tournamentSynopsis = computeWinLossSynopsis(tournamentFiltered);
    playerPageSynopsisBody.appendChild(synopsisStatRow(T("playerPage.tournamentsPlayed"), tournamentSynopsis.total));
    playerPageSynopsisBody.appendChild(synopsisStatRow(T("playerPage.tournamentsWon"), tournamentSynopsis.wins, "win"));
    playerPageSynopsisBody.appendChild(synopsisStatRow(T("playerPage.tournamentsLost"), tournamentSynopsis.losses, "loss"));

    var h2h = computeHeadToHead(filtered);
    setPanelSummary(
      "player-page-h2h-panel",
      h2h.length === 0
        ? "No opponents yet this period."
        : h2h.length + " opponent" + (h2h.length === 1 ? "" : "s") + " faced: " + h2h.map(function (o) { return o.name; }).join(", ")
    );
    playerPageH2hList.innerHTML = "";
    if (h2h.length === 0) {
      var hint = document.createElement("li");
      hint.className = "empty-hint";
      hint.textContent = T("playerPage.noOpponentGamesThisPeriod");
      playerPageH2hList.appendChild(hint);
      return;
    }
    h2h.forEach(function (opp) {
      var li = document.createElement("li");
      li.className = "player-h2h-row";
      var name = document.createElement("span");
      name.className = "player-h2h-name";
      name.textContent = opp.name;
      name.appendChild(buildRatingBadge(opp.name));
      var record = document.createElement("span");
      record.className = "player-h2h-record";
      record.textContent = opp.wins + "–" + opp.losses;
      var pct = document.createElement("span");
      pct.className = "player-h2h-pct";
      pct.textContent = opp.pct === null ? "—" : opp.pct + "%";
      li.appendChild(name);
      li.appendChild(record);
      li.appendChild(pct);
      playerPageH2hList.appendChild(li);
    });
  }

  function renderPlayerPageGraph() {
    if (!currentStatsPlayerName) return;
    var period = currentStatsPeriod;
    var stats = computePlayerCareerStats(currentStatsPlayerName, period);

    var periodStart = periodStartDate(period);
    var minMs, maxMs;
    if (periodStart) {
      minMs = periodStart.getTime();
    } else {
      var minTs = null;
      stats.games.forEach(function (g) {
        if (!g.ts) return;
        if (minTs === null || g.ts < minTs) minTs = g.ts;
      });
      minMs = minTs === null ? Date.now() : new Date(minTs).getTime();
    }
    maxMs = Date.now();
    if (maxMs <= minMs) maxMs = minMs + 1;

    playerPageGraphBody.innerHTML = "";
    playerPageGraphBody.appendChild(buildPlayerGraph(stats, minMs, maxMs, period));
  }

  function setStatsPeriod(period) {
    currentStatsPeriod = period;
    for (var i = 0; i < playerPagePeriodButtons.length; i++) {
      var btn = playerPagePeriodButtons[i];
      btn.classList.toggle("is-active", btn.getAttribute("data-period") === period);
    }
    renderPlayerSynopsis();
    renderPlayerPageGraph();
  }

  function formatSessionDateTime(session) {
    var text = session.date;
    if (session.games && session.games.length) {
      var sorted = session.games.slice().sort(function (a, b) {
        return a.ts.localeCompare(b.ts);
      });
      var first = formatTimestamp(sorted[0].ts, false);
      var last = formatTimestamp(sorted[sorted.length - 1].ts, false);
      if (first || last) {
        text += " · " + (first === last ? first : first + " – " + last);
      }
    }
    return text;
  }

  function renderPlayerHistoryList(sessions) {
    playerPageHistoryList.innerHTML = "";
    if (!sessions || sessions.length === 0) {
      var hint = document.createElement("li");
      hint.className = "empty-hint";
      hint.textContent = T("playerPage.noSavedSessionsYet");
      playerPageHistoryList.appendChild(hint);
      return;
    }
    var playerName = currentStatsPlayerName || "";
    sessions
      .slice()
      .sort(function (a, b) {
        return b.date.localeCompare(a.date);
      })
      .forEach(function (session) {
        var li = document.createElement("li");
        li.className = "player-history-row" + (session.wonTournament ? " won-tournament" : "");

        var top = document.createElement("div");
        top.className = "player-history-top";
        var date = document.createElement("span");
        date.className = "player-history-date";
        date.textContent = formatSessionDateTime(session);
        var wins = document.createElement("span");
        wins.className = "player-history-wins";
        wins.textContent = session.wins + " win" + (session.wins === 1 ? "" : "s");
        top.appendChild(date);
        top.appendChild(wins);
        li.appendChild(top);

        if (session.wonTournament) {
          var banner = document.createElement("div");
          banner.className = "tournament-winner-banner";
          banner.textContent = T("playerPage.wonTournamentBanner", { name: playerName });
          banner.appendChild(buildRatingBadge(playerName));
          li.appendChild(banner);
        }

        var detail = document.createElement("div");
        detail.className = "player-history-detail";
        if (session.games && session.games.length) {
          var log = document.createElement("div");
          log.className = "player-game-log";
          session.games.forEach(function (g) {
            log.appendChild(playerGameLogRow(g));
          });
          detail.appendChild(log);
        } else {
          var gamesText = session.gamesWon && session.gamesWon.length ? session.gamesWon.join(", ") : "—";
          detail.appendChild(document.createTextNode("Games: " + gamesText));
          detail.appendChild(document.createElement("br"));
        }
        var opponentsText = session.opponents && session.opponents.length ? session.opponents.join(", ") : "—";
        detail.appendChild(document.createTextNode("Opponents: " + opponentsText));
        li.appendChild(detail);

        playerPageHistoryList.appendChild(li);
      });
  }

  // ---------------------------------------------------------------------
  // Screen navigation / browser history — makes the physical browser back
  // button do exactly what the in-app "← Back" buttons do: no reload, no
  // leaving the app, just the same screen transition. main -> subscreen
  // pushes a new entry (so one physical Back returns to main); moving
  // sideways between two subscreens (e.g. Player Stats -> All Players via
  // "Global Stats") replaces the current entry instead, so depth never
  // exceeds one level — Back always means "back to main," matching how
  // the in-app Back buttons already behaved before this existed.
  // ---------------------------------------------------------------------

  function pushScreenHistory(screen, extra) {
    var onMain = !appRoot.classList.contains("hidden");
    var state = { screen: screen };
    var hash = "#" + screen;
    if (extra && extra.name) {
      state.name = extra.name;
      hash += "/" + encodeURIComponent(extra.name);
    }
    if (onMain) {
      history.pushState(state, "", hash);
    } else {
      history.replaceState(state, "", hash);
    }
  }

  function navigateBack() {
    history.back();
  }

  window.addEventListener("popstate", function (e) {
    var state = e.state;
    if (!state || !state.screen || state.screen === "main") {
      if (!playerPageView.classList.contains("hidden")) closePlayerStatsPage(true);
      else if (!allPlayersPageView.classList.contains("hidden")) closeAllPlayersPage(true);
      else if (!tournamentPageView.classList.contains("hidden")) closeTournamentPage(true);
      return;
    }
    if (state.screen === "all-players") openAllPlayersPage(true);
    else if (state.screen === "tournament") openTournamentPage(true);
    else if (state.screen === "player") openPlayerStatsPage(state.name, true);
  });

  history.replaceState({ screen: "main" }, "", location.pathname + location.search);

  // Fills the Player Stats page's player-switcher dropdown with every
  // known player name (alphabetical) and selects the one currently being
  // viewed, so switching players is a single dropdown pick instead of a
  // trip back to All Stats. Re-run on every openPlayerStatsPage call so a
  // player added since the page last opened shows up too.
  function populatePlayerPageSwitcher(currentName) {
    var names = getAllKnownPlayerNames();
    // Belt-and-suspenders: whatever page we're viewing should always be
    // selectable, even in an edge case where this name isn't found by
    // getAllKnownPlayerNames (e.g. reached via a stale link after that
    // player's data was reset).
    if (names.indexOf(currentName) === -1) names.push(currentName);
    names.sort(function (a, b) {
      return a.localeCompare(b);
    });
    playerPageSwitcher.innerHTML = "";
    names.forEach(function (n) {
      var opt = document.createElement("option");
      opt.value = n;
      opt.textContent = n;
      playerPageSwitcher.appendChild(opt);
    });
    playerPageSwitcher.value = currentName;
  }

  // name: the player's name — works whether or not they're currently on
  // the roster, since saved stats are keyed by name, not id. skipHistory
  // is true only when called from the popstate handler above (restoring
  // a screen the browser already navigated to) — it must never push or
  // replace history again in that case.
  function openPlayerStatsPage(name, skipHistory) {
    if (!name) return;
    if (!skipHistory) pushScreenHistory("player", { name: name });
    currentStatsPlayerName = name;
    currentStatsSessions = null;
    playerPageName.innerHTML = "";
    buildPlayerNameLabel(playerPageName, name, true);
    playerPageName.appendChild(buildRatingBadge(name));
    var addedAt = getPlayerAddedAt(name);
    if (addedAt) {
      playerPageAdded.textContent = T("playerPage.added", { date: formatDateISO(addedAt) });
      playerPageAdded.classList.remove("hidden");
    } else {
      playerPageAdded.textContent = "";
      playerPageAdded.classList.add("hidden");
    }
    populatePlayerPageSwitcher(name);
    renderLiveSessionForPlayer(name);
    playerPageHistoryList.innerHTML = "";
    var loading = document.createElement("li");
    loading.className = "empty-hint";
    loading.textContent = T("playerPage.loadingSavedHistory");
    playerPageHistoryList.appendChild(loading);

    appRoot.classList.add("hidden");
    allPlayersPageView.classList.add("hidden");
    tournamentPageView.classList.add("hidden");
    playerPageView.classList.remove("hidden");
    window.scrollTo(0, 0);

    currentStatsSessions = getPlayerSessions(name);
    renderPlayerHistoryList(currentStatsSessions);
    setStatsPeriod("all");
  }

  function closePlayerStatsPage(skipHistory) {
    if (!skipHistory) {
      navigateBack();
      return;
    }
    playerPageView.classList.add("hidden");
    appRoot.classList.remove("hidden");
    currentStatsPlayerName = null;
    currentStatsSessions = null;
  }

  function returnToGlobalStats() {
    playerPageView.classList.add("hidden");
    currentStatsPlayerName = null;
    currentStatsSessions = null;
    openAllPlayersPage();
  }

  // ---------------------------------------------------------------------
  // All Players page — every player who has ever played, with a career
  // played/won/lost scale each and a timeline of when they played.
  // ---------------------------------------------------------------------

  // Every player name known to this device: anyone with saved stats, anyone
  // currently on the roster (even before their first save), and anyone who
  // shows up in this session's still-unsaved game history (e.g. removed
  // from the roster mid-session, or before "New Game" folds it into
  // PLAYER_STATS) — so nobody who's actually played drops off the list.
  // Case variants of the same name (built via buildNameCasingMap) collapse
  // into one canonical entry.
  function getAllKnownPlayerNames() {
    var map = buildNameCasingMap();
    return Object.keys(map).map(function (k) {
      return map[k];
    });
  }

  // All of one player's games — saved history plus whatever's still live
  // in the current in-progress session — deduped the same way the stats
  // synopsis page does.
  function allGamesForPlayerName(name) {
    var sessions = getPlayerSessions(name);
    var today = todayDateStr();
    var live = computeSessionFromGameHistory(state.gameHistory, name, today);
    var merged = live ? mergeSessionIntoList(sessions, live) : sessions;
    var games = [];
    merged.forEach(function (s) {
      (s.games || []).forEach(function (g) {
        games.push(fillLegacyGameOpponents(g, s));
      });
    });
    return games;
  }

  // Sessions saved before per-game opponentNames/teammateNames/isTeam
  // existed (e.g. the bundled players/*.json backups) only have those
  // fields at the session level ("opponents"). Backfilling them from
  // there keeps head-to-head, tooltips, and rating backfill all working
  // for that older data instead of silently treating it as opponent-less.
  function fillLegacyGameOpponents(g, session) {
    if (g.opponentNames) return g;
    var opponentNames = (session && session.opponents) || [];
    var isTeam = (g.winnerNames || []).length > 1 || opponentNames.length > 1;
    return {
      ts: g.ts,
      gameLabel: g.gameLabel,
      target: g.target,
      result: g.result,
      winnerNames: g.winnerNames,
      opponentNames: opponentNames,
      teammateNames: g.teammateNames || [],
      isTeam: isTeam,
      mvpName: g.mvpName,
      durationMs: g.durationMs,
      wonRace: g.wonRace,
      raceTarget: g.raceTarget,
      raceCount: g.raceCount
    };
  }

  function computePlayerCareerStats(name, period) {
    var allGames = allGamesForPlayerName(name);
    var games = filterGamesByPeriod(allGames, period);
    var tournamentGames = filterGamesByPeriod(
      tournamentGamesForPlayerName(name).concat(sessionRaceTournamentGames(allGames)),
      period
    );
    var wins = 0;
    var losses = 0;
    games.forEach(function (g) {
      if (g.result === "won") wins += 1;
      else losses += 1;
    });
    var tournamentWins = 0;
    var tournamentLosses = 0;
    tournamentGames.forEach(function (g) {
      if (g.result === "won") tournamentWins += 1;
      else tournamentLosses += 1;
    });
    return {
      name: name,
      games: games,
      tournamentGames: tournamentGames,
      played: games.length,
      wins: wins,
      losses: losses,
      tournamentPlayed: tournamentGames.length,
      tournamentWins: tournamentWins,
      tournamentLosses: tournamentLosses,
      winPct: games.length ? wins / games.length : null
    };
  }

  function sortAllPlayerStats(list, mode) {
    var sorted = list.slice();
    if (mode === "alpha") {
      sorted.sort(function (a, b) {
        return a.name.localeCompare(b.name);
      });
    } else if (mode === "wins") {
      sorted.sort(function (a, b) {
        return b.wins - a.wins || a.name.localeCompare(b.name);
      });
    } else {
      sorted.sort(function (a, b) {
        var ap = a.winPct === null ? -1 : a.winPct;
        var bp = b.winPct === null ? -1 : b.winPct;
        return bp - ap || b.played - a.played || a.name.localeCompare(b.name);
      });
    }
    return sorted;
  }

  // Rounds a raw max game-count up to the nearest multiple of 4 (minimum 4)
  // so the 4 axis graduations below always land on whole numbers.
  function axisMaxFor(rawMax) {
    return Math.max(4, Math.ceil(rawMax / 4) * 4);
  }

  function buildScaleRow(label, value, axisMax, variantClass) {
    var row = document.createElement("div");
    row.className = "scale-row";

    var top = document.createElement("div");
    top.className = "scale-row-top";
    var l = document.createElement("span");
    l.className = "scale-row-label";
    l.textContent = T("allPlayers.statWithCount", { label: label, count: value });
    top.appendChild(l);
    row.appendChild(top);

    var track = document.createElement("div");
    track.className = "scale-track";
    var pct = axisMax > 0 ? (value / axisMax) * 100 : 0;
    var fill = document.createElement("div");
    fill.className = "scale-fill " + variantClass;
    fill.style.width = pct + "%";
    track.appendChild(fill);

    var ticks = document.createElement("div");
    ticks.className = "scale-ticks";
    var tickCount = 4;
    for (var i = 0; i <= tickCount; i++) {
      var tick = document.createElement("span");
      tick.className = "scale-tick";
      tick.style.left = (i * 100) / tickCount + "%";
      tick.setAttribute("data-value", Math.round((axisMax * i) / tickCount));
      ticks.appendChild(tick);
    }
    track.appendChild(ticks);
    row.appendChild(track);
    return row;
  }

  function buildTimelineRow(games, minMs, maxMs) {
    var wrap = document.createElement("div");

    var title = document.createElement("div");
    title.className = "timeline-title";
    title.textContent = T("common.timeline");
    wrap.appendChild(title);

    var track = document.createElement("div");
    track.className = "timeline-track";

    var sameDay = maxMs - minMs < 24 * 60 * 60 * 1000;
    var tickCount = 4;
    for (var i = 0; i <= tickCount; i++) {
      var frac = i / tickCount;
      var tick = document.createElement("span");
      tick.className = "timeline-tick";
      tick.style.left = frac * 100 + "%";
      var tickDate = new Date(minMs + frac * (maxMs - minMs));
      var label = sameDay
        ? tickDate.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
        : tickDate.toLocaleDateString(undefined, { month: "short", day: "numeric" });
      tick.setAttribute("data-label", label);
      track.appendChild(tick);
    }

    games.forEach(function (g) {
      if (!g.ts) return;
      var t = new Date(g.ts).getTime();
      if (isNaN(t)) return;
      var frac = maxMs > minMs ? (t - minMs) / (maxMs - minMs) : 0.5;
      var dot = document.createElement("span");
      dot.className = "timeline-dot " + (g.result === "won" ? "timeline-dot-won" : "timeline-dot-lost");
      dot.style.left = frac * 100 + "%";
      dot.title = formatTimestamp(g.ts, true) + " — " + (g.result === "won" ? "Won" : "Lost") + " " + g.gameLabel;
      track.appendChild(dot);
    });

    wrap.appendChild(track);
    return wrap;
  }

  // ---------------------------------------------------------------------
  // All Players page — graph view (cumulative played/lost over time,
  // individual and per-team-combo lines)
  // ---------------------------------------------------------------------

  var SVG_NS = "http://www.w3.org/2000/svg";
  var TEAM_COMBO_PALETTE = ["#c77dff", "#4fb0a5", "#e08e45", "#8ecae6", "#f2a6c9", "#9fd35c", "#d4a24c", "#6a8caf"];
  // Fixed (theme-independent) colors for the whole-Tournament played/won/
  // lost series — deliberately blue/violet, nowhere near the gold/amber
  // family several themes use for --accent (which Single games won/lost
  // follows instead) or the red family every theme uses for --danger, so
  // the two "won" lines (and the two "lost" lines) stay visually distinct
  // no matter the active theme.
  var TOURNAMENT_PLAYED_COLOR = "#00b4d8";
  var TOURNAMENT_WON_COLOR = "#3a86ff";
  var TOURNAMENT_LOST_COLOR = "#8338ec";
  // Leaves this fraction of the chart's width blank at the right edge, so
  // the most recent line segment and "Now" tick aren't flush against the
  // card border — otherwise the latest data reads as cut off.
  var GRAPH_END_BUFFER = 0.05;

  function svgEl(tag, attrs) {
    var el = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs || {}).forEach(function (key) {
      el.setAttribute(key, attrs[key]);
    });
    return el;
  }

  function teamComboLabel(teammateNames) {
    return (teammateNames || []).slice().sort().join(", ");
  }

  // Turns a chronological game list into cumulative played/lost counts over
  // time — one line for individual games, and one played/lost pair per
  // distinct team combination this player has been part of.
  // Groups a timestamp into the bucket the graph should show one data point
  // per, matching the selected period's natural resolution: minute-by-
  // minute for a single day (otherwise several games in the same session
  // would each get their own dot), day-by-day for everything from a week
  // up to a year, since "which minute" stops being meaningful at that
  // range.
  function bucketKeyFor(ts, period) {
    var d = new Date(ts);
    if (period === "today") {
      return d.getFullYear() + "-" + d.getMonth() + "-" + d.getDate() + "-" + d.getHours() + "-" + d.getMinutes();
    }
    return d.getFullYear() + "-" + d.getMonth() + "-" + d.getDate();
  }

  // Adds one game's result to a cumulative series, collapsing consecutive
  // games that land in the same bucket into a single point (the bucket's
  // last timestamp, with the running total as of that point) instead of
  // plotting a dot per game. gameInfo ({gameLabel, opponentNames, result})
  // is kept per point (not just the count) so a dot can show exactly
  // which opponents were played and the win/loss against each — see
  // summarizeGraphDotGames / the graph's click-to-reveal tooltip.
  function pushBucketedPoint(arr, ts, count, period, gameInfo) {
    var key = bucketKeyFor(ts, period);
    var last = arr.length ? arr[arr.length - 1] : null;
    if (last && last.bucketKey === key) {
      last.ts = ts;
      last.count = count;
      if (gameInfo) last.games.push(gameInfo);
    } else {
      arr.push({ ts: ts, count: count, bucketKey: key, games: gameInfo ? [gameInfo] : [] });
    }
  }

  function buildCumulativeSeries(games, period) {
    var sorted = games.slice().sort(function (a, b) {
      return a.ts.localeCompare(b.ts);
    });
    var individualPlayed = [];
    var individualWon = [];
    var individualLost = [];
    var indPlayedCount = 0;
    var indWonCount = 0;
    var indLostCount = 0;
    var teamCombos = {};

    sorted.forEach(function (g) {
      var gameInfo = { gameLabel: g.gameLabel, opponentNames: g.opponentNames || [], result: g.result };
      if (!g.isTeam) {
        indPlayedCount += 1;
        pushBucketedPoint(individualPlayed, g.ts, indPlayedCount, period, gameInfo);
        if (g.result === "won") {
          indWonCount += 1;
          pushBucketedPoint(individualWon, g.ts, indWonCount, period, gameInfo);
        } else {
          indLostCount += 1;
          pushBucketedPoint(individualLost, g.ts, indLostCount, period, gameInfo);
        }
        return;
      }
      var key = teamComboLabel(g.teammateNames) || T("graph.teammatesUnknown");
      if (!teamCombos[key]) {
        teamCombos[key] = {
          label: key,
          played: [],
          won: [],
          lost: [],
          playedCount: 0,
          wonCount: 0,
          lostCount: 0
        };
      }
      var combo = teamCombos[key];
      combo.playedCount += 1;
      pushBucketedPoint(combo.played, g.ts, combo.playedCount, period, gameInfo);
      if (g.result === "won") {
        combo.wonCount += 1;
        pushBucketedPoint(combo.won, g.ts, combo.wonCount, period, gameInfo);
      } else {
        combo.lostCount += 1;
        pushBucketedPoint(combo.lost, g.ts, combo.lostCount, period, gameInfo);
      }
    });

    return {
      individualPlayed: individualPlayed,
      individualWon: individualWon,
      individualLost: individualLost,
      teamCombos: teamCombos
    };
  }

  // Same bucketing idea as buildCumulativeSeries, but for whole completed
  // bracket Tournaments (won = became champion, lost = eliminated at any
  // point) rather than individual rack results — see
  // tournamentGamesForPlayerName. Kept as its own (much simpler) function
  // since there's no "played"/team-combo split to track here.
  function buildTournamentCumulativeSeries(games, period) {
    var sorted = games.slice().sort(function (a, b) {
      return a.ts.localeCompare(b.ts);
    });
    var played = [];
    var won = [];
    var lost = [];
    var playedCount = 0;
    var wonCount = 0;
    var lostCount = 0;
    sorted.forEach(function (g) {
      var gameInfo = { gameLabel: g.gameLabel, opponentNames: g.opponentNames || [], result: g.result };
      playedCount += 1;
      pushBucketedPoint(played, g.ts, playedCount, period, gameInfo);
      if (g.result === "won") {
        wonCount += 1;
        pushBucketedPoint(won, g.ts, wonCount, period, gameInfo);
      } else {
        lostCount += 1;
        pushBucketedPoint(lost, g.ts, lostCount, period, gameInfo);
      }
    });
    return { played: played, won: won, lost: lost };
  }

  // Monotone cubic Hermite spline (Fritsch–Carlson) through a point list —
  // smooth, no sharp corners, and — unlike a plain Catmull-Rom spline —
  // never overshoots past a point's value, which matters here because the
  // data is a cumulative count that only ever holds or rises.
  function monotoneLinePath(rawPts) {
    if (rawPts.length === 0) return "";
    // A monotone spline needs strictly increasing x; merge any points that
    // land on (almost) the same x — e.g. two events a fraction of a second
    // apart — keeping the later one, since a vertical jump has no slope.
    var pts = [rawPts[0]];
    for (var i = 1; i < rawPts.length; i++) {
      if (rawPts[i].x - pts[pts.length - 1].x < 0.01) {
        pts[pts.length - 1] = rawPts[i];
      } else {
        pts.push(rawPts[i]);
      }
    }
    var n = pts.length;
    if (n === 1) return "M " + pts[0].x + " " + pts[0].y;

    var dx = [];
    var delta = [];
    for (i = 0; i < n - 1; i++) {
      dx[i] = pts[i + 1].x - pts[i].x;
      delta[i] = (pts[i + 1].y - pts[i].y) / dx[i];
    }

    var m = [delta[0]];
    for (i = 1; i < n - 1; i++) {
      if (delta[i - 1] === 0 || delta[i] === 0 || delta[i - 1] < 0 !== delta[i] < 0) {
        m[i] = 0;
      } else {
        m[i] = (delta[i - 1] + delta[i]) / 2;
      }
    }
    m[n - 1] = delta[n - 2];

    for (i = 0; i < n - 1; i++) {
      if (delta[i] === 0) {
        m[i] = 0;
        m[i + 1] = 0;
        continue;
      }
      var a = m[i] / delta[i];
      var b = m[i + 1] / delta[i];
      if (a < 0) m[i] = 0;
      if (b < 0) m[i + 1] = 0;
      var s = a * a + b * b;
      if (s > 9) {
        var tau = 3 / Math.sqrt(s);
        m[i] = tau * a * delta[i];
        m[i + 1] = tau * b * delta[i];
      }
    }

    var d = "M " + pts[0].x + " " + pts[0].y;
    for (i = 0; i < n - 1; i++) {
      var cp1x = pts[i].x + dx[i] / 3;
      var cp1y = pts[i].y + (m[i] * dx[i]) / 3;
      var cp2x = pts[i + 1].x - dx[i] / 3;
      var cp2y = pts[i + 1].y - (m[i + 1] * dx[i]) / 3;
      d += " C " + cp1x + " " + cp1y + " " + cp2x + " " + cp2y + " " + pts[i + 1].x + " " + pts[i + 1].y;
    }
    return d;
  }

  // Maps a cumulative (ts, count) series onto chart coordinates and builds
  // a smooth path through it (anchored flat at the chart's time edges), plus
  // the screen position of every real data point for dot markers.
  function buildSeriesGeometry(points, minMs, maxMs, width, height, axisMax) {
    var usableWidth = width * (1 - GRAPH_END_BUFFER);
    function xFor(ms) {
      return maxMs > minMs ? ((ms - minMs) / (maxMs - minMs)) * usableWidth : 0;
    }
    function yFor(count) {
      return axisMax > 0 ? height - (count / axisMax) * height : height;
    }
    var dots = points.map(function (p) {
      return { x: xFor(new Date(p.ts).getTime()), y: yFor(p.count), games: p.games || [] };
    });
    var lastCount = points.length ? points[points.length - 1].count : 0;
    var allPts = [{ x: xFor(minMs), y: yFor(0) }].concat(dots, [{ x: xFor(maxMs), y: yFor(lastCount) }]);
    return { path: monotoneLinePath(allPts), dots: dots };
  }

  // Collapses a graph dot's underlying games into one win/loss tally per
  // opponent (a bucketed dot can represent several games against several
  // people), in first-seen order.
  function summarizeGraphDotGames(games) {
    var byOpponent = {};
    var order = [];
    games.forEach(function (g) {
      (g.opponentNames || []).forEach(function (name) {
        if (!byOpponent[name]) {
          byOpponent[name] = { name: name, wins: 0, losses: 0 };
          order.push(name);
        }
        if (g.result === "won") byOpponent[name].wins += 1;
        else byOpponent[name].losses += 1;
      });
    });
    return order.map(function (name) {
      return byOpponent[name];
    });
  }

  var graphTooltipEl = null;

  function getGraphTooltipEl() {
    if (!graphTooltipEl) {
      graphTooltipEl = document.createElement("div");
      graphTooltipEl.className = "player-graph-tooltip hidden";
      document.body.appendChild(graphTooltipEl);
    }
    return graphTooltipEl;
  }

  // Shows (or moves, if already open) a small fixed-position tooltip near
  // wherever a graph dot was clicked, listing every opponent behind that
  // point and the win/loss record against each. One shared tooltip node
  // for the whole app — only one is ever open at a time.
  function showGraphDotTooltip(clientX, clientY, games) {
    var el = getGraphTooltipEl();
    var perOpponent = summarizeGraphDotGames(games);
    el.innerHTML = "";
    var title = document.createElement("div");
    title.className = "player-graph-tooltip-title";
    title.textContent = games.length + " game" + (games.length === 1 ? "" : "s") + " here";
    el.appendChild(title);
    perOpponent.forEach(function (opp) {
      var row = document.createElement("div");
      row.className = "player-graph-tooltip-row";
      var name = document.createElement("span");
      name.className = "player-graph-tooltip-name";
      // "vs " prefix (matching the rating-dot tooltip's convention)
      // instead of the bare opponent name — otherwise "Suresh 2 wins,
      // 0 losses" reads as Suresh's own record, when it's actually
      // this player's record against Suresh.
      name.textContent = T("common.vsName", { name: opp.name });
      var record = document.createElement("span");
      record.className = "player-graph-tooltip-record";
      var winWord = opp.wins === 1 ? "win" : "wins";
      var lossWord = opp.losses === 1 ? "loss" : "losses";
      record.textContent = opp.wins + " " + winWord + ", " + opp.losses + " " + lossWord;
      row.appendChild(name);
      row.appendChild(record);
      el.appendChild(row);
    });
    el.classList.remove("hidden");
    positionGraphTooltip(el, clientX, clientY);
  }

  // Places an already-populated, already-unhidden tooltip just beside
  // wherever it was triggered from — above the click point by default,
  // flipping below if that would run off the top, and clamped left/right
  // so it never runs off either edge. Shared by every graph tooltip
  // (win/loss dots, rating dots) so they all behave identically.
  function positionGraphTooltip(el, clientX, clientY) {
    var margin = 8;
    var left = Math.min(Math.max(clientX - el.offsetWidth / 2, margin), window.innerWidth - el.offsetWidth - margin);
    var top = clientY - el.offsetHeight - 14;
    if (top < margin) top = clientY + 14;
    el.style.left = left + "px";
    el.style.top = top + "px";
  }

  function hideGraphTooltip() {
    if (graphTooltipEl) graphTooltipEl.classList.add("hidden");
  }

  // Finds this player's own game record with a given ts (exact match —
  // every rating-history point is stamped with the same ts as the game
  // that caused it) so a rating dot's tooltip can show who it was against.
  function findGameByTs(games, ts) {
    for (var i = 0; i < games.length; i++) {
      if (games[i].ts === ts) return games[i];
    }
    return null;
  }

  function formatSignedDelta(delta) {
    if (delta > 0) return "▲ +" + delta;
    if (delta < 0) return "▼ " + delta;
    return "— no change";
  }

  // Click-to-reveal tooltip for one rating-history dot: the resulting
  // rating at that exact point, this player's own change from that
  // game, plus — by cross-referencing the matching game record's
  // opponentNames and each opponent's own rating history at the same ts
  // (getPlayerRatingDeltaForGame) — exactly who it was against and what
  // happened to their rating too, so it's clear who gained and lost.
  function showRatingDotTooltip(clientX, clientY, point, game) {
    var el = getGraphTooltipEl();
    el.innerHTML = "";
    var title = document.createElement("div");
    title.className = "player-graph-tooltip-title";
    title.textContent = formatTimestamp(point.ts, true);
    el.appendChild(title);

    var ratingRow = document.createElement("div");
    ratingRow.className = "player-graph-tooltip-row";
    var ratingLabel = document.createElement("span");
    ratingLabel.className = "player-graph-tooltip-name";
    ratingLabel.textContent = T("common.rating");
    var ratingValue = document.createElement("span");
    ratingValue.className = "player-graph-tooltip-record";
    ratingValue.textContent = point.rating;
    ratingRow.appendChild(ratingLabel);
    ratingRow.appendChild(ratingValue);
    el.appendChild(ratingRow);

    var youRow = document.createElement("div");
    youRow.className = "player-graph-tooltip-row";
    var youName = document.createElement("span");
    youName.className = "player-graph-tooltip-name";
    youName.textContent = T("common.you");
    var youRecord = document.createElement("span");
    youRecord.className = "player-graph-tooltip-record";
    youRecord.textContent = formatSignedDelta(point.delta);
    youRow.appendChild(youName);
    youRow.appendChild(youRecord);
    el.appendChild(youRow);

    var opponentNames = game ? game.opponentNames || [] : [];
    if (opponentNames.length === 0) {
      var noGame = document.createElement("div");
      noGame.className = "player-graph-tooltip-row";
      var hint = document.createElement("span");
      hint.className = "player-graph-tooltip-record";
      hint.textContent = T("playerPage.opponentDetailsUnavailable");
      noGame.appendChild(hint);
      el.appendChild(noGame);
    } else {
      opponentNames.forEach(function (oppName) {
        var oppDelta = getPlayerRatingDeltaForGame(oppName, point.ts);
        var row = document.createElement("div");
        row.className = "player-graph-tooltip-row";
        var name = document.createElement("span");
        name.className = "player-graph-tooltip-name";
        name.textContent = T("common.vsName", { name: oppName });
        var record = document.createElement("span");
        record.className = "player-graph-tooltip-record";
        record.textContent = oppDelta === null ? "—" : formatSignedDelta(oppDelta);
        row.appendChild(name);
        row.appendChild(record);
        el.appendChild(row);
      });
    }

    el.classList.remove("hidden");
    positionGraphTooltip(el, clientX, clientY);
  }

  // Draws one series as a smooth path plus a dot at every real data point.
  // color is only needed for team-combo lines, which use an inline stroke/
  // fill instead of a CSS class (their color is picked at render time).
  // Returns the <g> the series was drawn into, so the legend can toggle its
  // visibility (show/hide) as one unit. Every dot that has games behind it
  // gets an invisible, larger "hit" circle on top (small dots are hard to
  // tap precisely) that reveals a tooltip with the opponent(s) and win/
  // loss for every game bucketed into that point — see
  // showGraphDotTooltip/summarizeGraphDotGames.
  function appendGraphSeries(svg, points, minMs, maxMs, width, height, axisMax, lineClass, dotClass, color, startHidden) {
    var geo = buildSeriesGeometry(points, minMs, maxMs, width, height, axisMax);
    var group = svgEl("g", { class: "player-graph-series" + (startHidden ? " is-hidden" : "") });
    var pathAttrs = { d: geo.path, fill: "none", class: lineClass };
    if (color) pathAttrs.stroke = color;
    group.appendChild(svgEl("path", pathAttrs));
    geo.dots.forEach(function (pt) {
      var circleAttrs = { cx: pt.x, cy: pt.y, r: 3.2, class: dotClass };
      if (color) circleAttrs.fill = color;
      group.appendChild(svgEl("circle", circleAttrs));
      if (pt.games && pt.games.length) {
        var hit = svgEl("circle", { cx: pt.x, cy: pt.y, r: 9, class: "player-graph-dot-hit" });
        hit.addEventListener("click", function (e) {
          e.stopPropagation();
          showGraphDotTooltip(e.clientX, e.clientY, pt.games);
        });
        group.appendChild(hit);
      }
    });
    svg.appendChild(group);
    return group;
  }

  // Dense graduation points for the graph's time axis, matching the
  // selected period's natural calendar unit: hours through a day, days
  // through a week or month, months through 6 months or a year. Always
  // ends with maxMs itself — "now", the moment the graph was requested —
  // even though that rarely lands exactly on one of those boundaries.
  function periodAxisTicks(period, minMs, maxMs) {
    var start = new Date(minMs);
    var ticks = [];
    function add(d) {
      var ms = d.getTime();
      if (ms <= maxMs) ticks.push(ms);
    }
    if (period === "today") {
      for (var h = 0; h <= 24; h++) {
        add(new Date(start.getFullYear(), start.getMonth(), start.getDate(), h, 0, 0, 0));
      }
    } else if (period === "week") {
      for (var d1 = 0; d1 <= 7; d1++) {
        add(new Date(start.getFullYear(), start.getMonth(), start.getDate() + d1));
      }
    } else if (period === "month") {
      var daysInMonth = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();
      for (var d2 = 0; d2 <= daysInMonth; d2++) {
        add(new Date(start.getFullYear(), start.getMonth(), start.getDate() + d2));
      }
    } else if (period === "6month" || period === "year") {
      var monthCount = period === "year" ? 12 : 6;
      for (var m = 0; m <= monthCount; m++) {
        add(new Date(start.getFullYear(), start.getMonth() + m, start.getDate()));
      }
    } else {
      var evenCount = 4;
      for (var i = 0; i <= evenCount; i++) {
        ticks.push(minMs + (i / evenCount) * (maxMs - minMs));
      }
    }
    if (ticks.length === 0 || ticks[ticks.length - 1] !== maxMs) {
      ticks.push(maxMs);
    }
    return ticks;
  }

  function formatAxisTickLabel(d, period) {
    if (period === "today") return d.toLocaleTimeString(undefined, { hour: "numeric" });
    if (period === "week") return d.toLocaleDateString(undefined, { weekday: "short" });
    if (period === "month") return String(d.getDate());
    if (period === "6month" || period === "year") return d.toLocaleDateString(undefined, { month: "short" });
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function buildGraphTimeAxis(minMs, maxMs, period) {
    var axis = document.createElement("div");
    axis.className = "player-graph-time-axis";

    var allTicks = periodAxisTicks(period, minMs, maxMs);
    var span = maxMs - minMs || 1;
    function pctFor(ms) {
      return ((ms - minMs) / span) * 100 * (1 - GRAPH_END_BUFFER);
    }

    // Dense, unlabeled graduation marks — one per hour/day/month depending
    // on the selected period, like a ruler.
    allTicks.forEach(function (ms) {
      var mark = document.createElement("span");
      mark.className = "player-graph-time-tick";
      mark.style.left = pctFor(ms) + "%";
      axis.appendChild(mark);
    });

    // A sparser labeled subset so the text stays legible; the last label
    // is always "Now" — exactly maxMs, the moment this graph was requested.
    var maxLabels = 6;
    var labelIdxs = [];
    if (allTicks.length <= maxLabels) {
      for (var i = 0; i < allTicks.length; i++) labelIdxs.push(i);
    } else {
      var step = (allTicks.length - 1) / (maxLabels - 1);
      for (var j = 0; j < maxLabels; j++) labelIdxs.push(Math.round(j * step));
    }
    var seen = {};
    var finalIdxs = [];
    labelIdxs.forEach(function (idx) {
      if (!seen[idx]) {
        seen[idx] = true;
        finalIdxs.push(idx);
      }
    });
    var lastIdx = allTicks.length - 1;
    // A narrow (phone-portrait) viewport gives the same-length "Now" text
    // a much bigger share of the available width than on a wide screen, so
    // a threshold tuned for desktop isn't enough clearance there — and
    // since a slightly sparser axis costs nothing on a wide screen either,
    // just use the wide clearance unconditionally rather than guess a
    // width breakpoint that has to match every real device.
    var nowCollisionThreshold = 0.32;

    // Guarantee "Now" is the final label, then drop whichever regular tick
    // landed right next to it — including one that happened to already be
    // in the evenly-spaced selection — so the (usually much longer) "Now"
    // text never overlaps its neighbor.
    if (finalIdxs[finalIdxs.length - 1] !== lastIdx) finalIdxs.push(lastIdx);
    while (
      finalIdxs.length > 1 &&
      (allTicks[lastIdx] - allTicks[finalIdxs[finalIdxs.length - 2]]) / span < nowCollisionThreshold
    ) {
      finalIdxs.splice(finalIdxs.length - 2, 1);
    }

    finalIdxs.forEach(function (idx, pos) {
      var ms = allTicks[idx];
      var isNow = idx === lastIdx;
      var d = new Date(ms);
      var label = document.createElement("span");
      label.className = "player-graph-time-label";
      if (pos === 0) label.classList.add("is-first");
      if (isNow) label.classList.add("is-last", "is-now");
      label.style.left = pctFor(ms) + "%";
      // No time-of-day - "Now · Sep 3", not "Now · Sep 3 1:21 PM" - the
      // extra precision isn't worth how much wider it makes the one label
      // that always has to fit without overlapping its neighbor.
      label.textContent = isNow
        ? T("graph.nowPrefix") + d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
        : formatAxisTickLabel(d, period);
      axis.appendChild(label);
    });

    return axis;
  }

  // Rating points use their own value scale (roughly 0-900, no natural
  // zero baseline worth showing) instead of the games chart's 0-based
  // count scale, so this pads the start/end of the line with the first/
  // last known rating rather than 0.
  function buildRatingSeriesGeometry(points, minMs, maxMs, width, height, axisMin, axisMax) {
    var usableWidth = width * (1 - GRAPH_END_BUFFER);
    function xFor(ms) {
      return maxMs > minMs ? ((ms - minMs) / (maxMs - minMs)) * usableWidth : 0;
    }
    var range = axisMax - axisMin || 1;
    function yFor(rating) {
      return height - ((rating - axisMin) / range) * height;
    }
    var dots = points.map(function (p) {
      return { x: xFor(new Date(p.ts).getTime()), y: yFor(p.rating), ts: p.ts, delta: p.delta, rating: p.rating };
    });
    var firstRating = points.length ? points[0].rating : axisMin;
    var lastRating = points.length ? points[points.length - 1].rating : axisMin;
    var allPts = [{ x: xFor(minMs), y: yFor(firstRating) }].concat(dots, [{ x: xFor(maxMs), y: yFor(lastRating) }]);
    return { path: monotoneLinePath(allPts), dots: dots };
  }

  function appendRatingGraphSeries(svg, points, minMs, maxMs, width, height, axisMin, axisMax, games) {
    var geo = buildRatingSeriesGeometry(points, minMs, maxMs, width, height, axisMin, axisMax);
    var group = svgEl("g", { class: "player-graph-series" });
    group.appendChild(svgEl("path", { d: geo.path, fill: "none", class: "player-rating-graph-line" }));
    geo.dots.forEach(function (pt) {
      group.appendChild(svgEl("circle", { cx: pt.x, cy: pt.y, r: 3.2, class: "player-rating-graph-dot" }));
      var hit = svgEl("circle", { cx: pt.x, cy: pt.y, r: 9, class: "player-graph-dot-hit" });
      hit.addEventListener("click", function (e) {
        e.stopPropagation();
        showRatingDotTooltip(e.clientX, e.clientY, pt, findGameByTs(games, pt.ts));
      });
      group.appendChild(hit);
    });
    svg.appendChild(group);
    return group;
  }

  // A small standalone "rating over time" chart, appended after the main
  // played/won/lost graph — kept separate because ratings (roughly 0-900,
  // no meaningful zero baseline) can't share a Y-axis with game counts.
  function buildRatingGraphSection(name, games, minMs, maxMs, period) {
    var section = document.createElement("div");
    section.className = "player-rating-graph-wrap";

    var heading = document.createElement("h3");
    heading.className = "player-rating-graph-heading";
    heading.textContent = T("common.rating");
    section.appendChild(heading);

    var entry = getPlayerRatingEntry(name);
    var pointsInWindow = entry
      ? entry.history.filter(function (h) {
          var t = new Date(h.ts).getTime();
          return t >= minMs && t <= maxMs;
        })
      : [];

    if (pointsInWindow.length === 0) {
      var hint = document.createElement("p");
      hint.className = "player-graph-empty";
      hint.textContent = T("playerPage.noRatingChangesThisPeriod", { rating: getPlayerRating(name) });
      section.appendChild(hint);
      return section;
    }

    var ratings = pointsInWindow.map(function (h) {
      return h.rating;
    });
    var minRating = Math.min.apply(null, ratings);
    var maxRating = Math.max.apply(null, ratings);
    var pad = Math.max(10, Math.round((maxRating - minRating) * 0.15));
    var axisMin = Math.max(0, Math.floor((minRating - pad) / 10) * 10);
    var axisMax = Math.ceil((maxRating + pad) / 10) * 10;
    if (axisMax <= axisMin) axisMax = axisMin + 20;

    var width = 600;
    var height = 140;

    var chart = document.createElement("div");
    chart.className = "player-graph-chart";

    var yAxis = document.createElement("div");
    yAxis.className = "player-graph-yaxis";
    for (var i = 4; i >= 0; i--) {
      var label = document.createElement("span");
      label.textContent = Math.round(axisMin + ((axisMax - axisMin) * i) / 4);
      yAxis.appendChild(label);
    }
    chart.appendChild(yAxis);

    var svg = svgEl("svg", { viewBox: "0 0 " + width + " " + height, class: "player-graph-svg" });
    for (var g = 0; g <= 4; g++) {
      var gy = height - (g / 4) * height;
      svg.appendChild(svgEl("line", { x1: 0, x2: width, y1: gy, y2: gy, class: "player-graph-gridline" }));
    }
    appendRatingGraphSeries(svg, pointsInWindow, minMs, maxMs, width, height, axisMin, axisMax, games);

    chart.appendChild(svg);
    section.appendChild(chart);
    section.appendChild(buildGraphTimeAxis(minMs, maxMs, period));
    return section;
  }

  // sharedAxisMax (optional): when set (the All Players comparison view
  // passes the axis for whichever player there has played the most
  // games), every player's chart uses that SAME y-axis instead of its own
  // - so the line's climb rate is directly comparable card to card.
  // Falls back to this player's own axis (the original behavior) for the
  // single-player stats page, where there's nothing to compare against.
  function buildPlayerGraph(stats, minMs, maxMs, period, sharedAxisMax) {
    var wrap = document.createElement("div");
    wrap.className = "player-graph-wrap";

    var series = buildCumulativeSeries(stats.games, period);
    var tournamentSeries = buildTournamentCumulativeSeries(stats.tournamentGames || [], period);
    var comboKeys = Object.keys(series.teamCombos).sort();

    var maxCount = 0;
    [
      series.individualPlayed,
      series.individualWon,
      series.individualLost,
      tournamentSeries.played,
      tournamentSeries.won,
      tournamentSeries.lost
    ].forEach(function (arr) {
      if (arr.length) maxCount = Math.max(maxCount, arr[arr.length - 1].count);
    });
    comboKeys.forEach(function (key) {
      var c = series.teamCombos[key];
      if (c.playedCount) maxCount = Math.max(maxCount, c.playedCount);
    });

    if (maxCount === 0) {
      var emptyHint = document.createElement("p");
      emptyHint.className = "player-graph-empty";
      emptyHint.textContent = T("playerPage.noGamesThisPeriod");
      wrap.appendChild(emptyHint);
      wrap.appendChild(buildRatingGraphSection(stats.name, stats.games, minMs, maxMs, period));
      return wrap;
    }

    var axisMax = sharedAxisMax || axisMaxFor(maxCount);
    var width = 600;
    var height = 200;

    var chart = document.createElement("div");
    chart.className = "player-graph-chart";

    var yAxis = document.createElement("div");
    yAxis.className = "player-graph-yaxis";
    for (var i = 4; i >= 0; i--) {
      var label = document.createElement("span");
      label.textContent = Math.round((axisMax * i) / 4);
      yAxis.appendChild(label);
    }
    chart.appendChild(yAxis);

    var svg = svgEl("svg", {
      viewBox: "0 0 " + width + " " + height,
      class: "player-graph-svg"
    });
    for (var g = 0; g <= 4; g++) {
      var gy = height - (g / 4) * height;
      svg.appendChild(svgEl("line", { x1: 0, x2: width, y1: gy, y2: gy, class: "player-graph-gridline" }));
    }

    var legendItems = [];

    if (series.individualPlayed.length) {
      var gIndPlayed = appendGraphSeries(
        svg,
        series.individualPlayed,
        minMs,
        maxMs,
        width,
        height,
        axisMax,
        "player-graph-line player-graph-line-ind-played",
        "player-graph-dot player-graph-dot-ind-played",
        null
      );
      legendItems.push({ color: "var(--info)", style: "solid", label: T("graph.singleGamesPlayed"), group: gIndPlayed });
    }
    if (series.individualWon.length) {
      var gIndWon = appendGraphSeries(
        svg,
        series.individualWon,
        minMs,
        maxMs,
        width,
        height,
        axisMax,
        "player-graph-line player-graph-line-dotted player-graph-line-ind-won",
        "player-graph-dot player-graph-dot-ind-won",
        null
      );
      legendItems.push({ color: "var(--accent)", style: "dotted", label: T("graph.singleGamesWon"), group: gIndWon });
    }
    if (series.individualLost.length) {
      var gIndLost = appendGraphSeries(
        svg,
        series.individualLost,
        minMs,
        maxMs,
        width,
        height,
        axisMax,
        "player-graph-line player-graph-line-dashed player-graph-line-ind-lost",
        "player-graph-dot player-graph-dot-ind-lost",
        null,
        true
      );
      legendItems.push({
        color: "var(--danger)",
        style: "dashed",
        label: T("graph.singleGamesLost"),
        group: gIndLost,
        startHidden: true
      });
    }

    comboKeys.forEach(function (key, idx) {
      var combo = series.teamCombos[key];
      var color = TEAM_COMBO_PALETTE[idx % TEAM_COMBO_PALETTE.length];
      if (combo.played.length) {
        var gComboPlayed = appendGraphSeries(
          svg,
          combo.played,
          minMs,
          maxMs,
          width,
          height,
          axisMax,
          "player-graph-line",
          "player-graph-dot",
          color
        );
        legendItems.push({ color: color, style: "solid", label: T("graph.comboPlayed", { key: key }), group: gComboPlayed });
      }
      if (combo.won.length) {
        var gComboWon = appendGraphSeries(
          svg,
          combo.won,
          minMs,
          maxMs,
          width,
          height,
          axisMax,
          "player-graph-line player-graph-line-dotted",
          "player-graph-dot",
          color
        );
        legendItems.push({ color: color, style: "dotted", label: T("graph.comboWon", { key: key }), group: gComboWon });
      }
      if (combo.lost.length) {
        var gComboLost = appendGraphSeries(
          svg,
          combo.lost,
          minMs,
          maxMs,
          width,
          height,
          axisMax,
          "player-graph-line player-graph-line-dashed",
          "player-graph-dot",
          color,
          true
        );
        legendItems.push({
          color: color,
          style: "dashed",
          label: T("graph.comboLost", { key: key }),
          group: gComboLost,
          startHidden: true
        });
      }
    });

    if (tournamentSeries.played.length) {
      var gTournPlayed = appendGraphSeries(
        svg,
        tournamentSeries.played,
        minMs,
        maxMs,
        width,
        height,
        axisMax,
        "player-graph-line",
        "player-graph-dot",
        TOURNAMENT_PLAYED_COLOR
      );
      legendItems.push({ color: TOURNAMENT_PLAYED_COLOR, style: "solid", label: T("graph.tournamentsPlayed"), group: gTournPlayed });
    }
    if (tournamentSeries.won.length) {
      var gTournWon = appendGraphSeries(
        svg,
        tournamentSeries.won,
        minMs,
        maxMs,
        width,
        height,
        axisMax,
        "player-graph-line player-graph-line-dotted",
        "player-graph-dot",
        TOURNAMENT_WON_COLOR
      );
      legendItems.push({ color: TOURNAMENT_WON_COLOR, style: "dotted", label: T("graph.tournamentWins"), group: gTournWon });
    }
    if (tournamentSeries.lost.length) {
      var gTournLost = appendGraphSeries(
        svg,
        tournamentSeries.lost,
        minMs,
        maxMs,
        width,
        height,
        axisMax,
        "player-graph-line player-graph-line-dashed",
        "player-graph-dot",
        TOURNAMENT_LOST_COLOR
      );
      legendItems.push({ color: TOURNAMENT_LOST_COLOR, style: "dashed", label: T("graph.tournamentLosses"), group: gTournLost });
    }

    chart.appendChild(svg);
    wrap.appendChild(chart);
    wrap.appendChild(buildGraphTimeAxis(minMs, maxMs, period));

    var legend = document.createElement("div");
    legend.className = "player-graph-legend";
    legendItems.forEach(function (item) {
      var row = document.createElement("div");
      row.className = "player-graph-legend-row" + (item.startHidden ? " is-off" : "");
      var swatch = document.createElement("span");
      swatch.className = "player-graph-legend-swatch" + (item.style === "solid" ? "" : " is-" + item.style);
      swatch.style.setProperty("--swatch-color", item.color);
      var text = document.createElement("span");
      text.className = "player-graph-legend-label";
      text.textContent = item.label;
      var toggleBtn = document.createElement("button");
      toggleBtn.type = "button";
      toggleBtn.className = "player-graph-legend-toggle";
      toggleBtn.textContent = T(item.startHidden ? "common.show" : "common.hide");
      toggleBtn.setAttribute("aria-pressed", item.startHidden ? "false" : "true");
      toggleBtn.addEventListener("click", function () {
        var nowHidden = item.group.classList.toggle("is-hidden");
        row.classList.toggle("is-off", nowHidden);
        toggleBtn.textContent = T(nowHidden ? "common.show" : "common.hide");
        toggleBtn.setAttribute("aria-pressed", nowHidden ? "false" : "true");
      });
      row.appendChild(swatch);
      row.appendChild(toggleBtn);
      row.appendChild(text);
      legend.appendChild(row);
    });
    wrap.appendChild(legend);
    wrap.appendChild(buildRatingGraphSection(stats.name, stats.games, minMs, maxMs, period));

    return wrap;
  }

  function buildAllPlayerCard(
    stats,
    sharedAxisMax,
    tournSharedAxisMax,
    minMs,
    maxMs,
    period,
    isInLiveRoster
  ) {
    var li = document.createElement("li");
    li.className = "all-player-card";

    var top = document.createElement("div");
    top.className = "all-player-card-top";
    var name = document.createElement("button");
    name.type = "button";
    name.className = "all-player-name";
    buildPlayerNameLabel(name, stats.name, false);
    name.appendChild(buildRatingBadge(stats.name));
    name.setAttribute("aria-label", "View stats for " + stats.name);
    name.addEventListener("click", function () {
      openPlayerStatsPage(stats.name);
    });
    var nameGroup = document.createElement("div");
    nameGroup.className = "all-player-name-group";
    nameGroup.appendChild(name);
    nameGroup.appendChild(buildPlayerLinkIcon(stats.name));
    var summary = document.createElement("span");
    summary.className = "all-player-summary";
    summary.textContent = stats.winPct === null ? T("allPlayers.noGamesYet") : T("allPlayers.winRate", { pct: Math.round(stats.winPct * 100) });
    top.appendChild(nameGroup);
    top.appendChild(summary);
    li.appendChild(top);

    var ratingDeltaText = formatRatingPeriodDelta(stats.name, period);
    if (ratingDeltaText !== null) {
      var ratingStatus = document.createElement("div");
      ratingStatus.className = "all-player-rating-status";
      if (ratingDeltaText.charAt(0) === "▲") ratingStatus.classList.add("is-up");
      else if (ratingDeltaText.charAt(0) === "▼") ratingStatus.classList.add("is-down");
      ratingStatus.textContent = T("allPlayers.ratingThisPeriod", { delta: ratingDeltaText });
      li.appendChild(ratingStatus);
    }

    if (allPlayersViewMode === "graph") {
      if (isInLiveRoster) {
        li.appendChild(buildPlayerGraph(stats, minMs, maxMs, period, sharedAxisMax));
      } else {
        var graphHolder = document.createElement("div");
        graphHolder.className = "all-player-graph-holder hidden";
        var showGraphBtn = document.createElement("button");
        showGraphBtn.type = "button";
        showGraphBtn.className = "btn btn-ghost all-player-show-graph-btn";
        showGraphBtn.textContent = T("allPlayers.showGraph");
        showGraphBtn.addEventListener("click", function () {
          if (!graphHolder.hasChildNodes()) {
            graphHolder.appendChild(buildPlayerGraph(stats, minMs, maxMs, period, sharedAxisMax));
          }
          var nowHidden = graphHolder.classList.toggle("hidden");
          showGraphBtn.textContent = T(nowHidden ? "allPlayers.showGraph" : "allPlayers.hideGraph");
        });
        li.appendChild(showGraphBtn);
        li.appendChild(graphHolder);
      }
    } else {
      // Played/won/lost share one scale (played's, since played >= won +
      // lost for any one player) so equal counts always draw equal bar
      // lengths and different players' bars stay directly comparable -
      // same for the tournament trio below.
      li.appendChild(buildScaleRow(T("allPlayers.gamesPlayed"), stats.played, sharedAxisMax, "scale-fill-played"));
      li.appendChild(buildScaleRow(T("allPlayers.gamesWon"), stats.wins, sharedAxisMax, "scale-fill-won"));
      li.appendChild(buildScaleRow(T("allPlayers.gamesLost"), stats.losses, sharedAxisMax, "scale-fill-lost"));
      if (stats.tournamentPlayed > 0) {
        li.appendChild(buildScaleRow(T("allPlayers.tournamentsPlayed"), stats.tournamentPlayed, tournSharedAxisMax, "scale-fill-tourn-played"));
        li.appendChild(buildScaleRow(T("allPlayers.tournamentsWon"), stats.tournamentWins, tournSharedAxisMax, "scale-fill-tourn-won"));
        li.appendChild(buildScaleRow(T("allPlayers.tournamentsLost"), stats.tournamentLosses, tournSharedAxisMax, "scale-fill-tourn-lost"));
      }

      if (stats.games.length) {
        li.appendChild(buildTimelineRow(stats.games, minMs, maxMs));
      }
    }

    return li;
  }

  function renderAllPlayersPage() {
    var period = allPlayersPeriodSelect.value;
    var names = getAllKnownPlayerNames();
    if (allPlayersRosterOnly) {
      var rosterNames = {};
      state.players.forEach(function (p) {
        rosterNames[p.name] = true;
      });
      names = names.filter(function (n) {
        return rosterNames[n];
      });
    }
    var stats = names.map(function (name) {
      return computePlayerCareerStats(name, period);
    });

    // The player with the most games played (maxPlayed) sets the shared
    // scale for every played/won/lost bar AND every graph's y-axis, for
    // every player shown - so equal counts always look equal and one
    // player's chart can be read against another's, instead of each
    // player silently rescaling to their own numbers. Same idea for the
    // tournament trio, off tournaments played.
    var maxPlayed = 0;
    var maxTournPlayed = 0;
    var minTs = null;
    stats.forEach(function (s) {
      maxPlayed = Math.max(maxPlayed, s.played);
      maxTournPlayed = Math.max(maxTournPlayed, s.tournamentPlayed);
      s.games.forEach(function (g) {
        if (!g.ts) return;
        if (minTs === null || g.ts < minTs) minTs = g.ts;
      });
    });

    // For a fixed period (today/week/month/6month/year), anchor the timeline
    // to that period's actual calendar span — start of the period through
    // right now — rather than just the span of games that happen to exist,
    // so "This Month" always shows the whole month, not just wherever the
    // first and last game happened to fall. "All Time" has no natural fixed
    // span, so it keeps following the actual data.
    var periodStart = periodStartDate(period);
    var minMs, maxMs;
    if (periodStart) {
      minMs = periodStart.getTime();
    } else {
      // "All Time" has no natural fixed start, so it keeps following the
      // earliest actual game.
      minMs = minTs === null ? Date.now() : new Date(minTs).getTime();
    }
    // The end of the axis is always "right now" — the moment the graph was
    // requested — for every period, All Time included, so the "Now" tick
    // and label are never stale.
    maxMs = Date.now();
    if (maxMs <= minMs) maxMs = minMs + 1;

    var playedAxisMax = axisMaxFor(maxPlayed);
    var tournPlayedAxisMax = axisMaxFor(maxTournPlayed);

    var sorted = sortAllPlayerStats(stats, allPlayersSortSelect.value);

    var liveRosterNames = {};
    state.players.forEach(function (p) {
      liveRosterNames[p.name] = true;
    });

    allPlayersList.innerHTML = "";
    if (sorted.length === 0) {
      var hint = document.createElement("li");
      hint.className = "empty-hint";
      hint.textContent = allPlayersRosterOnly
        ? T("allPlayers.noPlayersRosterOnly")
        : T("allPlayers.noPlayersYet");
      allPlayersList.appendChild(hint);
      return;
    }
    sorted.forEach(function (s) {
      allPlayersList.appendChild(
        buildAllPlayerCard(
          s,
          playedAxisMax,
          tournPlayedAxisMax,
          minMs,
          maxMs,
          period,
          !!liveRosterNames[s.name]
        )
      );
    });
  }

  function openAllPlayersPage(skipHistory) {
    if (!skipHistory) pushScreenHistory("all-players");
    renderAllPlayersPage();
    appRoot.classList.add("hidden");
    tournamentPageView.classList.add("hidden");
    playerPageView.classList.add("hidden");
    allPlayersPageView.classList.remove("hidden");
    window.scrollTo(0, 0);
  }

  function closeAllPlayersPage(skipHistory) {
    if (!skipHistory) {
      navigateBack();
      return;
    }
    allPlayersPageView.classList.add("hidden");
    appRoot.classList.remove("hidden");
  }

  // ---------------------------------------------------------------------
  // Elimination Tournament — double-elimination bracket.
  //
  // Reuses the same game type / target / "race to N wins" idea as the main
  // scoreboard for each individual match, and records every rack win into
  // the shared state.gameHistory (so it counts toward player stats and the
  // All Players graphs) — but keeps its own bracket state completely
  // separate from the main session. state.playerWins, rotation, teams and
  // milestone overlays are all main-session-only and untouched here.
  // ---------------------------------------------------------------------

  var TOURNAMENT_KEY = "poolMasterCounter.tournament.v1";

  function loadTournamentFromStorage() {
    try {
      var raw = localStorage.getItem(TOURNAMENT_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function saveTournamentToStorage(t) {
    try {
      if (t) localStorage.setItem(TOURNAMENT_KEY, JSON.stringify(t));
      else localStorage.removeItem(TOURNAMENT_KEY);
    } catch (e) {
      console.warn("Could not save tournament.", e);
    }
  }

  var TOURNAMENT = loadTournamentFromStorage();

  // History of finished brackets — separate from TOURNAMENT (the single
  // live/in-progress bracket, overwritten on every "Start New Tournament")
  // so a player's graph can show whole-tournament wins/losses over time,
  // distinct from the individual rack wins/losses already recorded via
  // recordTournamentRackWin into state.gameHistory.
  var TOURNAMENT_RESULTS_KEY = "poolMasterCounter.tournamentResults.v1";

  function loadTournamentResultsFromStorage() {
    try {
      var raw = localStorage.getItem(TOURNAMENT_RESULTS_KEY);
      var parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function saveTournamentResultsToStorage(list) {
    try {
      localStorage.setItem(TOURNAMENT_RESULTS_KEY, JSON.stringify(list));
    } catch (e) {
      console.warn("Could not save tournament results.", e);
    }
  }

  var TOURNAMENT_RESULTS = loadTournamentResultsFromStorage();

  // Called once, right when a bracket's champion is first decided — records
  // a win for the champion and a loss for every other entrant. Skipped
  // under noStatsMode, same as every other persistence path.
  function recordTournamentCompletion(t) {
    if (noStatsMode) return;
    var ts = new Date().toISOString();
    TOURNAMENT_RESULTS.unshift({
      ts: ts,
      // Round Robin can end in a tie shared by more than one champion;
      // t.championNames already holds all of them there. Bracket formats
      // only ever have a single winner.
      championNames: t.championNames || [t.champion],
      format: t.format,
      players: t.players.slice()
    });
    if (TOURNAMENT_RESULTS.length > 200) TOURNAMENT_RESULTS.length = 200;
    saveTournamentResultsToStorage(TOURNAMENT_RESULTS);
  }

  // A "race to N wins" main-scoreboard session counts as a Tournament too
  // (per how this app's players use the term). Rather than a separate
  // store (which would only start counting from whenever this shipped),
  // this derives it straight from the player's own game log: every game
  // already carries wonRace (true on exactly the rack that pushed
  // someone's count over the race target) plus winnerNames/opponentNames/
  // teammateNames, which together already tell us who else was in that
  // race — so this surfaces every race ever completed, including ones
  // from long before this feature existed. `games` is one player's own
  // games (as produced by allGamesForPlayerName/computeSessionFromGameHistory),
  // already relative to that player: g.result is "won" only when this
  // player's own side reached the target on this exact rack.
  function sessionRaceTournamentGames(games) {
    var results = [];
    games.forEach(function (g) {
      if (!g.wonRace) return;
      results.push({
        ts: g.ts,
        result: g.result,
        opponentNames: (g.teammateNames || []).concat(g.opponentNames || []),
        gameLabel: "Race-to Session"
      });
    });
    return results;
  }

  // One pseudo-"game" per completed bracket Tournament this player
  // entered, shaped enough like a real game (ts/result/opponentNames/
  // gameLabel) to reuse filterGamesByPeriod and the graph's bucketing
  // helpers, but plotted as its own series in buildPlayerGraph rather
  // than mixed into single-game counts. Race-to-N session results are
  // handled separately by sessionRaceTournamentGames above — a stray
  // "session-race" entry can exist here from an earlier version of this
  // feature that wrote both to the same store; skipped to avoid double-
  // counting anyone who already triggered that code path.
  function tournamentGamesForPlayerName(name) {
    var games = [];
    TOURNAMENT_RESULTS.forEach(function (r) {
      if (r.format === "session-race") return;
      if ((r.players || []).indexOf(name) === -1) return;
      games.push({
        ts: r.ts,
        result: (r.championNames || []).indexOf(name) !== -1 ? "won" : "lost",
        opponentNames: r.players.filter(function (n) {
          return n !== name;
        }),
        gameLabel: "Tournament"
      });
    });
    return games;
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

  function createBracketMatch(a, b, tag) {
    return { id: uid(), a: a || null, b: b || null, winner: null, loser: null, tag: tag, collected: false };
  }

  function pairUpNames(names, tag) {
    var matches = [];
    var i = 0;
    while (i + 1 < names.length) {
      matches.push(createBracketMatch(names[i], names[i + 1], tag));
      i += 2;
    }
    var leftover = i < names.length ? [names[i]] : [];
    return { matches: matches, leftover: leftover };
  }

  function wbRoundComplete(t, ri) {
    return t.wb[ri].every(function (m) {
      return m.winner !== null;
    });
  }

  function pendingWbMatches(t) {
    var out = [];
    t.wb.forEach(function (rnd) {
      rnd.forEach(function (m) {
        if (m.a !== null && m.b !== null && m.winner === null) out.push(m);
      });
    });
    return out;
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

  function pendingGfMatches(t) {
    return t.grandFinal.filter(function (m) {
      return m.a !== null && m.b !== null && m.winner === null;
    });
  }

  function pendingRrMatches(t) {
    return t.matches.filter(function (m) {
      return m.a !== null && m.b !== null && m.winner === null;
    });
  }

  function pendingBracketMatches(t) {
    if (t.format === "roundrobin") return pendingRrMatches(t);
    return pendingWbMatches(t).concat(pendingLbMatches(t), pendingGfMatches(t));
  }

  function findBracketMatchById(t, id) {
    var all = [];
    if (t.format === "roundrobin") {
      all = t.matches;
    } else {
      t.wb.forEach(function (r) {
        all = all.concat(r);
      });
      t.lbRounds.forEach(function (r) {
        all = all.concat(r);
      });
      all = all.concat(t.grandFinal);
    }
    for (var i = 0; i < all.length; i++) {
      if (all[i].id === id) return all[i];
    }
    return null;
  }

  // Propagates every decided result through the bracket: winners advance to
  // their next winners-bracket slot, losers drop into the losers bracket in
  // the standard alternating pattern (a round pairing fresh drop-ins against
  // losers-bracket survivors, then a round consolidating those survivors
  // among themselves before the next winners-bracket round's losers arrive),
  // and sets up the grand final once both bracket champions are known.
  function advanceBracket(t) {
    var changed = true;
    while (changed) {
      changed = false;

      t.wb.forEach(function (rnd, ri) {
        rnd.forEach(function (m, mi) {
          if (m.winner !== null && !m.collected) {
            m.collected = true;
            changed = true;
            if (ri + 1 < t.wb.length) {
              var nxt = t.wb[ri + 1][Math.floor(mi / 2)];
              if (mi % 2 === 0) nxt.a = m.winner;
              else nxt.b = m.winner;
            } else {
              t.wbChampion = m.winner;
            }
          }
        });
      });

      while (t.lbNextWbRoundToDrop < t.wb.length && wbRoundComplete(t, t.lbNextWbRoundToDrop)) {
        var ri2 = t.lbNextWbRoundToDrop;
        var losers = t.wb[ri2]
          .map(function (m) {
            return m.loser;
          })
          .filter(function (x) {
            return x !== null;
          });
        t.lbNextWbRoundToDrop += 1;
        changed = true;
        if (ri2 === 0) {
          var res = pairUpNames(losers, "Losers R1");
          if (res.matches.length) t.lbRounds.push(res.matches);
          t.lbWaiting = t.lbWaiting.concat(res.leftover);
        } else {
          var matches2 = [];
          var newWaiting = [];
          var li = 0;
          var wi = 0;
          var waiting = t.lbWaiting;
          while (li < losers.length || wi < waiting.length) {
            if (wi < waiting.length && li < losers.length) {
              matches2.push(createBracketMatch(waiting[wi], losers[li], "Losers"));
              wi += 1;
              li += 1;
            } else if (wi < waiting.length) {
              newWaiting.push(waiting[wi]);
              wi += 1;
            } else {
              newWaiting.push(losers[li]);
              li += 1;
            }
          }
          if (matches2.length) t.lbRounds.push(matches2);
          t.lbWaiting = newWaiting;
        }
      }

      t.lbRounds.forEach(function (rnd) {
        rnd.forEach(function (m) {
          if (m.winner !== null && !m.collected) {
            m.collected = true;
            t.lbWaiting.push(m.winner);
            changed = true;
          }
        });
      });

      if (t.lbWaiting.length >= 2) {
        var moreWbPending = t.lbNextWbRoundToDrop < t.wb.length;
        if (!moreWbPending || !wbRoundComplete(t, t.lbNextWbRoundToDrop)) {
          var res2 = pairUpNames(t.lbWaiting, "Losers");
          if (res2.matches.length) {
            t.lbRounds.push(res2.matches);
            t.lbWaiting = res2.leftover;
            changed = true;
          }
        }
      }

      if (
        t.lbChampion === null &&
        t.lbNextWbRoundToDrop >= t.wb.length &&
        pendingLbMatches(t).length === 0 &&
        t.lbWaiting.length === 1
      ) {
        t.lbChampion = t.lbWaiting[0];
        changed = true;
      }

      if (t.wbChampion && t.lbChampion && t.grandFinal.length === 0) {
        t.grandFinal.push(createBracketMatch(t.wbChampion, t.lbChampion, "Grand Final"));
        changed = true;
      }
    }

    // Single elimination has no losers bracket or grand final — the
    // winners-bracket champion is the tournament champion outright.
    if (t.format === "single" && t.wbChampion && !t.champion) {
      t.champion = t.wbChampion;
    }
  }

  // Shuffles the field and builds the empty winners-bracket rounds shared
  // by both tournament formats — round 1 seeded with the standard spread
  // (1v4/2v3, etc.) so byes land spread across the draw, every later round
  // starting empty until winners advance into it.
  function buildWinnersBracketRounds(playerNames) {
    var shuffled = playerNames.slice();
    for (var i = shuffled.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = shuffled[i];
      shuffled[i] = shuffled[j];
      shuffled[j] = tmp;
    }
    var n = shuffled.length;
    var size = nextPow2(n);
    var order = seedOrder(size);
    var slots = order.map(function (s) {
      return s <= n ? shuffled[s - 1] : null;
    });

    var wb = [];
    var r1 = [];
    for (var k = 0; k < size; k += 2) {
      r1.push(createBracketMatch(slots[k], slots[k + 1], "Winners R1"));
    }
    wb.push(r1);
    var nrounds = Math.round(Math.log(size) / Math.log(2));
    for (var r = 1; r < nrounds; r++) {
      var prev = wb[wb.length - 1];
      var cur = [];
      for (var m = 0; m < prev.length / 2; m++) {
        cur.push(createBracketMatch(null, null, "Winners R" + (r + 1)));
      }
      wb.push(cur);
    }

    // Round-1 byes are structural (a slot was never filled because there
    // weren't enough real players) — resolve them once, explicitly, here.
    // Every other empty slot elsewhere in the bracket just means "not
    // decided yet" and must never be treated as a bye.
    wb[0].forEach(function (m) {
      if ((m.a === null) !== (m.b === null)) {
        m.winner = m.a !== null ? m.a : m.b;
        m.loser = null;
      }
    });

    return { shuffled: shuffled, size: size, wb: wb };
  }

  function buildDoubleEliminationBracket(playerNames, gameType, target, raceTo) {
    var built = buildWinnersBracketRounds(playerNames);
    var t = {
      format: "double",
      createdAt: new Date().toISOString(),
      gameType: gameType,
      target: target,
      raceTo: raceTo,
      players: built.shuffled,
      size: built.size,
      wb: built.wb,
      lbRounds: [],
      lbWaiting: [],
      lbNextWbRoundToDrop: 0,
      wbChampion: null,
      lbChampion: null,
      grandFinal: [],
      champion: null,
      active: null
    };
    advanceBracket(t);
    return t;
  }

  // Single elimination: same winners-bracket shape as double elimination,
  // but there's no losers bracket to drop into (lbNextWbRoundToDrop starts
  // past the last round, so the losers-bracket logic in advanceBracket
  // never fires) and no grand final — the winners-bracket champion is the
  // tournament champion outright.
  function buildSingleEliminationBracket(playerNames, gameType, target, raceTo) {
    var built = buildWinnersBracketRounds(playerNames);
    var t = {
      format: "single",
      createdAt: new Date().toISOString(),
      gameType: gameType,
      target: target,
      raceTo: raceTo,
      players: built.shuffled,
      size: built.size,
      wb: built.wb,
      lbRounds: [],
      lbWaiting: [],
      lbNextWbRoundToDrop: built.wb.length,
      wbChampion: null,
      lbChampion: null,
      grandFinal: [],
      champion: null,
      active: null
    };
    advanceBracket(t);
    return t;
  }

  // Round Robin: no bracket tree at all — every player plays every other
  // player exactly once (shuffled match order only, since there's no
  // seeding to speak of), and the champion is decided once every match
  // has a result — see finalizeRoundRobinIfComplete.
  function buildRoundRobinTournament(playerNames, gameType, target, raceTo) {
    var shuffled = playerNames.slice();
    for (var i = shuffled.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = shuffled[i];
      shuffled[i] = shuffled[j];
      shuffled[j] = tmp;
    }
    var matches = [];
    for (var a = 0; a < shuffled.length; a++) {
      for (var b = a + 1; b < shuffled.length; b++) {
        matches.push(createBracketMatch(shuffled[a], shuffled[b], "Round Robin"));
      }
    }
    return {
      format: "roundrobin",
      createdAt: new Date().toISOString(),
      gameType: gameType,
      target: target,
      raceTo: raceTo,
      players: shuffled,
      matches: matches,
      champion: null,
      championNames: null,
      active: null
    };
  }

  // Ranks every entrant by match wins (most first, name as a stable
  // tiebreaker for display order only — a true tie in wins is reflected
  // by championNames holding more than one name, not by this ordering).
  function roundRobinStandings(t) {
    var wins = {};
    var played = {};
    t.players.forEach(function (name) {
      wins[name] = 0;
      played[name] = 0;
    });
    t.matches.forEach(function (m) {
      if (m.winner === null) return;
      wins[m.winner] = (wins[m.winner] || 0) + 1;
      played[m.a] = (played[m.a] || 0) + 1;
      played[m.b] = (played[m.b] || 0) + 1;
    });
    return t.players
      .slice()
      .sort(function (x, y) {
        return (wins[y] || 0) - (wins[x] || 0) || x.localeCompare(y);
      })
      .map(function (name) {
        return { name: name, wins: wins[name] || 0, played: played[name] || 0 };
      });
  }

  // Once every round-robin match has a result, the champion is whoever
  // has the most match wins — a tie at the top makes every tied player a
  // champion (championNames holds all of them; TOURNAMENT_RESULTS
  // already supports multiple simultaneous winners for team wins, so
  // this reuses that instead of picking an arbitrary tiebreaker).
  function finalizeRoundRobinIfComplete(t) {
    var allDecided = t.matches.every(function (m) {
      return m.winner !== null;
    });
    if (!allDecided) return;
    var standings = roundRobinStandings(t);
    var topWins = standings[0].wins;
    var champions = standings
      .filter(function (s) {
        return s.wins === topWins;
      })
      .map(function (s) {
        return s.name;
      });
    t.championNames = champions;
    t.champion = champions.join(" & ");
  }

  function isGrandFinalMatch(t, match) {
    return t.grandFinal.indexOf(match) !== -1;
  }

  function reportBracketResult(t, match, winnerName) {
    if (match.a !== winnerName && match.b !== winnerName) return;
    match.winner = winnerName;
    match.loser = match.a === winnerName ? match.b : match.a;
    if (t.format === "roundrobin") {
      finalizeRoundRobinIfComplete(t);
      return;
    }
    if (isGrandFinalMatch(t, match)) {
      if (winnerName === t.wbChampion) {
        t.champion = winnerName;
      } else if (t.grandFinal.length === 1) {
        // The losers-bracket champion beat the winners-bracket champion,
        // who has only lost once — double elimination means they get a
        // second grand final to decide it.
        t.grandFinal.push(createBracketMatch(t.grandFinal[0].a, t.grandFinal[0].b, "Grand Final (bracket reset)"));
      } else {
        t.champion = winnerName;
      }
      return;
    }
    advanceBracket(t);
  }

  function recordTournamentRackWin(winnerName, loserName, durationMs) {
    var typeLabel = GAME_TYPES[TOURNAMENT.gameType] ? GAME_TYPES[TOURNAMENT.gameType].label : TOURNAMENT.gameType;
    var ts = new Date().toISOString();
    state.gameHistory.unshift({
      ts: ts,
      gameType: TOURNAMENT.gameType,
      gameLabel: typeLabel,
      target: TOURNAMENT.target,
      winnerNames: [winnerName],
      opponentNames: [loserName],
      isTeam: false,
      mvpId: null,
      mvpName: null,
      durationMs: durationMs,
      summary: winnerName + " won " + typeLabel + " (tournament vs " + loserName + ")"
    });
    if (state.gameHistory.length > 200) state.gameHistory.length = 200;
    applyPairwiseRatingResult(winnerName, loserName, ts);
    saveRatingsToStorage(PLAYER_RATINGS);
    saveState();
  }

  function renderTournamentPlayerChecklist() {
    var names = getAllKnownPlayerNames().sort(function (a, b) {
      return a.localeCompare(b);
    });
    var activeNames = {};
    activePlayers().forEach(function (p) {
      activeNames[p.name] = true;
    });
    tournamentPlayerChecklist.innerHTML = "";
    if (names.length === 0) {
      var hint = document.createElement("li");
      hint.className = "empty-hint";
      hint.textContent = T("tournament.addPlayersFirst");
      tournamentPlayerChecklist.appendChild(hint);
      return;
    }
    names.forEach(function (name) {
      var li = document.createElement("li");
      li.className = "tournament-player-check-row";
      var label = document.createElement("label");
      var checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = name;
      checkbox.checked = !!activeNames[name];
      var span = document.createElement("span");
      span.textContent = name;
      span.appendChild(buildRatingBadge(name));
      label.appendChild(checkbox);
      label.appendChild(span);
      li.appendChild(label);
      tournamentPlayerChecklist.appendChild(li);
    });
  }

  function getCheckedTournamentPlayers() {
    return Array.prototype.slice
      .call(tournamentPlayerChecklist.querySelectorAll('input[type="checkbox"]:checked'))
      .map(function (cb) {
        return cb.value;
      });
  }

  function startTournament() {
    var names = getCheckedTournamentPlayers();
    if (names.length < 2) {
      alertModal(T("alert.pickAtLeast2Players"));
      return;
    }
    var gameType = tournamentGameTypeSelect.value;
    var target = parseInt(tournamentTargetInput.value, 10) || GAME_TYPES[gameType].defaultTarget;
    var raceTo = parseInt(tournamentRaceToInput.value, 10) || 1;
    var format = Array.prototype.filter.call(tournamentFormatRadios, function (r) {
      return r.checked;
    })[0].value;
    if (format === "roundrobin") {
      TOURNAMENT = buildRoundRobinTournament(names, gameType, target, raceTo);
    } else if (format === "single") {
      TOURNAMENT = buildSingleEliminationBracket(names, gameType, target, raceTo);
    } else {
      TOURNAMENT = buildDoubleEliminationBracket(names, gameType, target, raceTo);
    }
    saveTournamentToStorage(TOURNAMENT);
    renderTournamentPage();
  }

  function abandonTournament() {
    var isDone = TOURNAMENT && TOURNAMENT.champion;
    var clear = function () {
      if (TOURNAMENT) {
        saveResetSnapshot("tournament", T("resetSnapshot.tournamentLabel"), {
          tournament: JSON.parse(JSON.stringify(TOURNAMENT))
        });
      }
      TOURNAMENT = null;
      saveTournamentToStorage(null);
      renderTournamentPage();
      renderRecoverDataList();
    };
    if (isDone) {
      clear();
    } else {
      confirmModal(T("confirm.abandonTournament"), clear);
    }
  }

  function tournamentMatchCard(match, activeMatchId) {
    var div = document.createElement("div");
    var isActive = activeMatchId === match.id;
    var stateClass = match.winner ? "is-done" : isActive ? "is-active" : match.a && match.b ? "is-ready" : "is-pending";
    div.className = "tournament-match-card " + stateClass;

    [match.a, match.b].forEach(function (name) {
      var row = document.createElement("div");
      row.className = "tournament-match-side";
      var isWinner = match.winner && name === match.winner;
      if (isWinner) row.classList.add("is-winner");
      if (match.winner && name === match.loser) row.classList.add("is-loser");
      row.textContent = (isWinner ? "👑 " : "") + (name || "—");
      if (name) {
        row.appendChild(buildRatingBadge(name));
        row.appendChild(buildPlayerLinkIcon(name));
      }
      div.appendChild(row);
    });

    if (isActive) {
      var playingNote = document.createElement("div");
      playingNote.className = "tournament-playing-note";
      playingNote.textContent = T("tournament.playingNow");
      div.appendChild(playingNote);
    } else if (match.a && match.b && !match.winner) {
      var playBtn = document.createElement("button");
      playBtn.type = "button";
      playBtn.className = "btn btn-primary tournament-play-btn";
      playBtn.textContent = T("tournament.play");
      playBtn.addEventListener("click", function () {
        startTournamentMatch(match.id);
      });
      div.appendChild(playBtn);
    }

    return div;
  }

  // Renders the winners bracket as a real horizontal tree: round 1 on the
  // left, each pair of matches converging into the match they feed, all the
  // way to the final on the right. Built as nested "children + this round's
  // match" wrappers rather than flat columns — the connector lines are then
  // pure CSS (percentages against each pair's own wrapper), needing no
  // pixel measurement, because a 2-item "space-around" column always places
  // its items at exactly 25%/75% of the wrapper's height regardless of the
  // wrapper's actual size.
  function renderWbTreeNode(t, ri, mi, activeMatchId) {
    var match = t.wb[ri][mi];
    var card = tournamentMatchCard(match, activeMatchId);
    if (ri === 0) {
      card.classList.add("wb-tree-leaf");
      return card;
    }
    var childrenWrap = document.createElement("div");
    childrenWrap.className = "wb-tree-children";
    childrenWrap.appendChild(renderWbTreeNode(t, ri - 1, mi * 2, activeMatchId));
    childrenWrap.appendChild(renderWbTreeNode(t, ri - 1, mi * 2 + 1, activeMatchId));

    var node = document.createElement("div");
    node.className = "wb-tree-node";
    node.appendChild(childrenWrap);
    node.appendChild(card);
    return node;
  }

  function renderWbTree(container, t, activeMatchId) {
    container.innerHTML = "";
    var lastRound = t.wb.length - 1;
    var root = renderWbTreeNode(t, lastRound, 0, activeMatchId);
    root.classList.add("wb-tree-root");
    container.appendChild(root);
  }

  function renderBracketColumns(container, rounds, activeMatchId) {
    container.innerHTML = "";
    if (!rounds.length) {
      var hint = document.createElement("p");
      hint.className = "empty-hint";
      hint.textContent = "—";
      container.appendChild(hint);
      return;
    }
    rounds.forEach(function (round, i) {
      var col = document.createElement("div");
      col.className = "tournament-round-col";
      var heading = document.createElement("div");
      heading.className = "tournament-round-heading";
      heading.textContent = round.length ? round[0].tag : "Round " + (i + 1);
      col.appendChild(heading);
      round.forEach(function (m) {
        col.appendChild(tournamentMatchCard(m, activeMatchId));
      });
      container.appendChild(col);
    });
  }

  function startTournamentMatch(matchId) {
    var match = findBracketMatchById(TOURNAMENT, matchId);
    if (!match || match.winner) return;
    TOURNAMENT.active = {
      matchId: matchId,
      aBalls: 0,
      bBalls: 0,
      aWins: 0,
      bWins: 0,
      startedAt: new Date().toISOString()
    };
    saveTournamentToStorage(TOURNAMENT);
    renderTournamentActive();
  }

  function tournamentAdjustScore(side, delta) {
    var t = TOURNAMENT;
    if (!t || !t.active) return;
    var match = findBracketMatchById(t, t.active.matchId);
    if (!match) return;
    var gameType = GAME_TYPES[t.gameType];
    var allowNegative = gameType.unit !== "rack";
    var ballsKey = side === "a" ? "aBalls" : "bBalls";
    var winsKey = side === "a" ? "aWins" : "bWins";
    var next = (t.active[ballsKey] || 0) + delta;
    if (next < 0 && !allowNegative) next = 0;
    t.active[ballsKey] = next;

    var name = side === "a" ? match.a : match.b;
    var otherName = side === "a" ? match.b : match.a;
    var player = getPlayer(getPlayerIdByName(name));
    var voice = player ? player.voice : undefined;

    if (delta > 0 && next >= t.target) {
      t.active[winsKey] += 1;
      var startedMs = t.active.startedAt ? new Date(t.active.startedAt).getTime() : null;
      var durationMs = startedMs ? Math.max(0, Date.now() - startedMs) : null;
      recordTournamentRackWin(name, otherName, durationMs);
      t.active.aBalls = 0;
      t.active.bBalls = 0;
      t.active.startedAt = new Date().toISOString();
      playWinSound(voice);
      if (t.active[winsKey] >= t.raceTo) {
        var championAlreadyDecided = !!t.champion;
        reportBracketResult(t, match, name);
        if (!championAlreadyDecided && t.champion) {
          recordTournamentCompletion(t);
          playTournamentChampionSound();
        }
        t.active = null;
        saveTournamentToStorage(t);
        renderTournamentPage();
        return;
      }
    } else if (delta > 0) {
      playPositiveSound(voice);
    } else {
      playNegativeSound(voice);
    }
    saveTournamentToStorage(t);
    renderTournamentActiveMatch();
  }

  function buildTournamentSidePanel(name, side, balls, wins, t) {
    var panel = document.createElement("div");
    panel.className = "player-panel";

    var nameEl = document.createElement("div");
    nameEl.className = "player-name";
    nameEl.textContent = name;
    nameEl.appendChild(buildRatingBadge(name));
    nameEl.appendChild(buildPlayerLinkIcon(name));
    panel.appendChild(nameEl);

    panel.appendChild(buildStatMini(T("tournament.matchWins"), wins, wins >= t.raceTo));

    var block = document.createElement("div");
    block.className = "stat-block";
    var label = document.createElement("div");
    label.className = "stat-label";
    label.textContent = T("scoreboard.gameTargetLabel", { game: GAME_TYPES[t.gameType].label, target: t.target });
    var value = document.createElement("div");
    value.className = "stat-value";
    value.textContent = balls;
    block.appendChild(label);
    block.appendChild(value);
    panel.appendChild(block);

    var controls = document.createElement("div");
    controls.className = "ball-controls";
    var unit = GAME_TYPES[t.gameType].unit;
    var allowNegative = unit !== "rack";

    var minusBtn = document.createElement("button");
    minusBtn.type = "button";
    minusBtn.className = "btn-ball minus";
    minusBtn.textContent = "−";
    minusBtn.setAttribute("aria-label", "Remove point for " + name);
    minusBtn.disabled = !allowNegative && balls <= 0;
    minusBtn.addEventListener("click", function () {
      tournamentAdjustScore(side, -1);
    });

    var plusBtn = document.createElement("button");
    plusBtn.type = "button";
    plusBtn.className = "btn-ball plus";
    plusBtn.textContent = "+";
    plusBtn.setAttribute("aria-label", "Add point for " + name);
    plusBtn.addEventListener("click", function () {
      tournamentAdjustScore(side, 1);
    });

    controls.appendChild(minusBtn);
    controls.appendChild(plusBtn);
    panel.appendChild(controls);

    return panel;
  }

  function renderTournamentActiveMatch() {
    var t = TOURNAMENT;
    tournamentCurrentMatchPanel.innerHTML = "";
    if (!t || !t.active) return;
    var match = findBracketMatchById(t, t.active.matchId);
    if (!match) {
      t.active = null;
      return;
    }
    var gameType = GAME_TYPES[t.gameType];

    var banner = document.createElement("div");
    banner.className = "now-playing-banner tournament-now-playing";
    banner.textContent = gameType.label + " — " + match.tag;
    tournamentCurrentMatchPanel.appendChild(banner);

    var board = document.createElement("div");
    board.className = "scoreboard";
    board.appendChild(buildTournamentSidePanel(match.a, "a", t.active.aBalls, t.active.aWins, t));
    board.appendChild(buildTournamentSidePanel(match.b, "b", t.active.bBalls, t.active.bWins, t));
    tournamentCurrentMatchPanel.appendChild(board);
  }

  // Standings ranked by match wins (most first); the name is only a
  // stable sort key for display order — a genuine tie in wins is
  // reflected by t.championNames holding more than one name once the
  // round robin is complete, not by anything in this ordering.
  function roundRobinStandingsRow(s, t) {
    var li = document.createElement("li");
    var isChampion = t.championNames && t.championNames.indexOf(s.name) !== -1;
    li.className = "tournament-rr-standings-row" + (isChampion ? " is-champion" : "");
    var name = document.createElement("span");
    name.className = "tournament-rr-standings-name";
    name.textContent = (isChampion ? "👑 " : "") + s.name;
    name.appendChild(buildRatingBadge(s.name));
    name.appendChild(buildPlayerLinkIcon(s.name));
    var record = document.createElement("span");
    record.className = "tournament-rr-standings-record";
    record.textContent = s.wins + " win" + (s.wins === 1 ? "" : "s") + " / " + s.played + " played";
    li.appendChild(name);
    li.appendChild(record);
    return li;
  }

  // Round Robin has no bracket tree to render, so it gets its own board:
  // a live standings list (ranked by match wins) plus every match as a
  // card (reusing tournamentMatchCard, which already renders pending/
  // active/done states generically) — unlike the bracket formats, this
  // shows every match at once since round robin has no round-by-round
  // progression gating which ones are "ready."
  function renderRoundRobinBoard(t, activeMatchId) {
    tournamentRrStandingsEl.innerHTML = "";
    roundRobinStandings(t).forEach(function (s) {
      tournamentRrStandingsEl.appendChild(roundRobinStandingsRow(s, t));
    });

    tournamentRrMatchesEl.innerHTML = "";
    t.matches.forEach(function (m) {
      tournamentRrMatchesEl.appendChild(tournamentMatchCard(m, activeMatchId));
    });
  }

  function renderTournamentActive() {
    var t = TOURNAMENT;
    var activeMatchId = t.active ? t.active.matchId : null;
    var isSingle = t.format === "single";
    var isRoundRobin = t.format === "roundrobin";

    tournamentWbSection.classList.toggle("hidden", isRoundRobin);
    tournamentLbSection.classList.toggle("hidden", isRoundRobin || isSingle);
    tournamentGfSection.classList.toggle("hidden", isRoundRobin || isSingle);
    tournamentRrSection.classList.toggle("hidden", !isRoundRobin);

    if (isRoundRobin) {
      renderRoundRobinBoard(t, activeMatchId);
    } else {
      renderWbTree(tournamentWbEl, t, activeMatchId);
      if (!isSingle) {
        renderBracketColumns(tournamentLbEl, t.lbRounds, activeMatchId);
        renderBracketColumns(tournamentGfEl, t.grandFinal.length ? [t.grandFinal] : [], activeMatchId);
      }
    }

    btnTournamentAbandon.textContent = T(t.champion ? "tournament.startNew" : "tournament.abandon");

    if (t.champion) {
      tournamentChampionBanner.classList.remove("hidden");
      var multipleChampions = !!(t.championNames && t.championNames.length > 1);
      tournamentChampionBanner.textContent =
        T(multipleChampions ? "tournament.tiedForTheWin" : "tournament.wonTheTournament", { champion: t.champion });
      (t.championNames || [t.champion]).forEach(function (name) {
        tournamentChampionBanner.appendChild(buildRatingBadge(name));
      });
    } else {
      tournamentChampionBanner.classList.add("hidden");
      tournamentChampionBanner.textContent = "";
    }

    tournamentReadyList.innerHTML = "";
    tournamentCurrentMatchPanel.innerHTML = "";

    if (t.active) {
      renderTournamentActiveMatch();
      return;
    }
    if (t.champion) return;

    var ready = pendingBracketMatches(t);
    if (ready.length === 0) return;
    if (ready.length === 1) {
      startTournamentMatch(ready[0].id);
      return;
    }
    // Round Robin's Matches grid above already shows every pending match
    // with its own Play button — no need for a second "ready" list too.
    if (isRoundRobin) return;
    var heading = document.createElement("li");
    heading.className = "tournament-ready-heading";
    heading.textContent = T("tournament.readyToPlay", { count: ready.length });
    tournamentReadyList.appendChild(heading);
    ready.forEach(function (m) {
      var li = document.createElement("li");
      li.className = "tournament-ready-row";
      var text = document.createElement("span");
      text.appendChild(document.createTextNode(m.a));
      text.appendChild(buildRatingBadge(m.a));
      text.appendChild(document.createTextNode(" vs " + m.b));
      text.appendChild(buildRatingBadge(m.b));
      text.appendChild(document.createTextNode(" (" + m.tag + ")"));
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-primary";
      btn.textContent = T("tournament.play");
      btn.addEventListener("click", function () {
        startTournamentMatch(m.id);
      });
      li.appendChild(text);
      li.appendChild(btn);
      tournamentReadyList.appendChild(li);
    });
  }

  function renderTournamentPage() {
    if (TOURNAMENT) {
      tournamentSetupPanel.classList.add("hidden");
      tournamentActivePanel.classList.remove("hidden");
      renderTournamentActive();
    } else {
      tournamentActivePanel.classList.add("hidden");
      tournamentSetupPanel.classList.remove("hidden");
      renderTournamentPlayerChecklist();
      tournamentTargetUnit.textContent = GAME_TYPES[tournamentGameTypeSelect.value].unit;
    }
  }

  function openTournamentPage(skipHistory) {
    if (!skipHistory) pushScreenHistory("tournament");
    renderTournamentPage();
    appRoot.classList.add("hidden");
    allPlayersPageView.classList.add("hidden");
    playerPageView.classList.add("hidden");
    tournamentPageView.classList.remove("hidden");
    window.scrollTo(0, 0);
  }

  function closeTournamentPage(skipHistory) {
    if (!skipHistory) {
      navigateBack();
      return;
    }
    tournamentPageView.classList.add("hidden");
    appRoot.classList.remove("hidden");
  }

  // Combines two session records for the SAME calendar date. Games are
  // unioned by timestamp (so a game saved in both — e.g. by two separate
  // exports, or two devices' backups — counts once, not twice), and the
  // summary fields are rebuilt from that merged list so they stay accurate.
  function mergeTwoSessionsForSameDate(a, b) {
    var seen = {};
    var mergedGames = [];
    (a.games || []).concat(b.games || []).forEach(function (g) {
      if (!g || !g.ts || seen[g.ts]) return;
      seen[g.ts] = true;
      mergedGames.push(g);
    });
    mergedGames.sort(function (x, y) {
      return x.ts.localeCompare(y.ts);
    });
    var gamesWon = [];
    var opponentSet = {};
    var wins = 0;
    mergedGames.forEach(function (g) {
      if (g.result === "won") {
        wins += 1;
        gamesWon.push(g.gameLabel);
      }
      (g.opponentNames || []).forEach(function (n) {
        opponentSet[n] = true;
      });
    });
    return {
      date: a.date,
      wins: wins,
      gamesWon: gamesWon,
      opponents: Object.keys(opponentSet),
      games: mergedGames,
      wonTournament: !!(a.wonTournament || b.wonTournament)
    };
  }

  // Merges two full session lists (e.g. one player's locally-saved history
  // with the same player's history from an imported backup), combining any
  // sessions that land on the same date instead of one replacing the other.
  function mergeSessionLists(listA, listB) {
    var byDate = {};
    var order = [];
    (listA || []).concat(listB || []).forEach(function (s) {
      if (!s || !s.date) return;
      if (byDate[s.date]) {
        byDate[s.date] = mergeTwoSessionsForSameDate(byDate[s.date], s);
      } else {
        byDate[s.date] = s;
        order.push(s.date);
      }
    });
    return order.map(function (d) {
      return byDate[d];
    });
  }

  function mergeSessionIntoList(sessions, live) {
    return mergeSessionLists(sessions, [live]);
  }

  function exportAllPlayerStats() {
    if (noStatsMode) return;
    state.players.forEach(function (p) {
      var live = computeLiveSessionForPlayer(p.name);
      if (!live || !live.games || live.games.length === 0) return;
      var sessions = mergeSessionIntoList(getPlayerSessions(p.name), live);
      setPlayerSessions(p.name, sessions);
      if (p.name === currentStatsPlayerName) currentStatsSessions = sessions;
    });
  }

  function exportCurrentPlayerStats() {
    var name = currentStatsPlayerName;
    if (!name) return;
    if (noStatsMode) {
      showToast(T("toast.noStatsModeNothingSaved"));
      return;
    }
    var live = computeLiveSessionForPlayer(name);
    var sessions = mergeSessionIntoList(currentStatsSessions || [], live);
    currentStatsSessions = sessions;
    setPlayerSessions(name, sessions);
    renderPlayerHistoryList(sessions);
    renderPlayerSynopsis();
    showToast(T("toast.statsSaved", { name: name }));
  }

  function resetPlayerHistoricalStats() {
    var name = currentStatsPlayerName;
    if (!name) return;
    confirmModal(T("confirm.resetPlayerStats", { name: name }), function () {
      saveResetSnapshot("playerStats", T("resetSnapshot.playerStatsLabel", { name: name }), {
        name: name,
        sessions: JSON.parse(JSON.stringify(getPlayerSessions(name)))
      });
      currentStatsSessions = [];
      setPlayerSessions(name, []);
      renderPlayerHistoryList([]);
      renderPlayerSynopsis();
      renderRecoverDataList();
    });
  }

  // ---------------------------------------------------------------------
  // Events + Init (deferred until settings/game-types.json has loaded)
  // ---------------------------------------------------------------------

  function boot() {
  backfillMissingRatingsFromHistory();
  backfillMissingAddedDates();

  btnExportAllData.addEventListener("click", exportAllData);

  btnImportAllData.addEventListener("click", function () {
    importFileInput.click();
  });

  importFileInput.addEventListener("change", function () {
    var file = importFileInput.files && importFileInput.files[0];
    importFileInput.value = "";
    if (!file) return;
    importAllData(file);
  });

  btnResetAllPlayerStats.addEventListener("click", resetAllPlayerStats);
  btnResetRosterLists.addEventListener("click", resetAllRosterLists);
  btnResetAllRatings.addEventListener("click", resetAllPlayersOfficialRating);
  btnResetSessionTournament.addEventListener("click", resetSessionAndTournament);

  btnRecoverImportFile.addEventListener("click", function () {
    recoverImportFileInput.click();
  });
  recoverImportFileInput.addEventListener("change", function () {
    var file = recoverImportFileInput.files && recoverImportFileInput.files[0];
    recoverImportFileInput.value = "";
    if (!file) return;
    importFileForRecovery(file);
  });
  btnRecoverRestore.addEventListener("click", restoreCheckedFromSnapshot);
  btnRecoverCancel.addEventListener("click", closeRecoverDetail);
  recoverDetailOverlay.addEventListener("click", function (e) {
    if (e.target === recoverDetailOverlay) closeRecoverDetail();
  });

  btnRatingEditSave.addEventListener("click", saveRatingEditPopup);
  btnRatingEditCancel.addEventListener("click", closeRatingEditPopup);
  ratingEditOverlay.addEventListener("click", function (e) {
    if (e.target === ratingEditOverlay) closeRatingEditPopup();
  });

  btnExportRosterLists.addEventListener("click", exportRosterLists);

  btnImportRosterLists.addEventListener("click", function () {
    importRosterListsFileInput.click();
  });

  importRosterListsFileInput.addEventListener("change", function () {
    var file = importRosterListsFileInput.files && importRosterListsFileInput.files[0];
    importRosterListsFileInput.value = "";
    if (!file) return;
    importRosterListsFile(file);
  });

  newPlayerName.addEventListener("input", validateNewPlayerNameInput);

  addPlayerForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var trimmed = newPlayerName.value.trim();
    if (!trimmed || isDuplicatePlayerName(trimmed)) {
      validateNewPlayerNameInput();
      return;
    }
    var starting = parseStartingRatingInput(newPlayerRatingInput);
    var alreadyRated = starting !== null && !!findRatingKey(resolvePlayerName(trimmed));
    var player = addPlayer(newPlayerName.value, starting === null ? undefined : starting);
    if (!player) return;
    newPlayerName.value = "";
    newPlayerRatingInput.value = "";
    validateNewPlayerNameInput();
    renderAll();
    if (alreadyRated) showToast(player.name + " already has a tracked rating — starting rating not applied.");
  });

  gameTypeSelect.addEventListener("change", function () {
    var type = GAME_TYPES[gameTypeSelect.value];
    state.currentGame.gameType = gameTypeSelect.value;
    state.currentGame.target = type.defaultTarget;
    state.currentGame.unit = type.unit;
    gameTargetInput.value = type.defaultTarget;
    gameTargetUnitSelect.value = type.unit;
    saveState();
    renderScoreboard();
    updateCurrentGameSummary();
  });

  gameTargetInput.addEventListener("input", function () {
    var target = parseInt(gameTargetInput.value, 10);
    if (!target || target < 1) return;
    state.currentGame.target = target;
    saveState();
    renderScoreboard();
    updateCurrentGameSummary();
  });

  gameTargetUnitSelect.addEventListener("change", function () {
    state.currentGame.unit = gameTargetUnitSelect.value;
    saveState();
    renderScoreboard();
    updateCurrentGameSummary();
  });

  Array.prototype.forEach.call(modeRadios, function (radio) {
    radio.addEventListener("change", function () {
      if (!radio.checked) return;
      state.currentGame.mode = radio.value;
      saveState();
      renderAll();
      updateCurrentGameSummary();
    });
  });

  noStatsCheckbox.addEventListener("change", function () {
    noStatsMode = noStatsCheckbox.checked;

    // Unchecking it is the only way out of Quick Counter once you're in
    // Focus Mode (every other control is hidden there) — without this,
    // the scoreboard kept the bare point tally while the rest of the app
    // (Game Order, Current Game) still showed the real rotation/target as
    // if it were in effect, which is exactly the mismatch this fixes.
    if (!noStatsCheckbox.checked && quickCounterMode) {
      quickCounterMode = false;
      resetGameBalls();
      applyRotationIfDue();
      saveState();
      renderAll();
      updateCurrentGameSummary();
      showToast(T("toast.backToNormalGame"));
      return;
    }

    showToast(
      noStatsMode
        ? "No Statistic mode is on — nothing from here on will be saved."
        : "No Statistic mode is off — games will be tracked normally again."
    );
  });

  raceToWinsInput.addEventListener("input", function () {
    var target = parseInt(raceToWinsInput.value, 10);
    if (!target || target < 1) return;
    state.raceToWinsTarget = target;
    saveState();
    renderScoreboard();
    renderStandings();
    updateCurrentGameSummary();
  });

  btnResetGame.addEventListener("click", resetCurrentGame);
  btnUndoWin.addEventListener("click", undoLastWin);
  btnShare.addEventListener("click", shareStandings);
  btnExportSession.addEventListener("click", function () {
    exportSession();
    exportAllPlayerStats();
  });

  rotationEnabledCheckbox.addEventListener("change", function () {
    state.rotation.enabled = rotationEnabledCheckbox.checked;
    saveState();
    applyRotationIfDue();
    renderRotation();
    renderScoreboard();
  });

  btnRotationPositionPrev.addEventListener("click", function () {
    moveRotationPosition(-1);
  });
  btnRotationPositionNext.addEventListener("click", function () {
    moveRotationPosition(1);
  });

  rotationAddType.addEventListener("change", function () {
    var type = GAME_TYPES[rotationAddType.value];
    if (!type) return;
    rotationAddTarget.value = type.defaultTarget;
    rotationAddUnit.value = type.unit;
  });

  btnRotationAdd.addEventListener("click", function () {
    var target = parseInt(rotationAddTarget.value, 10) || 1;
    addRotationItem(rotationAddType.value, target, rotationAddUnit.value);
  });

  rotationEveryInput.addEventListener("input", function () {
    var v = parseInt(rotationEveryInput.value, 10);
    if (!v || v < 1) return;
    state.rotation.every = v;
    saveState();
    applyRotationIfDue();
    renderRotation();
    renderScoreboard();
  });

  btnMilestoneClose.addEventListener("click", closeMilestone);
  btnMilestoneUndo.addEventListener("click", undoTournamentWinFromMilestoneOverlay);
  milestoneOverlay.addEventListener("click", function (e) {
    if (e.target === milestoneOverlay) closeMilestone();
  });

  btnGamewinClose.addEventListener("click", closeGameWinOverlay);
  btnGamewinUndo.addEventListener("click", undoWinFromGameWinOverlay);
  gamewinOverlay.addEventListener("click", function (e) {
    if (e.target === gamewinOverlay) closeGameWinOverlay();
  });

  btnForceResetClose.addEventListener("click", closeForceResetNotice);
  forceResetOverlay.addEventListener("click", function (e) {
    if (e.target === forceResetOverlay) closeForceResetNotice();
  });

  btnResetTodayStats.addEventListener("click", resetTodayStats);

  btnOnHillClose.addEventListener("click", closeOnHill);
  onHillOverlay.addEventListener("click", function (e) {
    if (e.target === onHillOverlay) closeOnHill();
  });

  btnGameChangeClose.addEventListener("click", closeGameChange);
  gameChangeOverlay.addEventListener("click", function (e) {
    if (e.target === gameChangeOverlay) closeGameChange();
  });

  btnSaveSessionSave.addEventListener("click", function () {
    exportSession();
    exportAllPlayerStats();
    closeSaveSessionPopup();
    startNewSession(true);
    endTournamentSilently();
  });
  btnSaveSessionSkip.addEventListener("click", function () {
    // "Skip" never folded this session into PLAYER_STATS (that's what
    // "Save" does via exportAllPlayerStats) - the only thing about to be
    // lost is the live gameHistory/win tallies, so snapshot just those.
    if (state.gameHistory.length) {
      saveResetSnapshot("todayStats", T("resetSnapshot.sessionSkipLabel", { date: todayDateStr() }), {
        date: todayDateStr(),
        prunedSessions: {},
        gameHistory: JSON.parse(JSON.stringify(state.gameHistory)),
        playerWins: JSON.parse(JSON.stringify(state.playerWins)),
        teamWins: JSON.parse(JSON.stringify(state.teamWins)),
        teamMvpWins: JSON.parse(JSON.stringify(state.teamMvpWins)),
        ratingHistory: {}
      });
    }
    closeSaveSessionPopup();
    startNewSession(false);
    endTournamentSilently();
  });
  btnSaveSessionCancel.addEventListener("click", closeSaveSessionPopup);
  saveSessionOverlay.addEventListener("click", function (e) {
    if (e.target === saveSessionOverlay) closeSaveSessionPopup();
  });

  btnRosterLoad.addEventListener("click", loadSelectedRoster);
  btnRotationLoad.addEventListener("click", loadSelectedRotation);

  btnOpenHelpButtons.forEach(function (btn) {
    if (btn) btn.addEventListener("click", openHelp);
  });
  btnHelpClose.addEventListener("click", closeHelp);
  document.addEventListener("click", hideGraphTooltip);
  document.addEventListener("scroll", hideGraphTooltip, true);
  unlockAudioOnFirstInteraction();
  helpOverlay.addEventListener("click", function (e) {
    if (e.target === helpOverlay) closeHelp();
  });
  Array.prototype.forEach.call(helpNavLinks, function (a) {
    a.addEventListener("click", function (e) {
      e.preventDefault();
      var targetId = a.getAttribute("href").slice(1);
      Array.prototype.forEach.call(helpNavLinks, function (link) {
        link.classList.toggle("is-active", link === a);
      });
      scrollHelpToSection(targetId);
    });
  });

  btnTestOnboarding.addEventListener("click", openOnboarding);
  btnOpenWizard.addEventListener("click", openWizard);
  btnWizardClose.addEventListener("click", closeWizard);
  btnWizardCancel.addEventListener("click", closeWizard);
  wizardOverlay.addEventListener("click", function (e) {
    if (e.target === wizardOverlay) closeWizard();
  });
  btnWizardBack.addEventListener("click", wizardBack);
  btnWizardNext.addEventListener("click", wizardNext);
  btnWizardStart.addEventListener("click", finalizeWizardAndStart);
  wizardTempCounterCheckbox.addEventListener("change", function () {
    btnWizardStartQuickCounter.classList.toggle("hidden", !wizardTempCounterCheckbox.checked);
  });
  btnWizardStartQuickCounter.addEventListener("click", startQuickCounter);

  btnOnboardingCancel.addEventListener("click", closeOnboarding);
  btnOnboardingGo.addEventListener("click", advanceOnboarding);
  onboardingNameInput.addEventListener("input", validateOnboardingNameInput);
  onboardingEmailInput.addEventListener("input", function () {
    var hasEmail = !!onboardingEmailInput.value.trim();
    onboardingReportOptInCheckbox.disabled = !hasEmail;
    if (!hasEmail) onboardingReportOptInCheckbox.checked = false;
  });
  btnOnboardingRunWizard.addEventListener("click", function () {
    closeOnboarding();
    openWizard();
  });
  btnOnboardingManual.addEventListener("click", closeOnboarding);

  Array.prototype.forEach.call(wizardFormatRadios, function (radio) {
    radio.addEventListener("change", function () {
      if (!radio.checked) return;
      wizardFormat = radio.value;
      wizardRaceToRow.classList.toggle("hidden", wizardFormat !== "raceto");
    });
  });

  wizardNewPlayerName.addEventListener("input", validateWizardNewPlayerNameInput);

  wizardAddPlayerForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var trimmed = wizardNewPlayerName.value.trim();
    if (!trimmed || isDuplicatePlayerName(trimmed)) {
      validateWizardNewPlayerNameInput();
      return;
    }
    var starting = parseStartingRatingInput(wizardNewPlayerRatingInput);
    var alreadyRated = starting !== null && !!findRatingKey(resolvePlayerName(trimmed));
    var player = addPlayer(wizardNewPlayerName.value, starting === null ? undefined : starting);
    if (!player) return;
    wizardNewPlayerName.value = "";
    wizardNewPlayerRatingInput.value = "";
    validateWizardNewPlayerNameInput();
    renderAll();
    if (alreadyRated) showToast(player.name + " already has a tracked rating — starting rating not applied.");
  });

  btnWizardRosterLoad.addEventListener("click", loadSelectedWizardRoster);

  Array.prototype.forEach.call(wizardRotationEnabledRadios, function (radio) {
    radio.addEventListener("change", function () {
      if (!radio.checked) return;
      var on = radio.value === "yes";
      state.rotation.enabled = on;
      saveState();
      wizardRotationDetail.classList.toggle("hidden", !on);
      applyRotationIfDue();
      renderRotation();
      renderWizardIfOpen();
    });
  });

  btnWizardRotationLoad.addEventListener("click", loadSelectedWizardRotation);

  wizardRotationAddType.addEventListener("change", function () {
    var type = GAME_TYPES[wizardRotationAddType.value];
    if (!type) return;
    wizardRotationAddTarget.value = type.defaultTarget;
    wizardRotationAddUnit.value = type.unit;
  });

  btnWizardRotationAdd.addEventListener("click", function () {
    var target = parseInt(wizardRotationAddTarget.value, 10) || 1;
    addRotationItem(wizardRotationAddType.value, target, wizardRotationAddUnit.value);
  });

  wizardRotationEveryInput.addEventListener("input", function () {
    var v = parseInt(wizardRotationEveryInput.value, 10);
    if (!v || v < 1) return;
    state.rotation.every = v;
    saveState();
    applyRotationIfDue();
    renderRotation();
    renderWizardIfOpen();
  });

  wireCollapsiblePanel("backup-panel", "btn-toggle-backup-panel");
  wireCollapsiblePanel("rotation-panel", "btn-toggle-rotation-panel");
  wireCollapsiblePanel("game-setup-panel", "btn-toggle-game-setup-panel");
  wireCollapsiblePanel("players-panel", "btn-toggle-players-panel");
  wireCollapsiblePanel("standings-panel", "btn-toggle-standings-panel");
  wireCollapsiblePanel("history-panel", "btn-toggle-history-panel");
  wireCollapsiblePanel("day-notes-panel", "btn-toggle-day-notes-panel");
  wireCollapsiblePanel("resets-panel", "btn-toggle-resets-panel");
  wireCollapsiblePanel("focus-players-wrap", "btn-toggle-focus-players");
  wireCollapsiblePanel("player-page-h2h-panel", "btn-toggle-player-page-h2h-panel");

  var dayNotesSaveTimer = null;
  dayNotesTextarea.addEventListener("input", function () {
    clearTimeout(dayNotesSaveTimer);
    dayNotesSaveTimer = setTimeout(function () {
      setDayNotes(todayDateStr(), dayNotesTextarea.value);
      updateDayNotesSummary();
    }, 500);
  });

  btnDayReportCopy.addEventListener("click", function () {
    var text = buildDayReportText(todayDateStr());
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function () {
          showToast(T("toast.dayReportCopied"));
        },
        function () {
          alertModal(text);
        }
      );
    } else {
      alertModal(text);
    }
  });

  btnDayReportEmail.addEventListener("click", function () {
    var text = buildDayReportText(todayDateStr());
    var to = reportOptedInContacts()
      .map(function (c) {
        return encodeURIComponent(c.contact.email);
      })
      .join(",");
    window.location.href = "mailto:" + to + "?subject=" + encodeURIComponent("Pool Master Counter — Day Report") + "&body=" + encodeURIComponent(text);
  });

  btnDayReportSms.addEventListener("click", function () {
    var text = buildDayReportText(todayDateStr());
    window.location.href = "sms:&body=" + encodeURIComponent(text);
  });

  btnPlayerPageExport.addEventListener("click", exportCurrentPlayerStats);
  btnPlayerPageReset.addEventListener("click", resetPlayerHistoricalStats);
  btnPlayerPageBack.addEventListener("click", function () {
    closePlayerStatsPage();
  });
  btnReturnToGlobalStats.addEventListener("click", returnToGlobalStats);
  playerPageSwitcher.addEventListener("change", function () {
    if (playerPageSwitcher.value && playerPageSwitcher.value !== currentStatsPlayerName) {
      openPlayerStatsPage(playerPageSwitcher.value);
    }
  });

  btnOpenAllPlayers.addEventListener("click", function () {
    openAllPlayersPage();
  });
  btnAllPlayersBack.addEventListener("click", function () {
    closeAllPlayersPage();
  });
  allPlayersSortSelect.addEventListener("change", renderAllPlayersPage);
  allPlayersPeriodSelect.addEventListener("change", renderAllPlayersPage);
  btnToggleAllPlayersView.addEventListener("click", function () {
    allPlayersViewMode = allPlayersViewMode === "bars" ? "graph" : "bars";
    btnToggleAllPlayersView.textContent = T(allPlayersViewMode === "graph" ? "allPlayers.seeAsBars" : "allPlayers.seeAsGraph");
    renderAllPlayersPage();
  });
  btnToggleRosterFilter.addEventListener("click", function () {
    allPlayersRosterOnly = !allPlayersRosterOnly;
    btnToggleRosterFilter.classList.toggle("is-active", allPlayersRosterOnly);
    btnToggleRosterFilter.textContent = T(allPlayersRosterOnly ? "allPlayers.showingRosterOnly" : "allPlayers.rosterOnly");
    renderAllPlayersPage();
  });

  btnOpenTournament.addEventListener("click", function () {
    openTournamentPage();
  });
  btnTournamentBack.addEventListener("click", function () {
    closeTournamentPage();
  });
  btnTournamentStart.addEventListener("click", startTournament);
  btnTournamentAbandon.addEventListener("click", abandonTournament);
  tournamentGameTypeSelect.addEventListener("change", function () {
    var type = GAME_TYPES[tournamentGameTypeSelect.value];
    tournamentTargetInput.value = type.defaultTarget;
    tournamentTargetUnit.textContent = type.unit;
  });

  Array.prototype.forEach.call(playerPagePeriodButtons, function (btn) {
    btn.addEventListener("click", function () {
      setStatsPeriod(btn.getAttribute("data-period"));
    });
  });

  // ---------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------

  gameTypeSelect.value = state.currentGame.gameType;
  gameTargetInput.value = state.currentGame.target;
  gameTargetUnitSelect.value = state.currentGame.unit;
  raceToWinsInput.value = state.raceToWinsTarget;
  Array.prototype.forEach.call(modeRadios, function (radio) {
    radio.checked = radio.value === state.currentGame.mode;
  });
  updateCurrentGameSummary();

  dayNotesTextarea.value = getDayNotes(todayDateStr());
  updateDayNotesSummary();
  updateDayReportRecipientsLine();

  if (state.rotation.enabled && state.rotation.order.length > 0) {
    state.gamesPlayedCount = 0;
    applyRotationIfDue();
    gameTargetInput.value = state.currentGame.target;
    saveState();
  }

  populateRosterLoadSelect();
  populateRotationLoadSelect();
  populateWizardRosterLoadSelect();
  populateWizardRotationLoadSelect();
  validateNewPlayerNameInput();
  validateWizardNewPlayerNameInput();
  renderAll();

  if (!hasSeenOnboarding() && isFirstTimeUser()) {
    openOnboarding();
  }

  var storedFocusMode = "0";
  try {
    storedFocusMode = localStorage.getItem(FOCUS_MODE_KEY) || "0";
  } catch (e) {
    storedFocusMode = "0";
  }
  setFocusMode(storedFocusMode === "1");
  btnToggleFocus.addEventListener("click", function () {
    setFocusMode(!appRoot.classList.contains("focus-mode"));
  });

  setInterval(updateGameDurationDisplay, 1000);
  }

  // ---------------------------------------------------------------------
  // Load settings/game-types.json (app config) and run the one-time
  // repo-to-localStorage migration, then boot
  // ---------------------------------------------------------------------

  var gameTypesPromise = fetchFresh("settings/game-types.json")
    .then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    })
    .catch(function (err) {
      console.warn("Could not load settings/game-types.json, using built-in defaults.", err);
      return DEFAULT_GAME_TYPES;
    });

  Promise.all([gameTypesPromise, migrateFromRepoIfNeeded(), languagePromise]).then(function (results) {
    GAME_TYPE_LIST = results[0];
    GAME_TYPE_LIST.forEach(function (t) {
      GAME_TYPES[t.id] = { label: t.label, defaultTarget: t.defaultTarget, unit: t.unit };
    });
    populateGameTypeSelects();
    normalizeGameTypeDependentData();
    [
      [rotationAddType, rotationAddTarget, rotationAddUnit],
      [wizardRotationAddType, wizardRotationAddTarget, wizardRotationAddUnit]
    ].forEach(function (trio) {
      var type = GAME_TYPES[trio[0].value];
      if (!type) return;
      trio[1].value = type.defaultTarget;
      trio[2].value = type.unit;
    });
    applyDomTranslations(document);
    boot();
  });
})();
