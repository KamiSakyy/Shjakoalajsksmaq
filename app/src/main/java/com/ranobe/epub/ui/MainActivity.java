package com.ranobe.epub.ui;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.ClipData;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.OpenableColumns;
import android.view.Menu;
import android.view.MenuItem;
import android.view.View;
import android.widget.Toast;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.splashscreen.SplashScreen;
import androidx.recyclerview.widget.LinearLayoutManager;

import com.google.android.material.dialog.MaterialAlertDialogBuilder;
import com.ranobe.epub.R;
import com.ranobe.epub.data.ProjectStore;
import com.ranobe.epub.databinding.ActivityMainBinding;
import com.ranobe.epub.epub.EpubExporter;
import com.ranobe.epub.epub.EpubValidationException;
import com.ranobe.epub.model.Project;
import com.ranobe.epub.ui.adapter.ProjectAdapter;
import com.ranobe.epub.util.CrashLog;

import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

public final class MainActivity extends AppCompatActivity {

    private static final String PREFS = "ranobe_epub_settings";
    private static final String KEY_DEFAULT_LANGUAGE = "default_language";
    private static final String KEY_DEFAULT_VERTICAL = "default_vertical";

    private ActivityMainBinding binding;
    private ProjectStore store;
    private ProjectAdapter adapter;

    /** Project that an in-flight SAF "Save as" belongs to (library item overflow export). */
    private Project pendingExport;

