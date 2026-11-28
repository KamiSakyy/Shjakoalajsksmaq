package com.ranobe.epub.epub;

import com.ranobe.epub.model.Chapter;
import com.ranobe.epub.model.Project;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;
import java.util.zip.CRC32;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/**
 * Builds a standards-compliant EPUB 3 publication entirely on-device.
 *
 * <p>Output layout (EPUB 3.0.1, with a legacy NCX for maximum reader compatibility):</p>
 * <pre>
 *   mimetype                    (STORED, first entry, "application/epub+zip")
 *   META-INF/container.xml
 *   OEBPS/content.opf           (package, version="3.0")
 *   OEBPS/nav.xhtml             (properties="nav", epub:type="toc")
 *   OEBPS/toc.ncx               (EPUB 2 compatibility)
 *   OEBPS/style.css             (supports vertical-rl for tategaki)
 *   OEBPS/text/chapter-001.xhtml ...
 *   OEBPS/images/cover.jpg|png  (optional, properties="cover-image")
 * </pre>
 *
 * <p>Pure Java, no Android dependencies — unit-tested on the JVM.</p>
 */
public final class EpubExporter {

    public static final String MIMETYPE = "application/epub+zip";

    private EpubExporter() {
    }

    /**
     * Export the project to EPUB bytes.
     *
     * @param project    project to export (validated; Russian user-facing error messages)
     * @param coverBytes optional cover image bytes (already ≤ 1600 px, JPEG/PNG), may be null
     * @param coverExt   "jpg" or "png", used when coverBytes != null
     * @return complete EPUB file as a byte array
     * @throws EpubValidationException if the project is not exportable
     * @throws IOException             on low-level I/O failure (should not happen for byte[] targets)
     */
    public static byte[] export(Project project, byte[] coverBytes, String coverExt)
            throws EpubValidationException, IOException {
        validate(project);

        ByteArrayOutputStream bout = new ByteArrayOutputStream(64 * 1024);
        ZipOutputStream zos = new ZipOutputStream(bout);
        zos.setMethod(ZipOutputStream.DEFLATED);
        zos.setLevel(9);

        writeMimetype(zos);
        writeEntry(zos, "META-INF/container.xml", buildContainerXml());
        writeEntry(zos, "OEBPS/content.opf", buildOpf(project, coverBytes != null, coverExt));
        writeEntry(zos, "OEBPS/nav.xhtml", buildNavXhtml(project));
        writeEntry(zos, "OEBPS/toc.ncx", buildNcx(project));
        writeEntry(zos, "OEBPS/style.css", buildCss(project.vertical));

        int index = 1;
        for (Chapter chapter : project.chapters) {
            String name = String.format(Locale.US, "OEBPS/text/chapter-%03d.xhtml", index);
            writeEntry(zos, name, buildChapterXhtml(project, chapter, index));
            index++;
        }

        if (coverBytes != null && coverBytes.length > 0) {
            String ext = normalizeCoverExt(coverExt);
            ZipEntry cover = new ZipEntry("OEBPS/images/cover." + ext);
            zos.putNextEntry(cover);
            zos.write(coverBytes);
            zos.closeEntry();
        }

        zos.finish();
        zos.close();
        return bout.toByteArray();
    }

    // ------------------------------------------------------------------ validation

    public static void validate(Project project) throws EpubValidationException {
        if (project == null) {
            throw new EpubValidationException("Проект не загружен.");
        }
        if (project.title == null || project.title.trim().isEmpty()) {
            throw new EpubValidationException("Укажите название произведения — EPUB не может быть пустым.");
        }
        if (project.author == null || project.author.trim().isEmpty()) {
            throw new EpubValidationException("Укажите автора (dc:creator является обязательным для публикации).");
        }
        if (project.chapters == null || project.chapters.isEmpty()) {
            throw new EpubValidationException("Добавьте хотя бы одну главу перед экспортом.");
        }
        boolean anyContent = false;
        for (Chapter c : project.chapters) {
            if (c != null && c.content != null && !c.content.trim().isEmpty()) {
                anyContent = true;
                break;
            }
        }
        if (!anyContent) {
            throw new EpubValidationException("Все главы пусты. Напишите хотя бы несколько строк.");
        }
    }

