package org.taisei_project.taisei;

import android.content.res.AssetFileDescriptor;
import android.os.Bundle;
import android.system.Os;
import android.util.Log;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.RelativeLayout;

import org.libsdl.app.SDLActivity;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;

public class TaiseiActivity extends SDLActivity {
    private static final String TAG = "TaiseiAndroid";
    private static final String ASSET_PAK_NAME = "00-taisei.zip";

    @Override
    protected String[] getLibraries() {
        return new String[] {
            "c++_shared",
            "SDL3",
            "main"
        };
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        setupTaiseiPathsAndAssets();
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        if (mLayout != null) {
            TouchOverlayView overlay = new TouchOverlayView(this);
            RelativeLayout.LayoutParams params = new RelativeLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            );
            mLayout.addView(overlay, params);
        }
    }

    private void setupTaiseiPathsAndAssets() {
        File filesDir = getFilesDir();
        File resDir = new File(filesDir, "res");
        File storageDir = new File(filesDir, "storage");
        File cacheDir = new File(getCacheDir(), "taisei");

        resDir.mkdirs();
        storageDir.mkdirs();
        cacheDir.mkdirs();

        extractAssetIfNeeded(ASSET_PAK_NAME, new File(resDir, ASSET_PAK_NAME));

        try {
            Os.setenv("TAISEI_RES_PATH", resDir.getAbsolutePath(), true);
            Os.setenv("TAISEI_STORAGE_PATH", storageDir.getAbsolutePath(), true);
            Os.setenv("TAISEI_CACHE_PATH", cacheDir.getAbsolutePath(), true);
        } catch (Exception e) {
            Log.e(TAG, "Failed to set Taisei environment variables", e);
        }
    }

    private void extractAssetIfNeeded(String assetName, File outFile) {
        long assetSize = -1;
        try (AssetFileDescriptor afd = getAssets().openFd(assetName)) {
            assetSize = afd.getLength();
        } catch (IOException ignored) {
        }

        if (outFile.exists() && assetSize > 0 && outFile.length() == assetSize) {
            return;
        }

        Log.i(TAG, "Extracting " + assetName + " to " + outFile.getAbsolutePath());
        File tmpFile = new File(outFile.getAbsolutePath() + ".tmp");
        try (InputStream in = getAssets().open(assetName);
             FileOutputStream out = new FileOutputStream(tmpFile)) {
            byte[] buf = new byte[65536];
            int len;
            while ((len = in.read(buf)) != -1) {
                out.write(buf, 0, len);
            }
            out.flush();
            if (outFile.exists()) {
                outFile.delete();
            }
            if (!tmpFile.renameTo(outFile)) {
                Log.e(TAG, "Failed to rename extracted asset to " + outFile.getAbsolutePath());
            }
        } catch (IOException e) {
            Log.e(TAG, "Failed to extract asset " + assetName, e);
        }
    }
}
