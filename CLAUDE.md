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
- iOS app has NOT been compiled yet (written in a Linux sandbox; Swift syntax-checked only). First job: `cd ios && xcodegen generate && xcodebuild -project CareTracker.xcodeproj -scheme CareTracker -destination 'generic/platform=iOS Simulator' build` and fix any type errors.
- Then: set bundle ID in `ios/project.yml`, create the app in App Store Connect, run `TEAM_ID=… ios/testflight.sh` (needs Xcode 26+).
- Ideas not built yet: voice-note transcription, push notifications for plan changes, supplement reminders.
