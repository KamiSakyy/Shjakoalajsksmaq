# Offline Android wrapper

The workflow downloads the user-provided Railway archive on GitHub Actions (the sandbox itself cannot fetch that external host). It extracts a ZIP/TAR or accepts a single HTML file, builds the site when it finds a `package.json` build script, locates the static `index.html` output, and copies the site into the Android APK assets.

The Android project is a native Gradle app with a full-screen WebView, a stable local HTTPS app origin, persistent WebView local storage, and **no INTERNET permission**. Relative and root-relative bundled site assets are served locally. Remote requests and external navigation are blocked. Site features that depend on remote servers cannot function offline unless the archive includes an offline implementation.

Run **Download supplied site and build signed offline Android APK** in GitHub Actions. On success, use the release's direct `app-release.apk` download link. The workflow creates a random signing key for each run without repository secrets. The APK is signed and installable, but the signing key is discarded, so a future build cannot update an existing installation; uninstall the old app first.
