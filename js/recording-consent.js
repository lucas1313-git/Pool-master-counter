// Before the first recording on a device: a short notice - everyone at the
// table should know they're filmed (and heard, with sound on), and some
// places require their agreement - with a printable "📷 Camera in use"
// sign for the table. Asked once per device (remembered here), on the
// in-app recorder (js/local-recorder.js) and the recording page
// (record.html) alike. Texts from the app's language files.
//
// window.PMCRecordingConsent:
//   ask({ sound }) -> a promise of true (go ahead) / false (cancelled)
//   given()        -> already agreed on this device
//   printSign({ sound })
(function () {
  "use strict";
  var root = window;
  var KEY = "poolMasterCounter.recordingConsent.v1";
  var LANGUAGE_KEY = "poolMasterCounter.language.v1";
  var dict = {}, dictEn = {}, textsLoaded = null;

  function tr(key, vars) {
    var s = dict[key] !== undefined ? dict[key] : dictEn[key] !== undefined ? dictEn[key] : key;
    Object.keys(vars || {}).forEach(function (k) { s = s.split("{{" + k + "}}").join(vars[k]); });
    return s;
  }
  function loadTexts() {
    if (textsLoaded) return textsLoaded;
    var code = "english";
    try { code = localStorage.getItem(LANGUAGE_KEY) || "english"; } catch (e) {}
    function file(name) {
      return fetch("languages/" + name + ".json", { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; });
    }
    textsLoaded = file("english").then(function (en) {
      dictEn = en || {};
      if (code === "english") { dict = dictEn; return; }
      return file(code).then(function (d) { dict = d || {}; });
    });
    return textsLoaded;
  }

  function given() {
    try { return !!localStorage.getItem(KEY); } catch (e) { return false; }
  }

  // The sign: a page of its own on paper (everything else hidden while it prints).
  function printSign(opts) {
    return loadTexts().then(function () {
      var old = document.getElementById("pmc-camera-sign");
      if (old) old.remove();
      var sign = document.createElement("div");
      sign.id = "pmc-camera-sign";
      var big = document.createElement("div");
      big.className = "pmc-sign-title";
      big.textContent = tr("rec.signTitle");
      var line1 = document.createElement("p");
      line1.textContent = tr("rec.signText");
      var line2 = document.createElement("p");
      line2.textContent = tr(opts && opts.sound ? "rec.signSound" : "rec.signNoSound");
      var line3 = document.createElement("p");
      line3.className = "pmc-sign-ask";
      line3.textContent = tr("rec.signAsk");
      sign.appendChild(big);
      sign.appendChild(line1);
      sign.appendChild(line2);
      sign.appendChild(line3);
      var style = document.getElementById("pmc-camera-sign-style");
      if (!style) {
        style = document.createElement("style");
        style.id = "pmc-camera-sign-style";
        style.textContent =
          "#pmc-camera-sign{display:none}" +
          "@media print{body>*:not(#pmc-camera-sign){display:none!important}" +
          "#pmc-camera-sign{display:flex!important;flex-direction:column;justify-content:center;align-items:center;text-align:center;height:95vh;font-family:system-ui,-apple-system,sans-serif;color:#000;background:#fff}" +
          "#pmc-camera-sign .pmc-sign-title{font-size:64pt;font-weight:900;margin-bottom:24pt}" +
          "#pmc-camera-sign p{font-size:22pt;margin:8pt 24pt}" +
          "#pmc-camera-sign .pmc-sign-ask{margin-top:28pt;font-style:italic}}";
        document.head.appendChild(style);
      }
      document.body.appendChild(sign);
      var done = function () { if (sign.parentNode) sign.remove(); root.removeEventListener("afterprint", done); };
      root.addEventListener("afterprint", done);
      try { root.print(); } catch (e) {}
      return sign;
    });
  }

  function ask(opts) {
    if (given()) return Promise.resolve(true);
    return loadTexts().then(function () {
      return new Promise(function (resolve) {
        var overlay = document.createElement("div");
        overlay.id = "pmc-rec-consent";
        overlay.setAttribute("role", "dialog");
        overlay.setAttribute("aria-modal", "true");
        overlay.style.cssText = "position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,0.82);display:flex;align-items:center;justify-content:center;padding:16px;font-family:system-ui,-apple-system,sans-serif;";
        var card = document.createElement("div");
        card.style.cssText = "background:#2a1015;color:#fff;border:2px solid #e8b923;border-radius:16px;max-width:460px;width:100%;padding:22px;text-align:left;box-shadow:0 20px 60px rgba(0,0,0,0.6);";
        var h = document.createElement("h2");
        h.textContent = tr("rec.consentTitle");
        h.style.cssText = "margin:0 0 10px;font-size:1.35rem;text-align:center;";
        var p = document.createElement("p");
        p.textContent = tr(opts && opts.sound ? "rec.consentTextSound" : "rec.consentText");
        p.style.cssText = "margin:0 0 16px;line-height:1.45;";
        function button(label, primary, onClick, id) {
          var b = document.createElement("button");
          b.type = "button";
          b.id = id;
          b.textContent = label;
          b.style.cssText = "display:block;width:100%;margin-top:10px;font-size:1.05rem;font-weight:700;padding:12px;border-radius:12px;cursor:pointer;" +
            (primary ? "border:none;background:#e8b923;color:#241a00;" : "border:1px solid rgba(255,255,255,0.35);background:transparent;color:#fff;");
          b.addEventListener("click", onClick);
          return b;
        }
        function close(answer) {
          overlay.remove();
          if (answer) {
            try { localStorage.setItem(KEY, new Date().toISOString()); } catch (e) {}
          }
          resolve(answer);
        }
        card.appendChild(h);
        card.appendChild(p);
        card.appendChild(button(tr("rec.consentPrint"), false, function () { printSign(opts); }, "pmc-rec-consent-print"));
        card.appendChild(button(tr("rec.consentGo"), true, function () { close(true); }, "pmc-rec-consent-go"));
        card.appendChild(button(tr("rec.consentCancel"), false, function () { close(false); }, "pmc-rec-consent-cancel"));
        overlay.appendChild(card);
        document.body.appendChild(overlay);
      });
    });
  }

  root.PMCRecordingConsent = { ask: ask, given: given, printSign: printSign };
})();
