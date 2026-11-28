package com.ranobe.epub.epub;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import com.ranobe.epub.model.Chapter;
import com.ranobe.epub.model.Project;

import org.junit.Test;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.HashMap;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

public class EpubExporterTest {

    private static Project sampleProject(boolean vertical) {
        Project p = new Project();
        p.title = "テスト小説 & <test>";
        p.author = "著者 太郎";
        p.language = "ja";
        p.description = "テスト用のアノテーション";
        p.vertical = vertical;
        p.chapters.add(new Chapter("第一章　旅立ち", "私は猫《ねこ》。\n次の行。"));
        p.chapters.add(new Chapter("", "無題の本文"));
        return p;
    }

    private static Map<String, byte[]> readZip(File file) throws Exception {
        Map<String, byte[]> entries = new HashMap<>();
        try (ZipFile zip = new ZipFile(file)) {
            java.util.Enumeration<? extends ZipEntry> names = zip.entries();
            while (names.hasMoreElements()) {
                ZipEntry entry = names.nextElement();
                if (!entry.isDirectory()) {
                    try (InputStream in = zip.getInputStream(entry)) {
                        byte[] data = in.readAllBytes();
                        entries.put(entry.getName(), data);
                    }
                }
            }
        }
        return entries;
    }

    @Test
    public void export_producesEpub3Structure() throws Exception {
        Project p = sampleProject(true);
        byte[] cover = {(byte) 0xFF, (byte) 0xD8, (byte) 0xFF, 0x00, 0x01, 0x02};
        byte[] epub = EpubExporter.export(p, cover, "jpg");
        assertNotNull(epub);
        assertTrue(epub.length > 500);

        File tmp = Files.createTempFile("test", ".epub").toFile();
        tmp.deleteOnExit();
        try (java.io.OutputStream out = Files.newOutputStream(tmp.toPath())) {
            out.write(epub);
        }

        Map<String, byte[]> entries = readZip(tmp);

        assertTrue("mimetype must exist", entries.containsKey("mimetype"));
        assertEquals(EpubExporter.MIMETYPE, new String(entries.get("mimetype"), StandardCharsets.US_ASCII));
        assertTrue(entries.containsKey("META-INF/container.xml"));
        assertTrue(entries.containsKey("OEBPS/content.opf"));
        assertTrue(entries.containsKey("OEBPS/nav.xhtml"));
        assertTrue(entries.containsKey("OEBPS/toc.ncx"));
        assertTrue(entries.containsKey("OEBPS/style.css"));
        assertTrue(entries.containsKey("OEBPS/text/chapter-001.xhtml"));
        assertTrue(entries.containsKey("OEBPS/text/chapter-002.xhtml"));
        assertTrue(entries.containsKey("OEBPS/images/cover.jpg"));

        String opf = new String(entries.get("OEBPS/content.opf"), StandardCharsets.UTF_8);
        assertTrue(opf.contains("version=\"3.0\""));
        assertTrue(opf.contains("<dc:language>ja</dc:language>"));
        assertTrue(opf.contains("page-progression-direction=\"rtl\""));
        assertTrue(opf.contains("dcterms:modified"));
        assertTrue(opf.contains("properties=\"cover-image\""));
        assertTrue(opf.contains("&lt;test&gt;")); // title was XML-escaped

        String nav = new String(entries.get("OEBPS/nav.xhtml"), StandardCharsets.UTF_8);
        assertTrue(nav.contains("epub:type=\"toc\""));
        assertTrue(nav.contains("第一章　旅立ち"));

        String ch1 = new String(entries.get("OEBPS/text/chapter-001.xhtml"), StandardCharsets.UTF_8);
        assertTrue("ruby must be converted", ch1.contains("<ruby><rb>猫</rb><rt>ねこ</rt></ruby>"));

        String ncx = new String(entries.get("OEBPS/toc.ncx"), StandardCharsets.UTF_8);
        assertTrue(ncx.contains("<ncx"));
        assertTrue(ncx.contains("第一章　旅立ち"));

        // mimetype must be the first entry and stored uncompressed.
        try (ZipFile zip = new ZipFile(tmp)) {
            ZipEntry first = zip.entries().nextElement();
            assertEquals("mimetype", first.getName());
            assertEquals(ZipEntry.STORED, first.getMethod());
        }
    }

    @Test
    public void export_horizontalProjectHasNoRtlSpine() throws Exception {
        Project p = sampleProject(false);
        p.chapters.get(0).content = "Plain text.";
        byte[] epub = EpubExporter.export(p, null, null);
        File tmp = Files.createTempFile("test", ".epub").toFile();
        tmp.deleteOnExit();
        try (java.io.OutputStream out = Files.newOutputStream(tmp.toPath())) {
            out.write(epub);
        }
        Map<String, byte[]> entries = readZip(tmp);
        String opf = new String(entries.get("OEBPS/content.opf"), StandardCharsets.UTF_8);
        assertFalse(opf.contains("page-progression-direction=\"rtl\""));
        assertFalse("no cover expected", entries.containsKey("OEBPS/images/cover.jpg"));
        assertFalse(opf.contains("properties=\"cover-image\""));
    }

    @Test
    public void validate_rejectsEmptyTitle() {
        Project p = sampleProject(true);
        p.title = "   ";
        try {
            EpubExporter.validate(p);
            fail("expected EpubValidationException");
        } catch (EpubValidationException expected) {
            assertFalse(expected.getMessage().isEmpty());
        }
    }

    @Test
    public void validate_rejectsEmptyAuthor() {
        Project p = sampleProject(true);
        p.author = "";
        try {
            EpubExporter.validate(p);
            fail("expected EpubValidationException");
        } catch (EpubValidationException expected) {
            // ok
        }
    }

    @Test
    public void validate_rejectsNoChapters() {
        Project p = sampleProject(true);
        p.chapters.clear();
        try {
            EpubExporter.validate(p);
            fail("expected EpubValidationException");
        } catch (EpubValidationException expected) {
            // ok
        }
    }

    @Test
    public void validate_rejectsAllEmptyChapters() {
        Project p = sampleProject(true);
        for (Chapter c : p.chapters) {
            c.content = "   \n  ";
        }
        try {
            EpubExporter.validate(p);
            fail("expected EpubValidationException");
        } catch (EpubValidationException expected) {
            // ok
        }
    }

    @Test
    public void export_untitledChapterGetsJapaneseFallback() throws Exception {
        Project p = sampleProject(true);
        byte[] epub = EpubExporter.export(p, null, null);
        File tmp = Files.createTempFile("test", ".epub").toFile();
        tmp.deleteOnExit();
        try (java.io.OutputStream out = Files.newOutputStream(tmp.toPath())) {
            out.write(epub);
        }
        Map<String, byte[]> entries = readZip(tmp);
        String ncx = new String(entries.get("OEBPS/toc.ncx"), StandardCharsets.UTF_8);
        assertTrue("expected 第2章 fallback in NCX: " + ncx, ncx.contains("第2章"));
    }
}
