# Ranobe EPUB — нативное Android-приложение (Java + Gradle)

Полностью локальный редактор **EPUB 3** для японских ранобэ (и любых книг).
Тёмная тема, Material 3, только векторные иконки, без градиентов и неона.
Без интернета (у приложения **нет разрешения `INTERNET`**), без аккаунта, без рекламы.

> Существующие файлы репозитория (`README.md`, `realistic-axe-physics-zombie-game (3).zip`)
> не изменялись и не используются. Приложение целиком состоит из новых файлов.

## Возможности

- **Проекты-библиотека**: создание, дублирование, удаление, быстрый экспорт из списка.
- **Редактор метаданных** EPUB 3 (OPF): название, автор (`dc:creator` + `role=aut`, `file-as`),
  язык (BCP 47), издательство, серия (`belongs-to-collection` + `collection-type=series`),
  рубрики (`dc:subject`), аннотация, уникальный идентификатор (URN; пусто → `urn:uuid`).
- **Главы**: добавление, переименование, порядок ↑↓, удаление, счётчик знаков,
  полноэкранный редактор, автосохранение (onPause и при каждой мутации).
- **Вертикальная запись (縦書き)**: `writing-mode: vertical-rl` в CSS +
  `page-progression-direction="rtl"` в `<spine>` — как в настоящих ранобэ.
- **Руби (фуригана) по правилам Aozora Bunko**: `漢字《かんじ》`, явная база `｜漢字《かんじ》`,
  управляющие метки `［＃…］` удаляются при экспорте.
- **Обложка**: выбор из галереи/Google Фото/проводника, даунскейл до 1600×2400, JPEG 88,
  встраивание как `properties="cover-image"` + legacy-метка `name="cover"`.
- **Импорт .txt / .md**: автоопределение кодировки (UTF-8 BOM, UTF-8, Shift_JIS/Windows-31J/MS932,
  windows-1251, ISO-8859-1), разбивка на главы по заголовкам (`第一章`, `第２話`, `第1部`,
  `序章`/`終章`, `プロローグ`/`エピローグ`, `Chapter 12`, `# Markdown`), преамбула → отдельная глава.
- **Экспорт EPUB 3.0.1**: `mimetype` (STORED, первый), `META-INF/container.xml`,
  `content.opf` (version 3.0, `dcterms:modified`, accessibility-метки `schema:accessibility*`),
  `nav.xhtml` (`epub:type="toc"`), `toc.ncx` (для старых читалок), `style.css`.
- **Предпросмотр главы** в WebView (тот же конвейер, что и при экспорте).
- **Резервная копия проекта** в `.json` (обложка встраивается как base64) и импорт обратно.
- **Сохранение**: автосохранение + явная кнопка; экспорт/сохранение через системный SAF —
  проводник, Google Drive, почта и т.д. Путь сохранения выбирает пользователь.
- **Разрешения**: `READ_MEDIA_IMAGES` (Android 13+), `READ_EXTERNAL_STORAGE` (≤32),
  `WRITE_EXTERNAL_STORAGE` (≤28). Современный поток на SAF разрешений не требует.
  Сети нет вовсе.

## Стек

- Android SDK, **Java 17**, Gradle 9.9.1 (wrapper), **Android Gradle Plugin 9.5.1**
- `compileSdk 36` / `targetSdk 36` / `minSdk 26`
- AndroidX + Material Components 1.12.0, ViewBinding, RecyclerView, NestedScrollView
- Чистый Java-движок EPUB (без сетевых и без бинарных зависимостей) — покрыт unit-тестами
- `core-splashscreen`, Splash Screen API

## Получение APK (GitHub Actions)

Воркфлоу: `.github/workflows/android.yml`.

Триггеры: push в `main` и `arena/**`, pull request в `main`, теги `v*`, ручной запуск
(workflow_dispatch). Стадии: **unit-тесты → assembleDebug (ставится на устройство) →
assembleRelease (arm64-v8a, ProGuard-минификация, debug-signed)** → загрузка артефактов.

- Прямая ссылка на APK после слияния в `main`:
  `https://github.com/KamiSakyy/Shjakoalajsksmaq/releases/tag/latest`
  (rolling-релиз `latest` обновляется автоматически при каждом push в `main`).
- Версионный релиз: `git tag v1.0.0 && git push origin v1.0.0` — APK прикрепится к релизу `v1.0.0`.
- На каждой сборке артефакты также лежат в разделе **Actions → RanobeEPUB-apk**.

> О подписи: `release`-сборка (arm64-v8a, R8-минификация) подписана **стандартным публичным
> debug-ключом Android** — так APK реально устанавливается на устройство. Это НЕ production-подпись
> и НЕ подпись для Google Play (нужен собственный keystore). `debug`-сборка тоже ставится на устройство.
> подпишите её своим ключом, когда понадобится публикация.

## Локальная сборка

```bash
./gradlew :app:testDebugUnitTest
./gradlew :app:assembleDebug
# APK: app/build/outputs/apk/debug/app-debug.apk
```

Требования: JDK 17, Android SDK (platforms;android-36, build-tools;36.0.0).

## Структура

```
app/src/main/java/com/ranobe/epub/
  model/   Chapter, Project            — модель данных (чистая Java)
  epub/    RubyConverter               — Aozora ruby → XHTML (чистая Java)
           EpubExporter                — сборка EPUB 3 (zip, чистая Java)
           ChapterImporter             — разбивка рукописи на главы (чистая Java)
           ImportDecoder               — детект кодировок (чистая Java)
           EpubValidationException
  data/    ProjectStore                — JSON + обложка + бэкап (files/projects/<id>)
  ui/      MainActivity                — библиотека
           ProjectActivity             — редактор проекта (метаданные, главы, экспорт)
           ChapterActivity             — полноэкранный редактор главы
           ChapterPreviewActivity      — предпросмотр в WebView
           SettingsActivity, AboutActivity
           adapter/ProjectAdapter, ChapterAdapter
  util/    PermissionsHelper           — runtime-разрешения (медиа), рационале, настройки
app/src/test/java/com/ranobe/epub/epub/  — unit-тесты движка (JUnit 4)
```

Хранение: `files/projects/<projectId>/project.json` + `cover.jpg`. Ничего не уходит из песочницы.

## Дизайн

Палитра графит + приглушённая латунь (`#0F1115` / `#161A20` / `#D3B26A`). Только плоские
цвета — ни градиентов, ни неона, ни эмодзи. Иконки — векторные path (24 dp, Material-стиль),
лаунчер — адаптивная иконка (vector + monochrome).
