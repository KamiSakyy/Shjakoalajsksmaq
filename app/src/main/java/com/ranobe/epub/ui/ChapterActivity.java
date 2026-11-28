package com.ranobe.epub.ui;

import android.os.Bundle;
import android.view.Menu;
import android.view.MenuItem;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;

import com.google.android.material.snackbar.Snackbar;
import com.ranobe.epub.R;
import com.ranobe.epub.data.ProjectStore;
import com.ranobe.epub.databinding.ActivityChapterBinding;
import com.ranobe.epub.model.Chapter;
import com.ranobe.epub.model.Project;

import java.util.List;

/**
 * Full-screen multi-line chapter editor. Aozora-bunko markup is converted at
 * export time; here the author sees raw text (the standard for Japanese
 * manuscripts). Auto-saves on pause; explicit save is in the toolbar.
 */
public final class ChapterActivity extends AppCompatActivity {

    public static final String EXTRA_PROJECT_ID = "project_id";
    public static final String EXTRA_CHAPTER_ID = "chapter_id";

    private ActivityChapterBinding binding;
    private ProjectStore store;
    private Project project;
    private Chapter chapter;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        binding = ActivityChapterBinding.inflate(getLayoutInflater());
        setContentView(binding.getRoot());
        setSupportActionBar(binding.toolbar);
        if (getSupportActionBar() != null) {
            getSupportActionBar().setDisplayHomeAsUpEnabled(true);
        }
        binding.toolbar.setNavigationOnClickListener(v -> finishAndSave());

        store = new ProjectStore(this);
        String projectId = getIntent().getStringExtra(EXTRA_PROJECT_ID);
        String chapterId = getIntent().getStringExtra(EXTRA_CHAPTER_ID);
        project = store.load(projectId);
        chapter = findChapter(project, chapterId);
        if (project == null || chapter == null) {
            Toast.makeText(this, getString(R.string.error_generic, "chapter not found"),
                    Toast.LENGTH_LONG).show();
            finish();
            return;
        }
        binding.chapterTitleInput.setText(chapter.title);
        binding.chapterContent.setText(chapter.content);
        // Place cursor at the end, ready to write.
        binding.chapterContent.setSelection(binding.chapterContent.getText().length());
    }

    private static Chapter findChapter(Project project, String chapterId) {
        if (project == null || chapterId == null) {
            return null;
        }
        List<Chapter> chapters = project.chapters;
        for (Chapter c : chapters) {
            if (chapterId.equals(c.id)) {
                return c;
            }
        }
        return null;
    }

    private void persist() {
        if (project == null || chapter == null) {
            return;
        }
        chapter.title = binding.chapterTitleInput.getText() == null
                ? ""
                : binding.chapterTitleInput.getText().toString().trim();
        chapter.content = binding.chapterContent.getText() == null
                ? ""
                : binding.chapterContent.getText().toString();
        try {
            store.save(project);
        } catch (Exception e) {
            Snackbar.make(binding.getRoot(),
                    getString(R.string.error_generic, e.getMessage()),
                    Snackbar.LENGTH_LONG).show();
        }
    }

    private void finishAndSave() {
        persist();
        finish();
    }

    @Override
    protected void onPause() {
        super.onPause();
        persist();
    }

    @Override
    public boolean onCreateOptionsMenu(Menu menu) {
        getMenuInflater().inflate(R.menu.menu_chapter, menu);
        return true;
    }

    @Override
    public boolean onOptionsItemSelected(MenuItem item) {
        int id = item.getItemId();
        if (id == R.id.action_save) {
            persist();
            Toast.makeText(this, R.string.toast_saved, Toast.LENGTH_SHORT).show();
            return true;
        } else if (id == R.id.action_preview) {
            persist();
            android.content.Intent intent = new android.content.Intent(this, ChapterPreviewActivity.class);
            intent.putExtra(ChapterPreviewActivity.EXTRA_PROJECT_ID, project.id);
            intent.putExtra(ChapterPreviewActivity.EXTRA_CHAPTER_ID, chapter.id);
            startActivity(intent);
            return true;
        }
        return super.onOptionsItemSelected(item);
    }
}
