# Offline Android app

GitHub Actions workflow **Download supplied site and build signed offline Android APK** downloads the website archive from the Railway link provided for this task, packages its static web output inside a native Gradle Android app, builds a signed APK, and publishes a direct APK download in the workflow's GitHub prerelease.

The installed WebView serves only packaged app assets on a local app origin, stores browser local data on-device, runs fullscreen, and the app has no `INTERNET` permission. See [`android/README.md`](android/README.md) for the build and signing details.
