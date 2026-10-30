#!/bin/sh
# Builds the macOS app. Run on a Mac from this folder: sh build-mac.sh
# (A Mac app can't be built on Windows: packaging there breaks it and it can't be signed.)
set -e
cd "$(dirname "$0")"
npm install
npx electron-packager . "Music Visualizer" --platform=darwin --out=dist --overwrite \
  --ignore='^/dist' --ignore='media\.ps1' --ignore='media-win\.js' --ignore='media-linux\.js' --ignore='node_modules/@jellybrick' \
  --extend-info=mac-info.plist
APP="$(ls -d dist/"Music Visualizer-darwin-"*/"Music Visualizer.app" | head -n 1)"
# An ad-hoc signature, without which macOS refuses to open the app ("damaged"); and clear the download flag.
codesign --force --deep --sign - "$APP"
xattr -cr "$APP"
echo "Built: $APP  (drag it to Applications)"
