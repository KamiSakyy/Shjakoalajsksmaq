package com.ranobe.epub.ui;

import android.os.Bundle;

import androidx.appcompat.app.AppCompatActivity;

import com.ranobe.epub.databinding.ActivityChapterPreviewBinding;
import com.ranobe.epub.epub.RubyConverter;
import com.ranobe.epub.model.Chapter;
import com.ranobe.epub.model.Project;
import com.ranobe.epub.data.ProjectStore;

import java.util.List;
import java.util.Locale;

/**
 * Fully offline WebView preview of the current chapter exactly as it will
 * appear inside the EPUB (same ruby conversion, same vertical-rl option).
 */
public final class ChapterPreviewActivity extends AppCompatActivity {

    public static final String EXTRA_PROJECT_ID = "project_id";
    public static final String EXTRA_CHAPTER_ID = "chapter_id";

    private ActivityChapterPreviewBinding binding;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        binding = ActivityChapterPreviewBinding.inflate(getLayoutInflater());
        setContentView(binding.getRoot());
        com.ranobe.epub.util.Insets.applyEdgeToEdge(this, binding.getRoot());
        setSupportActionBar(binding.toolbar);
        if (getSupportActionBar() != null) {
            getSupportActionBar().setDisplayHomeAsUpEnabled(true);
        }
        binding.toolbar.setNavigationOnClickListener(v -> finish());

        ProjectStore store = new ProjectStore(this);
        Project project = store.load(getIntent().getStringExtra(EXTRA_PROJECT_ID));
        Chapter chapter = null;
        List<Chapter> chapters = project == null ? null : project.chapters;
        String chapterId = getIntent().getStringExtra(EXTRA_CHAPTER_ID);
        if (chapters != null) {
            for (Chapter c : chapters) {
                if (c.id.equals(chapterId)) {
                    chapter = c;
                    break;
                }
            }
        }
        if (project == null || chapter == null) {
            finish();
            return;
        }
        binding.previewWebview.getSettings().setJavaScriptEnabled(false);
        binding.previewWebview.getSettings().setDefaultTextEncodingName("utf-8");
        binding.previewWebview.loadDataWithBaseURL(
                null, buildPreviewHtml(project, chapter), "text/html", "utf-8", null);
    }

    static String buildPreviewHtml(Project project, Chapter chapter) {
        String lang = project.language == null ? "ja" : project.language;
        boolean ja = lang.toLowerCase(Locale.ROOT).startsWith("ja");
        String title = chapter.title == null || chapter.title.trim().isEmpty()
                ? (ja ? "無題" : "Untitled")
                : chapter.title.trim();
        StringBuilder paragraphs = new StringBuilder();
        for (String p : RubyConverter.toParagraphXhtml(chapter.content)) {
            paragraphs.append(p).append('\n');
        }
        String verticalCss = project.vertical
                ? "html { writing-mode: vertical-rl; -webkit-writing-mode: vertical-rl; }\n"
                : "";
        return "<!DOCTYPE html><html lang=\"" + escape(lang) + "\"><head><meta charset=\"utf-8\"/>"
                + "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"/>"
                + "<title>" + escape(title) + "</title>"
                + "<style>"
                + verticalCss
                + "body { font-family: 'Noto Serif JP','Noto Serif CJK JP','Yu Mincho',serif;"
                + " background:#f8f7f3; color:#191a1c; font-size:19px; line-height:2.0;"
                + " padding:22px 18px; margin:0; }"
                + "h1 { font-size:1.3em; font-weight:600; border-bottom:1px solid #d8d5cb;"
                + " padding-bottom:0.4em; }\n"
                + "p { text-indent:1em; margin:0 0 0.95em 0; }\n"
                + "rt { font-size:0.58em; }"
                + "</style></head><body>"
                + "<h1>" + escape(title) + "</h1>"
                + paragraphs
                + "</body></html>";
    }

    private static String escape(String s) {
        return RubyConverter.escapeXml(s);
    }
}
