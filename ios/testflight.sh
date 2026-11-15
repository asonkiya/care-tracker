#!/usr/bin/env bash
# Builds Care Tracker and uploads it to TestFlight.
# Usage:  TEAM_ID=ABCDE12345 ./testflight.sh
# Needs: Xcode 26+, signed into your Apple Developer account in Xcode (Settings → Accounts),
#        and an app created in App Store Connect with the same bundle ID as project.yml.
set -euo pipefail
cd "$(dirname "$0")"

: "${TEAM_ID:?Set TEAM_ID to your Apple Developer Team ID (developer.apple.com/account → Membership details)}"

XCODE_MAJOR=$(xcodebuild -version | awk 'NR==1{print $2}' | cut -d. -f1)
if [ "$XCODE_MAJOR" -lt 26 ]; then echo "App Store Connect needs Xcode 26 or later (found $XCODE_MAJOR)."; exit 1; fi

command -v xcodegen >/dev/null || brew install xcodegen
xcodegen generate

# On CI (or without an Xcode login) sign with an App Store Connect API key instead.
AUTH=()
if [ -n "${ASC_KEY_PATH:-}" ]; then
  AUTH=(-authenticationKeyPath "$ASC_KEY_PATH" -authenticationKeyID "$ASC_KEY_ID" -authenticationKeyIssuerID "$ASC_ISSUER_ID")
fi

BUILD=${BUILD_NUMBER:-$(date +%y%m%d%H%M)}   # unique, always-increasing build number
rm -rf build

xcodebuild -project CareTracker.xcodeproj -scheme CareTracker -configuration Release \
  -destination 'generic/platform=iOS' -archivePath build/CareTracker.xcarchive \
  DEVELOPMENT_TEAM="$TEAM_ID" CURRENT_PROJECT_VERSION="$BUILD" \
  -allowProvisioningUpdates ${AUTH[@]+"${AUTH[@]}"} archive

xcodebuild -exportArchive -archivePath build/CareTracker.xcarchive \
  -exportOptionsPlist ExportOptions.plist -exportPath build/export \
  -allowProvisioningUpdates ${AUTH[@]+"${AUTH[@]}"}

echo "✅ Build $BUILD uploaded. It shows up in App Store Connect → TestFlight after processing (usually 5–15 min)."
