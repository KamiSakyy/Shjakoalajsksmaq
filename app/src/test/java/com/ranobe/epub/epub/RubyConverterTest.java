package com.ranobe.epub.epub;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.List;

public class RubyConverterTest {

    @Test
    public void escapeXml_escapesAllFive() {
        assertEquals("&amp;&lt;&gt;&quot;&#39;", RubyConverter.escapeXml("&<>\"'"));
    }

    @Test
    public void lineToXhtml_unmarkedKanjiRuby() {
        String html = RubyConverter.lineToXhtml("私は猫《ねこ》が好き");
        assertTrue("expected ruby for 猫: " + html, html.contains("<ruby><rb>猫</rb><rt>ねこ</rt></ruby>"));
    }

    @Test
    public void lineToXhtml_multipleKanjiBaseWord() {
        String html = RubyConverter.lineToXhtml("学校《がっこう》へ行く");
        assertTrue(html.contains("<ruby><rb>学校</rb><rt>がっこう</rt></ruby>"));
    }

    @Test
    public void lineToXhtml_twoSeparateRubies() {
        String html = RubyConverter.lineToXhtml("私《わたし》の本《ほん》");
        assertTrue(html.contains("<rb>私</rb>"));
        assertTrue(html.contains("<rb>本</rb>"));
    }

    @Test
    public void lineToXhtml_explicitPipeBase() {
        String html = RubyConverter.lineToXhtml("｜彼女《かのじょ》が笑う");
        assertTrue(html.contains("<ruby><rb>彼女</rb><rt>かのじょ</rt></ruby>"));
    }

    @Test
    public void lineToXhtml_aozoraNotesAreStripped() {
        String html = RubyConverter.lineToXhtml("本文［＃改ページ］続き");
        assertFalse(html.contains("改ページ"));
        assertTrue(html.contains("本文続き"));
    }

    @Test
    public void lineToXhtml_escapesAngleBrackets() {
        String html = RubyConverter.lineToXhtml("1 < 2 & 4 > 3");
        assertTrue(html.contains("1 &lt; 2 &amp; 4 &gt; 3"));
    }

    @Test
    public void lineToXhtml_unpairedBracketStaysLiteral() {
        String html = RubyConverter.lineToXhtml("開《かい");
        assertTrue(html.contains("《かい"));
    }

    @Test
    public void lineToXhtml_bracketWithoutKanjiBaseStaysLiteral() {
        String html = RubyConverter.lineToXhtml("abc《def》ghi");
        assertTrue(html.contains("《def》"));
        assertFalse(html.contains("<ruby>"));
    }

    @Test
    public void toParagraphXhtml_skipsBlankLines() {
        List<String> out = RubyConverter.toParagraphXhtml("一行目\n\n\n二行目\n");
        assertEquals(2, out.size());
        assertTrue(out.get(0).startsWith("<p>"));
        assertTrue(out.get(0).contains("一行目"));
        assertTrue(out.get(1).contains("二行目"));
    }

    @Test
    public void toParagraphXhtml_crlfAndCrSeparators() {
        assertEquals(2, RubyConverter.toParagraphXhtml("a\r\nb").size());
        assertEquals(2, RubyConverter.toParagraphXhtml("a\rb").size());
    }
}
