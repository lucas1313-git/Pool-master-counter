(function () {
  "use strict";

  var STORAGE_KEY = "poolMasterCounter.state.v1";

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
        return { playerId: id, standby: false };
      });
      delete m.player1Id;
      delete m.player2Id;
    }
    if (!m.mode) m.mode = "games";
    if (typeof m.pointGoal !== "number") m.pointGoal = 100;
    if (typeof m.raceTo !== "number") m.raceTo = 5;
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

  function playPositiveSound() {
    var ctx = getAudioCtx();
    var now = ctx.currentTime;
    tone(660, now, 0.09, "triangle", 0.22);
    tone(990, now + 0.07, 0.14, "triangle", 0.2);
  }

  function playNegativeSound() {
    var ctx = getAudioCtx();
    var now = ctx.currentTime;
    tone(220, now, 0.18, "sawtooth", 0.18);
    tone(160, now + 0.05, 0.22, "sawtooth", 0.16);
  }

  function playWinSound() {
    var ctx = getAudioCtx();
    var now = ctx.currentTime;
    tone(523, now, 0.12, "triangle", 0.22);
    tone(659, now + 0.1, 0.12, "triangle", 0.22);
    tone(784, now + 0.2, 0.28, "triangle", 0.24);
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

  function populateParticipantList(checkedIds) {
    checkedIds = checkedIds || [];
    participantList.innerHTML = "";
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

      li.appendChild(checkbox);
      li.appendChild(label);
      participantList.appendChild(li);
    });
  }

  function getCheckedParticipantIds() {
    var boxes = participantList.querySelectorAll("input[type=checkbox]:checked");
    return Array.prototype.map.call(boxes, function (b) {
      return b.value;
    });
  }

  function addPlayer(name) {
    name = (name || "").trim();
    if (!name) return null;
    var player = { id: uid(), name: name };
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
      names.textContent = valid
        .map(function (pt) {
          var pl = getPlayer(pt.playerId);
          return pl.name + (pt.standby ? " (standby)" : "");
        })
        .join(" vs ");

      var sub = document.createElement("div");
      sub.className = "sub";
      sub.textContent = m.mode === "points" ? "Point goal " + m.pointGoal : "Race to " + m.raceTo;
      if (m.status === "completed") {
        var badge = document.createElement("span");
        badge.className = "badge-done";
        var winner = getPlayer(m.winnerId);
        badge.textContent = winner ? winner.name + " won" : "Done";
        sub.appendChild(badge);
      }
      left.appendChild(names);
      left.appendChild(sub);

      var score = document.createElement("div");
      score.className = "score";
      score.textContent = valid
        .map(function (pt) {
          return m.mode === "points" ? m.balls[pt.playerId] || 0 : m.games[pt.playerId] || 0;
        })
        .join(" – ");

      li.appendChild(left);
      li.appendChild(score);
      matchList.appendChild(li);
    });
  }

  // ---------------------------------------------------------------------
  // Match creation / deletion
  // ---------------------------------------------------------------------

  function createMatch(participantIds, mode, target) {
    var match = {
      id: uid(),
      participants: participantIds.map(function (id) {
        return { playerId: id, standby: false };
      }),
      mode: mode,
      raceTo: mode === "games" ? target : 5,
      pointGoal: mode === "points" ? target : 100,
      status: "in_progress",
      winnerId: null,
      games: {},
      balls: {},
      createdAt: Date.now()
    };
    participantIds.forEach(function (id) {
      match.games[id] = 0;
      match.balls[id] = 0;
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
    m.participants.forEach(function (pt) {
      m.games[pt.playerId] = 0;
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

    var names = valid
      .map(function (pt) {
        return getPlayer(pt.playerId).name;
      })
      .join(" vs ");
    var modeLabel = m.mode === "points" ? "Point goal " + m.pointGoal : "Race to " + m.raceTo;
    matchRaceLabel.textContent = names + " · " + modeLabel;

    if (m.status === "completed") {
      var winner = getPlayer(m.winnerId);
      winnerBanner.textContent = "🏆 " + (winner ? winner.name : "") + " wins the match!";
      winnerBanner.classList.remove("hidden");
    } else {
      winnerBanner.classList.add("hidden");
    }

    scoreboard.innerHTML = "";
    valid.forEach(function (pt) {
      scoreboard.appendChild(buildPlayerPanel(m, pt));
    });
  }

  function buildPlayerPanel(match, participant) {
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
    panel.appendChild(controls);

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

  function adjustBalls(matchId, playerId, delta) {
    var m = getMatch(matchId);
    if (!m || m.status === "completed") return;
    var next = (m.balls[playerId] || 0) + delta;
    if (next < 0) next = 0;
    m.balls[playerId] = next;

    if (m.mode === "points" && delta > 0 && next >= m.pointGoal) {
      m.status = "completed";
      m.winnerId = playerId;
      saveState();
      playWinSound();
      renderMatchView();
      renderMatches();
      return;
    }

    saveState();
    if (delta > 0) {
      playPositiveSound();
    } else {
      playNegativeSound();
    }
    renderMatchView();
  }

  function winGame(matchId, playerId) {
    var m = getMatch(matchId);
    if (!m || m.status === "completed" || m.mode !== "games") return;
    m.games[playerId] = (m.games[playerId] || 0) + 1;
    m.participants.forEach(function (pt) {
      m.balls[pt.playerId] = 0;
    });

    if (m.games[playerId] >= m.raceTo) {
      m.status = "completed";
      m.winnerId = playerId;
      saveState();
      playWinSound();
    } else {
      saveState();
      playPositiveSound();
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
    var parts = valid.map(function (pt) {
      var pl = getPlayer(pt.playerId);
      var score = m.mode === "points" ? m.balls[pt.playerId] || 0 : m.games[pt.playerId] || 0;
      return pl.name + " " + score + (pt.standby ? " (standby)" : "");
    });
    var line = parts.join(" - ");
    line += m.mode === "points" ? " (point goal " + m.pointGoal + ")" : " (race to " + m.raceTo + ")";
    if (m.status === "completed") {
      var w = getPlayer(m.winnerId);
      line += " — winner: " + (w ? w.name : "?");
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
    var subject = "Pool Match: " + valid.map(function (pt) { return getPlayer(pt.playerId).name; }).join(" vs ");
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
      populateParticipantList(getCheckedParticipantIds());
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
    populateParticipantList(checked);
  });

  btnNewMatch.addEventListener("click", function () {
    if (state.players.length < 2) {
      alert("Add at least two players first.");
      return;
    }
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
    var mode = "games";
    Array.prototype.forEach.call(modeRadios, function (radio) {
      if (radio.checked) mode = radio.value;
    });
    var target =
      mode === "points" ? parseInt(matchPointGoal.value, 10) || 100 : parseInt(matchRaceTo.value, 10) || 5;

    var match = createMatch(participantIds, mode, target);
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
