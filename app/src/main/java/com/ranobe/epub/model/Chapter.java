package com.ranobe.epub.model;

import java.util.UUID;

/**
 * A single chapter of a ranobe. Plain Java, no Android dependencies,
 * so it can be unit-tested on the JVM.
 */
public class Chapter {

    public String id;
    public String title;
    public String content;

    public Chapter() {
        this("", "");
    }

    public Chapter(String title, String content) {
        this.id = UUID.randomUUID().toString();
        this.title = title == null ? "" : title;
        this.content = content == null ? "" : content;
    }

    /** Character count (Japanese-aware: counts code points, not UTF-16 units). */
    public int charCount() {
        return content == null ? 0 : content.codePointCount(0, content.length());
    }

    public Chapter copy() {
        Chapter c = new Chapter(title, content);
        c.id = UUID.randomUUID().toString();
        return c;
    }
}
