"""
Shared pytest fixtures for the Pool Master Counter browser test suite.

Spins up the app's own static file server (the same `python3 -m http.server`
command used for manual testing/deployment — no build step, matching how
this app actually ships) and drives it with headless Chrome via Selenium.
"""

import os
import socket
import subprocess
import sys
import time

import pytest
from selenium import webdriver
from selenium.webdriver.chrome.options import Options

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
PORT = int(os.environ.get("PMC_TEST_PORT", "8935"))
BASE_URL = "http://localhost:{}".format(PORT)


def _wait_for_port(port, timeout=10):
    deadline = time.time() + timeout
    while time.time() < deadline:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(("127.0.0.1", port)) == 0:
                return True
        time.sleep(0.1)
    return False


@pytest.fixture(scope="session")
def server():
    """Serves the repo root for the whole test session, on PMC_TEST_PORT
    (8935 by default) rather than the 8934 commonly used for manual
    testing, so this suite never collides with a manual dev server."""
    proc = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT)],
        cwd=REPO_ROOT,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        if not _wait_for_port(PORT):
            raise RuntimeError("static server on port {} did not start".format(PORT))
        yield BASE_URL
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()


@pytest.fixture
def driver(server):
    """A fresh headless Chrome per test, with browser console logging
    enabled so tests can assert on JS errors, not just visible DOM state."""
    opts = Options()
    opts.add_argument("--headless=new")
    opts.add_argument("--no-sandbox")
    opts.add_argument("--disable-gpu")
    opts.add_argument("--window-size=1280,1400")
    opts.set_capability("goog:loggingPrefs", {"browser": "ALL"})
    drv = webdriver.Chrome(options=opts)
    try:
        yield drv
    finally:
        drv.quit()


@pytest.fixture
def app(driver, server):
    """Loads the app on a clean localStorage (no players, no saved stats,
    default theme) and stubs window.confirm/alert so destructive actions
    (Reset, Undo, Abandon Tournament, etc.) don't hang a real browser
    dialog — same stubbing this app's manual test sessions always do
    before interacting with anything that can trigger one."""
    driver.get(server + "/index.html")
    driver.execute_script("window.localStorage.clear();")
    driver.get(server + "/index.html")
    driver.execute_script(
        "window.confirm = function () { return true; };"
        "window.alert = function () {};"
    )
    return driver
