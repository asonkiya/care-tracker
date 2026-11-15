# Care Tracker

Reads one WhatsApp group (you + your doctor/nutritionist/coach), uses Claude to pull out the plan, and shows it in a phone-friendly dashboard:

- **Today**: supplement checklist, what's waiting on you, what you've logged today
- **Plan**: current supplements/medicines (dose and timing) plus diet and lifestyle rules; stopped items are kept
- **To-do**: tasks and tests on you, questions waiting on the team, appointments
- **Changes**: every plan change with its date, plus your logs (meals, weight, sleep, symptoms…) for the last 14 days
- **Chat**: the full group, searchable. Every item has a **source** link that opens the original message.

Images (meal photos, supplement labels) and PDFs (diet charts, lab reports) are read too. Voice notes are stored as "[voice note]" but are not transcribed yet.

Your WhatsApp is linked as a companion device, the same way WhatsApp Web works. Nothing changes for anyone else in the group. It never sends messages, read receipts or "online" status.

## Deploy on Railway (Hobby plan)

1. Push this folder to a private GitHub repo, then in Railway: **New Project → Deploy from GitHub repo**. It builds from the `Dockerfile`.
2. **Add a volume** to the service (right-click the service → *Attach volume*) with mount path **`/data`**. This is essential: the WhatsApp login and the database live there. Without it, every redeploy logs you out and wipes the data.
3. **Variables** (see `.env.example`):
   - `DASHBOARD_PASSWORD`: anything long
   - `ANTHROPIC_API_KEY`: from console.anthropic.com
   - `DATA_DIR` = `/data`
   - optional: `TRACK_GROUP_NAME` (part of the group's name, to pick it automatically), `MODEL=claude-haiku-5-5` to make it cheaper
4. **Settings → Networking → Generate domain**. Open it and log in with the password.
5. Go to **Setup**. A QR code appears. On the phone: WhatsApp → Settings → Linked devices → Link a device → scan it.
6. Within a minute or so, a list of groups appears. Tap **Track** on the care group. The last 45 days of history are organised automatically. After that, new messages are processed about 90 seconds after the chat goes quiet.
7. Optional: on the phone, open the URL and choose *Add to Home Screen* so it opens like an app.

Keep it to **one replica**. Two copies would fight over the WhatsApp session.

## Good to know

- **Phone must come online occasionally.** WhatsApp drops linked devices if the phone is offline for about 14 days. If that happens, the Setup tab shows a new QR to scan.
- **Unofficial client.** This uses Baileys, an open-source WhatsApp Web library, not Meta's official API, which can't read personal groups. A read-only linked device is low risk, but WhatsApp could in principle flag it.
- **Cost.** One group is a few dozen API calls a day. On Sonnet that's typically well under a few dollars a month; Haiku costs less.
- **Fixing mistakes.** Items can be ticked off by hand. If the AI got something structurally wrong (e.g. after you change the prompt in `src/extract.js`), *Setup → Rebuild from history* re-runs it over all stored messages.

## Run locally

```bash
npm install
DASHBOARD_PASSWORD=test DATA_DIR=./data ANTHROPIC_API_KEY=sk-ant-... npm start   # http://localhost:3000
# or try the dashboard with fake data, no WhatsApp or key needed:
DATA_DIR=./demo node scripts/seed.js && DATA_DIR=./demo DASHBOARD_PASSWORD=test NO_WHATSAPP=1 npm start
```

## How it works

`src/whatsapp.js` (Baileys listener, stores messages and media for the chosen group only) → `src/extract.js` (batches new messages and asks Claude to call an `update_tracker` tool with supplements, rules, logs, items and changes, each citing a message id) → SQLite in `/data/tracker.db` → `src/server.js` + `public/index.html` (dashboard).

## iPhone app (TestFlight)

`ios/` is a native SwiftUI app that talks to the same Railway server (sign in with the Railway URL + `DASHBOARD_PASSWORD`). It has the same tabs as the web dashboard, plus pull-to-refresh, tap-to-tick, source sheets, in-app image and PDF viewing, and Setup (link WhatsApp, pick the group) under the gear icon on Today.

**Redeploy the server first.** The app signs in with a token that the server only issues as of this version.

### One-time setup (about 10 minutes)
1. **Apple Developer Program** membership ($99/yr) on the Apple ID that will publish it.
2. In **Xcode → Settings → Accounts**, sign in with that Apple ID. Xcode 26 or later is required for uploads.
3. Pick a bundle ID (default `com.ahrimane.caretracker` in `ios/project.yml`; change it if you like).
4. **App Store Connect → Apps → + → New App**: platform iOS, name "Care Tracker" (or any unique name), select that bundle ID (register it at developer.apple.com → Identifiers if it isn't listed), SKU anything.
5. Find your **Team ID**: developer.apple.com/account → Membership details.

### Build and upload
```bash
cd ios
TEAM_ID=ABCDE12345 ./testflight.sh
```
This generates the Xcode project (installing XcodeGen with Homebrew if needed), archives a Release build with a fresh build number, and uploads it straight to App Store Connect. Re-run it for every new build.

### Get it on the phone
- App Store Connect → your app → **TestFlight**. Wait for the build to finish processing.
- **Internal testing** (instant, no review): add yourself/your friend under Users and Access, then add them to an internal group.
- **External testing** (anyone with an email or a public link): create an external group and add the build. The first build gets a short Beta App Review, usually under a day. Give the reviewer a test account by putting the server URL and password in *Test Information → Sign-in required*.
- Your friend installs the **TestFlight** app from the App Store and accepts the invite.

Prefer Xcode's UI? Run `xcodegen generate` in `ios/`, open `CareTracker.xcodeproj`, pick your team under *Signing & Capabilities*, then **Product → Archive → Distribute App → TestFlight & App Store**.
