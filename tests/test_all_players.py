"""All Players page: bar/graph view toggle, the graph-overflow
regression fix, and Tournament stats (derived from race-to-N wins)."""

from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import Select

from helpers import (
    add_player,
    assert_no_console_errors,
    click_plus,
    dismiss_gamewin_overlay,
    expand_panel,
    set_number_input,
    wait,
)


def _open_all_players(driver):
    # btn-open-all-players ("All Players Stats") lives inside the Players
    # panel, not the always-visible header row.
    expand_panel(driver, "btn-toggle-players-panel")
    driver.find_element(By.ID, "btn-open-all-players").click()
    wait(driver).until(EC.visibility_of_element_located((By.ID, "view-all-players-page")))


def _win_one_race(driver, winner, loser):
    """Completes a full race-to-1 session so both players get a
    Tournament (win/loss) result, at the default target of 1 rack."""
    add_player(driver, winner)
    add_player(driver, loser)
    expand_panel(driver, "btn-toggle-game-setup-panel")
    set_number_input(driver, "race-to-wins", 1)
    click_plus(driver, winner)
    dismiss_gamewin_overlay(driver)
    wait(driver).until(EC.visibility_of_element_located((By.ID, "milestone-overlay")))
    driver.find_element(By.ID, "btn-milestone-close").click()
    wait(driver).until(EC.invisibility_of_element_located((By.ID, "milestone-overlay")))


def test_all_players_lists_every_known_player(app):
    # The app also surfaces names from its bundled players/*.json roster
    # presets regardless of localStorage state, so .all-player-name's
    # rendered text is never *only* "Alice" (the rating badge renders
    # right after it with no separator, e.g. "Alice449") - match with
    # startswith rather than asserting an exact/exclusive list.
    add_player(app, "Alice")
    add_player(app, "Bob")
    _open_all_players(app)
    names = [el.text for el in app.find_elements(By.CSS_SELECTOR, ".all-player-name")]
    assert any(n.startswith("Alice") for n in names), names
    assert any(n.startswith("Bob") for n in names), names
    assert_no_console_errors(app)


def test_player_link_icon_opens_player_stats_page(app):
    # .player-link-icon also appears on the (currently hidden) main
    # scoreboard cards, so scope the query to the visible All Players
    # page rather than a bare app-wide find_element.
    add_player(app, "Alice")
    add_player(app, "Bob")
    _open_all_players(app)
    icon = wait(app).until(
        EC.presence_of_element_located(
            (By.CSS_SELECTOR, "#view-all-players-page .player-link-icon")
        )
    )
    app.execute_script("arguments[0].scrollIntoView({block: 'center'});", icon)
    icon.click()
    wait(app).until(EC.visibility_of_element_located((By.ID, "view-player-page")))
    name = app.find_element(By.ID, "player-page-name").text
    assert name  # whichever known player's card happened to be first


def test_graph_view_does_not_overflow_its_card(app):
    """Regression test for the flexbox min-width bug: the SVG's
    intrinsic aspect-ratio used to act as a flex min-width floor and
    push the whole chart past its card's right edge."""
    _win_one_race(app, "Alice", "Bob")
    _open_all_players(app)
    app.find_element(By.ID, "btn-toggle-all-players-view").click()

    svg = wait(app).until(EC.presence_of_element_located((By.CSS_SELECTOR, ".player-graph-svg")))
    card = svg.find_element(By.XPATH, "ancestor::li[contains(@class,'all-player-card')]")
    svg_rect = app.execute_script("return arguments[0].getBoundingClientRect();", svg)
    card_rect = app.execute_script("return arguments[0].getBoundingClientRect();", card)

    tolerance = 1  # sub-pixel rounding
    assert svg_rect["right"] <= card_rect["right"] + tolerance, (
        "graph right edge ({}) spills past its card's right edge ({})".format(
            svg_rect["right"], card_rect["right"]
        )
    )
    assert svg_rect["left"] >= card_rect["left"] - tolerance
    assert_no_console_errors(app)


def test_tournament_scale_rows_appear_after_a_completed_race(app):
    _win_one_race(app, "Alice", "Bob")
    _open_all_players(app)

    # .scale-row-label is styled text-transform:uppercase, and Selenium's
    # .text reflects rendered (post-CSS) text, so compare case-insensitively.
    labels = [el.text.lower() for el in app.find_elements(By.CSS_SELECTOR, ".scale-row-label")]
    assert "tournaments played" in labels
    assert "tournaments won" in labels
    assert "tournaments lost" in labels
    assert_no_console_errors(app)


def test_graph_time_axis_now_label_has_no_time_of_day(app):
    """Regression test: the "Now" axis label used to include a
    time-of-day ("Now · Sep 3 1:21 PM"), which made it wide enough to
    spill into and overlap the tick label before it, especially on
    narrow/portrait viewports where the same-width text takes up a much
    bigger share of the axis. It's date-only now ("Now · Sep 3")."""
    _win_one_race(app, "Alice", "Bob")
    _open_all_players(app)
    app.find_element(By.ID, "btn-toggle-all-players-view").click()

    now_label = wait(app).until(
        EC.presence_of_element_located((By.CSS_SELECTOR, ".player-graph-time-label.is-now"))
    )
    assert "Now" in now_label.text
    assert ":" not in now_label.text, now_label.text
    assert_no_console_errors(app)


def test_sort_and_period_selects_are_usable(app):
    add_player(app, "Alice")
    _open_all_players(app)
    Select(app.find_element(By.ID, "all-players-sort")).select_by_value("alpha")
    Select(app.find_element(By.ID, "all-players-period")).select_by_value("today")
    assert_no_console_errors(app)
