package com.ranobe.epub.ui;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Bundle;
import android.provider.OpenableColumns;
import android.view.Menu;
import android.view.MenuItem;
import android.view.View;
import android.widget.ArrayAdapter;
import android.widget.Toast;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.appcompat.app.AppCompatActivity;
import androidx.recyclerview.widget.LinearLayoutManager;

import com.google.android.material.dialog.MaterialAlertDialogBuilder;
import com.google.android.material.snackbar.Snackbar;
import com.google.android.material.textfield.MaterialAutoCompleteTextView;
import com.ranobe.epub.R;
import com.ranobe.epub.data.ProjectStore;
import com.ranobe.epub.databinding.ActivityProjectBinding;
import com.ranobe.epub.epub.ChapterImporter;
import com.ranobe.epub.epub.EpubExporter;
import com.ranobe.epub.epub.EpubValidationException;
import com.ranobe.epub.epub.ImportDecoder;
import com.ranobe.epub.model.Chapter;
import com.ranobe.epub.model.Project;
import com.ranobe.epub.ui.adapter.ChapterAdapter;
import com.ranobe.epub.util.PermissionsHelper;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;

public final class ProjectActivity extends AppCompatActivity {

    public static final String EXTRA_PROJECT_ID = "project_id";

    private ActivityProjectBinding binding;
    private ProjectStore store;
    private Project project;
    private ChapterAdapter chapterAdapter;

    private String selectedLanguage;
    private boolean languageBound;

    /** Pending SAF target for the currently running export flow. */
    private ExportTarget pendingTarget = ExportTarget.NONE;

    private enum ExportTarget {NONE, EPUB, BACKUP}

