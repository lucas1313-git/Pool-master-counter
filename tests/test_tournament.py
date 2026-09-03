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


def _start_round_robin_tournament(driver, target=1, race_to=1):
    driver.find_element(
        By.CSS_SELECTOR, "input[name='tournament-format'][value='roundrobin']"
    ).click()
    set_number_input(driver, "tournament-target", target)
    set_number_input(driver, "tournament-race-to", race_to)
    driver.find_element(By.ID, "btn-tournament-start").click()
    wait(driver).until(EC.visibility_of_element_located((By.ID, "tournament-rr-section")))


def _play_round_robin_match(driver, a, b, winner):
    """Plays the match between a and b (found by name pair, regardless of
    the random shuffle order matches were generated in) at target=1/
    race-to=1, crediting winner the single rack needed to decide it."""
    matches_container = driver.find_element(By.ID, "tournament-rr-matches")
    card = matches_container.find_element(
        By.XPATH,
        ".//*[contains(@class,'tournament-match-card')]"
        "[.//*[contains(@class,'tournament-match-side')][contains(text(),'{}')]]"
        "[.//*[contains(@class,'tournament-match-side')][contains(text(),'{}')]]".format(a, b),
    )
    play_buttons = card.find_elements(By.CSS_SELECTOR, ".tournament-play-btn")
    if play_buttons:
        play_buttons[0].click()
        wait(driver).until(
            EC.visibility_of_element_located((By.ID, "tournament-current-match-panel"))
        )
    _click_plus_in_active_match(driver, winner)


def test_round_robin_generates_every_pairwise_match(app):
    add_player(app, "Alice")
    add_player(app, "Bob")
    add_player(app, "Charlie")
    _open_tournament_page(app)
    _start_round_robin_tournament(app)

    cards = app.find_elements(By.CSS_SELECTOR, "#tournament-rr-matches .tournament-match-card")
    assert len(cards) == 3  # 3 players -> 3 unique pairings
    standings_rows = app.find_elements(By.CSS_SELECTOR, "#tournament-rr-standings li")
    assert len(standings_rows) == 3
    assert_no_console_errors(app)


def test_round_robin_played_to_completion_crowns_a_champion(app):
    add_player(app, "Alice")
    add_player(app, "Bob")
    _open_tournament_page(app)
    _start_round_robin_tournament(app)

    # Exactly one pairing exists for 2 players, so it auto-starts.
    _click_plus_in_active_match(app, "Alice")

    banner = wait(app).until(
        EC.visibility_of_element_located((By.ID, "tournament-champion-banner"))
    )
    assert "Alice" in banner.text
    assert "won the tournament" in banner.text
    standings_row = app.find_element(By.CSS_SELECTOR, "#tournament-rr-standings li")
    assert "is-champion" in standings_row.get_attribute("class")
    assert_no_console_errors(app)


def test_round_robin_tie_produces_shared_co_champions(app):
    add_player(app, "Alice")
    add_player(app, "Bob")
    add_player(app, "Charlie")
    add_player(app, "Dave")
    _open_tournament_page(app)
    _start_round_robin_tournament(app)

    # Engineered so Alice and Dave both finish 2-1 (2 wins out of 3
    # matches each) and Bob/Charlie both finish 1-2 - a clean 2-way tie
    # for first between Alice and Dave.
    _play_round_robin_match(app, "Alice", "Bob", winner="Alice")
    _play_round_robin_match(app, "Alice", "Charlie", winner="Alice")
    _play_round_robin_match(app, "Bob", "Charlie", winner="Bob")
    _play_round_robin_match(app, "Bob", "Dave", winner="Dave")
    _play_round_robin_match(app, "Charlie", "Dave", winner="Charlie")
    _play_round_robin_match(app, "Alice", "Dave", winner="Dave")

    banner = wait(app).until(
        EC.visibility_of_element_located((By.ID, "tournament-champion-banner"))
    )
    assert "tied for the win" in banner.text
    assert "Alice" in banner.text
    assert "Dave" in banner.text

    champion_rows = app.find_elements(By.CSS_SELECTOR, "#tournament-rr-standings li.is-champion")
    assert len(champion_rows) == 2
    champion_text = " ".join(row.text for row in champion_rows)
    assert "Alice" in champion_text
    assert "Dave" in champion_text
    assert "Bob" not in champion_text
    assert "Charlie" not in champion_text
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
