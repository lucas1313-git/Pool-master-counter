// camera.html in the device's language (P19 - a start). It reads the app's
// own languages/*.json ("cam.*" keys, plus a few "common.*"): static text
// carries data-i18n / data-i18n-aria-label / data-i18n-title, and text the
// page sets itself goes through window.CT(key, english, vars) - English
// until the language file has loaded, or for a key not translated yet.
// The language: ?lang=, else this browser's app setting, else English.
(function () {
  var LANGUAGE_KEY = "poolMasterCounter.language.v1";
  var HTML_LANG = { english: "en", french: "fr", spanish: "es", tagalog: "tl", cantonese: "yue" };
  var dict = null;
  var code = null;
  try { code = new URLSearchParams(location.search).get("lang"); } catch (e) {}
  if (!code) {
    try { code = localStorage.getItem(LANGUAGE_KEY); } catch (e) {}
  }
  if (!HTML_LANG[code]) code = "english";

  function fill(text, vars) {
    return String(text).replace(/\{\{(\w+)\}\}/g, function (m, k) {
      return vars && vars[k] !== undefined ? vars[k] : m;
    });
  }

  window.CT = function (key, english, vars) {
    return fill(dict && dict[key] ? dict[key] : english, vars);
  };

  function apply(root) {
    if (!dict) return;
    Array.prototype.forEach.call(root.querySelectorAll("[data-i18n]"), function (el) {
      var v = dict[el.getAttribute("data-i18n")];
      if (v) el.textContent = v;
    });
    ["aria-label", "title", "placeholder"].forEach(function (attr) {
      Array.prototype.forEach.call(root.querySelectorAll("[data-i18n-" + attr + "]"), function (el) {
        var v = dict[el.getAttribute("data-i18n-" + attr)];
        if (v) el.setAttribute(attr, v);
      });
    });
    if (dict["cam.pageTitle"] && /camera\.html$/.test(location.pathname)) document.title = dict["cam.pageTitle"];
  }

  window.PMCCameraI18n = { code: code, apply: apply };
  if (code === "english") return;
  fetch("languages/" + code + ".json", { cache: "no-cache" })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      if (!d) return;
      dict = d;
      var go = function () {
        document.documentElement.lang = HTML_LANG[code];
        apply(document);
        // (the labels the page set itself before the words arrived)
        if (typeof window.onCameraI18nReady === "function") window.onCameraI18nReady();
      };
      if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", go);
      else go();
    })
    .catch(function () {});
})();
