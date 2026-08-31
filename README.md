# Pool-master-counter

A touch-friendly pool scoring app for phone, tablet, or desktop — runs entirely in the browser, no server required.

## Features

- **Players & matches** — add any number of players, start head-to-head matches with a configurable "race to N games".
- **Games + balls scoring** — tap **+ / −** to track balls potted in the current game; tap **Win Game** to bank the game and reset the ball count. First to the race target wins the match.
- **Sound feedback** — a distinct positive tone when a ball is added and a distinct negative tone when one is removed (synthesized in-browser, no audio files).
- **Touch-first UI** — large tap targets, responsive layout for iPhone, iPad, and desktop.
- **Local storage** — all players and matches persist automatically in the browser, even after closing the tab.
- **Share by email** — send a single match or the full match summary via a pre-filled email.

## Running it

This is a static site — no build step or dependencies.

- **Locally:** open `index.html` in a browser, or serve the folder (e.g. `python3 -m http.server`) and visit it.
- **Online:** enable GitHub Pages for this repo (Settings → Pages → deploy from the `main` branch) and it's live at `https://<username>.github.io/Pool-master-counter/`.

## Structure

- `index.html` — markup for the home view (players/matches) and the match scoring view
- `css/style.css` — responsive, touch-friendly styling
- `js/app.js` — app state, localStorage persistence, sound synthesis, and UI logic

