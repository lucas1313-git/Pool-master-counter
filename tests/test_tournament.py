"""Bracket Tournament page: creating a tournament, playing a match to
completion, and the champion banner / 30-note fanfare trigger path."""

from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC

from helpers import add_player, assert_no_console_errors, set_number_input, wait


def _open_tournament_page(driver):
    driver.find_element(By.ID, "btn-open-tournament").click()
    wait(driver).until(EC.visibility_of_element_located((By.ID, "view-tournament-page")))


def _start_single_elim_tournament(driver, target=1, race_to=1):
    driver.find_element(
        By.CSS_SELECTOR, "input[name='tournament-format'][value='single']"
    ).click()
    set_number_input(driver, "tournament-target", target)
    set_number_input(driver, "tournament-race-to", race_to)
    driver.find_element(By.ID, "btn-tournament-start").click()
    wait(driver).until(
        EC.visibility_of_element_located((By.ID, "tournament-current-match-panel"))
    )


def _click_plus_in_active_match(driver, player_name):
    panel = driver.find_element(By.ID, "tournament-current-match-panel")
    side = panel.find_element(
        By.XPATH,
        ".//*[contains(@class,'player-panel')]"
        "[.//*[contains(@class,'player-name')][contains(text(),'{}')]]".format(player_name),
    )
    side.find_element(By.CSS_SELECTOR, ".btn-ball.plus").click()


def test_tournament_setup_form_is_reachable(app):
    add_player(app, "Alice")
    add_player(app, "Bob")
    _open_tournament_page(app)
    assert app.find_element(By.ID, "tournament-setup-panel").is_displayed()
    assert_no_console_errors(app)


def test_playing_a_single_elimination_match_to_completion_crowns_a_champion(app):
    add_player(app, "Alice")
    add_player(app, "Bob")
    _open_tournament_page(app)
    _start_single_elim_tournament(app, target=1, race_to=1)

    _click_plus_in_active_match(app, "Alice")

    banner = wait(app).until(
        EC.visibility_of_element_located((By.ID, "tournament-champion-banner"))
    )
    assert "Alice" in banner.text
    assert "won the tournament" in banner.text
    assert_no_console_errors(app)


def test_champion_is_recorded_as_a_tournament_win_in_player_stats(app):
    add_player(app, "Alice")
    add_player(app, "Bob")
    _open_tournament_page(app)
    _start_single_elim_tournament(app, target=1, race_to=1)
    _click_plus_in_active_match(app, "Alice")
    wait(app).until(EC.visibility_of_element_located((By.ID, "tournament-champion-banner")))

    # btn-open-all-players lives in the main screen's header, not on the
    # Tournament page - go back to main first.
    app.find_element(By.ID, "btn-tournament-back").click()
    wait(app).until(EC.visibility_of_element_located((By.ID, "btn-open-all-players")))
    app.find_element(By.ID, "btn-open-all-players").click()
    wait(app).until(EC.visibility_of_element_located((By.ID, "view-all-players-page")))
    app.find_element(
        By.XPATH, "//*[contains(@class,'all-player-name')][text()='Alice']"
    ).click()
    wait(app).until(EC.visibility_of_element_located((By.ID, "view-player-page")))

    rows = {
        row.find_element(By.CSS_SELECTOR, ".label").text: row.find_element(
            By.CSS_SELECTOR, ".value"
        ).text
        for row in app.find_elements(By.CSS_SELECTOR, "#player-page-synopsis-body .player-stats-row")
    }
    assert rows["Tournaments won"] == "1"
