#!/usr/bin/env bash
set -euo pipefail

APK="${1:-taisei-v1.4.6-android-release.apk}"

echo "==> Installing signed Release APK: $APK"
adb install -r "$APK"
adb logcat -c

echo "==> Launching Taisei Project..."
adb shell am start -n org.taisei_project.taisei/.TaiseiActivity

echo "==> Waiting 20s for asset extraction and game startup..."
sleep 20

adb logcat -d > emulator-logcat.txt
adb exec-out screencap -p > emulator-screenshot.png || true

PID=$(adb shell pidof org.taisei_project.taisei || true)
echo "==> Taisei process PID: ${PID:-NOT RUNNING}"

# Check for SDL error dialogs or fatal crashes in logcat
if grep -E "SDL/ERROR|UnsatisfiedLinkError|dlopen failed|FATAL EXCEPTION|SIGSEGV|SIGABRT|log_fatal" emulator-logcat.txt > emulator-errors.txt; then
    echo "==> Found errors in logcat:"
    cat emulator-errors.txt | tail -n 15
    tail -n 10 emulator-errors.txt | while IFS= read -r line; do
        echo "::error::$line"
    done
    exit 1
fi

if [ -z "$PID" ]; then
    echo "::error::Taisei process is not running after 20s!"
    grep -iE "taisei|sdl|error|fatal" emulator-logcat.txt | tail -n 10 | while IFS= read -r line; do
        echo "::error::$line"
    done
    exit 1
fi

echo "==> SUCCESS: Taisei Project is running cleanly on Android 14 Emulator (PID=$PID)!"
