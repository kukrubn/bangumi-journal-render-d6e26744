package io.github.kukrubn.bangumijournal;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;
import java.io.ByteArrayInputStream;

public class MainActivity extends Activity {
    static final String HOST = "bangumi-journal.onrender.com";
    static final String ORIGIN = "https://" + HOST;
    private static final String HOME = ORIGIN + "/library";
    private FrameLayout root;
    private WebView web;
    private LinearLayout offline;
    private ProgressBar progress;
    private Documents documents;
    private String retryUrl = HOME;

    static boolean isSite(Uri uri) {
        return uri != null && "https".equals(uri.getScheme()) && HOST.equals(uri.getEncodedAuthority())
            && uri.toString().indexOf('\\') < 0;
    }

    private static String inviteUrl(Intent intent) {
        Uri uri = intent.getData();
        return Intent.ACTION_VIEW.equals(intent.getAction()) && isSite(uri) && "/join".equals(uri.getEncodedPath())
            ? uri.toString() : null;
    }

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        root = new FrameLayout(this);
        root.setBackgroundColor(getColor(R.color.paper));
        insetSystemBars(root);
        setContentView(root);
        documents = new Documents(this);
        if (state != null) documents.restore(state);
        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::goBack);
        }
        String invite = inviteUrl(getIntent());
        String pending = state == null ? null : state.getString("pendingInvite");
        if (pending != null && isSite(Uri.parse(pending)) && "/join".equals(Uri.parse(pending).getEncodedPath())) {
            invite = pending;
        }
        retryUrl = invite != null ? invite : HOME;
        openJournal();
    }

    private void openJournal() {
        root.removeAllViews();
        // Next.js 16 targets Chrome 111+. Check before instantiating a missing or disabled provider.
        try {
            PackageInfo provider = WebView.getCurrentWebViewPackage();
            if (provider != null && provider.versionName != null
                && Integer.parseInt(provider.versionName.split("\\.", 2)[0]) >= 111) {
                web = new WebView(this);
                configureWebView();
            }
        } catch (RuntimeException | LinkageError unavailable) {
            if (web != null) web.destroy();
            web = null;
        }
        if (web == null) {
            BrowserFallback fallback = new BrowserFallback(this);
            root.addView(fallback.panel(() -> retryUrl, this::openJournal));
            return;
        }
        web.setBackgroundColor(getColor(R.color.paper));
        root.addView(web);
        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.setContentDescription("正在载入片单");
        root.addView(progress, new FrameLayout.LayoutParams(-1, dp(3), Gravity.TOP));
        offline = offlinePanel();
        root.addView(offline);
        web.loadUrl(retryUrl);
    }

    private void configureWebView() {
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setUserAgentString(settings.getUserAgentString() + " BangumiJournalAndroid/1.0");
        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(web, false);
        web.setWebViewClient(new Navigation());
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onProgressChanged(WebView view, int percent) {
                progress.setProgress(percent);
                progress.setVisibility(percent < 100 && offline.getVisibility() != View.VISIBLE ? View.VISIBLE : View.GONE);
            }
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (isSite(Uri.parse(view.getUrl() == null ? "" : view.getUrl()))) documents.pickJson(callback);
                else callback.onReceiveValue(null);
                return true;
            }
        });
        web.setDownloadListener((url, agent, disposition, type, size) -> {
            if (!documents.offerBackup(Uri.parse(url))) tell("这个文件无法在片单内下载");
        });
    }

    private class Navigation extends WebViewClient {
        @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (isSite(uri)) {
                return request.isForMainFrame() && "GET".equals(request.getMethod()) && documents.offerBackup(uri);
            }
            if (request.isForMainFrame() && ("https".equals(uri.getScheme()) || "http".equals(uri.getScheme()))) {
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE));
                } catch (ActivityNotFoundException e) {
                    tell("请安装浏览器后打开播放链接");
                }
            }
            return true;
        }

        @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            if (request.isForMainFrame() && !isSite(request.getUrl())) {
                return new WebResourceResponse("text/plain", "UTF-8", new ByteArrayInputStream(new byte[0]));
            }
            return null;
        }

        @Override public void onPageStarted(WebView view, String url, Bitmap icon) {
            offline.setVisibility(View.GONE);
            web.setVisibility(View.VISIBLE);
            if (isSite(Uri.parse(url))) retryUrl = url;
        }
        @Override public void onPageFinished(WebView view, String url) {
            CookieManager.getInstance().flush();
        }
        @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame() && isSite(request.getUrl())) showRetry(request.getUrl());
        }
        @Override public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
            if (request.isForMainFrame() && response.getStatusCode() >= 500 && isSite(request.getUrl())) {
                showRetry(request.getUrl());
            }
        }
    }

    private void showRetry(Uri uri) {
        retryUrl = uri.toString();
        web.setVisibility(View.INVISIBLE);
        progress.setVisibility(View.GONE);
        offline.setVisibility(View.VISIBLE);
    }

    private LinearLayout offlinePanel() {
        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setGravity(Gravity.CENTER);
        panel.setPadding(dp(24), 0, dp(24), 0);
        panel.setVisibility(View.GONE);
        TextView message = new TextView(this);
        message.setText("暂时无法连接片单");
        message.setTextSize(20);
        panel.addView(message);
        Button retry = new Button(this);
        retry.setText("重新连接");
        retry.setOnClickListener(v -> web.loadUrl(retryUrl));
        LinearLayout.LayoutParams button = new LinearLayout.LayoutParams(-2, -2);
        button.topMargin = dp(16);
        panel.addView(retry, button);
        return panel;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private void insetSystemBars(FrameLayout root) {
        int flags = View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION;
        boolean light = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) != Configuration.UI_MODE_NIGHT_YES;
        if (light) flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
        getWindow().getDecorView().setSystemUiVisibility(flags);
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars()
                    | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                return WindowInsets.CONSUMED;
            }
            v.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets.consumeSystemWindowInsets();
        });
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        String invite = inviteUrl(intent);
        if (invite != null) {
            setIntent(intent);
            retryUrl = invite;
            if (web != null) web.loadUrl(invite);
        }
    }
    private void goBack() {
        if (web != null && web.canGoBack()) web.goBack();
        else finish();
    }
    @Override public void onBackPressed() { goBack(); }
    @Override protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        documents.save(out);
        if (web == null && "/join".equals(Uri.parse(retryUrl).getEncodedPath())) out.putString("pendingInvite", retryUrl);
    }
    @Override protected void onActivityResult(int code, int result, Intent data) {
        super.onActivityResult(code, result, data);
        documents.result(code, result == RESULT_OK && data != null ? data.getData() : null);
    }
    @Override protected void onPause() {
        super.onPause();
        if (web != null) CookieManager.getInstance().flush();
    }
    @Override protected void onDestroy() {
        documents.close();
        if (web != null) {
            web.stopLoading();
            ((ViewGroup) web.getParent()).removeView(web);
            web.destroy();
        }
        super.onDestroy();
    }
    void tell(String message) { Toast.makeText(this, message, Toast.LENGTH_LONG).show(); }
}
