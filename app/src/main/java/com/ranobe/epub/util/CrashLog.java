package com.ranobe.epub.util;

import android.content.Context;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/**
 * App-private crash persistence. Every uncaught exception is stored under
 * filesDir/crashes as a plain-text stack trace; the newest file is surfaced
 * by the main screen so a crash never has to be reproduced blind.
 */
public final class CrashLog {

    private static final String DIR = "crashes";
    private static final int KEEP = 5;

    private CrashLog() {
    }

    public static void write(Context context, Throwable throwable) {
        File dir = dir(context);
        if (!dir.exists() && !dir.mkdirs()) {
            return;
        }
        String stamp = new SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(new Date());
        File out = new File(dir, "crash-" + stamp + ".log");
        try {
            StringBuilder sb = new StringBuilder(2048);
            sb.append("Ranobe EPUB crash report\n");
            sb.append("Time: ").append(new Date()).append('\n');
            sb.append("Device: ").append(android.os.Build.MANUFACTURER)
                    .append(' ').append(android.os.Build.MODEL)
                    .append(" · Android ").append(android.os.Build.VERSION.RELEASE)
                    .append(" (SDK ").append(android.os.Build.VERSION.SDK_INT).append(")\n\n");
            appendThrowable(sb, throwable);
            byte[] bytes = sb.toString().getBytes(StandardCharsets.UTF_8);
            try (FileOutputStream fos = new FileOutputStream(out)) {
                fos.write(bytes);
                fos.getFD().sync();
            }
        } catch (Throwable ignored) {
            // Never let crash handling itself crash the app.
        }
        prune(dir);
    }

    private static void appendThrowable(StringBuilder sb, Throwable throwable) {
        Throwable current = throwable;
        int depth = 0;
        while (current != null && depth < 8) {
            if (depth > 0) {
                sb.append("Caused by: ");
            }
            sb.append(current.getClass().getName()).append(": ")
                    .append(current.getMessage()).append('\n');
            for (StackTraceElement el : current.getStackTrace()) {
                sb.append("    at ").append(el).append('\n');
            }
            current = current.getCause();
            depth++;
        }
    }

    /** Newest crash file, or null when none was recorded. */
    public static File latestCrash(Context context) {
        List<File> crashes = crashes(context);
        return crashes.isEmpty() ? null : crashes.get(0);
    }

    public static String readLatestCrash(Context context) {
        File latest = latestCrash(context);
        if (latest == null) {
            return null;
        }
        try (FileInputStream in = new FileInputStream(latest)) {
            byte[] data = com.ranobe.epub.data.ProjectStore.readAllBytes(in);
            return new String(data, StandardCharsets.UTF_8);
        } catch (Throwable t) {
            return null;
        }
    }

    public static void deleteCrashes(Context context) {
        for (File f : crashes(context)) {
            //noinspection ResultOfMethodCallIgnored
            f.delete();
        }
    }

    private static List<File> crashes(Context context) {
        File dir = dir(context);
        File[] files = dir.listFiles();
        if (files == null) {
            return new ArrayList<>();
        }
        List<File> out = new ArrayList<>(Arrays.asList(files));
        out.removeIf(f -> f == null || !f.isFile());
        out.sort(Comparator.comparingLong(File::lastModified).reversed());
        return out;
    }

    private static void prune(File dir) {
        List<File> files = new ArrayList<>();
        File[] arr = dir.listFiles();
        if (arr != null) {
            files.addAll(Arrays.asList(arr));
        }
        files.removeIf(f -> f == null || !f.isFile());
        files.sort(Comparator.comparingLong(File::lastModified).reversed());
        for (int i = KEEP; i < files.size(); i++) {
            //noinspection ResultOfMethodCallIgnored
            files.get(i).delete();
        }
    }

    private static File dir(Context context) {
        return new File(context.getApplicationContext().getFilesDir(), DIR);
    }
}
