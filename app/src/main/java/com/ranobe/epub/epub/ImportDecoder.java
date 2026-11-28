package com.ranobe.epub.epub;

import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.Charset;
import java.nio.charset.CodingErrorAction;

/**
 * Decodes imported plain-text files (.txt / .md) with BOM detection and a
 * strict-decoder fallback chain. This matters for ranobe manuscripts, which
 * are frequently distributed as Shift_JIS while UTF-8 is preferred for new files.
 *
 * <p>Pure Java, no Android dependencies — unit-tested on the JVM.</p>
 */
public final class ImportDecoder {

    private ImportDecoder() {
    }

    public static String decode(byte[] bytes) {
        if (bytes == null || bytes.length == 0) {
            return "";
        }
        // 1) BOM sniffing.
        if (bytes.length >= 3 && (bytes[0] & 0xFF) == 0xEF && (bytes[1] & 0xFF) == 0xBB && (bytes[2] & 0xFF) == 0xBF) {
            return new String(bytes, 3, bytes.length - 3, Charset.forName("UTF-8"));
        }
        if (bytes.length >= 2 && (bytes[0] & 0xFF) == 0xFF && (bytes[1] & 0xFF) == 0xFE) {
            return new String(bytes, 2, bytes.length - 2, Charset.forName("UTF-16LE"));
        }
        if (bytes.length >= 2 && (bytes[0] & 0xFF) == 0xFE && (bytes[1] & 0xFF) == 0xFF) {
            return new String(bytes, 2, bytes.length - 2, Charset.forName("UTF-16BE"));
        }
        // 2) Strict UTF-8.
        String utf8 = strictDecode(bytes, "UTF-8");
        if (utf8 != null) {
            return utf8;
        }
        // 3) Japanese legacy encodings (Aozora-bunko Shift_JIS family).
        for (String cs : new String[]{"Shift_JIS", "Windows-31J", "MS932"}) {
            String s = strictDecode(bytes, cs);
            if (s != null) {
                return s;
            }
        }
        // 4) Cyrillic manuscripts.
        String cp1251 = strictDecode(bytes, "windows-1251");
        if (cp1251 != null) {
            return cp1251;
        }
        // 5) Last resort: ISO-8859-1 never fails.
        return new String(bytes, Charset.forName("ISO-8859-1"));
    }

    private static String strictDecode(byte[] bytes, String charsetName) {
        try {
            Charset cs = Charset.forName(charsetName);
            return cs.newDecoder()
                    .onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT)
                    .decode(ByteBuffer.wrap(bytes))
                    .toString();
        } catch (CharacterCodingException | IllegalArgumentException e) {
            return null;
        }
    }
}
