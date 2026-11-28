package com.ranobe.epub.ui;

import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;

import androidx.appcompat.app.AppCompatActivity;

import com.ranobe.epub.R;
import com.ranobe.epub.databinding.ActivityAboutBinding;

public final class AboutActivity extends AppCompatActivity {

    private ActivityAboutBinding binding;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        binding = ActivityAboutBinding.inflate(getLayoutInflater());
        setContentView(binding.getRoot());

        String versionName = "1.0.0";
        int versionCode = 1;
        try {
            PackageInfo info;
            if (Build.VERSION.SDK_INT >= 33) {
                info = getPackageManager().getPackageInfo(getPackageName(),
                        PackageManager.PackageInfoFlags.of(0));
            } else {
                //noinspection deprecation
                info = getPackageManager().getPackageInfo(getPackageName(), 0);
            }
            versionName = info.versionName != null ? info.versionName : versionName;
            versionCode = (int) info.getLongVersionCode();
        } catch (PackageManager.NameNotFoundException e) {
            // fall back to defaults baked into the resources
        }
        binding.versionText.setText(
                getString(R.string.about_version, versionName, versionCode));
        binding.closeAboutButton.setOnClickListener(v -> finish());
    }
}
