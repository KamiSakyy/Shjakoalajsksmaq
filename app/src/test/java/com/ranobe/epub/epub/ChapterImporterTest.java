package com.ranobe.epub.epub;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import com.ranobe.epub.model.Chapter;

import org.junit.Test;

import java.util.List;

public class ChapterImporterTest {

    @Test
    public void splitsByJapaneseChapterHeaders() {
        String text = "序章\n本文Aです。\n\n第一章　旅立ち\n本文Bです。\n第二章　帰還\n本文Cです。";
        List<Chapter> chapters = ChapterImporter.splitIntoChapters("novel.txt", text);
        assertEquals(3, chapters.size());
        assertEquals("序章", chapters.get(0).title);
        assertTrue(chapters.get(0).content.contains("本文A"));
        assertEquals("第一章　旅立ち", chapters.get(1).title);
        assertEquals("第二章　帰還", chapters.get(2).title);
    }

    @Test
    public void splitsByFullWidthDigits() {
        String text = "第２話\t始まり\n本文。";
        List<Chapter> chapters = ChapterImporter.splitIntoChapters("novel.txt", text);
        assertEquals(1, chapters.size());
        assertTrue(chapters.get(0).title.contains("第２話"));
    }

    @Test
    public void splitsByMarkdownHeadings() {
        String text = "# Prologue\nHello\n## Chapter 1\nWorld";
        List<Chapter> chapters = ChapterImporter.splitIntoChapters("book.md", text);
        assertEquals(2, chapters.size());
        assertEquals("Prologue", chapters.get(0).title);
        assertEquals("Chapter 1", chapters.get(1).title);
    }

    @Test
    public void splitsByEnglishChapterKeyword() {
        String text = "Chapter 12\nBody text\nCHAPTER 13\nMore text";
        List<Chapter> chapters = ChapterImporter.splitIntoChapters("book.txt", text);
        assertEquals(2, chapters.size());
        assertEquals("Chapter 12", chapters.get(0).title);
    }

    @Test
    public void preambleBecomesChapterNamedAfterFile() {
        String text = "これは序文です。\n第一章　開始\n本文。";
        List<Chapter> chapters = ChapterImporter.splitIntoChapters("story.txt", text);
        assertEquals(2, chapters.size());
        assertEquals("story", chapters.get(0).title);
        assertTrue(chapters.get(0).content.contains("これは序文です。"));
    }

    @Test
    public void noHeadersProducesSingleChapter() {
        String text = "だけの本文。\n二行目。";
        List<Chapter> chapters = ChapterImporter.splitIntoChapters("my book.txt", text);
        assertEquals(1, chapters.size());
        assertEquals("my book", chapters.get(0).title);
        assertTrue(chapters.get(0).content.contains("二行目。"));
    }

    @Test
    public void epilogueHeadersAreRecognized() {
        String text = "第一章　出発\n本文\nエピローグ\nあとの本文";
        List<Chapter> chapters = ChapterImporter.splitIntoChapters("n.txt", text);
        assertEquals(2, chapters.size());
        assertEquals("エピローグ", chapters.get(1).title);
    }

    @Test
    public void emptyInputProducesSingleEmptyChapter() {
        List<Chapter> chapters = ChapterImporter.splitIntoChapters("empty.txt", "");
        assertEquals(1, chapters.size());
        assertEquals("empty", chapters.get(0).title);
    }
}
