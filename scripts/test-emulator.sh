#!/usr/bin/env bash
set -euo pipefail

APK="${1:-taisei-v1.4.6-android-release.apk}"

echo "==> Installing signed Release APK: $APK"
adb install -r "$APK"
adb logcat -c

echo "==> Launching Taisei Project..."
adb shell am start -W -n org.taisei_project.taisei/.TaiseiActivity

echo "==> Waiting 20s for asset extraction and game startup..."
sleep 20

adb logcat -d > emulator-logcat.txt
adb exec-out screencap -p > emulator-screenshot.png || true

PID=$(adb shell pidof org.taisei_project.taisei || true)
echo "==> Taisei process PID: ${PID:-NOT RUNNING}"

# Check for crashes or errors specifically from Taisei / SDL / AndroidRuntime (ignore system WVCdm)
if [ -z "$PID" ]; then
    echo "::error::Taisei process is NOT running after 20s (crashed or exited)!"
    grep -iE "Taisei|SDL|taisei_project|AndroidRuntime|FATAL|SIGSEGV|SIGABRT|backtrace:|#00 pc" emulator-logcat.txt \
        | grep -v "WVCdm" \
        | tail -n 15 \
        | while IFS= read -r line; do echo "::error::$line"; done
    exit 1
fi

if grep -E "SDL/ERROR|UnsatisfiedLinkError|FATAL EXCEPTION" emulator-logcat.txt | grep -v "WVCdm" > emulator-errors.txt; then
    echo "::error::Taisei/SDL reported an error while running:"
    tail -n 10 emulator-errors.txt | while IFS= read -r line; do echo "::error::$line"; done
    exit 1
fi

echo "==> SUCCESS: Taisei Project is running cleanly on Android 14 Emulator (PID=$PID)!"