    private final ActivityResultLauncher<Intent> pickImageLauncher =
            registerForActivityResult(new ActivityResultContracts.StartActivityForResult(), result -> {
                if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
                    return;
                }
                Uri uri = result.getData().getData();
                if (uri == null || project == null) {
                    return;
                }
                try (InputStream in = getContentResolver().openInputStream(uri)) {
                    if (in == null) {
                        throw new IOException("Поток не открыт");
                    }
                    project.coverFileName = store.saveCover(project, in);
                    saveProject(false);
                    renderCover();
                } catch (Exception e) {
                    showError(e.getMessage());
                }
            });

    private final ActivityResultLauncher<Intent> importTxtLauncher =
            registerForActivityResult(new ActivityResultContracts.StartActivityForResult(), result -> {
                if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
                    return;
                }
                List<Uri> uris = collectUris(result.getData());
                int imported = 0;
                for (Uri uri : uris) {
                    try {
                        byte[] bytes;
                        try (InputStream in = getContentResolver().openInputStream(uri)) {
                            if (in == null) {
                                continue;
                            }
                            bytes = ProjectStore.readAllBytes(in);
                        }
                        String text = ImportDecoder.decode(bytes);
                        String name = displayName(uri, "import.txt");
                        List<Chapter> chapters = ChapterImporter.splitIntoChapters(name, text);
                        project.chapters.addAll(chapters);
                        imported += chapters.size();
                    } catch (Exception e) {
                        showError(e.getMessage());
                    }
                }
                if (imported > 0) {
                    try {
                        saveProject(false);
                    } catch (Exception e) {
                        showError(e.getMessage());
                    }
                    rebindChapters();
                    Toast.makeText(this, getString(R.string.import_txt_done, imported),
                            Toast.LENGTH_LONG).show();
                }
            });

    private final ActivityResultLauncher<Intent> createDocumentLauncher =
            registerForActivityResult(new ActivityResultContracts.StartActivityForResult(), result -> {
                ExportTarget target = pendingTarget;
                pendingTarget = ExportTarget.NONE;
                if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
                    return;
                }
                Uri uri = result.getData().getData();
                if (uri == null) {
                    return;
                }
                if (target == ExportTarget.EPUB) {
                    writeEpub(uri);
                } else if (target == ExportTarget.BACKUP) {
                    writeBackup(uri);
                }
            });

    // ---------------------------------------------------------------- lifecycle

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        binding = ActivityProjectBinding.inflate(getLayoutInflater());
        setContentView(binding.getRoot());
        com.ranobe.epub.util.Insets.applyEdgeToEdge(this, binding.getRoot());
        setSupportActionBar(binding.toolbar);
        if (getSupportActionBar() != null) {
            getSupportActionBar().setDisplayHomeAsUpEnabled(true);
        }
        binding.toolbar.setNavigationOnClickListener(v -> finishAfterSave());

        store = new ProjectStore(this);

        String projectId = getIntent().getStringExtra(EXTRA_PROJECT_ID);
        project = store.load(projectId);
        if (project == null) {
            Toast.makeText(this, getString(R.string.error_generic, "project not found"),
                    Toast.LENGTH_LONG).show();
            finish();
            return;
        }
        selectedLanguage = project.language;

        setupLanguageDropdown();
        bindStaticFields();
        setupCoverButtons();
        setupChapters();
        setupExportButtons();
        renderCover();
        rebindChapters();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (project == null || store == null) {
            return;
        }
        // Chapters may have changed while the editor was open; refresh the list only.
        Project fresh = store.load(project.id);
        if (fresh != null) {
            project = fresh;
            rebindChapters();
            renderCover();
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        // Auto-save: never lose text because the user walked away, rotated, or pressed Back.
        if (project != null && store != null) {
            try {
                collectFields();
                store.save(project);
            } catch (Exception ignored) {
                // Stay silent; the explicit Save action reports errors.
            }
        }
    }

    @Override
    public boolean onCreateOptionsMenu(Menu menu) {
        getMenuInflater().inflate(R.menu.menu_project, menu);
        return true;
    }

    @Override
    public boolean onOptionsItemSelected(MenuItem item) {
        if (item.getItemId() == R.id.action_save) {
            saveProject(true);
            return true;
        }
        return super.onOptionsItemSelected(item);
    }

    private void finishAfterSave() {
        try {
            collectFields();
            store.save(project);
        } catch (Exception ignored) {
            // ignore; user explicitly left
        }
        finish();
    }

    // ---------------------------------------------------------------- static fields

    private void bindStaticFields() {
        binding.inputTitle.setText(project.title);
        binding.inputAuthor.setText(project.author);
        binding.inputPublisher.setText(project.publisher);
        binding.inputSeries.setText(project.series);
        binding.inputSubjects.setText(project.subjects);
        binding.inputIdentifier.setText(project.identifier);
        binding.inputDescription.setText(project.description);
        binding.verticalSwitch.setChecked(project.vertical);
        selectLanguageInDropdown(project.language);
    }

    private void collectFields() {
        project.title = textOf(binding.inputTitle);
        project.author = textOf(binding.inputAuthor);
        project.publisher = textOf(binding.inputPublisher);
        project.series = textOf(binding.inputSeries);
        project.subjects = textOf(binding.inputSubjects);
        project.identifier = textOf(binding.inputIdentifier);
        project.description = textOf(binding.inputDescription);
        project.vertical = binding.verticalSwitch.isChecked();
        if (languageBound && selectedLanguage != null) {
            project.language = selectedLanguage;
        }
    }

    private static String textOf(android.widget.EditText editText) {
        return editText.getText() == null ? "" : editText.getText().toString().trim();
    }

    private void setupLanguageDropdown() {
        String[] labels = getResources().getStringArray(R.array.language_labels);
        String[] codes = getResources().getStringArray(R.array.language_codes);
        MaterialAutoCompleteTextView dropdown = binding.inputLanguage;
        ArrayAdapter<String> adapter = new ArrayAdapter<>(
                this, android.R.layout.simple_dropdown_item_1line, labels);
        dropdown.setAdapter(adapter);
        dropdown.setOnClickListener(v -> dropdown.showDropDown());
        dropdown.setOnItemClickListener((parent, view, position, id) -> {
            if (position >= 0 && position < codes.length) {
                selectedLanguage = codes[position];
            }
        });
        languageBound = true;
    }

    private void selectLanguageInDropdown(String code) {
        String[] labels = getResources().getStringArray(R.array.language_labels);
        String[] codes = getResources().getStringArray(R.array.language_codes);
        int index = 0;
        if (code != null) {
            for (int i = 0; i < codes.length; i++) {
                if (codes[i].equalsIgnoreCase(code)) {
                    index = i;
                    break;
                }
            }
        }
        selectedLanguage = codes[index];
        binding.inputLanguage.setText(labels[index], false);
    }

    // ---------------------------------------------------------------- cover

    private void setupCoverButtons() {
        binding.chooseCoverButton.setOnClickListener(v -> requestCoverPicker());
        binding.removeCoverButton.setOnClickListener(v -> {
            store.removeCover(project);
            try {
                saveProject(false);
            } catch (Exception ignored) {
                // keep silent
            }
            renderCover();
        });
    }

    private void requestCoverPicker() {
        if (PermissionsHelper.hasImagesPermission(this)) {
            launchCoverPicker();
            return;
        }
        if (PermissionsHelper.shouldShowRationale(this)) {
            new MaterialAlertDialogBuilder(this)
                    .setMessage(R.string.perm_denied_settings)
                    .setNegativeButton(R.string.cancel_action, null)
                    .setPositiveButton(R.string.open_settings,
                            (dialog, which) -> PermissionsHelper.requestImagesPermission(this))
                    .show();
            return;
        }
        PermissionsHelper.requestImagesPermission(this);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode,
                                           String[] permissions,
                                           int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != PermissionsHelper.REQUEST_CODE_IMAGES) {
            return;
        }
        boolean granted = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
        if (granted) {
            launchCoverPicker();
            return;
        }
        if (PermissionsHelper.isPermanentlyDenied(this)) {
            Snackbar.make(binding.getRoot(), R.string.perm_denied_settings, Snackbar.LENGTH_LONG)
                    .setAction(R.string.open_settings, v -> PermissionsHelper.openAppSettings(this))
                    .show();
        }
        // SAF does not need the permission; still open the picker.
        launchCoverPicker();
    }

    private void launchCoverPicker() {
        Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
        intent.setType("image/*");
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        try {
            pickImageLauncher.launch(intent);
        } catch (ActivityNotFoundException e) {
            showError(getString(R.string.no_app_to_open));
        }
    }

    private void renderCover() {
        byte[] bytes = store.readCover(project);
        Bitmap thumb = bytes == null ? null : decodeSampled(bytes, 360);
        if (thumb != null) {
            binding.coverPreview.setImageBitmap(thumb);
            binding.coverPreview.setVisibility(View.VISIBLE);
            binding.coverPlaceholderIcon.setVisibility(View.GONE);
        } else {
            binding.coverPreview.setImageDrawable(null);
            binding.coverPreview.setVisibility(View.GONE);
            binding.coverPlaceholderIcon.setVisibility(View.VISIBLE);
        }
    }

    private static Bitmap decodeSampled(byte[] bytes, int reqSize) {
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
        int sample = 1;
        while (bounds.outWidth / sample > reqSize || bounds.outHeight / sample > reqSize) {
            sample *= 2;
        }
        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inSampleSize = sample;
        try {
            return BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options);
        } catch (OutOfMemoryError e) {
            return null;
        }
    }

    // ---------------------------------------------------------------- chapters

    private void setupChapters() {
        chapterAdapter = new ChapterAdapter(new ChapterAdapter.Listener() {
            @Override
            public void onEdit(Chapter chapter) {
                openChapter(chapter);
            }

            @Override
            public void onMove(int fromPosition, int toPosition) {
                List<Chapter> chapters = project.chapters;
                if (fromPosition < 0 || toPosition < 0
                        || fromPosition >= chapters.size() || toPosition >= chapters.size()) {
                    return;
                }
                Collections.swap(chapters, fromPosition, toPosition);
                saveQuietly();
                chapterAdapter.submit(chapters);
                chapterAdapter.notifyItemMoved(fromPosition, toPosition);
                chapterAdapter.notifyItemRangeChanged(0, chapters.size());
                updateChapterCount();
            }

            @Override
            public void onDelete(Chapter chapter) {
                confirmDeleteChapter(chapter);
            }
        });
        binding.chaptersRecycler.setLayoutManager(new LinearLayoutManager(this));
        binding.chaptersRecycler.setAdapter(chapterAdapter);

        binding.addChapterButton.setOnClickListener(v -> showAddChapterDialog());
        binding.importTxtButton.setOnClickListener(v -> launchImportTxt());
    }

    private void showAddChapterDialog() {
        android.view.View view = getLayoutInflater().inflate(R.layout.dialog_chapter_name, null);
        final android.widget.EditText input =
                view.findViewById(R.id.chapter_name_input);

        new MaterialAlertDialogBuilder(this)
                .setTitle(R.string.dialog_add_chapter_title)
                .setView(view)
                .setNegativeButton(R.string.cancel_action, null)
                .setPositiveButton(R.string.create_action, (dialog, which) -> {
                    String title = input.getText() == null ? "" : input.getText().toString().trim();
                    if (title.isEmpty()) {
                        title = getString(R.string.chapter_fallback_title, project.chapters.size() + 1);
                    }
                    Chapter chapter = new Chapter(title, "");
                    project.chapters.add(chapter);
                    saveQuietly();
                    rebindChapters();
                    openChapter(chapter);
                })
                .show();
    }

    private void openChapter(Chapter chapter) {
        saveQuietly();
        Intent intent = new Intent(this, ChapterActivity.class);
        intent.putExtra(ChapterActivity.EXTRA_PROJECT_ID, project.id);
        intent.putExtra(ChapterActivity.EXTRA_CHAPTER_ID, chapter.id);
        startActivity(intent);
    }

    private void confirmDeleteChapter(Chapter chapter) {
        String name = chapter.title == null || chapter.title.trim().isEmpty()
                ? getString(R.string.untitled_chapter)
                : chapter.title.trim();
        new MaterialAlertDialogBuilder(this)
                .setTitle(R.string.dialog_delete_chapter_title)
                .setMessage(getString(R.string.dialog_delete_chapter_msg, name))
                .setNegativeButton(R.string.cancel_action, null)
                .setPositiveButton(R.string.delete_action, (dialog, which) -> {
                    project.chapters.remove(chapter);
                    saveQuietly();
                    rebindChapters();
                })
                .show();
    }

    private void rebindChapters() {
        if (chapterAdapter == null) {
            return;
        }
        chapterAdapter.submit(project.chapters);
        updateChapterCount();
        binding.chaptersEmpty.setVisibility(project.chapters.isEmpty() ? View.VISIBLE : View.GONE);
    }

    private void updateChapterCount() {
        binding.chaptersCount.setText(String.format(Locale.US, "%d", project.chapters.size()));
    }

    private void launchImportTxt() {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.setType("*/*");
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        intent.putExtra(Intent.EXTRA_MIME_TYPES,
                new String[]{"text/plain", "text/markdown", "application/octet-stream"});
        try {
            importTxtLauncher.launch(intent);
        } catch (ActivityNotFoundException e) {
            showError(getString(R.string.no_app_to_open));
        }
    }

    private List<Uri> collectUris(Intent data) {
        List<Uri> uris = new ArrayList<>();
        android.content.ClipData clip = data.getClipData();
        if (clip != null) {
            for (int i = 0; i < clip.getItemCount(); i++) {
                Uri uri = clip.getItemAt(i).getUri();
                if (uri != null) {
                    uris.add(uri);
                }
            }
        } else {
            Uri single = data.getData();
            if (single != null) {
                uris.add(single);
            }
        }
        return uris;
    }

    private String displayName(Uri uri, String fallback) {
        try (Cursor cursor = getContentResolver().query(uri,
                new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                String name = cursor.getString(0);
                if (name != null && !name.isEmpty()) {
                    return name;
                }
            }
        } catch (Exception ignored) {
            // fall through
        }
        return fallback;
    }

    // ---------------------------------------------------------------- export & backup

    private void setupExportButtons() {
        binding.exportEpubButton.setOnClickListener(v -> requestExportEpub());
        binding.backupSaveButton.setOnClickListener(v -> requestBackupSave());
        binding.deleteProjectButton.setOnClickListener(v ->
                confirmDeleteProject((dialog, which) -> {
                    store.delete(project);
                    finish();
                }));
    }

    private void confirmDeleteProject(DialogInterface.OnClickListener onConfirm) {
        new MaterialAlertDialogBuilder(this)
                .setTitle(R.string.dialog_delete_project_title)
                .setMessage(getString(R.string.dialog_delete_project_msg, project.displayTitle()))
                .setNegativeButton(R.string.cancel_action, null)
                .setPositiveButton(R.string.delete_action, onConfirm)
                .show();
    }

    private void requestExportEpub() {
        saveQuietly();
        try {
            EpubExporter.validate(project);
        } catch (EpubValidationException e) {
            showError(e.getMessage());
            return;
        }
        pendingTarget = ExportTarget.EPUB;
        String fileName = ProjectStore.sanitizeFileName(project.displayTitle()) + ".epub";
        launchCreateDocument(EpubExporter.MIMETYPE, fileName);
    }

    private void requestBackupSave() {
        saveQuietly();
        pendingTarget = ExportTarget.BACKUP;
        String fileName = ProjectStore.sanitizeFileName(project.displayTitle()) + ".ranobe.json";
        launchCreateDocument("application/json", fileName);
    }

    private void launchCreateDocument(String mimeType, String fileName) {
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.setType(mimeType);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.putExtra(Intent.EXTRA_TITLE, fileName);
        try {
            createDocumentLauncher.launch(intent);
        } catch (ActivityNotFoundException e) {
            pendingTarget = ExportTarget.NONE;
            showError(getString(R.string.no_app_to_open));
        }
    }

    private void writeEpub(Uri uri) {
        try {
            prepareForExport();
            byte[] cover = store.readCover(project);
            byte[] epub = EpubExporter.export(project, cover, store.coverExt(project));
            writeBytes(uri, epub);
            Toast.makeText(this, R.string.toast_epub_exported, Toast.LENGTH_SHORT).show();
            showExportSuccess(uri, epub.length);
        } catch (Exception e) {
            showError(e.getMessage());
        }
    }

    private void showExportSuccess(Uri uri, int byteCount) {
        String message = getString(R.string.epub_success_msg,
                ProjectStore.sanitizeFileName(project.displayTitle()) + ".epub",
                project.chapters.size(),
                humanReadableSize(byteCount));
        new MaterialAlertDialogBuilder(this)
                .setTitle(R.string.epub_success_title)
                .setMessage(message)
                .setNegativeButton(R.string.cancel_action, null)
                .setNeutralButton(R.string.share_epub, (dialog, which) -> shareEpubUri(uri))
                .setPositiveButton(R.string.epub_open, (dialog, which) -> openEpubUri(uri))
                .show();
    }

    private void shareEpubUri(Uri uri) {
        Intent send = new Intent(Intent.ACTION_SEND);
        send.setType(EpubExporter.MIMETYPE);
        send.putExtra(Intent.EXTRA_STREAM, uri);
        send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try {
            startActivity(Intent.createChooser(send, getString(R.string.share_chooser)));
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, R.string.no_app_to_open, Toast.LENGTH_LONG).show();
        }
    }

    private void openEpubUri(Uri uri) {
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(uri, EpubExporter.MIMETYPE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try {
            startActivity(intent);
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, R.string.no_app_to_open, Toast.LENGTH_LONG).show();
        }
    }

    private void writeBackup(Uri uri) {
        try {
            prepareForExport();
            byte[] backup = store.exportBackup(project);
            writeBytes(uri, backup);
            Toast.makeText(this, R.string.backup_saved, Toast.LENGTH_SHORT).show();
        } catch (Exception e) {
            showError(e.getMessage());
        }
    }

    /** Re-read from disk so export sees the latest chapters/cover. */
    private void prepareForExport() throws IOException {
        Project fresh = store.load(project.id);
        if (fresh != null) {
            project = fresh;
        }
    }

    private void writeBytes(Uri uri, byte[] bytes) throws IOException {
        try (OutputStream out = getContentResolver().openOutputStream(uri, "w")) {
            if (out == null) {
                throw new IOException("Поток не открыт");
            }
            out.write(bytes);
            out.flush();
        }
    }

    private static String humanReadableSize(long bytes) {
        if (bytes < 1024L * 1024L) {
            return String.format(Locale.US, "%.1f КБ", bytes / 1024.0);
        }
        return String.format(Locale.US, "%.2f МБ", bytes / (1024.0 * 1024.0));
    }

    // ---------------------------------------------------------------- save helpers

    private void saveProject(boolean withToast) {
        try {
            collectFields();
            store.save(project);
            if (withToast) {
                Toast.makeText(this, R.string.toast_saved, Toast.LENGTH_SHORT).show();
            }
        } catch (Exception e) {
            showError(e.getMessage());
        }
    }

    private void saveQuietly() {
        try {
            collectFields();
            store.save(project);
        } catch (Exception ignored) {
            // silent auto-save
        }
    }

    private void showError(String message) {
        Snackbar.make(binding.getRoot(),
                        getString(R.string.error_generic, message == null ? "unknown" : message),
                        Snackbar.LENGTH_LONG)
                .show();
    }
}
