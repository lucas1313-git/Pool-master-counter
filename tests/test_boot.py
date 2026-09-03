"""Cold-boot sanity checks: the app loads cleanly with an empty
localStorage and shows the expected empty-state UI."""

from selenium.webdriver.common.by import By

from helpers import assert_no_console_errors


def test_loads_with_correct_title_and_heading(app):
    assert app.title == "Pool Master Counter"
    heading = app.find_element(By.CSS_SELECTOR, ".brand-text h1").text
    assert heading == "Pool Master Counter"


def test_no_console_errors_on_cold_boot(app):
    assert_no_console_errors(app)


def test_fresh_state_has_no_players(app):
    summary = app.find_element(By.ID, "players-panel-summary").text
    assert "No players yet" in summary


def test_main_nav_buttons_present(app):
    for btn_id in (
        "btn-open-wizard",
        "btn-open-all-players",
        "btn-open-tournament",
        "btn-open-help",
    ):
        el = app.find_element(By.ID, btn_id)
        assert el.is_displayed()


def test_theme_selector_defaults_to_crimson_felt(app):
    select = app.find_element(By.ID, "theme-select")
    assert select.get_attribute("value") == "crimson-felt"
    html = app.find_element(By.TAG_NAME, "html")
    # Bare :root is Crimson Felt and never sets data-theme explicitly.
    assert html.get_attribute("data-theme") in (None, "", "crimson-felt")
