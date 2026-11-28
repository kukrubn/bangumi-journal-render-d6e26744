package io.github.kukrubn.bangumijournal;

import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipDescription;
import android.content.ClipboardManager;
import android.content.ComponentName;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.os.Build;
import android.os.PersistableBundle;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import java.util.ArrayList;
import java.util.List;
import java.util.function.Supplier;

final class BrowserFallback {
    private final MainActivity activity;

    BrowserFallback(MainActivity activity) { this.activity = activity; }

    View panel(Supplier<String> destination, Runnable retry) {
        ScrollView scroll = new ScrollView(activity);
        scroll.setFillViewport(true);
        LinearLayout column = new LinearLayout(activity);
        int gap = Math.round(20 * activity.getResources().getDisplayMetrics().density);
        column.setPadding(gap, gap, gap, gap);
        column.setGravity(Gravity.CENTER);
        column.setOrientation(LinearLayout.VERTICAL);
        scroll.addView(column);

        TextView title = new TextView(activity);
        title.setGravity(Gravity.CENTER);
        title.setTextSize(22);
        title.setText("请更新 Android 系统 WebView 或 Chrome");
        column.addView(title);
        TextView detail = new TextView(activity);
        detail.setGravity(Gravity.CENTER);
        detail.setTextSize(16);
        detail.setPadding(0, gap, 0, gap);
        detail.setText("在应用商店更新后点「重试」。也可以用其他浏览器打开当前链接。");
        column.addView(detail);
        button(column, "用浏览器继续", () -> open(destination.get()));
        button(column, "重试", retry);
        button(column, "复制链接", () -> copy(destination.get()));
        return scroll;
    }

    private void button(LinearLayout parent, String label, Runnable click) {
        Button button = new Button(activity);
        button.setText(label);
        button.setOnClickListener(v -> click.run());
        parent.addView(button);
    }

    private void open(String url) {
        PackageManager pm = activity.getPackageManager();
        // Probe a generic HTTPS URL, then target a browser explicitly to bypass our verified /join link.
        Intent probe = new Intent(Intent.ACTION_VIEW, Uri.parse("https://browser-check.invalid/"))
            .addCategory(Intent.CATEGORY_BROWSABLE);
        int flags = PackageManager.MATCH_DEFAULT_ONLY | PackageManager.GET_RESOLVED_FILTER;
        ResolveInfo preferred = pm.resolveActivity(probe, flags);
        List<Intent> browsers = new ArrayList<>();
        for (ResolveInfo candidate : pm.queryIntentActivities(probe, flags)) {
            String pkg = candidate.activityInfo.packageName;
            if (pkg.equals(activity.getPackageName()) || candidate.filter == null) continue;
            if (candidate.filter.countDataAuthorities() != 0
                && !candidate.filter.hasCategory(Intent.CATEGORY_APP_BROWSER)) continue;
            Intent open = new Intent(Intent.ACTION_VIEW, Uri.parse(url)).addCategory(Intent.CATEGORY_BROWSABLE)
                .setComponent(new ComponentName(pkg, candidate.activityInfo.name));
            if (preferred != null && pkg.equals(preferred.activityInfo.packageName)) {
                browsers.clear();
                browsers.add(open);
                break;
            }
            browsers.add(open);
        }
        if (!browsers.isEmpty()) {
            Intent launch = browsers.remove(0);
            if (!browsers.isEmpty()) {
                launch = Intent.createChooser(launch, "选择浏览器")
                    .putExtra(Intent.EXTRA_INITIAL_INTENTS, browsers.toArray(new Intent[0]));
            }
            try {
                activity.startActivity(launch);
                return;
            } catch (ActivityNotFoundException | SecurityException unavailable) {
                // A browser can be uninstalled between package discovery and launch.
            }
        }
        activity.tell("未找到可用浏览器，请复制链接后在其他设备或新版浏览器中打开");
    }

    private void copy(String url) {
        ClipboardManager clipboard = activity.getSystemService(ClipboardManager.class);
        if (clipboard == null) return;
        ClipData clip = ClipData.newPlainText("番剧手账链接", url);
        if (Build.VERSION.SDK_INT >= 33) {
            PersistableBundle extras = new PersistableBundle();
            extras.putBoolean(ClipDescription.EXTRA_IS_SENSITIVE, true);
            clip.getDescription().setExtras(extras);
        }
        clipboard.setPrimaryClip(clip);
        activity.tell("链接已复制");
    }
}
