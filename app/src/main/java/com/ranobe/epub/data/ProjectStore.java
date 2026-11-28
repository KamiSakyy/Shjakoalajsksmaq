package com.ranobe.epub.data;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.util.Base64;
import android.util.Log;

import com.ranobe.epub.model.Chapter;
import com.ranobe.epub.model.Project;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;

/**
 * On-device project storage. Every project lives in its own directory:
 *
 * <pre>files/projects/&lt;projectId&gt;/project.json
 * files/projects/&lt;projectId&gt;/cover.jpg</pre>
 *
 * Everything is local to the app sandbox; nothing touches the network.
 */
public final class ProjectStore {

    private static final String TAG = "ProjectStore";
    private static final String DIR_PROJECTS = "projects";
    private static final String DIR_CACHE = "epub-export";
    private static final String FILE_PROJECT = "project.json";

    private static final int COVER_MAX_WIDTH = 1600;
    private static final int COVER_MAX_HEIGHT = 2400;
    private static final int COVER_JPEG_QUALITY = 88;

    private final File projectsDir;
    private final File cacheDir;

    public ProjectStore(Context context) {
        File files = context.getApplicationContext().getFilesDir();
        projectsDir = new File(files, DIR_PROJECTS);
        if (!projectsDir.exists() && !projectsDir.mkdirs()) {
            Log.e(TAG, "Unable to create projects directory: " + projectsDir);
        }
        File cache = context.getApplicationContext().getCacheDir();
        cacheDir = new File(cache, DIR_CACHE);
        if (!cacheDir.exists()) {
            // Best effort; cache is optional.
            //noinspection ResultOfMethodCallIgnored
            cacheDir.mkdirs();
        }
    }

    // ------------------------------------------------------------------ CRUD

    public List<Project> listProjects() {
        List<Project> out = new ArrayList<>();
        File[] dirs = projectsDir.listFiles();
        if (dirs == null) {
            return out;
        }
        for (File dir : dirs) {
            if (!dir.isDirectory()) {
                continue;
            }
            File json = new File(dir, FILE_PROJECT);
            if (!json.isFile()) {
                continue;
            }
            try {
                out.add(fromJson(new String(readAllBytes(new FileInputStream(json)), StandardCharsets.UTF_8)));
            } catch (Exception e) {
                Log.w(TAG, "Skipping unreadable project in " + dir, e);
            }
        }
        out.sort(Comparator.comparingLong((Project p) -> p.updatedAt).reversed());
        return out;
    }

    public Project createEmpty() {
        Project p = new Project();
        try {
            save(p);
        } catch (IOException e) {
            Log.e(TAG, "Failed to create project", e);
        }
        return p;
    }

    public Project load(String id) {
        if (id == null) {
            return null;
        }
        File json = new File(projectDir(id), FILE_PROJECT);
        if (!json.isFile()) {
            return null;
        }
        try {
            return fromJson(new String(readAllBytes(new FileInputStream(json)), StandardCharsets.UTF_8));
        } catch (Exception e) {
            Log.e(TAG, "Failed to load project " + id, e);
            return null;
        }
    }

    public void save(Project project) throws IOException {
        if (project == null) {
            throw new IOException("null project");
        }
        project.updatedAt = System.currentTimeMillis();
        File dir = projectDir(project.id);
        if (!dir.exists() && !dir.mkdirs()) {
            throw new IOException("Не удалось создать папку проекта: " + dir);
        }
        File tmp = new File(dir, FILE_PROJECT + ".tmp");
        String payload = toJson(project);
        ByteArrayOutputStream bos = new ByteArrayOutputStream(payload.length() + 16);
        bos.write(payload.getBytes(StandardCharsets.UTF_8));
        try (FileOutputStream fos = new FileOutputStream(tmp)) {
            fos.write(bos.toByteArray());
            fos.getFD().sync();
        }
        File target = new File(dir, FILE_PROJECT);
        //noinspection ResultOfMethodCallIgnored
        target.delete();
        if (!tmp.renameTo(target)) {
            throw new IOException("Не удалось сохранить project.json");
        }
    }

