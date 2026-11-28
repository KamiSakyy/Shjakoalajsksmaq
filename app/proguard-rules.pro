# Ranobe EPUB — правила R8 / ProGuard для release-сборки.
#
# Бэкап проекта (JSON) сериализуется через framework-класс org.json без рефлексии,
# WebView работает с отключённым JavaScript и без JavascriptInterface —
# поэтому широкие -keep не требуются. AndroidX/Material приносят свои consumer-правила.

-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# Явно сохраняем аннотации, если появятся keep-аннотации в будущем.
-keepattributes *Annotation*
