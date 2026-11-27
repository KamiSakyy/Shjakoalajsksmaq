#!/usr/bin/env sh
set -eu
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT"
npm ci
npm run build
rm -rf android/app/src/main/assets/www
mkdir -p android/app/src/main/assets/www
cp -R dist/. android/app/src/main/assets/www/
echo "Web build copied into the Android app's offline assets."
