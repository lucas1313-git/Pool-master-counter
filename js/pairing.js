// Pairing this device with the scoreboard's computer (server/pairing.js).
// On a page the computer's server sends: a phone or tablet that isn't
// paired yet is asked once for the code shown on the computer (a scanned QR
// carries it as ?pair=, so that pairs by itself); after that it's paired
// for good. The computer itself never needs to. Anywhere else (the GitHub
// copy, the iOS app, a file) /api/pair/status isn't there and this does
// nothing.
//
// window.PMCPairing (for the scoreboard, see js/app.js):
//   ready            a promise of { paired, local } (null off the server)
//   withCode(url)    a promise of url + "pair=<code>" (for a QR another
//                    device scans); url unchanged when there's no code
//   renderPanel(el)  the computer's "📱 Paired devices" panel
(function () {
  "use strict";
  var root = window;
  var LANGUAGE_KEY = "poolMasterCounter.language.v1";
  var dict = {};
  var dictEn = {};

  function tr(key, vars) {
    var s = dict[key] !== undefined ? dict[key] : dictEn[key] !== undefined ? dictEn[key] : key;
    Object.keys(vars || {}).forEach(function (k) { s = s.split("{{" + k + "}}").join(vars[k]); });
    return s;
  }
  function getJson(url, opts) {
    return fetch(url, Object.assign({ cache: "no-store", credentials: "same-origin" }, opts || {})).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (body) {
        body.__status = r.status;
        return body;
      });
    });
  }
  // the texts, from the app's own language files (English underneath)
  function loadTexts() {
    var code = "english";
    try { code = localStorage.getItem(LANGUAGE_KEY) || "english"; } catch (e) {}
    function file(name) {
      return fetch("languages/" + name + ".json", { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; });
    }
    return file("english").then(function (en) {
      dictEn = en || {};
      if (code === "english") { dict = dictEn; return; }
      return file(code).then(function (d) { dict = d || {}; });
    });
  }

  function deviceName() {
    var ua = navigator.userAgent || "";
    var kind = /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? "iPad" : /iPhone/.test(ua) ? "iPhone" : /Android/.test(ua) ? "Android" : /Mac/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : "Device";
    var page = (location.pathname.split("/").pop() || "index.html").replace(/\.html$/, "");
    return kind + " (" + (page === "index" || !page ? "scoreboard" : page) + ")";
  }

  function pairWith(code) {
    return getJson("api/pair", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: String(code || "").replace(/\D/g, ""), name: deviceName() })
    });
  }

  function dropCodeFromAddress() {
    try {
      var u = new URL(location.href);
      if (!u.searchParams.has("pair")) return;
      u.searchParams.delete("pair");
      history.replaceState(null, "", u.pathname + (u.searchParams.toString() ? "?" + u.searchParams.toString() : "") + u.hash);
    } catch (e) {}
  }

  // ---- the "pair this device" screen ----
  function showPairScreen(message) {
    var old = document.getElementById("pmc-pair-overlay");
    if (old) old.remove();
    var overlay = document.createElement("div");
    overlay.id = "pmc-pair-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.style.cssText = "position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,0.82);display:flex;align-items:center;justify-content:center;padding:16px;font-family:system-ui,-apple-system,sans-serif;";
    var card = document.createElement("div");
    card.style.cssText = "background:#2a1015;color:#fff;border:2px solid #e8b923;border-radius:16px;max-width:420px;width:100%;padding:24px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.6);";
    var h = document.createElement("h2");
    h.textContent = tr("pair.title");
    h.style.cssText = "margin:0 0 10px;font-size:1.4rem;";
    var p = document.createElement("p");
    p.textContent = tr("pair.intro");
    p.style.cssText = "margin:0 0 16px;line-height:1.4;opacity:0.9;";
    var input = document.createElement("input");
    input.type = "text";
    input.inputMode = "numeric";
    input.autocomplete = "one-time-code";
    input.maxLength = 6;
    input.placeholder = "123456";
    input.id = "pmc-pair-code";
    input.setAttribute("aria-label", tr("pair.codeLabel"));
    input.style.cssText = "font-size:2.2rem;letter-spacing:0.3em;text-align:center;width:100%;box-sizing:border-box;padding:10px;border-radius:10px;border:2px solid #e8b923;background:#140608;color:#fff;margin-bottom:12px;";
    var status = document.createElement("p");
    status.id = "pmc-pair-status";
    status.style.cssText = "min-height:1.4em;margin:0 0 12px;color:#ffd27a;";
    status.textContent = message || "";
    var btn = document.createElement("button");
    btn.type = "button";
    btn.id = "pmc-pair-button";
    btn.textContent = tr("pair.button");
    btn.style.cssText = "font-size:1.15rem;font-weight:800;padding:12px 24px;border-radius:12px;border:none;background:#e8b923;color:#241a00;cursor:pointer;width:100%;";
    function submit() {
      btn.disabled = true;
      status.textContent = tr("pair.pairing");
      pairWith(input.value).then(function (r) {
        if (r.ok) {
          status.textContent = tr("pair.done");
          location.reload();
          return;
        }
        btn.disabled = false;
        status.textContent = r.__status === 429 ? tr("pair.tooMany") : tr("pair.wrongCode");
        input.select();
      }).catch(function () {
        btn.disabled = false;
        status.textContent = tr("pair.noServer");
      });
    }
    btn.addEventListener("click", submit);
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") submit(); });
    card.appendChild(h);
    card.appendChild(p);
    card.appendChild(input);
    card.appendChild(status);
    card.appendChild(btn);
    overlay.appendChild(card);
    (document.body || document.documentElement).appendChild(overlay);
    setTimeout(function () { try { input.focus(); } catch (e) {} }, 50);
  }

  var api = { ready: null, status: null, tr: tr };

  api.ready = (/^https?:$/.test(location.protocol) ? getJson("api/pair/status") : Promise.reject(new Error("not served")))
    .then(function (st) {
      if (st.__status !== 200 || typeof st.paired !== "boolean") return null;
      api.status = st;
      var fromLink = null;
      try { fromLink = new URL(location.href).searchParams.get("pair"); } catch (e) {}
      if (st.paired) {
        if (fromLink) dropCodeFromAddress();
        return st;
      }
      return loadTexts().then(function () {
        if (!fromLink) {
          showPairScreen();
          return st;
        }
        return pairWith(fromLink).then(function (r) {
          if (r.ok) {
            dropCodeFromAddress();
            location.reload();
            return st;
          }
          dropCodeFromAddress();
          showPairScreen(tr("pair.linkExpired"));
          return st;
        });
      });
    })
    .catch(function () { return null; });

  // url with this moment's pairing code in it (another device scanning it
  // pairs by itself)
  api.withCode = function (url) {
    return api.ready.then(function (st) {
      if (!st || !st.paired) return url;
      return getJson("api/pair/code").then(function (r) {
        if (!r.code) return url;
        return url + (url.indexOf("?") === -1 ? "?" : "&") + "pair=" + r.code;
      });
    }).catch(function () { return url; });
  };

  // ---- the computer's panel: the code, its QR, the paired devices, the
  // address for the Siri Shortcut and the iPad camera app ----
  api.renderPanel = function (container) {
    return api.ready.then(function (st) {
      if (!st || !st.local) return false;
      return loadTexts().then(function () {
        return Promise.all([getJson("api/pair/code"), getJson("api/pair/devices"), getJson("api/lan-info")]);
      }).then(function (all) {
        var codeInfo = all[0], list = all[1], lan = all[2];
        var host = (lan.addresses && lan.addresses[0] ? lan.addresses[0] : location.hostname) + ":" + (lan.port || location.port);
        container.innerHTML = "";
        function para(text, cls) {
          var p = document.createElement("p");
          p.className = cls || "player-stats-note";
          p.textContent = text;
          container.appendChild(p);
          return p;
        }
        para(tr("pair.panelIntro"));
        var codeEl = document.createElement("div");
        codeEl.className = "pair-panel-code";
        codeEl.id = "pair-panel-code";
        codeEl.textContent = codeInfo.code || "—";
        container.appendChild(codeEl);
        var pairUrl = "http://" + host + "/?pair=" + codeInfo.code;
        var qr = document.createElement("img");
        qr.className = "pair-panel-qr";
        qr.alt = tr("pair.panelQrAlt");
        qr.src = "api/qr.png?url=" + encodeURIComponent(pairUrl);
        container.appendChild(qr);
        para(tr("pair.panelQrHint", { url: pairUrl }));
        var h = document.createElement("h3");
        h.className = "tournament-section-heading";
        h.textContent = tr("pair.panelDevices");
        container.appendChild(h);
        var ul = document.createElement("ul");
        ul.className = "pair-panel-devices";
        ul.id = "pair-panel-devices";
        var devices = list.devices || [];
        if (!devices.length) {
          var none = document.createElement("li");
          none.className = "empty-hint";
          none.textContent = tr("pair.panelNoDevices");
          ul.appendChild(none);
        }
        devices.forEach(function (d) {
          var li = document.createElement("li");
          var label = document.createElement("span");
          label.textContent = d.name + " — " + tr("pair.panelLastSeen", { when: new Date(d.lastSeen || d.pairedAt).toLocaleString() });
          var forget = document.createElement("button");
          forget.type = "button";
          forget.className = "btn btn-ghost";
          forget.textContent = tr("pair.panelForget");
          forget.addEventListener("click", function () {
            getJson("api/pair/forget", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: d.id }) }).then(function () { api.renderPanel(container); });
          });
          li.appendChild(label);
          li.appendChild(forget);
          ul.appendChild(li);
        });
        container.appendChild(ul);
        var h2 = document.createElement("h3");
        h2.className = "tournament-section-heading";
        h2.textContent = tr("pair.panelAppTitle");
        container.appendChild(h2);
        para(tr("pair.panelAppHint"));
        var appRow = document.createElement("p");
        appRow.className = "pair-panel-app-address";
        appRow.id = "pair-panel-app-address";
        container.appendChild(appRow);
        var show = document.createElement("button");
        show.type = "button";
        show.className = "btn btn-ghost";
        show.textContent = tr("pair.panelAppShow");
        show.addEventListener("click", function () {
          getJson("api/pair/app-token").then(function (r) {
            if (!r.token) return;
            appRow.textContent = "http://" + host + "/?device=" + r.token;
            show.classList.add("hidden");
          });
        });
        container.appendChild(show);
        var all2 = document.createElement("button");
        all2.type = "button";
        all2.className = "btn btn-danger";
        all2.textContent = tr("pair.panelForgetAll");
        // (two taps: the first asks)
        var armed = false;
        all2.addEventListener("click", function () {
          if (!armed) {
            armed = true;
            all2.textContent = tr("pair.panelForgetAllConfirm");
            setTimeout(function () { armed = false; all2.textContent = tr("pair.panelForgetAll"); }, 5000);
            return;
          }
          getJson("api/pair/forget", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ all: true }) }).then(function () { api.renderPanel(container); });
        });
        container.appendChild(all2);
        return true;
      });
    }).catch(function () { return false; });
  };

  root.PMCPairing = api;
})();
