package com.ranobe.epub.model;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * A ranobe project: full metadata for an EPUB 3 publication plus its chapters.
 * Plain Java, no Android dependencies.
 */
public class Project {

    public static final String DEFAULT_LANGUAGE = "ja";

    public String id;
    public String title = "";
    public String author = "";
    public String language = DEFAULT_LANGUAGE;
    public String publisher = "";
    public String series = "";
    public String subjects = "";      // comma-separated
    public String description = "";
    /** DC identifier. If blank, "urn:uuid:<id>" is used at export time. */
    public String identifier = "";
    /** Vertical writing (tategaki, page-progression-direction="rtl"). Default: true for ranobe. */
    public boolean vertical = true;
    /** File name of the cover inside the project directory, null when absent. */
    public String coverFileName;
    public long createdAt;
    public long updatedAt;
    public final List<Chapter> chapters = new ArrayList<>();

    public Project() {
        this.id = UUID.randomUUID().toString();
        long now = System.currentTimeMillis();
        this.createdAt = now;
        this.updatedAt = now;
    }

    /** Effective unique identifier used for dc:identifier and dcterms:modified bookkeeping. */
    public String effectiveIdentifier() {
        if (identifier == null || identifier.trim().isEmpty()) {
            return "urn:uuid:" + id;
        }
        return identifier.trim();
    }

    public int totalChars() {
        int sum = 0;
        for (Chapter c : chapters) {
            sum += c.charCount();
        }
        return sum;
    }

    public String displayTitle() {
        return (title == null || title.trim().isEmpty()) ? "Без названия" : title.trim();
    }

    public Project duplicateAsNew() {
        Project p = new Project();
        p.title = (title == null || title.trim().isEmpty()) ? "" : title + " (копия)";
        p.author = author;
        p.language = language;
        p.publisher = publisher;
        p.series = series;
        p.subjects = subjects;
        p.description = description;
        p.identifier = ""; // fresh identifier for the copy
        p.vertical = vertical;
        for (Chapter c : chapters) {
            p.chapters.add(c.copy());
        }
        return p;
    }
}
