"""Players panel: adjusting one player's rating by hand (with its
warning popup) and resetting every roster player's rating back to the
default starting value."""

from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC

from helpers import add_player, assert_no_console_errors, wait


def _roster_row(driver, name):
    name_el = driver.find_element(
        By.XPATH,
        "//*[@id='roster-list']//*[contains(@class,'roster-name')][text()='{}']".format(name),
    )
    return name_el.find_element(By.XPATH, "..")


def _rating_badge_value(driver, name):
    return _roster_row(driver, name).find_element(By.CSS_SELECTOR, ".rating-badge").text


def _open_rating_edit(driver, name):
    _roster_row(driver, name).find_element(By.CSS_SELECTOR, ".roster-edit-rating-btn").click()
    wait(driver).until(EC.visibility_of_element_located((By.ID, "rating-edit-overlay")))


def test_editing_a_players_rating_updates_the_badge(app):
    add_player(app, "Alice")
    assert _rating_badge_value(app, "Alice") == "400"

    _open_rating_edit(app, "Alice")
    assert "Alice" in app.find_element(By.ID, "rating-edit-player-name").text
    # The popup should warn that this is normally a calculated value, not
    # something meant to be hand-edited casually.
    warning = app.find_element(By.CSS_SELECTOR, ".rating-edit-warning").text
    assert "calculat" in warning.lower()

    rating_input = app.find_element(By.ID, "rating-edit-input")
    assert rating_input.get_attribute("value") == "400"
    rating_input.clear()
    rating_input.send_keys("550")
    app.find_element(By.ID, "btn-rating-edit-save").click()

    wait(app).until(EC.invisibility_of_element_located((By.ID, "rating-edit-overlay")))
    assert _rating_badge_value(app, "Alice") == "550"
    assert_no_console_errors(app)


def test_cancelling_a_rating_edit_leaves_the_rating_unchanged(app):
    add_player(app, "Alice")
    _open_rating_edit(app, "Alice")

    rating_input = app.find_element(By.ID, "rating-edit-input")
    rating_input.clear()
    rating_input.send_keys("999")
    app.find_element(By.ID, "btn-rating-edit-cancel").click()

    wait(app).until(EC.invisibility_of_element_located((By.ID, "rating-edit-overlay")))
    assert _rating_badge_value(app, "Alice") == "400"
    assert_no_console_errors(app)


def test_reset_all_players_official_rating_resets_roster_to_default(app):
    # The app fixture stubs window.confirm to always return true, so both
    # of the reset flow's confirmations are accepted without a real
    # dialog ever appearing.
    add_player(app, "Alice")
    add_player(app, "Bob")

    _open_rating_edit(app, "Alice")
    rating_input = app.find_element(By.ID, "rating-edit-input")
    rating_input.clear()
    rating_input.send_keys("600")
    app.find_element(By.ID, "btn-rating-edit-save").click()
    wait(app).until(EC.invisibility_of_element_located((By.ID, "rating-edit-overlay")))
    assert _rating_badge_value(app, "Alice") == "600"

    app.find_element(By.ID, "btn-reset-all-ratings").click()

    wait(app).until(lambda d: _rating_badge_value(d, "Alice") == "400")
    assert _rating_badge_value(app, "Bob") == "400"
    assert_no_console_errors(app)
