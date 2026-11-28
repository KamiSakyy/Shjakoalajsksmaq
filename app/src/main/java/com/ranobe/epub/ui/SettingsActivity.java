package com.ranobe.epub.ui;

import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.widget.ArrayAdapter;

import androidx.appcompat.app.AppCompatActivity;

import com.google.android.material.textfield.MaterialAutoCompleteTextView;
import com.ranobe.epub.R;
import com.ranobe.epub.databinding.ActivitySettingsBinding;

/**
 * Defaults for new projects + a plain-language statement of the offline-first
 * storage model. Preferences live in the app sandbox; nothing leaves it.
 */
public final class SettingsActivity extends AppCompatActivity {

    static final String PREFS = "ranobe_epub_settings";
    static final String KEY_DEFAULT_LANGUAGE = "default_language";
    static final String KEY_DEFAULT_VERTICAL = "default_vertical";

    private ActivitySettingsBinding binding;
    private SharedPreferences prefs;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        binding = ActivitySettingsBinding.inflate(getLayoutInflater());
        setContentView(binding.getRoot());
        setSupportActionBar(binding.toolbar);
        if (getSupportActionBar() != null) {
            getSupportActionBar().setDisplayHomeAsUpEnabled(true);
        }
        binding.toolbar.setNavigationOnClickListener(v -> finish());

        prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        setupLanguageDropdown();

        binding.defaultVerticalSwitch.setChecked(prefs.getBoolean(KEY_DEFAULT_VERTICAL, true));
        binding.defaultVerticalSwitch.setOnCheckedChangeListener((button, checked) ->
                prefs.edit().putBoolean(KEY_DEFAULT_VERTICAL, checked).apply());

        binding.openAboutButton.setOnClickListener(v ->
                startActivity(new Intent(this, AboutActivity.class)));
    }

    private void setupLanguageDropdown() {
        String[] labels = getResources().getStringArray(R.array.language_labels);
        String[] codes = getResources().getStringArray(R.array.language_codes);
        String current = prefs.getString(KEY_DEFAULT_LANGUAGE, "ja");

        int index = 0;
        for (int i = 0; i < codes.length; i++) {
            if (codes[i].equalsIgnoreCase(current)) {
                index = i;
                break;
            }
        }

        MaterialAutoCompleteTextView dropdown = binding.defaultLanguageDropdown;
        ArrayAdapter<String> adapter = new ArrayAdapter<>(
                this, android.R.layout.simple_dropdown_item_1line, labels);
        dropdown.setAdapter(adapter);
        dropdown.setText(labels[index], false);
        dropdown.setOnClickListener(v -> dropdown.showDropDown());
        dropdown.setOnItemClickListener((parent, view, position, id) -> {
            if (position >= 0 && position < codes.length) {
                prefs.edit().putString(KEY_DEFAULT_LANGUAGE, codes[position]).apply();
            }
        });
    }
}
