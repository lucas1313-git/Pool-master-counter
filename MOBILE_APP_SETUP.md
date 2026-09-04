# Pool Master Counter — iOS App Setup

This branch (`mobile_app`) packages the web app as a real iOS app via
[Capacitor](https://capacitorjs.com/), with a one-time "Pro" unlock
handled by [RevenueCat](https://www.revenuecat.com/).

## What's already done (in this branch)

- `www/` — a self-contained copy of the app (`index.html`, `css/`,
  `js/`, `languages/`, `settings/game-types.json`). This is what
  Capacitor bundles into the app; it deliberately excludes `players/`,
  `stats/`, `tests/`, and the READMEs — those are dev-only, not part of
  the shipped app.
- `package.json` and `capacitor.config.json` — ready to install, not
  yet installed (this machine has neither Node nor a full Xcode, so I
  couldn't run the install/build steps myself — see Prerequisites).
- A full **Pro paywall** built into `www/js/app.js` / `www/index.html`
  / `www/css/style.css`:
  - Free tier: individual mode only, one game type (no rotation), no
    tournaments, no player-stats/ratings pages, no day reports, and a
    4-player roster cap.
  - Every locked action shows an in-app "Unlock Pro" screen instead of
    a native alert — see `requirePro()` in `www/js/app.js` for every
    gate point.
  - In the browser (no native shell), tapping "Unlock Pro" just flips
    the flag locally so you can test every gated feature without a
    device or a store connection. On a real device it calls RevenueCat.
  - `initRevenueCatIfNative()` configures the RevenueCat SDK on boot
    and reconciles the local Pro flag with the account's real
    entitlement (catches a restore or a refund).

**What I couldn't do here:** run `npm install`, `npx cap add ios`, open
Xcode, sign the app, create the App Store Connect listing, or set up
RevenueCat's dashboard — all of that needs your own Mac with Xcode and
your Apple/RevenueCat accounts. The rest of this doc is the exact path
through that.

## Prerequisites (one-time, on your Mac)

1. **Xcode** — install the full app from the Mac App Store (not just
   Command Line Tools). It's a large download.
2. **Node.js** — install from [nodejs.org](https://nodejs.org) (LTS is
   fine) or via `brew install node`.
3. **CocoaPods** — `sudo gem install cocoapods` (Capacitor's iOS
   platform uses it to manage native dependencies).
4. **Apple Developer Program** — [developer.apple.com/programs](https://developer.apple.com/programs/),
   $99/year. Required to run on a real device, use TestFlight, and
   submit to the App Store.
5. **RevenueCat account** — [app.revenuecat.com](https://app.revenuecat.com),
   free up to $2.5k/month tracked revenue. Handles the purchase
   receipt validation so you don't have to write that yourself.

## First-time build

Run these from the repo root, on the `mobile_app` branch:

```bash
npm install
npx cap add ios
npx cap sync
```

`cap add ios` generates the `ios/` Xcode project (not checked into
this branch yet — it's machine-generated, add it once you've run this
locally). `cap sync` copies `www/` into it.

### Set your real bundle ID

Edit `capacitor.config.json` — replace `"com.example.poolmastercounter"`
with your own reverse-DNS app identifier (e.g.
`com.yourname.poolmastercounter`). This has to match the identifier you
register in App Store Connect in the next section. After changing it,
re-run `npx cap sync`.

### Open and configure in Xcode

```bash
npx cap open ios
```

In Xcode:
- Select the project → **Signing & Capabilities** → pick your team
  (from the Apple Developer account) → let Xcode manage signing.
- Set an app icon (Assets.xcassets → AppIcon) and a launch screen —
  Capacitor's default template ships placeholders; swap in real ones
  before submitting (a 1024×1024 PNG is enough to generate the rest
  via Xcode's asset catalog).
- Add the **In-App Purchase** capability (Signing & Capabilities → +
  Capability → In-App Purchase).
- Build and run on a simulator or your own device to confirm it looks
  right (⌘R).

## App Store Connect: create the app + the Pro product

1. [appstoreconnect.apple.com](https://appstoreconnect.apple.com) →
   My Apps → **+** → New App. Use the same bundle ID from
   `capacitor.config.json`.
2. **Features → In-App Purchases → +** → **Non-Consumable** (a
   one-time unlock, not a subscription, matches what's built here).
   - Reference name: `Pro Unlock`
   - Product ID: something like `pro_unlock` — you'll need this exact
     string in RevenueCat next.
   - Set a price tier, write the review-facing description
     ("Unlocks Teams mode, Tournaments, rotation, full stats, and day
     reports").
3. Fill in the rest of the app listing (screenshots, description,
   privacy policy URL — required even for a fully local-data app;
   a one-line "no data leaves your device" policy page is enough,
   host it anywhere).

## RevenueCat: connect the product

1. New project in the RevenueCat dashboard → add an **iOS app**, paste
   in your bundle ID.
2. **Project Settings → Apple App Store** → generate/upload an
   App Store Connect API key (RevenueCat's docs walk through the exact
   App Store Connect screen for this) — lets RevenueCat validate
   receipts and read your product automatically.
3. **Products** → it should pick up `pro_unlock` from App Store Connect
   once the key is connected (can take a few minutes).
4. **Entitlements** → create one called exactly `pro` → attach the
   `pro_unlock` product to it. The app code checks
   `entitlements.active.pro` — this name has to match exactly.
5. **Offerings** → create a "default" offering → add a package wrapping
   the `pro_unlock` product.
6. **Project Settings → API Keys** → copy the **public** Apple/iOS SDK
   key, and paste it into `REVENUECAT_IOS_API_KEY` in
   `www/js/app.js` (search for `appl_REPLACE_ME`).

Re-run `npx cap sync` after editing `www/js/app.js` so the change makes
it into the Xcode project, then rebuild.

## Testing the real purchase flow

Real in-app purchases only work on a signed build, not the simulator's
default state, unless you set up a **StoreKit Configuration file** in
Xcode (Product → Scheme → Edit Scheme → Run → Options →
StoreKit Configuration) for local sandbox testing — RevenueCat's docs
have a walkthrough. Easiest path for a first pass: archive a build,
upload to **TestFlight**, install it on your own device via TestFlight,
and buy the Pro unlock using a **Sandbox Tester** Apple ID (App Store
Connect → Users and Access → Sandbox Testers) — sandbox purchases don't
charge real money.

## Submitting for review

- Apple sometimes rejects apps that read as "just a website in a
  wrapper." This app already has real native behavior going for it
  (works fully offline once installed, no browser chrome, all data
  local, a real purchase flow) — but it's still worth double-checking
  the build has no visible browser UI (address bar, etc. — Capacitor
  hides this by default) and that the icon/launch screen aren't
  placeholders before submitting.
- First submission review is typically the slowest; budget a few days.

## Keeping this branch in sync with `main`

`www/` is a snapshot, not a live symlink — when `main` gets updated
(bug fixes, new features), re-copy the changed files into `www/` on
this branch, the same way the `release` branch stays in sync:

```bash
git checkout mobile_app
git checkout main -- index.html css/style.css js/app.js languages/*.json settings/game-types.json
cp index.html www/index.html
cp css/style.css www/css/style.css
cp js/app.js www/js/app.js
cp languages/english.json languages/french.json languages/spanish.json languages/cantonese.json languages/manifest.json www/languages/
cp settings/game-types.json www/settings/game-types.json
git checkout main -- index.html css/style.css js/app.js languages/ settings/  # restore root files to main's version
```

Then **re-apply the Pro-gating edits** to the freshly-copied
`www/js/app.js` / `www/index.html` / `www/css/style.css` if `main`
touched any of the same code (the gates are additive and isolated —
`requirePro()`, the `isPro`/`FREE_PLAYER_CAP` block, the upsell overlay
markup/CSS, and the handful of `requirePro(...)` call sites listed
above), then `npx cap sync` and rebuild.
