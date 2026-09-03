# Pool Master Counter — browser test suite

End-to-end tests that drive the real app in headless Chrome, the same
way it's manually regression-tested during development: no build step,
no mocking of `js/app.js` — just the static files served exactly as
they ship, clicked through like a real user (or a real bug report).

This lives on its own branch (`tests`) rather than `main`, since the
app itself is intentionally dependency-free; the suite's own
dependencies (pytest, Selenium) never need to touch the shipped code.

## Requirements

- Python 3.9+
- Google Chrome installed locally (Selenium 4's built-in Selenium
  Manager downloads a matching chromedriver automatically — nothing
  else to install)

## Setup

```bash
cd tests
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Running

From the `tests/` directory (with the venv active):

```bash
pytest
```

Each test starts its own `python3 -m http.server` on port 8935 (see
`PMC_TEST_PORT` in `conftest.py` if that port is taken) for the whole
session, and gets a fresh headless Chrome + cleared `localStorage`
per test — tests never see each other's players, games, or theme
choice.

Run a single file or test:

```bash
pytest test_scoreboard.py
pytest test_scoreboard.py::test_undo_last_win_reverses_the_credited_win
```

Run with the browser visible (drop `--headless=new` to actually watch
it click through the app):

```bash
PMC_TEST_HEADED=1 pytest
```

(Set that env var and see `conftest.py`'s `driver` fixture if you want
to wire it up — headless is the default since that's what CI needs.)

## What's covered

- `test_boot.py` — cold boot, zero console errors, empty-state UI
- `test_scoreboard.py` — adding players, scoring, win detection at the
  default target, undo, and the race-to-N milestone overlay
- `test_themes.py` — all 10 themes apply `data-theme` correctly, the
  choice persists across reload, and the light themes' graph
  background is a genuine color tint rather than neutral gray
  (regression test for a real bug fixed in this app)
- `test_all_players.py` — the All Players list, the bar/graph view
  toggle, sort/period controls, and a regression test asserting the
  graph never renders past its card's edges (the flexbox min-width
  overflow bug)
- `test_player_stats.py` — the synopsis panel's single-game and
  Tournament rows, the player-switcher dropdown, and the click-to-
  reveal tooltips on both the win/loss graph and the rating graph
- `test_tournament.py` — creating and playing a bracket Tournament to
  completion, and that the champion shows up as a Tournament win on
  their own Player Stats page
- `test_no_stats_mode.py` — the "Do not record games statistics and
  players data" checkbox actually blocks persistence across a reload

## What's intentionally not covered

File-based flows (Export/Import All Data, Export Player Lists, backup
JSON round-trips) aren't exercised here — driving a real file download
+ re-upload headlessly is possible but adds real flakiness for
relatively low bug-catching value next to the flows above. Worth
adding if that area starts regressing.
