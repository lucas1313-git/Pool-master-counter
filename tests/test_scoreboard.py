"""Main scoreboard: adding players, scoring, win detection, the
race-to-N milestone overlay, and undo — the core game loop."""

from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC

from helpers import (
    add_player,
    assert_no_console_errors,
    click_plus,
    dismiss_gamewin_overlay,
    expand_panel,
    set_number_input,
    stat_value_for,
    wait,
)


def test_added_players_show_on_scoreboard_with_zero_score(app):
    add_player(app, "Alice")
    add_player(app, "Bob")
    assert stat_value_for(app, "Alice") == "0"
    assert stat_value_for(app, "Bob") == "0"
    assert_no_console_errors(app)


def test_plus_button_credits_a_win_at_default_target_1(app):
    # defaultState() ships with currentGame.target = 1, so a single '+'
    # is a complete rack and should immediately credit a win: the toast
    # announces it and the ball count resets to 0 for the next rack.
    add_player(app, "Alice")
    add_player(app, "Bob")
    click_plus(app, "Alice")

    toast = wait(app).until(EC.visibility_of_element_located((By.ID, "win-toast")))
    assert "Alice" in toast.text
    assert stat_value_for(app, "Alice") == "0"
    assert_no_console_errors(app)


def test_undo_last_win_reverses_the_credited_win(app):
    add_player(app, "Alice")
    add_player(app, "Bob")
    click_plus(app, "Alice")
    wait(app).until(EC.visibility_of_element_located((By.ID, "win-toast")))
    dismiss_gamewin_overlay(app)

    expand_panel(app, "btn-toggle-game-setup-panel")
    app.find_element(By.ID, "btn-undo-win").click()

    toast = wait(app).until(EC.visibility_of_element_located((By.ID, "win-toast")))
    assert "Undid" in toast.text
    assert_no_console_errors(app)


def test_race_to_n_completion_shows_milestone_overlay(app):
    add_player(app, "Alice")
    add_player(app, "Bob")

    expand_panel(app, "btn-toggle-game-setup-panel")
    set_number_input(app, "race-to-wins", 1)

    click_plus(app, "Alice")
    dismiss_gamewin_overlay(app)

    overlay = wait(app).until(EC.visibility_of_element_located((By.ID, "milestone-overlay")))
    assert overlay.is_displayed()
    headline = app.find_element(By.ID, "milestone-headline").text
    assert "Alice" in headline
    assert "1 wins" in headline

    app.find_element(By.ID, "btn-milestone-close").click()
    wait(app).until(EC.invisibility_of_element_located((By.ID, "milestone-overlay")))
    assert_no_console_errors(app)
