(function () {
  "use strict";

  var STORAGE_KEY = "poolMasterCounter.state.v2";
  var OLD_STORAGE_KEY = "poolMasterCounter.state.v1";
  var VOICE_PITCHES = [1.0, 1.26, 1.5, 0.79, 1.89, 0.63];

  var GAME_TYPES = {
    "8ball": { label: "8-Ball", defaultTarget: 1, unit: "rack" },
    "9ball": { label: "9-Ball", defaultTarget: 1, unit: "rack" },
    straight: { label: "Straight Pool", defaultTarget: 100, unit: "points" },
    onepocket: { label: "One Pocket", defaultTarget: 8, unit: "balls" },
    custom: { label: "Custom", defaultTarget: 1, unit: "points" }
  };

  // ---------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------

  var state = loadState();
  var toastTimer = null;

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function defaultState() {
    return {
      players: [],
      playerWins: {},
      teamWins: {},
      raceToWinsTarget: 5,
      currentGame: { gameType: "8ball", target: 1, mode: "individual" },
      gameHistory: []
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
          if (typeof parsed.raceToWinsTarget !== "number") parsed.raceToWinsTarget = 5;
          if (!parsed.currentGame) parsed.currentGame = { gameType: "8ball", target: 1, mode: "individual" };
          if (!Array.isArray(parsed.gameHistory)) parsed.gameHistory = [];
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

  function activePlayers() {
    return state.players.filter(function (p) {
      return p.playing;
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
    return (teamId === "A" ? "Team A" : "Team B") + (names ? " (" + names + ")" : "");
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
  function getAudioCtx() {
    if (!audioCtx) {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      audioCtx = new Ctx();
    }
    if (audioCtx.state === "suspended") {
      audioCtx.resume();
    }
    return audioCtx;
  }

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
    osc.start(startTime);
    osc.stop(startTime + duration + 0.02);
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

  function playNegativeSound(voice) {
    var mult = voicePitch(voice);
    var ctx = getAudioCtx();
    var now = ctx.currentTime;
    tone(220 * mult, now, 0.18, "sawtooth", 0.18);
    tone(160 * mult, now + 0.05, 0.22, "sawtooth", 0.16);
  }

  function playWinSound(voice) {
    var mult = voicePitch(voice);
    var ctx = getAudioCtx();
    var now = ctx.currentTime;
    tone(523 * mult, now, 0.12, "triangle", 0.22);
    tone(659 * mult, now + 0.1, 0.12, "triangle", 0.22);
    tone(784 * mult, now + 0.2, 0.28, "triangle", 0.24);
  }

  function playVictorySound() {
    var ctx = getAudioCtx();
    var now = ctx.currentTime;
    var run = [523.25, 587.33, 659.25, 698.46, 783.99, 880.0];
    run.forEach(function (freq, i) {
      tone(freq, now + i * 0.09, 0.16, "triangle", 0.2);
    });
    var chordStart = now + run.length * 0.09 + 0.05;
    [523.25, 659.25, 783.99, 1046.5].forEach(function (freq) {
      tone(freq, chordStart, 0.7, "triangle", 0.18);
    });
  }

  // ---------------------------------------------------------------------
  // DOM refs
  // ---------------------------------------------------------------------

  var addPlayerForm = document.getElementById("add-player-form");
  var newPlayerName = document.getElementById("new-player-name");
  var rosterList = document.getElementById("roster-list");

  var gameTypeSelect = document.getElementById("game-type");
  var gameTargetInput = document.getElementById("game-target");
  var gameTargetUnit = document.getElementById("game-target-unit");
  var modeRadios = document.getElementsByName("game-mode");
  var raceToWinsInput = document.getElementById("race-to-wins");

  var btnResetGame = document.getElementById("btn-reset-game");
  var btnShare = document.getElementById("btn-share");
  var btnResetStats = document.getElementById("btn-reset-stats");

  var winToast = document.getElementById("win-toast");
  var scoreboard = document.getElementById("scoreboard");
  var historyList = document.getElementById("history-list");
  var standingsTitle = document.getElementById("standings-title");
  var teamStandingsList = document.getElementById("team-standings-list");
  var playerStandingsList = document.getElementById("player-standings-list");

  var milestoneOverlay = document.getElementById("milestone-overlay");
  var milestoneMessage = document.getElementById("milestone-message");
  var btnMilestoneClose = document.getElementById("btn-milestone-close");

  // ---------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------

  function renderAll() {
    renderRoster();
    renderScoreboard();
    renderHistory();
    renderStandings();
  }

  function buildStandingsRow(name, wins) {
    var target = state.raceToWinsTarget;
    var reached = wins >= target;
    var li = document.createElement("li");
    li.className = "standings-row" + (reached ? " is-reached" : "");

    var top = document.createElement("div");
    top.className = "standings-row-top";
    var nameEl = document.createElement("span");
    nameEl.className = "standings-name";
    nameEl.textContent = name;
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
    standingsTitle.textContent = "Race to " + state.raceToWinsTarget + " Wins — Teams";

    var comboKeys = Object.keys(state.teamWins);
    ["A", "B"].forEach(function (teamId) {
      var key = teamComboKey(teamId);
      if (key && comboKeys.indexOf(key) === -1) comboKeys.push(key);
    });

    teamStandingsList.innerHTML = "";
    if (comboKeys.length === 0) {
      var teamHint = document.createElement("li");
      teamHint.className = "empty-hint";
      teamHint.textContent = "No team pairings yet — switch to Teams mode and assign players.";
      teamStandingsList.appendChild(teamHint);
    } else {
      comboKeys
        .map(function (key) {
          var names = key
            .split("|")
            .map(function (id) {
              var p = getPlayer(id);
              return p ? p.name : "?";
            })
            .join(" & ");
          return { key: key, names: names, wins: state.teamWins[key] || 0 };
        })
        .sort(function (a, b) {
          return b.wins - a.wins || a.names.localeCompare(b.names);
        })
        .forEach(function (row) {
          teamStandingsList.appendChild(buildStandingsRow(row.names, row.wins));
        });
    }

    playerStandingsList.innerHTML = "";
    if (state.players.length === 0) {
      var playerHint = document.createElement("li");
      playerHint.className = "empty-hint";
      playerHint.textContent = "No players yet.";
      playerStandingsList.appendChild(playerHint);
    } else {
      state.players
        .slice()
        .sort(function (a, b) {
          return (state.playerWins[b.id] || 0) - (state.playerWins[a.id] || 0) || a.name.localeCompare(b.name);
        })
        .forEach(function (p) {
          playerStandingsList.appendChild(buildStandingsRow(p.name, state.playerWins[p.id] || 0));
        });
    }
  }

  function renderRoster() {
    rosterList.innerHTML = "";
    if (state.players.length === 0) {
      var hint = document.createElement("li");
      hint.className = "empty-hint";
      hint.textContent = "Add players to get started.";
      rosterList.appendChild(hint);
      return;
    }
    var showTeamToggle = state.currentGame.mode === "teams";

    state.players.forEach(function (p) {
      var row = document.createElement("li");
      row.className = "roster-row" + (p.playing ? " is-playing" : "");

      var name = document.createElement("span");
      name.className = "roster-name";
      name.textContent = p.name;
      row.appendChild(name);

      var playBtn = document.createElement("button");
      playBtn.type = "button";
      playBtn.className = "btn-playing" + (p.playing ? " is-on" : "");
      playBtn.textContent = p.playing ? "Playing" : "Standby";
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
  }

  function buildStatMini(label, value, milestoneReached) {
    var el = document.createElement("div");
    el.className = "stat-mini";
    var strong = document.createElement("strong");
    strong.textContent = value;
    el.appendChild(document.createTextNode(label + ": "));
    el.appendChild(strong);
    if (milestoneReached) {
      var flag = document.createElement("span");
      flag.className = "flag";
      flag.textContent = "🏁";
      el.appendChild(flag);
    }
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
    minusBtn.disabled = disabled || (player.balls || 0) <= 0;
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

  function buildIndividualPanel(player) {
    var panel = document.createElement("div");
    panel.className = "player-panel";

    var name = document.createElement("div");
    name.className = "player-name";
    name.textContent = player.name;
    panel.appendChild(name);

    var wins = state.playerWins[player.id] || 0;
    panel.appendChild(buildStatMini("Career wins", wins, wins >= state.raceToWinsTarget));

    var block = document.createElement("div");
    block.className = "stat-block";
    var label = document.createElement("div");
    label.className = "stat-label";
    label.textContent = GAME_TYPES[state.currentGame.gameType].label + " · Target " + state.currentGame.target;
    var value = document.createElement("div");
    value.className = "stat-value";
    value.textContent = player.balls || 0;
    block.appendChild(label);
    block.appendChild(value);
    panel.appendChild(block);

    panel.appendChild(buildBallControls(player, false));

    return panel;
  }

  function buildMemberCard(player) {
    var card = document.createElement("div");
    card.className = "member-card";

    var name = document.createElement("div");
    name.className = "member-name";
    name.textContent = player.name;
    card.appendChild(name);

    var wins = state.playerWins[player.id] || 0;
    card.appendChild(buildStatMini("Career wins", wins, wins >= state.raceToWinsTarget));

    var value = document.createElement("div");
    value.className = "stat-value small";
    value.textContent = player.balls || 0;
    card.appendChild(value);

    card.appendChild(buildBallControls(player, false));

    return card;
  }

  function buildTeamPanel(teamId, members) {
    var panel = document.createElement("div");
    panel.className = "team-panel";

    var name = document.createElement("div");
    name.className = "team-name";
    name.textContent = teamLabelLive(teamId);
    panel.appendChild(name);

    var wins = state.teamWins[teamComboKey(teamId)] || 0;
    panel.appendChild(buildStatMini("Paired wins", wins, wins >= state.raceToWinsTarget));

    var block = document.createElement("div");
    block.className = "stat-block";
    var label = document.createElement("div");
    label.className = "stat-label";
    label.textContent = GAME_TYPES[state.currentGame.gameType].label + " · Target " + state.currentGame.target;
    var value = document.createElement("div");
    value.className = "stat-value";
    value.textContent = sumTeamBalls(teamId);
    block.appendChild(label);
    block.appendChild(value);
    panel.appendChild(block);

    var memberWrap = document.createElement("div");
    memberWrap.className = "team-members";
    members.forEach(function (p) {
      memberWrap.appendChild(buildMemberCard(p));
    });
    panel.appendChild(memberWrap);

    return panel;
  }

  function renderScoreboard() {
    scoreboard.innerHTML = "";
    var active = activePlayers();

    if (active.length === 0) {
      scoreboard.className = "scoreboard";
      var hint = document.createElement("div");
      hint.className = "empty-hint";
      hint.textContent = "Mark players as Playing above to start scoring.";
      scoreboard.appendChild(hint);
      return;
    }

    if (state.currentGame.mode === "teams") {
      scoreboard.className = "scoreboard scoreboard-teams";
      ["A", "B"].forEach(function (teamId) {
        var members = teamMembersLive(teamId);
        if (!members.length) return;
        scoreboard.appendChild(buildTeamPanel(teamId, members));
      });
    } else {
      scoreboard.className = "scoreboard";
      active.forEach(function (p) {
        scoreboard.appendChild(buildIndividualPanel(p));
      });
    }
  }

  function renderHistory() {
    historyList.innerHTML = "";
    if (state.gameHistory.length === 0) {
      var hint = document.createElement("li");
      hint.className = "empty-hint";
      hint.textContent = "No games finished yet.";
      historyList.appendChild(hint);
      return;
    }
    state.gameHistory.forEach(function (entry) {
      var li = document.createElement("li");
      li.textContent = entry;
      historyList.appendChild(li);
    });
  }

  // ---------------------------------------------------------------------
  // Player management
  // ---------------------------------------------------------------------

  function addPlayer(name) {
    name = (name || "").trim();
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
    return player;
  }

  function removePlayer(id) {
    if (!confirm("Remove this player? Their career win totals will also be cleared.")) return;
    state.players = state.players.filter(function (p) {
      return p.id !== id;
    });
    delete state.playerWins[id];
    saveState();
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

  function creditWin(isTeam, key) {
    var typeLabel = GAME_TYPES[state.currentGame.gameType].label;
    var summary;
    var milestoneNames = null;
    if (isTeam) {
      var members = teamMembersLive(key);
      var comboKey = teamComboKey(key);
      var prevTeamWins = state.teamWins[comboKey] || 0;
      state.teamWins[comboKey] = prevTeamWins + 1;
      members.forEach(function (p) {
        state.playerWins[p.id] = (state.playerWins[p.id] || 0) + 1;
      });
      summary = teamLabelLive(key) + " won " + typeLabel + " (target " + state.currentGame.target + ")";
      if (prevTeamWins < state.raceToWinsTarget && state.teamWins[comboKey] >= state.raceToWinsTarget) {
        milestoneNames = members
          .map(function (p) {
            return p.name;
          })
          .join(" & ");
      }
    } else {
      var prevPlayerWins = state.playerWins[key] || 0;
      state.playerWins[key] = prevPlayerWins + 1;
      summary = getPlayer(key).name + " won " + typeLabel + " (target " + state.currentGame.target + ")";
      if (prevPlayerWins < state.raceToWinsTarget && state.playerWins[key] >= state.raceToWinsTarget) {
        milestoneNames = getPlayer(key).name;
      }
    }
    state.gameHistory.unshift(summary);
    if (state.gameHistory.length > 50) state.gameHistory.length = 50;
    showToast(summary);
    if (milestoneNames) {
      celebrateMilestone(milestoneNames);
    }
    return summary;
  }

  function celebrateMilestone(names) {
    milestoneMessage.textContent = names + " won the race to " + state.raceToWinsTarget + "!";
    milestoneOverlay.classList.remove("hidden");
    playVictorySound();
  }

  function closeMilestone() {
    milestoneOverlay.classList.add("hidden");
  }

  function resetGameBalls() {
    state.players.forEach(function (p) {
      p.balls = 0;
    });
  }

  function adjustScore(playerId, delta) {
    var player = getPlayer(playerId);
    if (!player || !player.playing) return;
    var next = (player.balls || 0) + delta;
    if (next < 0) next = 0;
    player.balls = next;

    if (delta > 0) {
      var target = state.currentGame.target;
      var isTeamMode = state.currentGame.mode === "teams" && player.teamId;
      var reached = isTeamMode ? sumTeamBalls(player.teamId) >= target : next >= target;

      if (reached) {
        var winnerVoice = isTeamMode ? null : player.voice;
        creditWin(isTeamMode, isTeamMode ? player.teamId : playerId);
        resetGameBalls();
        saveState();
        playWinSound(winnerVoice);
        renderAll();
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
    if (!confirm("Reset the current game's score to zero? (No win will be credited.)")) return;
    resetGameBalls();
    saveState();
    renderAll();
  }

  function resetAllStats() {
    if (!confirm("This clears ALL career wins, team wins, and game history for every player. This cannot be undone. Continue?")) return;
    state.playerWins = {};
    state.teamWins = {};
    state.gameHistory = [];
    resetGameBalls();
    saveState();
    renderAll();
  }

  // ---------------------------------------------------------------------
  // Sharing by email
  // ---------------------------------------------------------------------

  function shareStandings() {
    var lines = ["Pool Master Counter — Standings", ""];
    lines.push("Player career wins:");
    state.players.forEach(function (p) {
      lines.push("  " + p.name + ": " + (state.playerWins[p.id] || 0));
    });
    var teamKeys = Object.keys(state.teamWins);
    if (teamKeys.length) {
      lines.push("");
      lines.push("Team pairing wins:");
      teamKeys.forEach(function (key) {
        var names = key
          .split("|")
          .map(function (id) {
            var p = getPlayer(id);
            return p ? p.name : "?";
          })
          .join(" & ");
        lines.push("  " + names + ": " + state.teamWins[key]);
      });
    }
    if (state.gameHistory.length) {
      lines.push("");
      lines.push("Recent games:");
      state.gameHistory.slice(0, 15).forEach(function (entry) {
        lines.push("  " + entry);
      });
    }
    var body = lines.join("\n");
    var href = "mailto:?subject=" + encodeURIComponent("Pool Master Counter — Standings") + "&body=" + encodeURIComponent(body);
    window.location.href = href;
  }

  // ---------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------

  addPlayerForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var player = addPlayer(newPlayerName.value);
    if (!player) return;
    newPlayerName.value = "";
    renderAll();
  });

  gameTypeSelect.addEventListener("change", function () {
    var type = GAME_TYPES[gameTypeSelect.value];
    state.currentGame.gameType = gameTypeSelect.value;
    state.currentGame.target = type.defaultTarget;
    gameTargetInput.value = type.defaultTarget;
    gameTargetUnit.textContent = type.unit;
    saveState();
    renderScoreboard();
  });

  gameTargetInput.addEventListener("input", function () {
    var target = parseInt(gameTargetInput.value, 10);
    if (!target || target < 1) return;
    state.currentGame.target = target;
    saveState();
    renderScoreboard();
  });

  Array.prototype.forEach.call(modeRadios, function (radio) {
    radio.addEventListener("change", function () {
      if (!radio.checked) return;
      state.currentGame.mode = radio.value;
      saveState();
      renderAll();
    });
  });

  raceToWinsInput.addEventListener("input", function () {
    var target = parseInt(raceToWinsInput.value, 10);
    if (!target || target < 1) return;
    state.raceToWinsTarget = target;
    saveState();
    renderScoreboard();
    renderStandings();
  });

  btnResetGame.addEventListener("click", resetCurrentGame);
  btnShare.addEventListener("click", shareStandings);
  btnResetStats.addEventListener("click", resetAllStats);

  btnMilestoneClose.addEventListener("click", closeMilestone);
  milestoneOverlay.addEventListener("click", function (e) {
    if (e.target === milestoneOverlay) closeMilestone();
  });

  // ---------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------

  gameTypeSelect.value = state.currentGame.gameType;
  gameTargetInput.value = state.currentGame.target;
  gameTargetUnit.textContent = GAME_TYPES[state.currentGame.gameType].unit;
  raceToWinsInput.value = state.raceToWinsTarget;
  Array.prototype.forEach.call(modeRadios, function (radio) {
    radio.checked = radio.value === state.currentGame.mode;
  });

  renderAll();
})();
