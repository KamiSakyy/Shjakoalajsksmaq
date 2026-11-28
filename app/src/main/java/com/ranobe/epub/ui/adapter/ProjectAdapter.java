package com.ranobe.epub.ui.adapter;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.PopupMenu;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.recyclerview.widget.RecyclerView;

import com.ranobe.epub.R;
import com.ranobe.epub.data.ProjectStore;
import com.ranobe.epub.databinding.ItemProjectBinding;
import com.ranobe.epub.model.Project;

import java.text.DecimalFormat;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/**
 * Grid/list adapter for the library screen. Covers are decoded from the
 * project directory on a best-effort basis and always downsampled.
 */
public final class ProjectAdapter extends RecyclerView.Adapter<ProjectAdapter.ViewHolder> {

    public interface Listener {
        void onOpen(Project project);

        void onExport(Project project);

        void onDuplicate(Project project);

        void onDelete(Project project);
    }

    private final List<Project> items = new ArrayList<>();
    private final ProjectStore store;
    private final Listener listener;

    public ProjectAdapter(@NonNull ProjectStore store, @NonNull Listener listener) {
        this.store = store;
        this.listener = listener;
    }

    public void submit(@Nullable List<Project> projects) {
        items.clear();
        if (projects != null) {
            items.addAll(projects);
        }
        notifyDataSetChanged();
    }

    @NonNull
    @Override
    public ViewHolder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
        ItemProjectBinding binding = ItemProjectBinding.inflate(
                LayoutInflater.from(parent.getContext()), parent, false);
        return new ViewHolder(binding);
    }

    @Override
    public void onBindViewHolder(@NonNull ViewHolder holder, int position) {
        Project project = items.get(position);
        Context context = holder.itemView.getContext();

        holder.binding.titleText.setText(project.displayTitle());

        String author = project.author == null || project.author.trim().isEmpty()
                ? context.getString(R.string.untitled_author)
                : project.author.trim();
        holder.binding.authorText.setText(author);

        DecimalFormat grouping = new DecimalFormat("#,###");
        String chars = grouping.format(project.totalChars());
        String date = new SimpleDateFormat("dd.MM.yyyy", Locale.getDefault())
                .format(new Date(project.updatedAt));
        String meta = context.getString(R.string.project_meta, project.chapters.size(), chars)
                + "  ·  " + date;
        holder.binding.metaText.setText(meta);

        bindCover(holder, project);

        holder.itemView.setOnClickListener(v -> listener.onOpen(project));
        holder.binding.overflowButton.setOnClickListener(v ->
                showOverflow(holder.binding.overflowButton, project));
    }

    private void bindCover(@NonNull ViewHolder holder, @NonNull Project project) {
        byte[] coverBytes = store.readCover(project);
        Bitmap thumb = coverBytes == null ? null : decodeThumbnail(coverBytes, 220);
        if (thumb != null) {
            holder.binding.coverImage.setImageBitmap(thumb);
            holder.binding.coverImage.setVisibility(View.VISIBLE);
            holder.binding.coverIcon.setVisibility(View.GONE);
        } else {
            holder.binding.coverImage.setImageDrawable(null);
            holder.binding.coverImage.setVisibility(View.GONE);
            holder.binding.coverIcon.setVisibility(View.VISIBLE);
        }
    }

    @Nullable
    private static Bitmap decodeThumbnail(byte[] bytes, int reqSize) {
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
        int sample = 1;
        while (bounds.outWidth / sample > reqSize || bounds.outHeight / sample > reqSize) {
            sample *= 2;
        }
        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inSampleSize = sample;
        options.inPreferredConfig = Bitmap.Config.RGB_565;
        try {
            return BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options);
        } catch (OutOfMemoryError e) {
            return null;
        }
    }

    private void showOverflow(@NonNull View anchor, @NonNull Project project) {
        PopupMenu menu = new PopupMenu(anchor.getContext(), anchor);
        menu.inflate(R.menu.menu_project_item);
        menu.setOnMenuItemClickListener(item -> {
            int id = item.getItemId();
            if (id == R.id.action_export) {
                listener.onExport(project);
                return true;
            } else if (id == R.id.action_duplicate) {
                listener.onDuplicate(project);
                return true;
            } else if (id == R.id.action_delete) {
                listener.onDelete(project);
                return true;
            }
            return false;
        });
        menu.show();
    }

    @Override
    public int getItemCount() {
        return items.size();
    }

    static final class ViewHolder extends RecyclerView.ViewHolder {
        final ItemProjectBinding binding;

        ViewHolder(@NonNull ItemProjectBinding binding) {
            super(binding.getRoot());
            this.binding = binding;
        }
    }
}
