(function () {
  "use strict";

  var STORAGE_KEY = "poolMasterCounter.state.v1";
  var VOICE_PITCHES = [1.0, 1.26, 1.5, 0.79, 1.89, 0.63];

  // ---------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------

  var state = loadState();
  var currentMatchId = null;

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function migrateMatch(m) {
    if (!m.participants) {
      var ids = [m.player1Id, m.player2Id].filter(Boolean);
      m.participants = ids.map(function (id) {
        return { playerId: id, standby: false, teamId: null };
      });
      delete m.player1Id;
      delete m.player2Id;
    }
    m.participants.forEach(function (pt) {
      if (typeof pt.teamId === "undefined") pt.teamId = null;
    });
    if (!m.mode) m.mode = "games";
    if (typeof m.pointGoal !== "number") m.pointGoal = 100;
    if (typeof m.raceTo !== "number") m.raceTo = 5;
    if (typeof m.teamsEnabled !== "boolean") m.teamsEnabled = false;
    if (!m.games) m.games = {};
    if (!m.balls) m.balls = {};
    return m;
  }

  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.players) && Array.isArray(parsed.matches)) {
          parsed.players.forEach(function (p, i) {
            if (typeof p.voice !== "number") p.voice = i % VOICE_PITCHES.length;
          });
          parsed.matches = parsed.matches.map(migrateMatch);
          return parsed;
        }
      }
    } catch (e) {
      console.warn("Could not read saved state, starting fresh.", e);
    }
    return { players: [], matches: [] };
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

  function getMatch(id) {
    for (var i = 0; i < state.matches.length; i++) {
      if (state.matches[i].id === id) return state.matches[i];
    }
    return null;
  }

  function matchValidParticipants(m) {
    return m.participants.filter(function (pt) {
      return !!getPlayer(pt.playerId);
    });
  }

  function teamMembers(m, teamId) {
    return matchValidParticipants(m).filter(function (pt) {
      return pt.teamId === teamId;
    });
  }

  function teamLabel(m, teamId) {
    var names = teamMembers(m, teamId)
      .map(function (pt) {
        return getPlayer(pt.playerId).name;
      })
      .join(" & ");
    var base = teamId === "A" ? "Team A" : "Team B";
    return names ? base + " (" + names + ")" : base;
  }

  function sumTeamBalls(m, teamId) {
    return teamMembers(m, teamId).reduce(function (sum, pt) {
      return sum + (m.balls[pt.playerId] || 0);
    }, 0);
  }

  // ---------------------------------------------------------------------
  // Lifetime stats — derived from match history, never stored separately
  // ---------------------------------------------------------------------

  function computeStats() {
    var playerWins = {};
    var teamWins = {};

    state.matches.forEach(function (m) {
      if (m.teamsEnabled) {
        ["A", "B"].forEach(function (teamId) {
          var members = teamMembers(m, teamId);
          if (!members.length) return;
          var wins =
            m.mode === "games"
              ? m.games[teamId] || 0
              : m.status === "completed" && m.winnerId === teamId
              ? 1
              : 0;
          if (!wins) return;
          var key = members
            .map(function (pt) {
              return pt.playerId;
            })
            .sort()
            .join("|");
          teamWins[key] = (teamWins[key] || 0) + wins;
          members.forEach(function (pt) {
            playerWins[pt.playerId] = (playerWins[pt.playerId] || 0) + wins;
          });
        });
      } else {
        matchValidParticipants(m).forEach(function (pt) {
          var wins =
            m.mode === "games"
              ? m.games[pt.playerId] || 0
              : m.status === "completed" && m.winnerId === pt.playerId
              ? 1
              : 0;
          if (!wins) return;
          playerWins[pt.playerId] = (playerWins[pt.playerId] || 0) + wins;
        });
      }
    });

    return { playerWins: playerWins, teamWins: teamWins };
  }

  function teamKey(m, teamId) {
    return teamMembers(m, teamId)
      .map(function (pt) {
        return pt.playerId;
      })
      .sort()
      .join("|");
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

  // ---------------------------------------------------------------------
  // DOM refs
  // ---------------------------------------------------------------------

  var viewHome = document.getElementById("view-home");
  var viewMatch = document.getElementById("view-match");

  var addPlayerForm = document.getElementById("add-player-form");
  var newPlayerName = document.getElementById("new-player-name");
  var playerList = document.getElementById("player-list");

  var btnNewMatch = document.getElementById("btn-new-match");
  var newMatchForm = document.getElementById("new-match-form");
  var participantList = document.getElementById("match-participant-list");
  var btnMatchAddPlayer = document.getElementById("btn-match-add-player");
  var useTeamsCheckbox = document.getElementById("match-use-teams");
  var modeRadios = document.getElementsByName("match-mode");
  var gamesModeRow = document.getElementById("games-mode-row");
  var pointsModeRow = document.getElementById("points-mode-row");
  var matchRaceTo = document.getElementById("match-race-to");
  var matchPointGoal = document.getElementById("match-point-goal");
  var btnCancelMatch = document.getElementById("btn-cancel-match");
  var matchList = document.getElementById("match-list");
  var btnShareAll = document.getElementById("btn-share-all");

  var btnBack = document.getElementById("btn-back");
  var matchRaceLabel = document.getElementById("match-race-label");
  var btnShareMatch = document.getElementById("btn-share-match");
  var btnResetMatch = document.getElementById("btn-reset-match");
  var btnDeleteMatch = document.getElementById("btn-delete-match");
  var winnerBanner = document.getElementById("winner-banner");
  var scoreboard = document.getElementById("scoreboard");

  // ---------------------------------------------------------------------
  // Rendering: Home view
  // ---------------------------------------------------------------------

  function renderPlayers() {
    playerList.innerHTML = "";
    if (state.players.length === 0) {
      var hint = document.createElement("li");
      hint.className = "empty-hint";
      hint.textContent = "Add players to get started.";
      playerList.appendChild(hint);
    }
    state.players.forEach(function (p) {
      var li = document.createElement("li");
      li.className = "chip";
      var span = document.createElement("span");
      span.textContent = p.name;
      var btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute("aria-label", "Remove " + p.name);
      btn.textContent = "×";
      btn.addEventListener("click", function () {
        removePlayer(p.id);
      });
      li.appendChild(span);
      li.appendChild(btn);
      playerList.appendChild(li);
    });
  }

  function populateParticipantList(checkedIds, teamAssignments) {
    checkedIds = checkedIds || [];
    teamAssignments = teamAssignments || {};
    participantList.innerHTML = "";
    var showTeamToggle = useTeamsCheckbox.checked;

    state.players.forEach(function (p) {
      var li = document.createElement("li");
      var checkboxId = "participant-" + p.id;

      var checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.id = checkboxId;
      checkbox.value = p.id;
      checkbox.checked = checkedIds.indexOf(p.id) !== -1;

      var label = document.createElement("label");
      label.setAttribute("for", checkboxId);
      label.textContent = p.name;

      var toggle = document.createElement("div");
      toggle.className = "team-toggle" + (showTeamToggle ? "" : " hidden");
      var selectedTeam = teamAssignments[p.id] || "A";
      ["A", "B"].forEach(function (teamId) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = teamId;
        btn.setAttribute("data-team", teamId);
        btn.setAttribute("data-player", p.id);
        if (teamId === selectedTeam) btn.classList.add("is-selected");
        btn.addEventListener("click", function () {
          toggle.querySelectorAll("button").forEach(function (b) {
            b.classList.toggle("is-selected", b === btn);
          });
        });
        toggle.appendChild(btn);
      });

      li.appendChild(checkbox);
      li.appendChild(label);
      li.appendChild(toggle);
      participantList.appendChild(li);
    });
  }

  function getCheckedParticipantIds() {
    var boxes = participantList.querySelectorAll("input[type=checkbox]:checked");
    return Array.prototype.map.call(boxes, function (b) {
      return b.value;
    });
  }

  function getTeamAssignments() {
    var assignments = {};
    participantList.querySelectorAll(".team-toggle").forEach(function (toggle) {
      var selected = toggle.querySelector("button.is-selected");
      if (!selected) return;
      assignments[selected.getAttribute("data-player")] = selected.getAttribute("data-team");
    });
    return assignments;
  }

  function addPlayer(name) {
    name = (name || "").trim();
    if (!name) return null;
    var player = { id: uid(), name: name, voice: state.players.length % VOICE_PITCHES.length };
    state.players.push(player);
    saveState();
    return player;
  }

  function removePlayer(id) {
    var inUse = state.matches.some(function (m) {
      return m.participants.some(function (pt) {
        return pt.playerId === id;
      });
    });
    if (inUse) {
      if (!confirm("This player has matches. Remove player and their matches?")) {
        return;
      }
      state.matches = state.matches.filter(function (m) {
        return !m.participants.some(function (pt) {
          return pt.playerId === id;
        });
      });
    }
    state.players = state.players.filter(function (p) {
      return p.id !== id;
    });
    saveState();
    renderPlayers();
    renderMatches();
  }

  function renderMatches() {
    matchList.innerHTML = "";
    if (state.matches.length === 0) {
      var hint = document.createElement("li");
      hint.className = "empty-hint";
      hint.textContent = "No matches yet. Start one above.";
      matchList.appendChild(hint);
      return;
    }
    var sorted = state.matches.slice().sort(function (a, b) {
      return b.createdAt - a.createdAt;
    });
    sorted.forEach(function (m) {
      var valid = matchValidParticipants(m);
      if (valid.length < 2) return;

      var li = document.createElement("li");
      li.className = "match-card" + (m.status === "completed" ? " completed" : "");
      li.addEventListener("click", function () {
        openMatch(m.id);
      });

      var left = document.createElement("div");
      var names = document.createElement("div");
      names.className = "names";
      var score = document.createElement("div");
      score.className = "score";

      if (m.teamsEnabled) {
        names.textContent = teamLabel(m, "A") + " vs " + teamLabel(m, "B");
        score.textContent =
          (m.mode === "points" ? sumTeamBalls(m, "A") : m.games.A || 0) +
          " – " +
          (m.mode === "points" ? sumTeamBalls(m, "B") : m.games.B || 0);
      } else {
        names.textContent = valid
          .map(function (pt) {
            var pl = getPlayer(pt.playerId);
            return pl.name + (pt.standby ? " (standby)" : "");
          })
          .join(" vs ");
        score.textContent = valid
          .map(function (pt) {
            return m.mode === "points" ? m.balls[pt.playerId] || 0 : m.games[pt.playerId] || 0;
          })
          .join(" – ");
      }

      var sub = document.createElement("div");
      sub.className = "sub";
      sub.textContent = m.mode === "points" ? "Point goal " + m.pointGoal : "Race to " + m.raceTo;
      if (m.status === "completed") {
        var badge = document.createElement("span");
        badge.className = "badge-done";
        badge.textContent = (m.teamsEnabled ? teamLabel(m, m.winnerId) : getPlayer(m.winnerId) ? getPlayer(m.winnerId).name : "?") + " won";
        sub.appendChild(badge);
      }
      left.appendChild(names);
      left.appendChild(sub);

      li.appendChild(left);
      li.appendChild(score);
      matchList.appendChild(li);
    });
  }

  // ---------------------------------------------------------------------
  // Match creation / deletion
  // ---------------------------------------------------------------------

  function createMatch(participantMeta, mode, target, teamsEnabled) {
    var match = {
      id: uid(),
      participants: participantMeta.map(function (p) {
        return { playerId: p.playerId, standby: false, teamId: teamsEnabled ? p.teamId : null };
      }),
      mode: mode,
      teamsEnabled: teamsEnabled,
      raceTo: mode === "games" ? target : 5,
      pointGoal: mode === "points" ? target : 100,
      status: "in_progress",
      winnerId: null,
      games: {},
      balls: {},
      createdAt: Date.now()
    };
    if (teamsEnabled && mode === "games") {
      match.games = { A: 0, B: 0 };
    } else {
      participantMeta.forEach(function (p) {
        match.games[p.playerId] = 0;
      });
    }
    participantMeta.forEach(function (p) {
      match.balls[p.playerId] = 0;
    });
    state.matches.push(match);
    saveState();
    renderMatches();
    return match;
  }

  function resetMatch(id) {
    var m = getMatch(id);
    if (!m) return;
    if (!confirm("Reset this match's score back to zero?")) return;
    if (m.teamsEnabled && m.mode === "games") {
      m.games.A = 0;
      m.games.B = 0;
    } else {
      m.participants.forEach(function (pt) {
        m.games[pt.playerId] = 0;
      });
    }
    m.participants.forEach(function (pt) {
      m.balls[pt.playerId] = 0;
    });
    m.status = "in_progress";
    m.winnerId = null;
    saveState();
    renderMatchView();
    renderMatches();
  }

  function deleteMatch(id) {
    if (!confirm("Delete this match? This cannot be undone.")) return;
    state.matches = state.matches.filter(function (m) {
      return m.id !== id;
    });
    saveState();
    goHome();
    renderMatches();
  }

  function startNextMatch(id) {
    var m = getMatch(id);
    if (!m) return;
    var participantMeta = matchValidParticipants(m).map(function (pt) {
      return { playerId: pt.playerId, teamId: pt.teamId };
    });
    var target = m.mode === "points" ? m.pointGoal : m.raceTo;
    var next = createMatch(participantMeta, m.mode, target, m.teamsEnabled);
    openMatch(next.id);
  }

  // ---------------------------------------------------------------------
  // Match view
  // ---------------------------------------------------------------------

  function openMatch(id) {
    currentMatchId = id;
    viewHome.classList.add("hidden");
    viewMatch.classList.remove("hidden");
    renderMatchView();
  }

  function goHome() {
    currentMatchId = null;
    viewMatch.classList.add("hidden");
    viewHome.classList.remove("hidden");
    renderMatches();
  }

  function renderMatchView() {
    var m = getMatch(currentMatchId);
    if (!m) {
      goHome();
      return;
    }
    var valid = matchValidParticipants(m);
    if (valid.length < 2) {
      goHome();
      return;
    }

    var modeLabel = m.mode === "points" ? "Point goal " + m.pointGoal : "Race to " + m.raceTo;
    if (m.teamsEnabled) {
      matchRaceLabel.textContent = teamLabel(m, "A") + " vs " + teamLabel(m, "B") + " · " + modeLabel;
    } else {
      var names = valid
        .map(function (pt) {
          return getPlayer(pt.playerId).name;
        })
        .join(" vs ");
      matchRaceLabel.textContent = names + " · " + modeLabel;
    }

    if (m.status === "completed") {
      var winnerText = m.teamsEnabled ? teamLabel(m, m.winnerId) : getPlayer(m.winnerId) ? getPlayer(m.winnerId).name : "";
      winnerBanner.innerHTML = "";
      var winnerText2 = document.createElement("div");
      winnerText2.textContent = "🏆 " + winnerText + " wins the match!";
      winnerBanner.appendChild(winnerText2);
      var rematchBtn = document.createElement("button");
      rematchBtn.type = "button";
      rematchBtn.className = "btn btn-primary";
      rematchBtn.textContent = "Start Next Match";
      rematchBtn.addEventListener("click", function () {
        startNextMatch(m.id);
      });
      winnerBanner.appendChild(rematchBtn);
      winnerBanner.classList.remove("hidden");
    } else {
      winnerBanner.classList.add("hidden");
    }

    var stats = computeStats();
    scoreboard.innerHTML = "";

    if (m.teamsEnabled) {
      scoreboard.className = "scoreboard-teams";
      ["A", "B"].forEach(function (teamId) {
        var members = teamMembers(m, teamId);
        if (!members.length) return;
        scoreboard.appendChild(buildTeamPanel(m, teamId, members, stats));
      });
    } else {
      scoreboard.className = "scoreboard";
      valid.forEach(function (pt) {
        scoreboard.appendChild(buildPlayerPanel(m, pt, stats));
      });
    }
  }

  function buildStatMini(label, value) {
    var el = document.createElement("div");
    el.className = "stat-mini";
    var strong = document.createElement("strong");
    strong.textContent = value;
    el.appendChild(document.createTextNode(label + ": "));
    el.appendChild(strong);
    return el;
  }

  function buildTeamPanel(match, teamId, members, stats) {
    var isWinner = match.winnerId === teamId;
    var matchOver = match.status === "completed";

    var panel = document.createElement("div");
    panel.className = "team-panel" + (isWinner ? " is-winner" : "");

    var name = document.createElement("div");
    name.className = "team-name";
    name.textContent = teamId === "A" ? "Team A" : "Team B";
    panel.appendChild(name);

    panel.appendChild(buildStatMini("Paired career wins", stats.teamWins[teamKey(match, teamId)] || 0));

    if (match.mode === "games") {
      var gamesBlock = document.createElement("div");
      gamesBlock.className = "stat-block";
      var gamesLabel = document.createElement("div");
      gamesLabel.className = "stat-label";
      gamesLabel.textContent = "Games";
      var gamesValue = document.createElement("div");
      gamesValue.className = "stat-value";
      gamesValue.textContent = match.games[teamId] || 0;
      gamesBlock.appendChild(gamesLabel);
      gamesBlock.appendChild(gamesValue);
      panel.appendChild(gamesBlock);

      var winBtn = document.createElement("button");
      winBtn.type = "button";
      winBtn.className = "btn-win";
      winBtn.textContent = "Win Game";
      winBtn.disabled = matchOver;
      winBtn.addEventListener("click", function () {
        winGame(match.id, teamId);
      });
      panel.appendChild(winBtn);
    } else {
      var pointsBlock = document.createElement("div");
      pointsBlock.className = "stat-block";
      var pointsLabel = document.createElement("div");
      pointsLabel.className = "stat-label";
      pointsLabel.textContent = "Points · Goal " + match.pointGoal;
      var pointsValue = document.createElement("div");
      pointsValue.className = "stat-value";
      pointsValue.textContent = sumTeamBalls(match, teamId);
      pointsBlock.appendChild(pointsLabel);
      pointsBlock.appendChild(pointsValue);
      panel.appendChild(pointsBlock);
    }

    var memberWrap = document.createElement("div");
    memberWrap.className = "team-members";
    members.forEach(function (pt) {
      memberWrap.appendChild(buildMemberCard(match, pt, stats));
    });
    panel.appendChild(memberWrap);

    return panel;
  }

  function buildMemberCard(match, participant, stats) {
    var player = getPlayer(participant.playerId);
    var matchOver = match.status === "completed";
    var standby = participant.standby;
    var disabled = matchOver || standby;

    var card = document.createElement("div");
    card.className = "member-card" + (standby ? " is-standby" : "");

    var name = document.createElement("div");
    name.className = "member-name";
    name.textContent = player.name;
    card.appendChild(name);

    var actions = document.createElement("div");
    actions.className = "member-actions";

    var standbyBtn = document.createElement("button");
    standbyBtn.type = "button";
    standbyBtn.className = "btn-standby" + (standby ? " is-active-toggle" : "");
    standbyBtn.textContent = standby ? "Resume" : "Standby";
    standbyBtn.disabled = matchOver;
    standbyBtn.addEventListener("click", function () {
      toggleStandby(match.id, participant.playerId);
    });
    actions.appendChild(standbyBtn);

    var otherTeam = participant.teamId === "A" ? "B" : "A";
    var switchBtn = document.createElement("button");
    switchBtn.type = "button";
    switchBtn.className = "btn-standby";
    switchBtn.textContent = "→ Team " + otherTeam;
    switchBtn.disabled = matchOver;
    switchBtn.addEventListener("click", function () {
      switchPlayerTeam(match.id, participant.playerId);
    });
    actions.appendChild(switchBtn);

    card.appendChild(actions);

    card.appendChild(buildStatMini("Career wins", stats.playerWins[player.id] || 0));

    var ballsValue = document.createElement("div");
    ballsValue.className = "stat-value small balls";
    ballsValue.textContent = match.balls[player.id] || 0;
    card.appendChild(ballsValue);

    card.appendChild(buildBallControls(match, player, disabled));

    return card;
  }

  function buildBallControls(match, player, disabled) {
    var controls = document.createElement("div");
    controls.className = "ball-controls";

    var minusBtn = document.createElement("button");
    minusBtn.type = "button";
    minusBtn.className = "btn-ball minus";
    minusBtn.textContent = "−";
    minusBtn.setAttribute("aria-label", "Remove point for " + player.name);
    minusBtn.disabled = disabled || (match.balls[player.id] || 0) <= 0;
    minusBtn.addEventListener("click", function () {
      adjustBalls(match.id, player.id, -1);
    });

    var plusBtn = document.createElement("button");
    plusBtn.type = "button";
    plusBtn.className = "btn-ball plus";
    plusBtn.textContent = "+";
    plusBtn.setAttribute("aria-label", "Add point for " + player.name);
    plusBtn.disabled = disabled;
    plusBtn.addEventListener("click", function () {
      adjustBalls(match.id, player.id, 1);
    });

    controls.appendChild(minusBtn);
    controls.appendChild(plusBtn);
    return controls;
  }

  function buildPlayerPanel(match, participant, stats) {
    var player = getPlayer(participant.playerId);
    var isWinner = match.winnerId === participant.playerId;
    var matchOver = match.status === "completed";
    var standby = participant.standby;
    var disabled = matchOver || standby;

    var panel = document.createElement("div");
    panel.className =
      "player-panel" + (isWinner ? " is-winner" : "") + (standby ? " is-standby" : "");

    var name = document.createElement("div");
    name.className = "player-name";
    name.textContent = player.name;
    panel.appendChild(name);

    var standbyBtn = document.createElement("button");
    standbyBtn.type = "button";
    standbyBtn.className = "btn-standby" + (standby ? " is-active-toggle" : "");
    standbyBtn.textContent = standby ? "Resume" : "Standby";
    standbyBtn.disabled = matchOver;
    standbyBtn.addEventListener("click", function () {
      toggleStandby(match.id, participant.playerId);
    });
    panel.appendChild(standbyBtn);

    panel.appendChild(buildStatMini("Career wins", stats.playerWins[player.id] || 0));

    if (match.mode === "games") {
      var gamesBlock = document.createElement("div");
      gamesBlock.className = "stat-block";
      var gamesLabel = document.createElement("div");
      gamesLabel.className = "stat-label";
      gamesLabel.textContent = "Games";
      var gamesValue = document.createElement("div");
      gamesValue.className = "stat-value";
      gamesValue.textContent = match.games[player.id] || 0;
      gamesBlock.appendChild(gamesLabel);
      gamesBlock.appendChild(gamesValue);
      panel.appendChild(gamesBlock);

      var winBtn = document.createElement("button");
      winBtn.type = "button";
      winBtn.className = "btn-win";
      winBtn.textContent = "Win Game";
      winBtn.disabled = disabled;
      winBtn.addEventListener("click", function () {
        winGame(match.id, player.id);
      });
      panel.appendChild(winBtn);

      var ballsBlock = document.createElement("div");
      ballsBlock.className = "stat-block";
      var ballsLabel = document.createElement("div");
      ballsLabel.className = "stat-label";
      ballsLabel.textContent = "Balls this game";
      var ballsValue = document.createElement("div");
      ballsValue.className = "stat-value balls";
      ballsValue.textContent = match.balls[player.id] || 0;
      ballsBlock.appendChild(ballsLabel);
      ballsBlock.appendChild(ballsValue);
      panel.appendChild(ballsBlock);
    } else {
      var pointsBlock = document.createElement("div");
      pointsBlock.className = "stat-block";
      var pointsLabel = document.createElement("div");
      pointsLabel.className = "stat-label";
      pointsLabel.textContent = "Points · Goal " + match.pointGoal;
      var pointsValue = document.createElement("div");
      pointsValue.className = "stat-value balls";
      pointsValue.textContent = match.balls[player.id] || 0;
      pointsBlock.appendChild(pointsLabel);
      pointsBlock.appendChild(pointsValue);
      panel.appendChild(pointsBlock);
    }

    panel.appendChild(buildBallControls(match, player, disabled));

    return panel;
  }

  function toggleStandby(matchId, playerId) {
    var m = getMatch(matchId);
    if (!m) return;
    var participant = m.participants.filter(function (pt) {
      return pt.playerId === playerId;
    })[0];
    if (!participant) return;
    participant.standby = !participant.standby;
    saveState();
    renderMatchView();
  }

  function switchPlayerTeam(matchId, playerId) {
    var m = getMatch(matchId);
    if (!m || !m.teamsEnabled || m.status === "completed") return;
    var participant = m.participants.filter(function (pt) {
      return pt.playerId === playerId;
    })[0];
    if (!participant) return;
    var currentTeam = participant.teamId;
    if (teamMembers(m, currentTeam).length <= 1) {
      alert("Team " + currentTeam + " needs at least one player — add someone else to that team first.");
      return;
    }
    participant.teamId = currentTeam === "A" ? "B" : "A";
    saveState();
    renderMatchView();
  }

  function adjustBalls(matchId, playerId, delta) {
    var m = getMatch(matchId);
    if (!m || m.status === "completed") return;
    var next = (m.balls[playerId] || 0) + delta;
    if (next < 0) next = 0;
    m.balls[playerId] = next;

    var player = getPlayer(playerId);

    if (m.mode === "points" && delta > 0) {
      var winnerKey = null;
      if (m.teamsEnabled) {
        var participant = m.participants.filter(function (pt) {
          return pt.playerId === playerId;
        })[0];
        if (participant && sumTeamBalls(m, participant.teamId) >= m.pointGoal) {
          winnerKey = participant.teamId;
        }
      } else if (next >= m.pointGoal) {
        winnerKey = playerId;
      }
      if (winnerKey) {
        m.status = "completed";
        m.winnerId = winnerKey;
        saveState();
        playWinSound(m.teamsEnabled ? null : player.voice);
        renderMatchView();
        renderMatches();
        return;
      }
    }

    saveState();
    if (delta > 0) {
      playPositiveSound(player.voice);
    } else {
      playNegativeSound(player.voice);
    }
    renderMatchView();
  }

  function winGame(matchId, teamOrPlayerId) {
    var m = getMatch(matchId);
    if (!m || m.status === "completed" || m.mode !== "games") return;
    m.games[teamOrPlayerId] = (m.games[teamOrPlayerId] || 0) + 1;
    m.participants.forEach(function (pt) {
      m.balls[pt.playerId] = 0;
    });

    var target = m.raceTo;
    var voice = m.teamsEnabled ? null : getPlayer(teamOrPlayerId).voice;
    if (m.games[teamOrPlayerId] >= target) {
      m.status = "completed";
      m.winnerId = teamOrPlayerId;
      saveState();
      playWinSound(voice);
    } else {
      saveState();
      playPositiveSound(voice);
    }
    renderMatchView();
    renderMatches();
  }

  // ---------------------------------------------------------------------
  // Sharing by email
  // ---------------------------------------------------------------------

  function matchSummaryLine(m) {
    var valid = matchValidParticipants(m);
    if (valid.length < 2) return "";
    var parts;
    if (m.teamsEnabled) {
      parts = ["A", "B"].map(function (teamId) {
        var score = m.mode === "points" ? sumTeamBalls(m, teamId) : m.games[teamId] || 0;
        return teamLabel(m, teamId) + " " + score;
      });
    } else {
      parts = valid.map(function (pt) {
        var pl = getPlayer(pt.playerId);
        var score = m.mode === "points" ? m.balls[pt.playerId] || 0 : m.games[pt.playerId] || 0;
        return pl.name + " " + score + (pt.standby ? " (standby)" : "");
      });
    }
    var line = parts.join(" - ");
    line += m.mode === "points" ? " (point goal " + m.pointGoal + ")" : " (race to " + m.raceTo + ")";
    if (m.status === "completed") {
      var winnerText = m.teamsEnabled ? teamLabel(m, m.winnerId) : getPlayer(m.winnerId) ? getPlayer(m.winnerId).name : "?";
      line += " — winner: " + winnerText;
    } else {
      line += " — in progress";
    }
    return line;
  }

  function shareByEmail(subject, bodyLines) {
    var body = bodyLines.join("\n");
    var href = "mailto:?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body);
    window.location.href = href;
  }

  function shareMatch(matchId) {
    var m = getMatch(matchId);
    if (!m) return;
    var valid = matchValidParticipants(m);
    var subject = m.teamsEnabled
      ? "Pool Match: " + teamLabel(m, "A") + " vs " + teamLabel(m, "B")
      : "Pool Match: " + valid.map(function (pt) { return getPlayer(pt.playerId).name; }).join(" vs ");
    var lines = ["Pool Master Counter", "", matchSummaryLine(m)];
    shareByEmail(subject, lines);
  }

  function shareAllMatches() {
    if (state.matches.length === 0) {
      alert("No matches to share yet.");
      return;
    }
    var sorted = state.matches.slice().sort(function (a, b) {
      return a.createdAt - b.createdAt;
    });
    var lines = ["Pool Master Counter — Match Summary", ""];
    sorted.forEach(function (m) {
      var line = matchSummaryLine(m);
      if (line) lines.push(line);
    });
    shareByEmail("Pool Master Counter — Match Summary", lines);
  }

  // ---------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------

  addPlayerForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var player = addPlayer(newPlayerName.value);
    if (!player) return;
    newPlayerName.value = "";
    renderPlayers();
    if (!newMatchForm.classList.contains("hidden")) {
      populateParticipantList(getCheckedParticipantIds(), getTeamAssignments());
    }
  });

  btnMatchAddPlayer.addEventListener("click", function () {
    var name = window.prompt("New player name:");
    if (name === null) return;
    var player = addPlayer(name);
    if (!player) return;
    renderPlayers();
    var checked = getCheckedParticipantIds();
    checked.push(player.id);
    populateParticipantList(checked, getTeamAssignments());
  });

  useTeamsCheckbox.addEventListener("change", function () {
    populateParticipantList(getCheckedParticipantIds(), getTeamAssignments());
  });

  btnNewMatch.addEventListener("click", function () {
    if (state.players.length < 2) {
      alert("Add at least two players first.");
      return;
    }
    useTeamsCheckbox.checked = false;
    populateParticipantList([]);
    newMatchForm.classList.remove("hidden");
  });

  btnCancelMatch.addEventListener("click", function () {
    newMatchForm.classList.add("hidden");
  });

  Array.prototype.forEach.call(modeRadios, function (radio) {
    radio.addEventListener("change", function () {
      var isPoints = radio.value === "points" && radio.checked;
      if (radio.checked) {
        gamesModeRow.classList.toggle("hidden", isPoints);
        pointsModeRow.classList.toggle("hidden", !isPoints);
      }
    });
  });

  newMatchForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var participantIds = getCheckedParticipantIds();
    if (participantIds.length < 2) {
      alert("Select at least two players for this match.");
      return;
    }
    var teamsEnabled = useTeamsCheckbox.checked;
    var teamAssignments = getTeamAssignments();
    var participantMeta = participantIds.map(function (id) {
      return { playerId: id, teamId: teamAssignments[id] || "A" };
    });

    if (teamsEnabled) {
      var hasA = participantMeta.some(function (p) { return p.teamId === "A"; });
      var hasB = participantMeta.some(function (p) { return p.teamId === "B"; });
      if (!hasA || !hasB) {
        alert("Assign at least one player to each team (A and B).");
        return;
      }
    }

    var mode = "games";
    Array.prototype.forEach.call(modeRadios, function (radio) {
      if (radio.checked) mode = radio.value;
    });
    var target =
      mode === "points" ? parseInt(matchPointGoal.value, 10) || 100 : parseInt(matchRaceTo.value, 10) || 5;

    var match = createMatch(participantMeta, mode, target, teamsEnabled);
    newMatchForm.classList.add("hidden");
    openMatch(match.id);
  });

  btnShareAll.addEventListener("click", shareAllMatches);

  btnBack.addEventListener("click", goHome);

  btnShareMatch.addEventListener("click", function () {
    if (currentMatchId) shareMatch(currentMatchId);
  });

  btnResetMatch.addEventListener("click", function () {
    if (currentMatchId) resetMatch(currentMatchId);
  });

  btnDeleteMatch.addEventListener("click", function () {
    if (currentMatchId) deleteMatch(currentMatchId);
  });

  // ---------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------

  renderPlayers();
  renderMatches();
})();
