package com.ranobe.epub.epub;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

/**
 * Converts raw manuscript text into EPUB 3 / XHTML fragment content.
 *
 * <p>Supported input conventions (Aozora-bunko style, the de-facto standard
 * for Japanese light novels distributed as plain text):</p>
 * <ul>
 *   <li>{@code 漢字《かんじ》} — ruby annotation; the base is recovered by
 *       scanning back over preceding kanji-like code points.</li>
 *   <li>{@code ｜漢字《かんじ》} — explicit ruby base prefix (pipe).</li>
 *   <li>{@code ［＃…］} — Aozora control notes, stripped on export.</li>
 * </ul>
 *
 * <p>Pure Java, no Android dependencies — unit-tested on the JVM.</p>
 */
public final class RubyConverter {

    private static final Pattern AOZORA_NOTE = Pattern.compile("［＃[^］]*］");
    private static final Pattern MARKED_RUBY =
            Pattern.compile("｜([^｜《》\\n]{1,40})《([^《》\\n]{1,80})》");

    private RubyConverter() {
    }

    /** XML escaping for both element text and double-quoted attribute values. */
    public static String escapeXml(String s) {
        if (s == null) {
            return "";
        }
        StringBuilder sb = new StringBuilder(s.length() + 16);
        for (int i = 0; i < s.length(); i++) {
            char ch = s.charAt(i);
            switch (ch) {
                case '&':
                    sb.append("&amp;");
                    break;
                case '<':
                    sb.append("&lt;");
                    break;
                case '>':
                    sb.append("&gt;");
                    break;
                case '"':
                    sb.append("&quot;");
                    break;
                case '\'':
                    sb.append("&#39;");
                    break;
                default:
                    sb.append(ch);
            }
        }
        return sb.toString();
    }

    /** Kanji-like code points that may act as an implicit ruby base (Aozora rule). */
    static boolean isKanjiLike(int cp) {
        return (cp >= 0x3400 && cp <= 0x4DBF)      // CJK Unified Ideographs Extension A
                || (cp >= 0x4E00 && cp <= 0x9FFF)  // CJK Unified Ideographs
                || (cp >= 0xF900 && cp <= 0xFAFF)  // CJK Compatibility Ideographs
                || (cp >= 0x20000 && cp <= 0x2EBEF)// CJK Unified Ideographs Extensions B..F
                || cp == 0x3005                    // 々 iteration mark
                || cp == 0x3006                    // 〆 shime mark
                || cp == 0x3007                    // 〇 ideographic number zero
                || cp == 0x30F5                    // ヵ small ka
                || cp == 0x30F6;                   // ヶ small ke
    }

    /** Render one raw line to inline XHTML (escaped, with ruby markup). */
    public static String lineToXhtml(String rawLine) {
        if (rawLine == null) {
            return "";
        }
        String s = AOZORA_NOTE.matcher(rawLine).replaceAll("");
        s = escapeXml(s);
        s = MARKED_RUBY.matcher(s).replaceAll("<ruby><rb>$1</rb><rt>$2</rt></ruby>");
        return applyUnmarkedRuby(s);
    }

    private static String applyUnmarkedRuby(String s) {
        StringBuilder sb = new StringBuilder(s.length() + 64);
        int i = 0;
        for (;;) {
            int open = s.indexOf("《", i);
            if (open < 0) {
                sb.append(s, i, s.length());
                break;
            }
            int close = s.indexOf("》", open + 1);
            if (close < 0) {
                sb.append(s, i, s.length());
                break;
            }
            // Scan back over kanji-like code points to find the implicit base.
            int baseStart = open;
            while (baseStart > i) {
                int prev = s.offsetByCodePoints(baseStart, -1);
                int cp = s.codePointAt(prev);
                if (isKanjiLike(cp)) {
                    baseStart = prev;
                } else {
                    break;
                }
            }
            if (baseStart == open) {
                // No kanji base before the bracket: emit literally, keep brackets.
                sb.append(s, i, close + 1);
                i = close + 1;
                continue;
            }
            sb.append(s, i, baseStart);
            sb.append("<ruby><rb>")
                    .append(s, baseStart, open)
                    .append("</rb><rt>")
                    .append(s, open + 1, close)
                    .append("</rt></ruby>");
            i = close + 1;
        }
        return sb.toString();
    }

    /**
     * Split a chapter body into paragraph elements. Every non-blank line becomes
     * one {@code <p>}; blank lines act as paragraph separators and are skipped
     * (paragraph spacing is controlled by CSS).
     */
    public static List<String> toParagraphXhtml(String content) {
        List<String> out = new ArrayList<>();
        if (content == null) {
            return out;
        }
        String[] lines = content.split("\\r\\n|\\r|\\n", -1);
        for (String line : lines) {
            String trimmed = line.trim();
            if (trimmed.isEmpty()) {
                continue;
            }
            out.add("<p>" + lineToXhtml(trimmed) + "</p>");
        }
        return out;
    }

    /** Char count helper used by validation messages (code points, not UTF-16 units). */
    public static int codePointLength(String s) {
        return s == null ? 0 : s.codePointCount(0, s.length());
    }
}
