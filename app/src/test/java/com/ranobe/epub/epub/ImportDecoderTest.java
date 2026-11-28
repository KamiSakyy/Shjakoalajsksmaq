package com.ranobe.epub.epub;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;

public class ImportDecoderTest {

    @Test
    public void decodesUtf8() {
        byte[] bytes = "日本語のテキスト".getBytes(StandardCharsets.UTF_8);
        assertEquals("日本語のテキスト", ImportDecoder.decode(bytes));
    }

    @Test
    public void decodesUtf8WithBom() {
        byte[] body = "あいうえお".getBytes(StandardCharsets.UTF_8);
        byte[] bytes = new byte[body.length + 3];
        bytes[0] = (byte) 0xEF;
        bytes[1] = (byte) 0xBB;
        bytes[2] = (byte) 0xBF;
        System.arraycopy(body, 0, bytes, 3, body.length);
        assertEquals("あいうえお", ImportDecoder.decode(bytes));
    }

    @Test
    public void decodesShiftJis() throws Exception {
        byte[] bytes = "日本語のテキスト".getBytes(Charset.forName("Shift_JIS"));
        assertEquals("日本語のテキスト", ImportDecoder.decode(bytes));
    }

    @Test
    public void decodesWindows1251() throws Exception {
        byte[] bytes = "Привет, мир".getBytes(Charset.forName("windows-1251"));
        assertEquals("Привет, мир", ImportDecoder.decode(bytes));
    }

    @Test
    public void utf16LeBom() {
        String original = "テスト";
        byte[] body = original.getBytes(Charset.forName("UTF-16LE"));
        byte[] bytes = new byte[body.length + 2];
        bytes[0] = (byte) 0xFF;
        bytes[1] = (byte) 0xFE;
        System.arraycopy(body, 0, bytes, 2, body.length);
        assertEquals(original, ImportDecoder.decode(bytes));
    }

    @Test
    public void emptyInput() {
        assertEquals("", ImportDecoder.decode(new byte[0]));
    }
}
