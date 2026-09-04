# Languages

Each file here is a flat `"key": "translated string"` dictionary for one
language. `english.json` is canonical — every key the app ever asks for
via `T(key)` must exist there, since it's always loaded as the fallback
dictionary. Other language files only need the keys that have actually
been translated; anything missing (or any file that fails to load) falls
back to the English string automatically, so a partially-translated
language never shows a raw key to the user.

## Adding a language

This is a static site with no server, so the app can't ask the
filesystem "what's in this folder" the way a native app could — there is
no directory listing over plain HTTP. Instead, `manifest.json` **is**
the list the language selector reads. To add a language:

1. Add `yourlanguage.json` here, with as many keys translated as you have
   (even `{}` works — it'll just show all-English until filled in).
2. Add an entry to `manifest.json`:
   ```json
   { "code": "yourlanguage", "file": "yourlanguage.json", "label": "Native name", "flag": "🏳️" }
   ```
3. Reload the app — the new language appears in the selector next to the
   theme selector automatically.

`code` is the value stored in `localStorage` (`poolMasterCounter.language.v1`)
and the key used in the per-player name-translation store — keep it
stable once a language ships, since renaming it orphans anyone's saved
data for it.

## What's translated

UI labels, buttons, help text, and screen content go through this
system. Dates are NOT part of it — the app always displays dates in
`YYYY-MM-DD` regardless of language (see `formatDateISO` in `js/app.js`).
Exported/imported data files (Export All Data, Export Player Lists, any
downloaded backup or report) are also NOT translated on purpose, so a
backup made in one language can always be read back in any other.
