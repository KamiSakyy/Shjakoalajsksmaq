# Yomi Studio offline Android app

The build workflow downloads the exact website archive from the supplied Railway URL. For the included Next.js writing studio it converts the database-backed pages to a static bundle, removes server API routes, and supplies a local IndexedDB-backed implementation of the book/settings APIs. The downloaded site's own UI, editor, styling, validation and export code remain the app; this is not the unrelated game archive in the repository.

The Android app opens the generated site in a full-screen WebView on a local HTTPS origin. Its native WebChromeClient opens Android's system document picker for web file inputs and grants WebView access to selected `content://` files. Books, chapters, cover data and preferences are stored on-device in IndexedDB; there is no Internet permission. TXT/Markdown import and manuscript/EPUB export are handled locally. EPUB source-file import needs server-side parsing and is not currently available offline.

Run **Download supplied site and build signed offline Android APK** in GitHub Actions. On success, the workflow uploads the signed APK as an artifact and publishes a direct download in a prerelease. Each run uses a newly generated signing key which is discarded after the run, so a later build cannot update that installation; uninstall the previous APK before installing a new build.
