// Big data in IndexedDB instead of localStorage's ~5 MB (Safari counts two
// bytes a letter): the players' game logs, the report archive, Recover Data
// copies, the camera's player samples. Shared by the scoreboard (app.js) and
// the camera page.
//
// One database ("pmc-big"), one store; each value is kept under
// "<name>@<generation>". The generation in use is a small localStorage key,
// so an import can write a whole new set of big values first and then switch
// to it in the same all-or-nothing localStorage write as everything else -
// or, if that write fails, not at all (see app.js withStorageRollback).
//
// Each name also has its old localStorage key: a value still found there
// (from before this, a test, or a fallback write) is the newest - it moves
// into the database and the key is cleared. Without IndexedDB (a browser
// that refuses it) everything stays in those localStorage keys, as before.
(function () {
  var DB_NAME = "pmc-big";
  var STORE = "kv";
  var GEN_KEY = "poolMasterCounter.bigStoreGen.v1";
  var legacyKeys = {};
  var dbPromise = null;
  var available = typeof indexedDB !== "undefined";

  function openDb() {
    if (!dbPromise) {
      dbPromise = new Promise(function (resolve, reject) {
        var req;
        try {
          req = indexedDB.open(DB_NAME, 1);
        } catch (e) {
          reject(e);
          return;
        }
        req.onupgradeneeded = function () {
          req.result.createObjectStore(STORE);
        };
        req.onsuccess = function () {
          resolve(req.result);
        };
        req.onerror = function () {
          reject(req.error || new Error("IndexedDB unavailable"));
        };
      });
      dbPromise.catch(function () {
        available = false;
      });
    }
    return dbPromise;
  }

  function request(mode, run) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, mode);
        var req = run(tx.objectStore(STORE));
        tx.oncomplete = function () {
          resolve(req ? req.result : undefined);
        };
        tx.onerror = tx.onabort = function () {
          reject(tx.error || new Error("IndexedDB write failed"));
        };
      });
    });
  }

  function gen() {
    try {
      return localStorage.getItem(GEN_KEY) || "0";
    } catch (e) {
      return "0";
    }
  }
  function key(name, g) {
    return name + "@" + (g || gen());
  }
  function readLegacy(name) {
    var k = legacyKeys[name];
    if (!k) return null;
    try {
      var raw = localStorage.getItem(k);
      return raw === null ? null : { value: JSON.parse(raw) };
    } catch (e) {
      return null;
    }
  }

  var api = {
    GEN_KEY: GEN_KEY,
    // name -> its old localStorage key (see above)
    register: function (name, legacyKey) {
      legacyKeys[name] = legacyKey;
    },
    available: function () {
      return available;
    },
    gen: gen,
    newGen: function () {
      return String(Date.now());
    },
    // The value (fallback when there's none): an old localStorage copy moves in first.
    load: function (name, fallback) {
      var legacy = readLegacy(name);
      return openDb().then(
        function () {
          if (legacy) {
            return api.set(name, legacy.value).then(function () {
              try {
                localStorage.removeItem(legacyKeys[name]);
              } catch (e) {}
              return legacy.value;
            });
          }
          return request("readonly", function (store) {
            return store.get(key(name));
          }).then(function (v) {
            return v === undefined ? fallback : v;
          });
        },
        function () {
          return legacy ? legacy.value : fallback;
        }
      );
    },
    // Saves under the generation in use (or g). Rejects when it can't (storage full...).
    set: function (name, value, g) {
      if (!available) {
        return new Promise(function (resolve) {
          localStorage.setItem(legacyKeys[name], JSON.stringify(value));
          resolve();
        });
      }
      return request("readwrite", function (store) {
        return store.put(value, key(name, g));
      });
    },
    // Drops every value not of the generation in use (an import switched).
    prune: function () {
      if (!available) return Promise.resolve();
      var current = "@" + gen();
      return request("readwrite", function (store) {
        var req = store.openCursor();
        req.onsuccess = function () {
          var cursor = req.result;
          if (!cursor) return;
          if (String(cursor.key).slice(-current.length) !== current) cursor.delete();
          cursor.continue();
        };
        return null;
      });
    }
  };
  window.PMCBigStore = api;
})();
