package com.ranobe.epub.util;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.annotation.NonNull;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

/**
 * Runtime-permission plumbing for image import.
 *
 * <p>Modern import/export goes through the Storage Access Framework and needs no
 * dangerous permissions at all. The permissions declared in the manifest exist for
 * legacy devices and direct-picker integration; they are requested here, with a
 * rationale and a deep-link to system settings when permanently denied.</p>
 */
public final class PermissionsHelper {

    public static final int REQUEST_CODE_IMAGES = 4201;

    private PermissionsHelper() {
    }

    /** The permission this OS level expects for reading images, or null when none is needed. */
    public static String imagesPermission() {
        if (Build.VERSION.SDK_INT >= 33) {
            return Manifest.permission.READ_MEDIA_IMAGES;
        }
        return Manifest.permission.READ_EXTERNAL_STORAGE;
    }

    public static boolean hasImagesPermission(@NonNull Context context) {
        String permission = imagesPermission();
        if (permission == null) {
            return true;
        }
        return ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED;
    }

    /** True when the user denied the permission in the past and a rationale should be shown. */
    public static boolean shouldShowRationale(@NonNull Activity activity) {
        String permission = imagesPermission();
        return permission != null && ActivityCompat.shouldShowRequestPermissionRationale(activity, permission);
    }

    public static void requestImagesPermission(@NonNull Activity activity) {
        String permission = imagesPermission();
        if (permission != null) {
            ActivityCompat.requestPermissions(activity, new String[]{permission}, REQUEST_CODE_IMAGES);
        }
    }

    /** Heuristic: denied once and the OS won't ask again — direct the user to settings. */
    public static boolean isPermanentlyDenied(@NonNull Activity activity) {
        return !hasImagesPermission(activity) && !shouldShowRationale(activity);
    }

    public static void openAppSettings(@NonNull Activity activity) {
        Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
        intent.setData(Uri.fromParts("package", activity.getPackageName(), null));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        activity.startActivity(intent);
    }
}
