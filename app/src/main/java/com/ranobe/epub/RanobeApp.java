package com.ranobe.epub;

import android.app.Application;
import android.util.Log;

import com.ranobe.epub.util.CrashLog;

/**
 * Application entry point. Installs a last-resort uncaught-exception handler that
 * persists the stack trace to app-private storage so the user (or support) can
 * read exactly what crashed instead of a bare "app stopped".
 */
public final class RanobeApp extends Application {

    private static final String TAG = "RanobeApp";

    @Override
    public void onCreate() {
        super.onCreate();
        Thread.UncaughtExceptionHandler defaultHandler = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler((thread, throwable) -> {
            try {
                CrashLog.write(this, throwable);
            } catch (Throwable t) {
                Log.e(TAG, "Unable to persist crash log", t);
            }
            if (defaultHandler != null) {
                defaultHandler.uncaughtException(thread, throwable);
            } else {
                //noinspection CallToSystemExit
                System.exit(10);
            }
        });
    }
}
