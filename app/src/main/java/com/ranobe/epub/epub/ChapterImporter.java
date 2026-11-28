package com.ranobe.epub.epub;

import com.ranobe.epub.model.Chapter;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

/**
 * Splits imported manuscript text into chapters. A line is treated as a chapter
 * boundary when it looks like one of the conventional Japanese/western headers:
 *
 * <ul>
 *   <li>{@code 第一章 …}, {@code 第2話 …}, {@code 第１２節}, {@code 第三部}, {@code 第４巻}</li>
 *   <li>{@code 序章}, {@code 終章}, {@code プロローグ}, {@code エピローグ}, {@code あとがき} …</li>
 *   <li>{@code Chapter 12 …}, {@code CHAPTER 12}</li>
 *   <li>{@code # Markdown heading} (up to three leading #)</li>
 * </ul>
 *
 * If no boundary line exists, the whole file becomes a single chapter titled
 * after the file name.
 *
 * <p>Pure Java, no Android dependencies — unit-tested on the JVM.</p>
 */
public final class ChapterImporter {

    private static final String JAPANESE_NUMBER = "[0-9０-９一二三四五六七八九十百千零〇]";

    private static final Pattern HEADER = Pattern.compile(
            "^\\s{0,3}(?:"
                    + "#{1,3}\\s+.*"                                    // Markdown
                    + "|[Cc][Hh][Aa][Pp][Tt][Ee][Rr]\\s+[0-9]+.*"     // Chapter 12
                    + "|第" + JAPANESE_NUMBER + "{1,4}\\s*[章話節部巻回].*"   // 第一章 / 第2話
                    + "|[序終][章節].*"                                // 序章 / 終章
                    + "|プロローグ.*|エピローグ.*|インタールード.*"          // pro/epilogue
                    + "|前書き.*|後書き.*|あとがき.*|はじめに.*|おわりに.*"   // pre/afterword
                    + ")\\s*$");

    private ChapterImporter() {
    }

    /**
     * Split raw manuscript into chapters.
     *
     * @param fileName source file name, used as the fallback chapter title
     * @param text     already-decoded manuscript text
     * @return at least one chapter; never an empty list
     */
    public static List<Chapter> splitIntoChapters(String fileName, String text) {
        List<Chapter> out = new ArrayList<>();
        String fallbackTitle = stripExtension(fileName);
        if (text == null || text.trim().isEmpty()) {
            out.add(new Chapter(fallbackTitle, ""));
            return out;
        }
        String[] lines = text.split("\\r\\n|\\r|\\n", -1);

        String currentTitle = null;
        StringBuilder body = null;
        StringBuilder preamble = null; // content before the very first header
        int chapterNo = 0;

        for (String line : lines) {
            if (isHeaderLine(line)) {
                // Flush preamble (text before the first header) as its own chapter.
                if (currentTitle == null && preamble != null && !preamble.toString().trim().isEmpty()) {
                    out.add(new Chapter(fallbackTitle, preamble.toString().trim()));
                    preamble = null;
                }
                // Flush previous chapter.
                if (currentTitle != null) {
                    out.add(new Chapter(currentTitle, body == null ? "" : body.toString().trim()));
                }
                chapterNo++;
                currentTitle = headerTitle(line, chapterNo);
                body = new StringBuilder();
            } else {
                if (currentTitle == null) {
                    if (preamble == null) {
                        preamble = new StringBuilder();
                    }
                    preamble.append(line).append('\n');
                } else {
                    body.append(line).append('\n');
                }
            }
        }
        if (currentTitle == null) {
            // No headers at all: single chapter for the whole file.
            out.add(new Chapter(fallbackTitle, text.trim()));
            return out;
        }
        out.add(new Chapter(currentTitle, body == null ? "" : body.toString().trim()));
        return out;
    }

    static boolean isHeaderLine(String line) {
        if (line == null) {
            return false;
        }
        String t = line.trim();
        if (t.isEmpty() || t.length() > 80) { // chapter titles are short
            return false;
        }
        return HEADER.matcher(line).matches();
    }

    private static String headerTitle(String line, int index) {
        String t = line.trim();
        // Strip Markdown hashes.
        while (t.startsWith("#")) {
            t = t.substring(1).trim();
        }
        if (t.isEmpty()) {
            t = "Chapter " + index;
        }
        return t;
    }

    static String stripExtension(String fileName) {
        if (fileName == null) {
            return "Untitled";
        }
        String name = fileName.trim();
        int slash = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
        if (slash >= 0) {
            name = name.substring(slash + 1);
        }
        int dot = name.lastIndexOf('.');
        if (dot > 0) {
            name = name.substring(0, dot);
        }
        return name.isEmpty() ? "Untitled" : name;
    }
}
