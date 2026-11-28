package io.github.kukrubn.bangumijournal;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.CookieManager;
import android.webkit.ValueCallback;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URL;
import java.time.LocalDate;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import javax.net.ssl.HttpsURLConnection;

final class Documents {
    private static final int OPEN_JSON = 21, SAVE_BACKUP = 22;
    private final MainActivity activity;
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private ValueCallback<Uri[]> upload;
    private String pendingFormat;

    Documents(MainActivity activity) { this.activity = activity; }

    void pickJson(ValueCallback<Uri[]> callback) {
        if (upload != null) upload.onReceiveValue(null);
        upload = callback;
        Intent picker = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
            .setType("*/*").putExtra(Intent.EXTRA_MIME_TYPES, new String[] {
                "application/json", "text/json", "text/plain", "application/octet-stream"
            });
        try {
            activity.startActivityForResult(picker, OPEN_JSON);
        } catch (ActivityNotFoundException e) {
            finishUpload(null);
            activity.tell("未找到系统文件选择器");
        }
    }

    boolean offerBackup(Uri uri) {
        if (!MainActivity.isSite(uri) || !"/api/backup".equals(uri.getEncodedPath())) return false;
        String format = uri.getQueryParameter("format");
        if (format == null) format = "json";
        if (!validFormat(format)) return false;
        if (pendingFormat != null) return true;
        pendingFormat = format;
        Intent create = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
            .setType(mime(format)).putExtra(Intent.EXTRA_TITLE, "bangumi-journal-" + LocalDate.now() + "." + format);
        try {
            activity.startActivityForResult(create, SAVE_BACKUP);
        } catch (ActivityNotFoundException e) {
            pendingFormat = null;
            activity.tell("未找到系统文件选择器");
        }
        return true;
    }

    void result(int code, Uri selected) {
        Uri uri = selected != null && "content".equals(selected.getScheme()) ? selected : null;
        if (code == OPEN_JSON) {
            if (upload == null && uri != null) activity.tell("请重新选择要恢复的 JSON 文件");
            finishUpload(uri);
        } else if (code == SAVE_BACKUP) {
            String format = pendingFormat;
            pendingFormat = null;
            if (uri == null || !validFormat(format)) return;
            String url = MainActivity.ORIGIN + "/api/backup?format=" + format;
            String cookies = CookieManager.getInstance().getCookie(url);
            io.execute(() -> export(uri, url, cookies, format));
        }
    }

    private void finishUpload(Uri uri) {
        if (upload == null) return;
        ValueCallback<Uri[]> callback = upload;
        upload = null;
        callback.onReceiveValue(uri == null ? null : new Uri[] { uri });
    }

    private static boolean validFormat(String format) {
        return "json".equals(format) || "csv".equals(format) || "zip".equals(format);
    }
    private static String mime(String format) {
        if ("csv".equals(format)) return "text/csv";
        if ("zip".equals(format)) return "application/zip";
        return "application/json";
    }

    private void export(Uri target, String url, String cookies, String format) {
        HttpsURLConnection connection = null;
        File staged = null;
        try {
            connection = (HttpsURLConnection) new URL(url).openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setUseCaches(false);
            connection.setConnectTimeout(30000);
            connection.setReadTimeout(90000);
            if (cookies != null) connection.setRequestProperty("Cookie", cookies);
            int status = connection.getResponseCode();
            if (status == 401 || status == 403) {
                notifyUser("请重新登录后导出备份");
                return;
            }
            String type = connection.getContentType();
            String disposition = connection.getHeaderField("Content-Disposition");
            if (status != 200 || type == null || !mime(format).equalsIgnoreCase(type.split(";")[0].trim())
                || disposition == null || !disposition.startsWith("attachment;")) {
                notifyUser("服务端未返回备份，请稍后重试");
                return;
            }
            // Finish the network transfer before opening the destination on the user's drive.
            staged = File.createTempFile("journal-export-", ".tmp", activity.getCacheDir());
            long bytes;
            try (InputStream from = connection.getInputStream(); OutputStream into = new FileOutputStream(staged)) {
                bytes = copy(from, into);
            }
            long expected = connection.getContentLengthLong();
            if (bytes == 0 || (expected >= 0 && bytes != expected)) {
                notifyUser("备份下载不完整，请重新导出");
                return;
            }
            try (InputStream from = new FileInputStream(staged);
                 OutputStream into = activity.getContentResolver().openOutputStream(target, "wt")) {
                if (into == null) throw new IOException("无法写入选择的位置");
                copy(from, into);
            }
            notifyUser("备份已保存");
        } catch (IOException | SecurityException e) {
            notifyUser("保存失败，请检查网络和保存位置后重试");
        } finally {
            if (connection != null) connection.disconnect();
            if (staged != null) staged.delete();
        }
    }

    private static long copy(InputStream from, OutputStream into) throws IOException {
        byte[] buffer = new byte[16 * 1024];
        int count;
        long total = 0;
        while ((count = from.read(buffer)) != -1) {
            into.write(buffer, 0, count);
            total += count;
        }
        return total;
    }

    private void notifyUser(String message) {
        activity.runOnUiThread(() -> activity.tell(message));
    }
    void save(Bundle out) { out.putString("backupFormat", pendingFormat); }
    void restore(Bundle saved) {
        String format = saved.getString("backupFormat");
        pendingFormat = validFormat(format) ? format : null;
    }
    void close() {
        finishUpload(null);
        io.shutdown();
    }
}
