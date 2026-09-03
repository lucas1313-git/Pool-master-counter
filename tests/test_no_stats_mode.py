"""'Do not record games statistics and players data' checkbox: while
checked, nothing should survive a reload."""

from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC

from helpers import add_player, assert_no_console_errors, wait


def test_player_added_under_no_stats_mode_does_not_survive_reload(app, server):
    checkbox = app.find_element(By.ID, "no-stats-checkbox")
    checkbox.click()
    assert checkbox.is_selected()

    add_player(app, "Ghost")
    # add_player leaves the Players panel expanded, and .panel-summary is
    # only visible (display:block) while its panel is *collapsed* - check
    # the roster list itself instead of the (currently hidden) summary.
    roster_names = [
        el.text for el in app.find_elements(By.CSS_SELECTOR, "#roster-list .roster-name")
    ]
    assert "Ghost" in roster_names

    app.get(server + "/index.html")  # reload without clearing localStorage

    summary_after = app.find_element(By.ID, "players-panel-summary").text
    assert "Ghost" not in summary_after
    assert_no_console_errors(app)


def test_no_stats_checkbox_is_unchecked_by_default(app):
    checkbox = app.find_element(By.ID, "no-stats-checkbox")
    assert not checkbox.is_selected()


def test_checkbox_label_reads_as_expected(app):
    label_text = app.find_element(By.CSS_SELECTOR, ".no-stats-row-inline").text
    assert label_text == "Do not record games statistics and players data"
