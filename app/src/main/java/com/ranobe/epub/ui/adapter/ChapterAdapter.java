package com.ranobe.epub.ui.adapter;

import android.content.Context;
import android.view.LayoutInflater;
import android.view.ViewGroup;

import androidx.annotation.NonNull;

import com.ranobe.epub.R;
import com.ranobe.epub.databinding.ItemChapterBinding;
import com.ranobe.epub.model.Chapter;

import java.text.DecimalFormat;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

import androidx.recyclerview.widget.RecyclerView;

public final class ChapterAdapter extends RecyclerView.Adapter<ChapterAdapter.ViewHolder> {

    public interface Listener {
        void onEdit(Chapter chapter);

        void onMove(int fromPosition, int toPosition);

        void onDelete(Chapter chapter);
    }

    private final List<Chapter> items = new ArrayList<>();
    private final Listener listener;

    public ChapterAdapter(@NonNull Listener listener) {
        this.listener = listener;
    }

    public void submit(List<Chapter> chapters) {
        items.clear();
        items.addAll(chapters);
        notifyDataSetChanged();
    }

    @NonNull
    @Override
    public ViewHolder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
        ItemChapterBinding binding = ItemChapterBinding.inflate(
                LayoutInflater.from(parent.getContext()), parent, false);
        return new ViewHolder(binding);
    }

    @Override
    public void onBindViewHolder(@NonNull ViewHolder holder, int position) {
        Chapter chapter = items.get(position);
        Context context = holder.itemView.getContext();

        holder.binding.chapterIndex.setText(String.format(Locale.US, "%d", position + 1));

        String title = chapter.title == null ? "" : chapter.title.trim();
        if (title.isEmpty()) {
            title = context.getString(R.string.chapter_fallback_title, position + 1);
        }
        holder.binding.chapterTitle.setText(title);

        DecimalFormat grouping = new DecimalFormat("#,###");
        holder.binding.chapterMeta.setText(
                context.getString(R.string.char_count, grouping.format(chapter.charCount())));

        boolean first = position == 0;
        boolean last = position == items.size() - 1;
        holder.binding.moveUpButton.setEnabled(!first);
        holder.binding.moveUpButton.setAlpha(first ? 0.32f : 1f);
        holder.binding.moveDownButton.setEnabled(!last);
        holder.binding.moveDownButton.setAlpha(last ? 0.32f : 1f);

        holder.binding.chapterBody.setOnClickListener(v -> listener.onEdit(chapter));
        holder.binding.chapterTitle.setOnClickListener(v -> listener.onEdit(chapter));
        holder.binding.moveUpButton.setOnClickListener(v -> {
            int from = holder.getBindingAdapterPosition();
            if (from != RecyclerView.NO_POSITION && from > 0) {
                listener.onMove(from, from - 1);
            }
        });
        holder.binding.moveDownButton.setOnClickListener(v -> {
            int from = holder.getBindingAdapterPosition();
            if (from != RecyclerView.NO_POSITION && from < items.size() - 1) {
                listener.onMove(from, from + 1);
            }
        });
        holder.binding.deleteButton.setOnClickListener(v -> listener.onDelete(chapter));
    }

    @Override
    public int getItemCount() {
        return items.size();
    }

    static final class ViewHolder extends RecyclerView.ViewHolder {
        final ItemChapterBinding binding;

        ViewHolder(@NonNull ItemChapterBinding binding) {
            super(binding.getRoot());
            this.binding = binding;
        }
    }
}
