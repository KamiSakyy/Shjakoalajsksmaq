package com.ranobe.epub.ui;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
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

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.List;

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
        setSupportActionBar(binding.toolbar);

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

    private void createProject() {
        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        Project project = new Project();
        project.language = prefs.getString(KEY_DEFAULT_LANGUAGE, Project.DEFAULT_LANGUAGE);
        project.vertical = prefs.getBoolean(KEY_DEFAULT_VERTICAL, true);
        // Ensure a fresh identifier chain for new projects.
        project.id = java.util.UUID.randomUUID().toString();
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
            Toast.makeText(this, R.string.toast_epub_exported, Toast.LENGTH_SHORT).show();
        } catch (Exception e) {
            showError(e.getMessage());
        }
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

    // ------------------------------------------------------------ misc

    private void showError(String message) {
        String text = getString(R.string.error_generic,
                message == null ? "unknown" : message);
        Toast.makeText(this, text, Toast.LENGTH_LONG).show();
    }

}