    // ------------------------------------------------------------------ zip helpers

    private static void writeMimetype(ZipOutputStream zos) throws IOException {
        byte[] mime = MIMETYPE.getBytes(StandardCharsets.US_ASCII);
        ZipEntry entry = new ZipEntry("mimetype");
        entry.setMethod(ZipEntry.STORED);
        entry.setSize(mime.length);
        entry.setCompressedSize(mime.length);
        CRC32 crc = new CRC32();
        crc.update(mime);
        entry.setCrc(crc.getValue());
        zos.putNextEntry(entry);
        zos.write(mime);
        zos.closeEntry();
    }

    private static void writeEntry(ZipOutputStream zos, String name, String utf8Content) throws IOException {
        ZipEntry entry = new ZipEntry(name);
        zos.putNextEntry(entry);
        zos.write(utf8Content.getBytes(StandardCharsets.UTF_8));
        zos.closeEntry();
    }

    private static String normalizeCoverExt(String ext) {
        if (ext == null) {
            return "jpg";
        }
        String e = ext.trim().toLowerCase(Locale.ROOT);
        if (e.equals("jpeg")) {
            return "jpg";
        }
        if (e.equals("jpg") || e.equals("png")) {
            return e;
        }
        return "jpg";
    }

    static String coverMediaType(String ext) {
        return normalizeCoverExt(ext).equals("png") ? "image/png" : "image/jpeg";
    }

    // ------------------------------------------------------------------ OPF

    private static String buildContainerXml() {
        return "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"
                + "<container version=\"1.0\" xmlns=\"urn:oasis:names:tc:opendocument:xmlns:container\">\n"
                + "  <rootfiles>\n"
                + "    <rootfile full-path=\"OEBPS/content.opf\" media-type=\"application/oebps-package+xml\"/>\n"
                + "  </rootfiles>\n"
                + "</container>\n";
    }

