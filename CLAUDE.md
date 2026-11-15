# Care Tracker — context for Claude Code

Personal tool for a friend who is a *client* in a WhatsApp group with his care team (doctor, nutritionist, etc.). It reads only that one group, uses Claude to extract the plan, and shows it in a dashboard + iPhone app.

## Layout
- `src/` — Node 22 server (ESM), deployed on Railway (Hobby) via `Dockerfile`, one replica, volume at `/data`
  - `whatsapp.js` — Baileys 7.0.0-rc14 (unofficial WhatsApp Web client), linked by QR; stores only the tracked group's messages; downloads images/PDFs
  - `extract.js` — batches new messages (debounced) → Claude with a forced `update_tracker` tool → supplements / rules / logs / items / changes, each citing `source_msg_id`
  - `db.js` — better-sqlite3 at `/data/tracker.db`
  - `server.js` — Express 5 JSON API; auth = `DASHBOARD_PASSWORD`, via cookie (web) or `Authorization: Bearer <token>` (iOS, token from POST /api/login)
- `public/index.html` — mobile web dashboard (vanilla JS)
- `ios/` — native SwiftUI app (iOS 17+), XcodeGen `project.yml`, `testflight.sh` archives + uploads to TestFlight
- `scripts/seed.js` — fake data for trying the dashboard without WhatsApp

## Status / next steps
- Server tested locally with seed data and a mocked Anthropic API; live WhatsApp linking not yet tested (needs Railway deploy).
- iOS: `ios/CareTracker.xcodeproj` is hand-written (no XcodeGen needed); `ios/project.yml` is kept in sync for XcodeGen users. Team `Z428Z377RQ`, bundle ID `com.ahrimane.caretracker`, iOS 17+.
- The iOS app compiles cleanly (Xcode 26.6) and is on TestFlight: version 1.0, first build `2611151520` uploaded 2026-11-15. App Store Connect record is named "Dietitian manager" (Apple ID 6835054917).
- GitHub Actions can't run: the account is locked for a billing issue. Build locally instead.

## Shipping a new iOS build to TestFlight
1. `cd ios && xcodebuild -project CareTracker.xcodeproj -scheme CareTracker -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build` — quick compile check.
2. Archive + upload: `cd ios && TEAM_ID=Z428Z377RQ ./testflight.sh` (uses the Apple account signed into Xcode; needs Xcode 26+). If XcodeGen is missing the script installs it via Homebrew.
   - The script regenerates `CareTracker.xcodeproj` from project.yml and leaves `ios/build/`; discard that churn afterwards (`git checkout -- ios/CareTracker.xcodeproj`) unless project.yml actually changed.
   - Alternatively sign with the App Store Connect API key: `ASC_KEY_PATH=~/path/AuthKey_L43PBN9Y3N.p8 ASC_KEY_ID=L43PBN9Y3N ASC_ISSUER_ID=<issuer> TEAM_ID=Z428Z377RQ ./testflight.sh`.
   - If signing fails with "PLA Update available", the account holder must accept the latest agreement at developer.apple.com/account.
3. Commit and push to github.com/asonkiya/care-tracker.

## Later
- Deploy the server to Railway (volume at /data; env DASHBOARD_PASSWORD, ANTHROPIC_API_KEY, DATA_DIR=/data).
- Ideas not built yet: voice-note transcription, push notifications for plan changes, supplement reminders.
