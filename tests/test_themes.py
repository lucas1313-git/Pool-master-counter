"""Theme switching, persistence across reload, and the graph-background
color fix (light themes must use a tinted wash, never neutral gray)."""

import re

import pytest
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import Select

from helpers import assert_no_console_errors

LIGHT_THEMES = ["daybreak-chalk", "pearl-lounge", "paper-contrast"]
ALL_THEMES = [
    "crimson-felt",
    "emerald-rail",
    "neon-arcade",
    "midnight-ivory",
    "sunset-chalk",
    "obsidian-break",
    "daybreak-chalk",
    "pearl-lounge",
    "blackout-contrast",
    "paper-contrast",
]


def _select_theme(driver, theme_id):
    Select(driver.find_element(By.ID, "theme-select")).select_by_value(theme_id)


@pytest.mark.parametrize("theme_id", ALL_THEMES)
def test_every_theme_applies_the_data_theme_attribute(app, theme_id):
    _select_theme(app, theme_id)
    html = app.find_element(By.TAG_NAME, "html")
    if theme_id == "crimson-felt":
        # Crimson Felt is the bare :root default and may be applied either
        # by omitting data-theme or by setting it explicitly — both render
        # the same palette.
        assert html.get_attribute("data-theme") in (None, "", "crimson-felt")
    else:
        assert html.get_attribute("data-theme") == theme_id
    assert_no_console_errors(app)


def test_theme_choice_persists_across_reload(app, server):
    _select_theme(app, "neon-arcade")
    app.get(server + "/index.html")
    html = app.find_element(By.TAG_NAME, "html")
    assert html.get_attribute("data-theme") == "neon-arcade"
    select = app.find_element(By.ID, "theme-select")
    assert select.get_attribute("value") == "neon-arcade"


@pytest.mark.parametrize("theme_id", LIGHT_THEMES)
def test_light_theme_graph_background_is_a_tint_not_gray(app, theme_id):
    """Regression test: --graph-bg used to be a flat rgba(0,0,0,0.25)
    wash, which over these themes' white panels rendered as flat neutral
    gray. Each light theme now overrides --graph-bg with a light tint of
    its own accent color — assert the R/G/B channels actually differ
    from each other (a gray/achromatic color has R==G==B)."""
    _select_theme(app, theme_id)
    raw = app.execute_script(
        "return getComputedStyle(document.documentElement)"
        ".getPropertyValue('--graph-bg');"
    )
    channels = [int(x) for x in re.findall(r"\d+(?:\.\d+)?", raw)[:3]]
    assert len(channels) == 3, "could not parse --graph-bg: {!r}".format(raw)
    r, g, b = channels
    assert not (r == g == b), (
        "--graph-bg for {} is achromatic (gray): {!r}".format(theme_id, raw)
    )
