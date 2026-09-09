import XCTest

final class AppUITests: XCTestCase {

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    /// Smoke test: app launches and shows the main scoreboard header.
    func testAppLaunches() throws {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.staticTexts["Pool Master Counter"].waitForExistence(timeout: 10))
    }

    /// Diagnostic: dumps the accessibility tree XCUITest sees inside the
    /// Capacitor WKWebView. Useful whenever a future test needs to find a
    /// new element's exact label - WKWebView exposes real HTML buttons/
    /// text with their visible text as the accessibility label, so this
    /// is the fastest way to find the right query.
    func testDumpAccessibilityTree() throws {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 10))
        Thread.sleep(forTimeInterval: 2)
        print("=== ACCESSIBILITY TREE DUMP START ===")
        print(app.debugDescription)
        print("=== ACCESSIBILITY TREE DUMP END ===")
    }

    /// Opens Tournament setup, confirms the "Play as teams" toggle and a
    /// per-player Team text field are both present and tappable - covers
    /// the fix shipped in f9d66c2 (live datalist + explicit teams toggle).
    func testTournamentTeamsToggle() throws {
        let app = XCUIApplication()
        app.launch()

        let tournamentButton = app.buttons["🏆 Tournament"]
        XCTAssertTrue(tournamentButton.waitForExistence(timeout: 10))
        tournamentButton.tap()

        let teamsToggle = app.descendants(matching: .any).matching(
            NSPredicate(format: "label CONTAINS[c] %@", "Play as teams")
        ).firstMatch
        XCTAssertTrue(teamsToggle.waitForExistence(timeout: 10), "Play as teams checkbox not found")
        // WKWebView-hosted elements sometimes fail XCUITest's automatic
        // activation-point heuristic (esp. wide flex/label rows) even
        // when they genuinely exist and are on-screen - tapping an
        // explicit coordinate within the element's own frame sidesteps
        // that instead of relying on .tap()'s auto-computed hit point.
        teamsToggle.coordinate(withNormalizedOffset: CGVector(dx: 0.05, dy: 0.5)).tap()

        let teamField = app.textFields.matching(
            NSPredicate(format: "label CONTAINS[c] %@ OR value CONTAINS[c] %@", "Team", "Team")
        ).firstMatch
        XCTAssertTrue(teamField.waitForExistence(timeout: 10), "Team text field not found")
    }

    /// Opens a player's page and confirms the Achievements panel (shipped
    /// in 52da0e4) is present, then expands it and checks at least one
    /// achievement badge renders.
    func testPlayerAchievementsPanelExists() throws {
        let app = XCUIApplication()
        app.launch()

        let playerLink = app.buttons.matching(
            NSPredicate(format: "label CONTAINS[c] %@", "single-player stats")
        ).firstMatch
        XCTAssertTrue(playerLink.waitForExistence(timeout: 10), "No player link found")
        playerLink.tap()

        let achievementsHeading = app.buttons.matching(
            NSPredicate(format: "label CONTAINS[c] %@", "ACHIEVEMENTS")
        ).firstMatch
        XCTAssertTrue(achievementsHeading.waitForExistence(timeout: 10), "Achievements panel not found")
        achievementsHeading.tap()

        let gamesPlayedBadge = app.staticTexts.matching(
            NSPredicate(format: "label CONTAINS[c] %@", "Games Played")
        ).firstMatch
        XCTAssertTrue(gamesPlayedBadge.waitForExistence(timeout: 10), "Games Played achievement badge not found")
    }
}