    private final ActivityResultLauncher<Intent> createEpubLauncher =
            registerForActivityResult(new ActivityResultContracts.StartActivityForResult(), result -> {
                Project project = pendingExport;
                pendingExport = null;
                if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
                    return;
                }
                Uri uri = result.getData().getData();
                if (uri == null || project == null) {
                    return;
                }
                writeEpubToUri(uri, project);
            });

    private final ActivityResultLauncher<Intent> importBackupLauncher =
            registerForActivityResult(new ActivityResultContracts.StartActivityForResult(), result -> {
                if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
                    return;
                }
                Uri uri = result.getData().getData();
                if (uri == null) {
                    return;
                }
                try (InputStream in = getContentResolver().openInputStream(uri)) {
                    if (in == null) {
                        throw new IOException("Поток не открыт");
                    }
                    byte[] data = ProjectStore.readAllBytes(in);
                    store.importBackup(data);
                    Toast.makeText(this, R.string.backup_imported, Toast.LENGTH_SHORT).show();
                    refreshProjects();
                } catch (Exception e) {
                    showError(e.getMessage());
                }
            });

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        SplashScreen.installSplashScreen(this);
        super.onCreate(savedInstanceState);
        binding = ActivityMainBinding.inflate(getLayoutInflater());
        setContentView(binding.getRoot());
        com.ranobe.epub.util.Insets.applyEdgeToEdge(this, binding.getRoot());
        setSupportActionBar(binding.toolbar);
        maybeShowCrashLog();

        store = new ProjectStore(this);
        adapter = new ProjectAdapter(store, new ProjectAdapter.Listener() {
            @Override
            public void onOpen(Project project) {
                openProject(project);
            }

            @Override
            public void onExport(Project project) {
                requestExport(project);
            }

            @Override
            public void onDuplicate(Project project) {
                try {
                    store.duplicate(project);
                    refreshProjects();
                } catch (IOException e) {
                    showError(e.getMessage());
                }
            }

            @Override
            public void onDelete(Project project) {
                confirmDelete(project);
            }
        });

        binding.projectsRecycler.setLayoutManager(new LinearLayoutManager(this));
        binding.projectsRecycler.setAdapter(adapter);

        binding.fabCreate.setOnClickListener(v -> createProject());
        binding.emptyCreateButton.setOnClickListener(v -> createProject());

        handleIncomingIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIncomingIntent(intent);
    }

    @Override
    protected void onResume() {
        super.onResume();
        refreshProjects();
    }

    @Override
    public boolean onCreateOptionsMenu(Menu menu) {
        getMenuInflater().inflate(R.menu.menu_main, menu);
        return true;
    }

    @Override
    public boolean onOptionsItemSelected(MenuItem item) {
        int id = item.getItemId();
        if (id == R.id.action_import_backup) {
            launchImportBackup();
            return true;
        } else if (id == R.id.action_settings) {
            startActivity(new Intent(this, SettingsActivity.class));
            return true;
        } else if (id == R.id.action_about) {
            startActivity(new Intent(this, AboutActivity.class));
            return true;
        }
        return super.onOptionsItemSelected(item);
    }

    // ------------------------------------------------------------ library

    private void refreshProjects() {
        List<Project> projects = store.listProjects();
        adapter.submit(projects);
        boolean empty = projects.isEmpty();
        binding.emptyState.setVisibility(empty ? View.VISIBLE : View.GONE);
        binding.projectsRecycler.setVisibility(empty ? View.GONE : View.VISIBLE);
        binding.fabCreate.setVisibility(empty ? View.GONE : View.VISIBLE);
    }

    private Project createProjectModel() {
        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        Project project = new Project();
        project.language = prefs.getString(KEY_DEFAULT_LANGUAGE, Project.DEFAULT_LANGUAGE);
        project.vertical = prefs.getBoolean(KEY_DEFAULT_VERTICAL, true);
        // Ensure a fresh identifier chain for new projects.
        project.id = java.util.UUID.randomUUID().toString();
        return project;
    }

    private void createProject() {
        Project project = createProjectModel();
        try {
            store.save(project);
        } catch (IOException e) {
            showError(e.getMessage());
            return;
        }
        openProject(project);
    }

    private void openProject(Project project) {
        Intent intent = new Intent(this, ProjectActivity.class);
        intent.putExtra(ProjectActivity.EXTRA_PROJECT_ID, project.id);
        startActivity(intent);
    }

    private void confirmDelete(Project project) {
        new MaterialAlertDialogBuilder(this)
                .setTitle(R.string.dialog_delete_project_title)
                .setMessage(getString(R.string.dialog_delete_project_msg, project.displayTitle()))
                .setNegativeButton(R.string.cancel_action, null)
                .setPositiveButton(R.string.delete_action, (dialog, which) -> {
                    store.delete(project);
                    refreshProjects();
                })
                .show();
    }

    // ------------------------------------------------------------ export

    private void requestExport(Project project) {
        // Re-load from disk to export the latest state.
        Project fresh = store.load(project.id);
        Project source = fresh != null ? fresh : project;
        try {
            EpubExporter.validate(source);
        } catch (EpubValidationException e) {
            showError(e.getMessage());
            return;
        }
        pendingExport = source;
        String fileName = ProjectStore.sanitizeFileName(source.displayTitle()) + ".epub";
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.setType(EpubExporter.MIMETYPE);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.putExtra(Intent.EXTRA_TITLE, fileName);
        try {
            createEpubLauncher.launch(intent);
        } catch (ActivityNotFoundException e) {
            pendingExport = null;
            showError(getString(R.string.no_app_to_open));
        }
    }

    private void writeEpubToUri(Uri uri, Project project) {
        try {
            byte[] cover = store.readCover(project);
            String coverExt = store.coverExt(project);
            byte[] epub = EpubExporter.export(project, cover, coverExt);
            try (OutputStream out = getContentResolver().openOutputStream(uri, "w")) {
                if (out == null) {
                    throw new IOException("Поток не открыт");
                }
                out.write(epub);
                out.flush();
            }
            showExportDoneDialog(uri, project, epub.length);
        } catch (Exception e) {
            showError(e.getMessage());
        }
    }

    private void showExportDoneDialog(Uri uri, Project project, int byteCount) {
        String message = getString(R.string.epub_success_msg,
                ProjectStore.sanitizeFileName(project.displayTitle()) + ".epub",
                project.chapters.size(),
                humanSize(byteCount));
        new MaterialAlertDialogBuilder(this)
                .setTitle(R.string.epub_success_title)
                .setMessage(message)
                .setNegativeButton(R.string.cancel_action, null)
                .setNeutralButton(R.string.share_epub, (dialog, which) -> shareEpubUri(uri))
                .setPositiveButton(R.string.epub_open, (dialog, which) -> {
                    Intent view = new Intent(Intent.ACTION_VIEW);
                    view.setDataAndType(uri, EpubExporter.MIMETYPE);
                    view.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    try {
                        startActivity(view);
                    } catch (ActivityNotFoundException e) {
                        Toast.makeText(this, R.string.no_app_to_open, Toast.LENGTH_LONG).show();
                    }
                })
                .show();
    }

    private static String humanSize(long bytes) {
        if (bytes < 1024L * 1024L) {
            return String.format(Locale.US, "%.1f КБ", bytes / 1024.0);
        }
        return String.format(Locale.US, "%.2f МБ", bytes / (1024.0 * 1024.0));
    }

    private void launchImportBackup() {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.setType("*/*");
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.putExtra(Intent.EXTRA_MIME_TYPES,
                new String[]{"application/json", "text/plain", "application/octet-stream"});
        try {
            importBackupLauncher.launch(intent);
        } catch (ActivityNotFoundException e) {
            showError(getString(R.string.no_app_to_open));
        }
    }

    // ------------------------------------------------------------ external import / export

    /** Open-with / share-to: .txt/.md becomes a fresh project with chapters; .json backup is restored. */
    private void handleIncomingIntent(Intent intent) {
        if (intent == null || intent.getAction() == null) {
            return;
        }
        String action = intent.getAction();
        List<Uri> uris = new ArrayList<>();
        if (Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            if (Build.VERSION.SDK_INT >= 33) {
                List<Uri> stream = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri.class);
                if (stream != null) {
                    uris.addAll(stream);
                }
            } else {
                //noinspection deprecation
                List<Uri> stream = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
                if (stream != null) {
                    uris.addAll(stream);
                }
            }
            collectClipUris(intent, uris);
        } else if (Intent.ACTION_SEND.equals(action)) {
            Uri uri = null;
            if (Build.VERSION.SDK_INT >= 33) {
                uri = intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class);
            } else {
                //noinspection deprecation
                uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            }
            if (uri == null) {
                uri = intent.getData();
            }
            if (uri == null) {
                List<Uri> fromClip = new ArrayList<>();
                collectClipUris(intent, fromClip);
                if (!fromClip.isEmpty()) {
                    uri = fromClip.get(0);
                }
            }
            if (uri != null) {
                uris.add(uri);
            }
        } else if (Intent.ACTION_VIEW.equals(action)) {
            Uri uri = intent.getData();
            if (uri != null) {
                uris.add(uri);
            }
        }
        if (!uris.isEmpty()) {
            importExternalFiles(uris);
        }
    }

    private static void collectClipUris(Intent intent, List<Uri> out) {
        ClipData clip = intent.getClipData();
        if (clip == null) {
            return;
        }
        for (int i = 0; i < clip.getItemCount(); i++) {
            Uri uri = clip.getItemAt(i).getUri();
            if (uri != null && !out.contains(uri)) {
                out.add(uri);
            }
        }
    }

    private void importExternalFiles(List<Uri> uris) {
        int imported = 0;
        Project scratch = null;
        List<com.ranobe.epub.model.Chapter> chapters = new ArrayList<>();
        Exception lastError = null;
        for (Uri uri : uris) {
            String name = displayNameOf(uri, "import.txt");
            String lower = name.toLowerCase(Locale.ROOT);
            boolean isJson = lower.endsWith(".json")
                    || "application/json".equalsIgnoreCase(safeMime(uri));
            try (InputStream in = getContentResolver().openInputStream(uri)) {
                if (in == null) {
                    throw new IOException("Поток не открыт");
                }
                byte[] data = ProjectStore.readAllBytes(in);
                if (isJson) {
                    store.importBackup(data);
                } else {
                    String text = com.ranobe.epub.epub.ImportDecoder.decode(data);
                    chapters.addAll(com.ranobe.epub.epub.ChapterImporter.splitIntoChapters(name, text));
                    if (scratch == null) {
                        scratch = createProjectModel();
                    }
                }
                imported++;
            } catch (Exception e) {
                lastError = e;
            }
        }

        if (scratch != null && !chapters.isEmpty()) {
            scratch.chapters.addAll(chapters);
            try {
                store.save(scratch);
                Toast.makeText(this, getString(R.string.import_txt_done, chapters.size()),
                        Toast.LENGTH_LONG).show();
                openProject(scratch);
                return;
            } catch (IOException e) {
                showError(e.getMessage());
                return;
            }
        }
        if (imported > 0) {
            Toast.makeText(this, R.string.backup_imported, Toast.LENGTH_LONG).show();
            refreshProjects();
        } else if (lastError != null) {
            showError(lastError.getMessage());
        }
    }

    private String safeMime(Uri uri) {
        try {
            String mime = getContentResolver().getType(uri);
            return mime == null ? "" : mime;
        } catch (Exception e) {
            return "";
        }
    }

    private String displayNameOf(Uri uri, String fallback) {
        try (android.database.Cursor cursor = getContentResolver().query(uri,
                new String[]{android.provider.OpenableColumns.DISPLAY_NAME}, null, null, null)) {
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

    private void shareEpubUri(Uri uri) {
        Intent send = new Intent(Intent.ACTION_SEND);
        send.setType(EpubExporter.MIMETYPE);
        send.putExtra(Intent.EXTRA_STREAM, uri);
        send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try {
            startActivity(Intent.createChooser(send, getString(R.string.share_chooser)));
        } catch (ActivityNotFoundException e) {
            showError(getString(R.string.no_app_to_open));
        }
    }

    // ------------------------------------------------------------ crash log

    /** Show the previous crash (if any) exactly once per launch, with copy/clear actions. */
    private void maybeShowCrashLog() {
        File latest = CrashLog.latestCrash(this);
        if (latest == null) {
            return;
        }
        String text0 = CrashLog.readLatestCrash(this);
        final String text = text0 == null ? latest.getName() : text0;

        android.widget.TextView view = new android.widget.TextView(this);
        view.setText(text);
        view.setTextIsSelectable(true);
        view.setTextSize(11f);
        view.setTypeface(android.graphics.Typeface.MONOSPACE);
        view.setPadding(48, 24, 48, 24);
        android.widget.ScrollView scroll = new android.widget.ScrollView(this);
        scroll.addView(view);

        new MaterialAlertDialogBuilder(this)
                .setTitle(R.string.crash_log_title)
                .setView(scroll)
                .setPositiveButton(R.string.crash_log_copy, (dialog, which) -> {
                    android.content.ClipboardManager clipboard =
                            (android.content.ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
                    if (clipboard != null) {
                        clipboard.setPrimaryClip(android.content.ClipData.newPlainText("crash", text));
                    }
                    Toast.makeText(this, R.string.crash_log_copied, Toast.LENGTH_SHORT).show();
                })
                .setNeutralButton(R.string.crash_log_clear, (dialog, which) -> {
                    CrashLog.deleteCrashes(this);
                    Toast.makeText(this, R.string.crash_log_cleared, Toast.LENGTH_SHORT).show();
                })
                .setNegativeButton(R.string.crash_log_dismiss, null)
                .show();
    }

    // ------------------------------------------------------------ misc

    private void showError(String message) {
        String text = getString(R.string.error_generic,
                message == null ? "unknown" : message);
        Toast.makeText(this, text, Toast.LENGTH_LONG).show();
    }

}