    private static String dctermsModified() {
        SimpleDateFormat fmt = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US);
        fmt.setTimeZone(TimeZone.getTimeZone("UTC"));
        return fmt.format(new Date());
    }

    private static String buildOpf(Project p, boolean hasCover, String coverExt) {
        String lang = safeLang(p.language);
        String id = RubyConverter.escapeXml(p.effectiveIdentifier());
        String title = RubyConverter.escapeXml(p.title.trim());
        String author = RubyConverter.escapeXml(p.author.trim());
        StringBuilder sb = new StringBuilder(2048);

        sb.append("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
        sb.append("<package xmlns=\"http://www.idpf.org/2007/opf\" version=\"3.0\" unique-identifier=\"book-id\" xml:lang=\"")
                .append(lang).append("\">\n");
        sb.append("  <metadata xmlns:dc=\"http://purl.org/dc/elements/1.1/\">\n");
        sb.append("    <dc:identifier id=\"book-id\">").append(id).append("</dc:identifier>\n");
        sb.append("    <dc:title>").append(title).append("</dc:title>\n");
        sb.append("    <dc:creator id=\"creator\">").append(author).append("</dc:creator>\n");
        sb.append("    <meta refines=\"#creator\" property=\"role\" scheme=\"marc:relators\">aut</meta>\n");
        sb.append("    <meta refines=\"#creator\" property=\"file-as\">").append(author).append("</meta>\n");
        sb.append("    <dc:language>").append(lang).append("</dc:language>\n");
        if (p.publisher != null && !p.publisher.trim().isEmpty()) {
            sb.append("    <dc:publisher>").append(RubyConverter.escapeXml(p.publisher.trim()))
                    .append("</dc:publisher>\n");
        }
        if (p.description != null && !p.description.trim().isEmpty()) {
            sb.append("    <dc:description>").append(RubyConverter.escapeXml(p.description.trim()))
                    .append("</dc:description>\n");
        }
        if (p.subjects != null) {
            for (String part : p.subjects.split(",")) {
                String s = part.trim();
                if (!s.isEmpty()) {
                    sb.append("    <dc:subject>").append(RubyConverter.escapeXml(s))
                            .append("</dc:subject>\n");
                }
            }
        }
        if (p.series != null && !p.series.trim().isEmpty()) {
            sb.append("    <meta property=\"belongs-to-collection\" id=\"series-collection\">")
                    .append(RubyConverter.escapeXml(p.series.trim())).append("</meta>\n");
            sb.append("    <meta refines=\"#series-collection\" property=\"collection-type\">series</meta>\n");
        }
        sb.append("    <meta property=\"dcterms:modified\">").append(dctermsModified()).append("</meta>\n");
        if (hasCover) {
            // Legacy hint for pre-EPUB3 readers (harmless in EPUB 3).
            sb.append("    <meta name=\"cover\" content=\"cover-image\"/>\n");
        }
        sb.append("    <meta property=\"schema:accessibilityMode\">textual</meta>\n");
        sb.append("    <meta property=\"schema:accessibilityModeSufficient\">textual</meta>\n");
        sb.append("    <meta property=\"schema:accessibilityFeature\">structuralNavigation</meta>\n");
        sb.append("    <meta property=\"schema:accessibilityFeature\">tableOfContents</meta>\n");
        sb.append("    <meta property=\"schema:accessibilitySummary\">Text with a navigable table of contents.</meta>\n");
        sb.append("  </metadata>\n");

        sb.append("  <manifest>\n");
        sb.append("    <item id=\"nav\" href=\"nav.xhtml\" media-type=\"application/xhtml+xml\" properties=\"nav\"/>\n");
        sb.append("    <item id=\"ncx\" href=\"toc.ncx\" media-type=\"application/x-dtbncx+xml\"/>\n");
        sb.append("    <item id=\"css\" href=\"style.css\" media-type=\"text/css\"/>\n");
        if (hasCover) {
            String ext = normalizeCoverExt(coverExt);
            sb.append("    <item id=\"cover-image\" href=\"images/cover.").append(ext)
                    .append("\" media-type=\"").append(coverMediaType(coverExt))
                    .append("\" properties=\"cover-image\"/>\n");
        }
        int i = 1;
        for (Chapter ignored : p.chapters) {
            sb.append("    <item id=\"chapter-").append(i)
                    .append("\" href=\"text/chapter-").append(chapterFileNumber(i))
                    .append(".xhtml\" media-type=\"application/xhtml+xml\"/>\n");
            i++;
        }
        sb.append("  </manifest>\n");

        sb.append("  <spine toc=\"ncx\"");
        if (p.vertical) {
            sb.append(" page-progression-direction=\"rtl\"");
        }
        sb.append(">\n");
        i = 1;
        for (Chapter ignored : p.chapters) {
            sb.append("    <itemref idref=\"chapter-").append(i).append("\"/>\n");
            i++;
        }
        sb.append("  </spine>\n");
        sb.append("</package>\n");
        return sb.toString();
    }

    private static String chapterFileNumber(int index) {
        return String.format(Locale.US, "%03d", index);
    }

    private static String chapterHref(int index) {
        return "text/chapter-" + chapterFileNumber(index) + ".xhtml";
    }

    private static String safeLang(String lang) {
        if (lang == null || lang.trim().isEmpty()) {
            return "ja";
        }
        String l = lang.trim();
        // Keep a conservative BCP 47-ish tag: letters, digits and hyphens only.
        StringBuilder sb = new StringBuilder(l.length());
        for (int i = 0; i < l.length(); i++) {
            char c = l.charAt(i);
            if (Character.isLetterOrDigit(c) || c == '-') {
                sb.append(c);
            }
        }
        String out = sb.toString();
        return out.isEmpty() ? "ja" : out;
    }

    // ------------------------------------------------------------------ NCX (EPUB 2 compat)

    private static String buildNcx(Project p) {
        String lang = safeLang(p.language);
        String title = RubyConverter.escapeXml(p.title.trim());
        String id = RubyConverter.escapeXml(p.effectiveIdentifier());
        StringBuilder sb = new StringBuilder(1024);
        sb.append("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
        sb.append("<ncx xmlns=\"http://www.daisy.org/z3986/2005/ncx/\" version=\"2005-1\" xml:lang=\"")
                .append(lang).append("\">\n");
        sb.append("  <head>\n");
        sb.append("    <meta name=\"dtb:uid\" content=\"").append(id).append("\"/>\n");
        sb.append("    <meta name=\"dtb:depth\" content=\"1\"/>\n");
        sb.append("    <meta name=\"dtb:totalPageCount\" content=\"0\"/>\n");
        sb.append("    <meta name=\"dtb:maxPageNumber\" content=\"0\"/>\n");
        sb.append("  </head>\n");
        sb.append("  <docTitle><text>").append(title).append("</text></docTitle>\n");
        sb.append("  <navMap>\n");
        int i = 1;
        for (Chapter chapter : p.chapters) {
            sb.append("    <navPoint id=\"navPoint-").append(i)
                    .append("\" playOrder=\"").append(i).append("\">\n");
            sb.append("      <navLabel><text>")
                    .append(RubyConverter.escapeXml(chapterTitle(projectLangIsJapanese(p), chapter, i)))
                    .append("</text></navLabel>\n");
            sb.append("      <content src=\"").append(chapterHref(i)).append("\"/>\n");
            sb.append("    </navPoint>\n");
            i++;
        }
        sb.append("  </navMap>\n");
        sb.append("</ncx>\n");
        return sb.toString();
    }

    // ------------------------------------------------------------------ NAV (EPUB 3)

    private static String buildNavXhtml(Project p) {
        String lang = safeLang(p.language);
        boolean ja = projectLangIsJapanese(p);
        String tocLabel = ja ? "目次" : "Contents";
        String title = RubyConverter.escapeXml(p.title.trim());
        StringBuilder sb = new StringBuilder(1024);
        sb.append("<?xml version=\"1.0\" encoding=\"utf-8\"?>\n");
        sb.append("<html xmlns=\"http://www.w3.org/1999/xhtml\" xmlns:epub=\"http://www.idpf.org/2007/ops\" ")
                .append("xml:lang=\"").append(lang).append("\" lang=\"").append(lang).append("\">\n");
        sb.append("<head>\n");
        sb.append("  <meta charset=\"utf-8\"/>\n");
        sb.append("  <title>").append(title).append(" — ").append(tocLabel).append("</title>\n");
        sb.append("  <link rel=\"stylesheet\" type=\"text/css\" href=\"style.css\"/>\n");
        sb.append("</head>\n");
        sb.append("<body>\n");
        sb.append("  <nav epub:type=\"toc\" id=\"toc\" aria-labelledby=\"toc-heading\">\n");
        sb.append("    <h1 id=\"toc-heading\">").append(tocLabel).append("</h1>\n");
        sb.append("    <ol>\n");
        int i = 1;
        for (Chapter chapter : p.chapters) {
            sb.append("      <li><a href=\"").append(chapterHref(i)).append("\">")
                    .append(RubyConverter.escapeXml(chapterTitle(ja, chapter, i)))
                    .append("</a></li>\n");
            i++;
        }
        sb.append("    </ol>\n");
        sb.append("  </nav>\n");
        sb.append("</body>\n");
        sb.append("</html>\n");
        return sb.toString();
    }

    private static boolean projectLangIsJapanese(Project p) {
        return p != null && p.language != null && p.language.toLowerCase(Locale.ROOT).startsWith("ja");
    }

    private static String chapterTitle(boolean japanese, Chapter chapter, int index) {
        String t = chapter == null ? "" : (chapter.title == null ? "" : chapter.title.trim());
        if (!t.isEmpty()) {
            return t;
        }
        return japanese ? "第" + index + "章" : "Chapter " + index;
    }

    // ------------------------------------------------------------------ Chapter XHTML

    private static String buildChapterXhtml(Project p, Chapter chapter, int index) {
        String lang = safeLang(p.language);
        boolean ja = projectLangIsJapanese(p);
        String chapterTitle = chapterTitle(ja, chapter, index);
        StringBuilder sb = new StringBuilder(4096);
        sb.append("<?xml version=\"1.0\" encoding=\"utf-8\"?>\n");
        sb.append("<html xmlns=\"http://www.w3.org/1999/xhtml\" xmlns:epub=\"http://www.idpf.org/2007/ops\" ")
                .append("xml:lang=\"").append(lang).append("\" lang=\"").append(lang).append("\">\n");
        sb.append("<head>\n");
        sb.append("  <meta charset=\"utf-8\"/>\n");
        sb.append("  <title>").append(RubyConverter.escapeXml(chapterTitle)).append("</title>\n");
        sb.append("  <link rel=\"stylesheet\" type=\"text/css\" href=\"../style.css\"/>\n");
        sb.append("</head>\n");
        sb.append("<body>\n");
        sb.append("  <section epub:type=\"chapter\" role=\"doc-chapter\" aria-labelledby=\"chapter-title-")
                .append(index).append("\">\n");
        sb.append("    <h1 id=\"chapter-title-").append(index).append("\" class=\"chapter-title\">")
                .append(RubyConverter.escapeXml(chapterTitle)).append("</h1>\n");
        for (String paragraph : RubyConverter.toParagraphXhtml(chapter == null ? "" : chapter.content)) {
            sb.append("    ").append(paragraph).append('\n');
        }
        sb.append("  </section>\n");
        sb.append("</body>\n");
        sb.append("</html>\n");
        return sb.toString();
    }

    // ------------------------------------------------------------------ CSS

    private static String buildCss(boolean vertical) {
        StringBuilder sb = new StringBuilder(1536);
        sb.append("@charset \"utf-8\";\n");
        sb.append("@namespace epub \"http://www.idpf.org/2007/ops\";\n\n");
        if (vertical) {
            sb.append("html {\n");
            sb.append("  writing-mode: vertical-rl;\n");
            sb.append("  -epub-writing-mode: vertical-rl;\n");
            sb.append("  -ms-writing-mode: tb-rl;\n");
            sb.append("}\n\n");
        }
        sb.append("body {\n");
        sb.append("  font-family: \"Noto Serif JP\", \"Noto Serif CJK JP\", \"Yu Mincho\", \"YuMincho\", \"Hiragino Mincho ProN\", \"Hiragino Mincho Pro\", serif;\n");
        sb.append("  font-size: 1em;\n");
        sb.append("  line-height: 1.9;\n");
        sb.append("  margin: 0;\n");
        sb.append("  padding: ").append(vertical ? "1.6em 1.3em" : "1.4em 1.15em").append(";\n");
        sb.append("  background-color: #f8f7f3;\n");
        sb.append("  color: #191a1c;\n");
        sb.append("  -epub-hyphens: none;\n");
        sb.append("  word-break: normal;\n");
        sb.append("}\n\n");
        sb.append("h1.chapter-title {\n");
        sb.append("  font-size: 1.32em;\n");
        sb.append("  font-weight: 600;\n");
        sb.append("  letter-spacing: 0.05em;\n");
        sb.append("  line-height: 1.45;\n");
        sb.append("  border-bottom: 1px solid #d8d5cb;\n");
        sb.append("  padding-bottom: 0.45em;\n");
        sb.append("  margin: 0 0 1.1em 0;\n");
        sb.append("}\n\n");
        sb.append("p {\n");
        sb.append("  text-indent: 1em;\n");
        sb.append("  margin: 0 0 0.95em 0;\n");
        sb.append("}\n\n");
        sb.append("ruby rt {\n");
        sb.append("  font-size: 0.58em;\n");
        sb.append("  font-weight: normal;\n");
        sb.append("}\n\n");
        sb.append("nav ol {\n");
        sb.append("  padding-left: 1.2em;\n");
        sb.append("  line-height: 2.0;\n");
        sb.append("}\n\n");
        sb.append("nav a {\n");
        sb.append("  color: inherit;\n");
        sb.append("  text-decoration: none;\n");
        sb.append("}\n");
        return sb.toString();
    }
}
