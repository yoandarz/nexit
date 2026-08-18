package com.nexit.app;

import android.Manifest;
import android.app.Activity;
import android.app.AlarmManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

public class MainActivity extends Activity {
    private static final String NEXIT_URL = "https://yoandarz.github.io/nexit/";
    private static final String NEXIT_HOST = "yoandarz.github.io";
    private static final int REQ_NOTIFICATIONS = 310;
    private static final int STATUS_COLOR = Color.rgb(16, 34, 61);
    private static final int NAV_COLOR = Color.rgb(7, 26, 51);

    private WebView webView;
    private FrameLayout root;
    private View statusBarScrim;

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(NAV_COLOR);

        root = new FrameLayout(this);
        root.setBackgroundColor(NAV_COLOR);

        webView = new WebView(this);
        FrameLayout.LayoutParams webParams = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        );
        root.addView(webView, webParams);

        statusBarScrim = new View(this);
        statusBarScrim.setBackgroundColor(STATUS_COLOR);
        FrameLayout.LayoutParams scrimParams = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            0,
            Gravity.TOP
        );
        root.addView(statusBarScrim, scrimParams);

        setContentView(root);
        configureSystemBars();
        configureWebView();
        loadRequestedUrl(getIntent());
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        loadRequestedUrl(intent);
    }

    private void configureSystemBars() {
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), root);
        controller.setAppearanceLightStatusBars(false);
        controller.setAppearanceLightNavigationBars(false);

        ViewCompat.setOnApplyWindowInsetsListener(root, (view, windowInsets) -> {
            Insets bars = windowInsets.getInsets(
                WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
            );

            FrameLayout.LayoutParams webLp = (FrameLayout.LayoutParams) webView.getLayoutParams();
            webLp.topMargin = bars.top;
            webLp.bottomMargin = bars.bottom;
            webView.setLayoutParams(webLp);

            FrameLayout.LayoutParams scrimLp = (FrameLayout.LayoutParams) statusBarScrim.getLayoutParams();
            scrimLp.height = bars.top;
            statusBarScrim.setLayoutParams(scrimLp);

            return windowInsets;
        });
        ViewCompat.requestApplyInsets(root);
    }

    private void loadRequestedUrl(Intent intent) {
        String day = intent == null ? null : intent.getStringExtra("reminderDay");
        webView.loadUrl(day == null || day.isEmpty() ? NEXIT_URL : NEXIT_URL + "?reminder=" + Uri.encode(day));
    }

    private void configureWebView() {
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        if (Build.VERSION.SDK_INT >= 26) s.setSafeBrowsingEnabled(true);

        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if ("https".equalsIgnoreCase(u.getScheme()) && NEXIT_HOST.equalsIgnoreCase(u.getHost())) return false;
                startActivity(new Intent(Intent.ACTION_VIEW, u));
                return true;
            }

            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) {
                Uri u = Uri.parse(url);
                if ("https".equalsIgnoreCase(u.getScheme()) && NEXIT_HOST.equalsIgnoreCase(u.getHost())) return false;
                startActivity(new Intent(Intent.ACTION_VIEW, u));
                return true;
            }
        });
        webView.addJavascriptInterface(new NativeBridge(this), "NexitNativeAndroid");
    }

    @Override protected void onResume() {
        super.onResume();
        String json = getSharedPreferences("nexit", MODE_PRIVATE).getString("state", "");
        if (!json.isEmpty()) AlarmScheduler.scheduleAll(this, json);
    }

    @Override public void onBackPressed() {
        if (webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    private boolean notificationsAllowed() {
        return Build.VERSION.SDK_INT < 33 || checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
    }

    private boolean exactAllowed() {
        AlarmManager am = (AlarmManager) getSystemService(ALARM_SERVICE);
        return Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms();
    }

    private void requestAlarmPermissions() {
        if (Build.VERSION.SDK_INT >= 33 && !notificationsAllowed()) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIFICATIONS);
            return;
        }
        if (Build.VERSION.SDK_INT >= 31 && !exactAllowed()) {
            startActivity(new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:" + getPackageName())));
            return;
        }
        Toast.makeText(this, "Alarmas locales activadas en Android.", Toast.LENGTH_SHORT).show();
    }

    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_NOTIFICATIONS) requestAlarmPermissions();
    }

    public static class NativeBridge {
        private final MainActivity activity;
        NativeBridge(MainActivity a) { activity = a; }

        @JavascriptInterface public String syncState(String json) {
            try {
                activity.getSharedPreferences("nexit", Context.MODE_PRIVATE).edit().putString("state", json).apply();
                AlarmScheduler.Result r = AlarmScheduler.scheduleAll(activity, json);
                return r.error.isEmpty() ? "ok" : "error:" + r.error;
            } catch (Exception e) {
                return "error:" + e.getClass().getSimpleName();
            }
        }

        @JavascriptInterface public void requestAlarmPermissions() {
            activity.runOnUiThread(activity::requestAlarmPermissions);
        }

        @JavascriptInterface public String testAlarm60s() {
            return AlarmScheduler.scheduleDiagnostic(activity, 60000L) ? "ok" : "error";
        }
    }
}
