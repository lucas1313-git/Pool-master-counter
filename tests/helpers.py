"""Shared helpers for the browser test suite."""

from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait


def wait(driver, timeout=5):
    return WebDriverWait(driver, timeout)


def expand_panel(driver, toggle_id):
    """Collapsible panels (Players, Current Game, Standings, ...) start
    collapsed; clicks the toggle only if it isn't already open, so this
    is safe to call unconditionally at the top of a test."""
    btn = driver.find_element(By.ID, toggle_id)
    panel = btn.find_element(By.XPATH, "./..")
    if "collapsed" in panel.get_attribute("class"):
        btn.click()
        wait(driver).until(
            lambda d: "collapsed" not in panel.get_attribute("class")
        )


def add_player(driver, name):
    """Adds a player via the main screen's Players panel, then flips
    their roster row from Standby to Playing (new players default to
    Standby) so they actually show up on the scoreboard."""
    expand_panel(driver, "btn-toggle-players-panel")
    name_input = driver.find_element(By.ID, "new-player-name")
    name_input.clear()
    name_input.send_keys(name)
    wait(driver).until(
        lambda d: d.find_element(By.ID, "btn-add-player").is_enabled()
    )
    driver.find_element(By.ID, "btn-add-player").click()

    roster_name = wait(driver).until(
        EC.presence_of_element_located(
            (
                By.XPATH,
                "//*[@id='roster-list']//*[contains(@class,'roster-name')][text()='{}']".format(name),
            )
        )
    )
    row = roster_name.find_element(By.XPATH, "..")
    row.find_element(By.CSS_SELECTOR, ".btn-playing").click()

    wait(driver).until(
        EC.presence_of_element_located(
            (
                By.XPATH,
                "//*[@id='scoreboard']//*[contains(@class,'player-name')][contains(text(),'{}')]".format(name),
            )
        )
    )


def set_number_input(driver, element_id, value):
    """Sets a <input type=number>'s value via real keystrokes (clear +
    type), so the app's own 'input'/'change' listeners fire - setting
    .value via JS would skip them."""
    el = driver.find_element(By.ID, element_id)
    el.click()
    el.clear()
    el.send_keys(str(value))
    el.send_keys(Keys.TAB)


def get_console_logs(driver, level=None):
    logs = driver.get_log("browser")
    if level is None:
        return logs
    return [entry for entry in logs if entry.get("level") == level]


def assert_no_console_errors(driver):
    """Fails on real JS-level errors (uncaught exceptions, console.error
    calls) - not on failed network requests. Chrome's DevTools protocol
    logs every failed fetch/XHR (e.g. a 404 probing for an optional
    per-player backup file that doesn't exist) as a SEVERE 'browser' log
    entry with source 'network', regardless of whether the app's own
    code handles that rejection gracefully; only entries with a
    javascript/console-api source reflect an actual code-level bug."""
    errors = [
        entry
        for entry in get_console_logs(driver, level="SEVERE")
        if entry.get("source") != "network"
    ]
    assert not errors, "Unexpected console errors: {}".format(errors)


def dismiss_gamewin_overlay(driver):
    """Closes the "Nice shot!" popup shown after every credited win (not
    just a race-ending one) - whatever else that win also triggers
    (milestone/on-hill/game-change) is deferred until this one closes, so
    tests waiting on those need to dismiss this first."""
    wait(driver).until(EC.visibility_of_element_located((By.ID, "gamewin-overlay")))
    driver.find_element(By.ID, "btn-gamewin-close").click()
    wait(driver).until(EC.invisibility_of_element_located((By.ID, "gamewin-overlay")))


def click_plus(driver, player_name):
    """Clicks the '+' ball button on a given player's scoreboard card."""
    card = driver.find_element(
        By.XPATH,
        "//*[@id='scoreboard']//*[contains(@class,'player-panel')]"
        "[.//*[contains(@class,'player-name')][contains(text(),'{}')]]".format(player_name),
    )
    card.find_element(By.CSS_SELECTOR, ".btn-ball.plus").click()


def stat_value_for(driver, player_name):
    card = driver.find_element(
        By.XPATH,
        "//*[@id='scoreboard']//*[contains(@class,'player-panel')]"
        "[.//*[contains(@class,'player-name')][contains(text(),'{}')]]".format(player_name),
    )
    return card.find_element(By.CSS_SELECTOR, ".stat-value").text