    public void delete(Project project) {
        if (project == null) {
            return;
        }
        deleteRecursive(projectDir(project.id));
    }

    public Project duplicate(Project source) throws IOException {
        Project copy = source.duplicateAsNew();
        File srcDir = projectDir(source.id);
        try {
            save(copy);
        } catch (IOException e) {
            delete(copy);
            throw e;
        }
        if (source.coverFileName != null) {
            File src = new File(srcDir, source.coverFileName);
            if (src.isFile()) {
                File dst = new File(projectDir(copy.id), source.coverFileName);
                copyFile(src, dst);
                copy.coverFileName = source.coverFileName;
                save(copy);
            }
        }
        return copy;
    }

    public File projectDir(String id) {
        // Keep directory names restricted to safe characters.
        String safe = id == null ? "unknown" : id.replaceAll("[^A-Za-z0-9._-]", "_");
        return new File(projectsDir, safe);
    }

    // ------------------------------------------------------------------ cover

    /**
     * Decode, downscale (max 1600×2400) and re-encode the cover as JPEG.
     * Replaces any previous cover. Returns the stored file name ("cover.jpg").
     */
    public String saveCover(Project project, InputStream in) throws IOException {
        byte[] original = readAllBytes(in);
        if (original.length == 0) {
            throw new IOException("Пустой файл изображения");
        }
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(original, 0, original.length, bounds);
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) {
            throw new IOException("Не удалось прочитать изображение (неподдерживаемый формат?)");
        }
        int sample = 1;
        while ((bounds.outWidth / sample) > COVER_MAX_WIDTH * 2 || (bounds.outHeight / sample) > COVER_MAX_HEIGHT * 2) {
            sample *= 2;
        }
        BitmapFactory.Options opts = new BitmapFactory.Options();
        opts.inSampleSize = sample;
        opts.inPreferredConfig = Bitmap.Config.ARGB_8888;
        Bitmap bitmap = BitmapFactory.decodeByteArray(original, 0, original.length, opts);
        if (bitmap == null) {
            throw new IOException("Не удалось декодировать изображение");
        }
        Bitmap scaled = scaleDown(bitmap, COVER_MAX_WIDTH, COVER_MAX_HEIGHT);
        File dir = projectDir(project.id);
        if (!dir.exists() && !dir.mkdirs()) {
            throw new IOException("Не удалось создать папку проекта");
        }
        // Remove any previous cover with a different file name.
        if (project.coverFileName != null && !"cover.jpg".equals(project.coverFileName)) {
            //noinspection ResultOfMethodCallIgnored
            new File(dir, project.coverFileName).delete();
        }
        File out = new File(dir, "cover.jpg");
        try (FileOutputStream fos = new FileOutputStream(out)) {
            scaled.compress(Bitmap.CompressFormat.JPEG, COVER_JPEG_QUALITY, fos);
            fos.getFD().sync();
        }
        if (scaled != bitmap) {
            scaled.recycle();
        }
        bitmap.recycle();
        return "cover.jpg";
    }

    public void removeCover(Project project) {
        if (project.coverFileName == null) {
            return;
        }
        //noinspection ResultOfMethodCallIgnored
        new File(projectDir(project.id), project.coverFileName).delete();
        project.coverFileName = null;
    }

    public byte[] readCover(Project project) {
        if (project == null || project.coverFileName == null) {
            return null;
        }
        File f = new File(projectDir(project.id), project.coverFileName);
        if (!f.isFile()) {
            return null;
        }
        try {
            return readAllBytes(new FileInputStream(f));
        } catch (IOException e) {
            Log.w(TAG, "Cover unreadable", e);
            return null;
        }
    }

    public String coverExt(Project project) {
        if (project == null || project.coverFileName == null) {
            return "jpg";
        }
        int dot = project.coverFileName.lastIndexOf('.');
        if (dot < 0) {
            return "jpg";
        }
        return project.coverFileName.substring(dot + 1).toLowerCase();
    }

    private static Bitmap scaleDown(Bitmap src, int maxW, int maxH) {
        int w = src.getWidth();
        int h = src.getHeight();
        float ratio = Math.min(1f, Math.min((float) maxW / w, (float) maxH / h));
        if (ratio >= 1f) {
            return src;
        }
        int nw = Math.max(1, Math.round(w * ratio));
        int nh = Math.max(1, Math.round(h * ratio));
        return Bitmap.createScaledBitmap(src, nw, nh, true);
    }

    // ------------------------------------------------------------------ backup (JSON, cover embedded as base64)

    public byte[] exportBackup(Project project) throws IOException {
        try {
            JSONObject root = new JSONObject();
            root.put("type", "ranobe-epub-backup");
            root.put("version", 1);
            root.put("app", "RanobeEPUB");
            JSONObject p = projectToJson(project);
            root.put("project", p);
            byte[] cover = readCover(project);
            if (cover != null) {
                JSONObject coverJson = new JSONObject();
                coverJson.put("ext", coverExt(project));
                coverJson.put("base64", Base64.encodeToString(cover, Base64.NO_WRAP));
                root.put("cover", coverJson);
            }
            return root.toString(2).getBytes(StandardCharsets.UTF_8);
        } catch (JSONException e) {
            throw new IOException("Не удалось сформировать резервную копию: " + e.getMessage(), e);
        }
    }

    public Project importBackup(byte[] data) throws IOException {
        try {
            JSONObject root = new JSONObject(new String(data, StandardCharsets.UTF_8));
            if (!"ranobe-epub-backup".equals(root.optString("type"))) {
                throw new IOException("Это не файл резервной копии Ranobe EPUB");
            }
            int version = root.optInt("version", 1);
            if (version > 1) {
                throw new IOException("Версия копии (" + version + ") новее, чем поддерживает приложение");
            }
            JSONObject p = root.getJSONObject("project");
            Project project = fromJson(p);
            // Always import as a brand-new project.
            project.id = UUID.randomUUID().toString();
            project.identifier = "";
            long now = System.currentTimeMillis();
            project.createdAt = now;
            project.updatedAt = now;
            project.coverFileName = null;
            save(project);
            JSONObject coverJson = root.optJSONObject("cover");
            if (coverJson != null) {
                try {
                    byte[] cover = Base64.decode(coverJson.getString("base64"), Base64.NO_WRAP);
                    String ext = coverJson.optString("ext", "jpg");
                    String fileName = "cover." + ("png".equalsIgnoreCase(ext) ? "png" : "jpg");
                    File out = new File(projectDir(project.id), fileName);
                    try (FileOutputStream fos = new FileOutputStream(out)) {
                        fos.write(cover);
                    }
                    project.coverFileName = fileName;
                    save(project);
                } catch (Exception e) {
                    Log.w(TAG, "Backup cover could not be restored; continuing without it", e);
                }
            }
            return project;
        } catch (JSONException e) {
            throw new IOException("Повреждённый файл резервной копии: " + e.getMessage(), e);
        }
    }

    // ------------------------------------------------------------------ JSON mapping

    private String toJson(Project project) {
        try {
            return projectToJson(project).toString(2);
        } catch (JSONException e) {
            throw new IllegalStateException(e);
        }
    }

    private static JSONObject projectToJson(Project p) throws JSONException {
        JSONObject o = new JSONObject();
        o.put("id", p.id);
        o.put("title", nullSafe(p.title));
        o.put("author", nullSafe(p.author));
        o.put("language", nullSafe(p.language).isEmpty() ? Project.DEFAULT_LANGUAGE : p.language);
        o.put("publisher", nullSafe(p.publisher));
        o.put("series", nullSafe(p.series));
        o.put("subjects", nullSafe(p.subjects));
        o.put("description", nullSafe(p.description));
        o.put("identifier", nullSafe(p.identifier));
        o.put("vertical", p.vertical);
        o.put("coverFileName", p.coverFileName == null ? JSONObject.NULL : p.coverFileName);
        o.put("createdAt", p.createdAt);
        o.put("updatedAt", p.updatedAt);
        JSONArray chapters = new JSONArray();
        for (Chapter c : p.chapters) {
            JSONObject co = new JSONObject();
            co.put("id", c.id == null ? UUID.randomUUID().toString() : c.id);
            co.put("title", nullSafe(c.title));
            co.put("content", nullSafe(c.content));
            chapters.put(co);
        }
        o.put("chapters", chapters);
        return o;
    }

    private static Project fromJson(String json) throws IOException {
        try {
            return fromJson(new JSONObject(json));
        } catch (JSONException e) {
            throw new IOException("Повреждённый project.json: " + e.getMessage(), e);
        }
    }

    private static Project fromJson(JSONObject o) throws JSONException {
        Project p = new Project();
        p.id = o.optString("id", p.id);
        p.title = o.optString("title", "");
        p.author = o.optString("author", "");
        p.language = o.optString("language", Project.DEFAULT_LANGUAGE);
        p.publisher = o.optString("publisher", "");
        p.series = o.optString("series", "");
        p.subjects = o.optString("subjects", "");
        p.description = o.optString("description", "");
        p.identifier = o.optString("identifier", "");
        p.vertical = o.optBoolean("vertical", true);
        p.coverFileName = o.isNull("coverFileName") ? null : o.optString("coverFileName", null);
        p.createdAt = o.optLong("createdAt", System.currentTimeMillis());
        p.updatedAt = o.optLong("updatedAt", System.currentTimeMillis());
        p.chapters.clear();
        JSONArray chapters = o.optJSONArray("chapters");
        if (chapters != null) {
            for (int i = 0; i < chapters.length(); i++) {
                JSONObject co = chapters.optJSONObject(i);
                if (co == null) {
                    continue;
                }
                Chapter c = new Chapter(co.optString("title", ""), co.optString("content", ""));
                c.id = co.optString("id", c.id);
                p.chapters.add(c);
            }
        }
        return p;
    }

    private static String nullSafe(String s) {
        return s == null ? "" : s;
    }

    // ------------------------------------------------------------------ temp files for export

    public File newTempEpubFile(String baseName) {
        String safe = sanitizeFileName(baseName);
        return new File(cacheDir, safe + "-" + System.currentTimeMillis() + ".epub");
    }

    public static String sanitizeFileName(String name) {
        String base = name == null || name.trim().isEmpty() ? "book" : name.trim();
        base = base.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_");
        base = base.replaceAll("\\s+", " ").trim();
        if (base.length() > 80) {
            base = base.substring(0, 80).trim();
        }
        return base.isEmpty() ? "book" : base;
    }

    // ------------------------------------------------------------------ byte helpers

    public static byte[] readAllBytes(InputStream in) throws IOException {
        try (InputStream input = in) {
            ByteArrayOutputStream out = new ByteArrayOutputStream(Math.max(1024, 4096));
            byte[] buffer = new byte[8192];
            int read;
            while ((read = input.read(buffer)) != -1) {
                out.write(buffer, 0, read);
            }
            return out.toByteArray();
        }
    }

    public static void copyStream(InputStream in, OutputStream out) throws IOException {
        byte[] buffer = new byte[8192];
        int read;
        while ((read = in.read(buffer)) != -1) {
            out.write(buffer, 0, read);
        }
    }

    private static void copyFile(File src, File dst) throws IOException {
        try (FileInputStream in = new FileInputStream(src);
             FileOutputStream out = new FileOutputStream(dst)) {
            copyStream(in, out);
        }
    }

    private static void deleteRecursive(File file) {
        if (file == null || !file.exists()) {
            return;
        }
        if (file.isDirectory()) {
            File[] children = file.listFiles();
            if (children != null) {
                for (File child : children) {
                    deleteRecursive(child);
                }
            }
        }
        //noinspection ResultOfMethodCallIgnored
        file.delete();
    }
}
