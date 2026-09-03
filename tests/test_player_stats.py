"""Individual Player Stats page: synopsis rows, the player switcher
dropdown, and the click-to-reveal rating/win-loss dot tooltips."""

from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import Select

from helpers import (
    add_player,
    assert_no_console_errors,
    click_plus,
    expand_panel,
    set_number_input,
    wait,
)


def _open_player_page(driver, name):
    driver.find_element(By.ID, "btn-open-all-players").click()
    wait(driver).until(EC.visibility_of_element_located((By.ID, "view-all-players-page")))
    driver.find_element(
        By.XPATH,
        "//*[contains(@class,'all-player-name')][text()='{}']".format(name),
    ).click()
    wait(driver).until(EC.visibility_of_element_located((By.ID, "view-player-page")))


def _win_one_race(driver, winner, loser):
    add_player(driver, winner)
    add_player(driver, loser)
    expand_panel(driver, "btn-toggle-game-setup-panel")
    set_number_input(driver, "race-to-wins", 1)
    click_plus(driver, winner)
    wait(driver).until(EC.visibility_of_element_located((By.ID, "milestone-overlay")))
    driver.find_element(By.ID, "btn-milestone-close").click()
    wait(driver).until(EC.invisibility_of_element_located((By.ID, "milestone-overlay")))


def _synopsis_rows(driver):
    rows = {}
    for row in driver.find_elements(By.CSS_SELECTOR, "#player-page-synopsis-body .player-stats-row"):
        label = row.find_element(By.CSS_SELECTOR, ".label").text
        value = row.find_element(By.CSS_SELECTOR, ".value").text
        rows[label] = value
    return rows


def test_synopsis_shows_single_game_and_tournament_rows(app):
    _win_one_race(app, "Alice", "Bob")
    _open_player_page(app, "Alice")

    rows = _synopsis_rows(app)
    assert rows["Games won"] == "1"
    assert rows["Games lost"] == "0"
    assert rows["Tournaments played"] == "1"
    assert rows["Tournaments won"] == "1"
    assert rows["Tournaments lost"] == "0"
    assert_no_console_errors(app)


def test_losing_player_synopsis_shows_a_tournament_loss(app):
    _win_one_race(app, "Alice", "Bob")
    _open_player_page(app, "Bob")

    rows = _synopsis_rows(app)
    assert rows["Tournaments played"] == "1"
    assert rows["Tournaments won"] == "0"
    assert rows["Tournaments lost"] == "1"


def test_player_switcher_dropdown_navigates_to_another_player(app):
    add_player(app, "Alice")
    add_player(app, "Bob")
    _open_player_page(app, "Alice")

    Select(app.find_element(By.ID, "player-page-switcher")).select_by_value("Bob")
    # player-page-name's rendered text also includes the rating badge
    # right after it with no separator (e.g. "Bob400").
    wait(app).until(lambda d: d.find_element(By.ID, "player-page-name").text.startswith("Bob"))
    assert_no_console_errors(app)


def test_rating_dot_click_shows_opponent_tooltip(app):
    _win_one_race(app, "Alice", "Bob")
    _open_player_page(app, "Alice")

    dot_hit = wait(app).until(
        EC.presence_of_element_located(
            (By.CSS_SELECTOR, ".player-rating-graph-wrap .player-graph-dot-hit")
        )
    )
    dot_hit.click()

    tooltip = wait(app).until(
        EC.visibility_of_element_located((By.CSS_SELECTOR, ".player-graph-tooltip"))
    )
    assert "Rating" in tooltip.text
    assert "You" in tooltip.text
    assert "Bob" in tooltip.text

    # The "Rating" row's value should be a plain number - the rating at
    # that point in time, not a +/- delta.
    rating_row = tooltip.find_element(
        By.XPATH,
        ".//*[contains(@class,'player-graph-tooltip-row')]"
        "[.//*[contains(@class,'player-graph-tooltip-name')][text()='Rating']]",
    )
    rating_value = rating_row.find_element(
        By.CSS_SELECTOR, ".player-graph-tooltip-record"
    ).text
    assert rating_value.lstrip("-").isdigit()
    assert_no_console_errors(app)


def test_win_loss_dot_click_shows_per_opponent_record(app):
    _win_one_race(app, "Alice", "Bob")
    _open_player_page(app, "Alice")

    # The win/loss chart and the Rating chart share both a container id
    # (#player-page-graph-body) and a dot-hit class, so scope this query
    # to hit-circles that are NOT inside .player-rating-graph-wrap.
    # Several series' lines also all start near (0, height) at the
    # graph's left edge, so their hit-circles can overlap there; the
    # rightmost ("now") point for each series is where they've diverged
    # and is reliably clickable.
    win_loss_hit_xpath = (
        "//*[@id='player-page-graph-body']"
        "//*[contains(@class,'player-graph-dot-hit')]"
        "[not(ancestor::*[contains(@class,'player-rating-graph-wrap')])]"
    )
    wait(app).until(EC.presence_of_element_located((By.XPATH, win_loss_hit_xpath)))
    dot_hits = app.find_elements(By.XPATH, win_loss_hit_xpath)
    dot_hits[-1].click()

    tooltip = wait(app).until(
        EC.visibility_of_element_located((By.CSS_SELECTOR, ".player-graph-tooltip"))
    )
    assert "Bob" in tooltip.text
    assert "win" in tooltip.text.lower()
