# ТОПОР.НОЧЬ — Android offline app

This is a native Android application project built with **Android Gradle Plugin**. The game is rendered by Android System WebView, but its production HTML, scripts, styles, images, textures, and available models are packaged inside the APK. The installed game does not need a website, server, or internet connection. The manifest intentionally has no `INTERNET` permission. WebView `localStorage` is enabled and stored on the stable bundled app origin, so game options and the selected map destination survive app restarts.

## Signed release APK through GitHub Actions

The Actions workflow `Build signed Android release APK` builds and verifies `app-release.apk`, then uploads it as the `PacificOffline-release-signed` artifact (available for 30 days). No secrets are required: the workflow creates a random self-signed Android signing key for that run. This is suitable for sideloading/testing. Since the key is intentionally not saved, a later APK will have a different signature and cannot update this installation in place; uninstall the old app first. For long-term releases, replace the temporary key with a privately backed-up keystore.

The project includes a Gradle wrapper. A local unsigned build can be run with `./android/gradlew -p android assembleDebug` from the repository root; first build downloads Gradle and Android dependencies.

The checked-in `app/src/main/assets/www/` is a ready-to-build copy of the web app. After changing the site, from the repository root run:

```sh
./android/sync-web-assets.sh
./android/gradlew -p android assembleRelease
```

The sync script requires Node.js/npm; installing/running the Android app does not.

## What is saved / offline behavior

- App assets and the whole game are local in the APK; the app has no internet permission.
- Graphics quality, mode, time, weather, sound mute, and the map destination are persisted in WebView local storage.
- The running simulation itself is not serialized as a save slot; leaving/restarting a session starts a new city simulation.
- The source archive does not contain `models/character/head.glb` or the licensed WOFF2 font files; characters use procedural heads and text uses installed system fonts as offline fallbacks.

The release APK produced by Actions is signed with the keystore you configure. The signing key is not included in the APK artifact.
