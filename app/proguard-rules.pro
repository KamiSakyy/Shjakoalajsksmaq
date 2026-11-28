# Ranobe EPUB — release rules. No obfuscation of app code is required for the
# unsigned release artifact; keep rules below are conservative and safe.
-keep class com.ranobe.epub.model.** { *; }
-dontwarn javax.annotation.**
