package com.ranobe.epub.util;

import android.app.Activity;
import android.view.View;
import android.view.Window;

import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;

/**
 * Edge-to-edge done right on every supported OS level.
 *
 * <p>Android 15+ enforces edge-to-edge; rather than letting content slide under
 * the system bars we opt out of the decor-fits behaviour and inset the given root
 * view by the system-bar / cutout insets. Status and navigation bars are kept
 * fully transparent so the graphite background runs edge to edge.</p>
 */
public final class Insets {

    private Insets() {
    }

    public static void applyEdgeToEdge(Activity activity, View root) {
        Window window = activity.getWindow();
        WindowCompat.setDecorFitsSystemWindows(window, false);
        WindowCompat.getInsetsController(window, root).setAppearanceLightStatusBars(false);
        WindowCompat.getInsetsController(window, root).setAppearanceLightNavigationBars(false);
        ViewCompat.setOnApplyWindowInsetsListener(root, (view, insets) -> {
            androidx.core.graphics.Insets bars = insets.getInsets(
                    WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return insets;
        });
        ViewCompat.requestApplyInsets(root);
    }
}
