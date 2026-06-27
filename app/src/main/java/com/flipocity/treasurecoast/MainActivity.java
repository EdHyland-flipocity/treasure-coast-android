package com.flipocity.treasurecoast;

import android.annotation.SuppressLint;
import android.content.Intent;
import android.app.AlertDialog;
import android.content.Context;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.ProgressBar;
import android.widget.TextView;
import androidx.appcompat.app.AppCompatActivity;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends AppCompatActivity {

    private static final String TAG = "TreasureCoast";
    private static final String DB_URL = "https://github.com/EdHyland-flipocity/treasure-coast-android/releases/latest/download/treasure_coast.db";
    private static final String PREFS_NAME = "FlipocityPrefs";
    private static final String PREF_DB_DATE = "db_downloaded_date";
    private static final String PREF_SHOW_SUPPORT = "show_support_card";
    private static final long ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000L;

    private WebView webView;
    private SQLiteDatabase db;
    private ExecutorService executor = Executors.newFixedThreadPool(4);
    private Handler mainHandler = new Handler(Looper.getMainLooper());
    private SharedPreferences prefs;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN,
                WindowManager.LayoutParams.FLAG_FULLSCREEN);
        getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE |
            View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION |
            View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
            getWindow().setDecorFitsSystemWindows(false);
        }

        setContentView(R.layout.activity_main);

        prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        webView = findViewById(R.id.webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setAllowFileAccessFromFileURLs(true);
        settings.setAllowUniversalAccessFromFileURLs(true);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage cm) {
                Log.d(TAG, "JS: " + cm.message());
                return true;
            }
        });
        webView.addJavascriptInterface(new DBInterface(), "AndroidDB");
        WebView.setWebContentsDebuggingEnabled(true);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return false;
            }
        });

        executor.execute(() -> {
            initializeDatabase();
        });
    }

    private void initializeDatabase() {
        File dbFile = getDbFile();
        boolean needsDownload = !dbFile.exists() || dbFile.length() < 1000000;
        boolean needsUpdate   = !needsDownload && shouldCheckForUpdate();

        if (needsDownload) {
            Log.d(TAG, "No local DB — downloading from GitHub...");
            showSplashMessage("Downloading database...\nFirst launch may take 1-2 minutes on WiFi");
            downloadDatabase(dbFile, true);
        } else {
            openDatabase(dbFile);
            mainHandler.post(() -> {
                webView.loadUrl("file:///android_asset/www/index.html");
                if (needsUpdate) {
                    checkForUpdateInBackground(dbFile);
                }
                // Show support card occasionally
                if (shouldShowSupportCard()) {
                    mainHandler.postDelayed(() -> showSupportCard(), 3000);
                }
            });
        }
    }

    private File getDbFile() {
        return new File(getFilesDir(), "treasure_coast.db");
    }

    private boolean shouldCheckForUpdate() {
        long lastCheck = prefs.getLong(PREF_DB_DATE, 0);
        return System.currentTimeMillis() - lastCheck > ONE_WEEK_MS;
    }

    private boolean shouldShowSupportCard() {
        // Show support card every 7th app open
        int opens = prefs.getInt("app_opens", 0) + 1;
        prefs.edit().putInt("app_opens", opens).apply();
        return opens % 7 == 0;
    }

    private void showSplashMessage(String msg) {
        mainHandler.post(() -> {
            TextView tv = findViewById(R.id.splashText);
            if (tv != null) {
                tv.setVisibility(View.VISIBLE);
                tv.setText(msg);
            }
        });
    }

    private void downloadDatabase(File dbFile, boolean showInApp) {
        try {
            URL url = new URL(DB_URL);
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setInstanceFollowRedirects(true);
            conn.setConnectTimeout(30000);
            conn.setReadTimeout(120000);
            conn.connect();

            int responseCode = conn.getResponseCode();
            Log.d(TAG, "Download response: " + responseCode);

            if (responseCode == HttpURLConnection.HTTP_OK ||
                responseCode == HttpURLConnection.HTTP_MOVED_TEMP ||
                responseCode == HttpURLConnection.HTTP_MOVED_PERM) {

                // Follow redirects manually if needed
                String redirectUrl = conn.getHeaderField("Location");
                if (redirectUrl != null) {
                    conn.disconnect();
                    conn = (HttpURLConnection) new URL(redirectUrl).openConnection();
                    conn.setConnectTimeout(30000);
                    conn.setReadTimeout(120000);
                    conn.connect();
                }

                int contentLength = conn.getContentLength();
                Log.d(TAG, "Content length: " + contentLength);

                File tempFile = new File(getFilesDir(), "treasure_coast_tmp.db");
                InputStream in  = conn.getInputStream();
                OutputStream out = new FileOutputStream(tempFile);

                byte[] buf = new byte[65536];
                int len;
                long downloaded = 0;
                while ((len = in.read(buf)) > 0) {
                    out.write(buf, 0, len);
                    downloaded += len;
                    if (contentLength > 0) {
                        final int pct = (int)(downloaded * 100 / contentLength);
                        showSplashMessage("Downloading database...\n" + pct + "% (" +
                            (downloaded/1024/1024) + " MB / " +
                            (contentLength/1024/1024) + " MB)");
                    }
                }
                in.close();
                out.close();
                conn.disconnect();

                // Replace old DB with new
                if (dbFile.exists()) dbFile.delete();
                tempFile.renameTo(dbFile);

                // Save download date
                prefs.edit().putLong(PREF_DB_DATE, System.currentTimeMillis()).apply();
                Log.d(TAG, "Database downloaded: " + dbFile.length() + " bytes");

                openDatabase(dbFile);
                mainHandler.post(() -> {
                    hideSplash();
                    webView.loadUrl("file:///android_asset/www/index.html");
                    if (shouldShowSupportCard()) {
                        mainHandler.postDelayed(() -> showSupportCard(), 3000);
                    }
                });

            } else {
                Log.e(TAG, "Download failed: HTTP " + responseCode);
                // Fall back to bundled DB if available
                fallbackToBundledDb(dbFile);
            }

        } catch (Exception e) {
            Log.e(TAG, "Download error: " + e.getMessage());
            fallbackToBundledDb(dbFile);
        }
    }

    private void fallbackToBundledDb(File dbFile) {
        Log.d(TAG, "Falling back to bundled database...");
        showSplashMessage("No internet connection.\nLoading bundled database...");
        try {
            InputStream in  = getAssets().open("db/treasure_coast.db");
            OutputStream out = new FileOutputStream(dbFile);
            byte[] buf = new byte[65536];
            int len;
            while ((len = in.read(buf)) > 0) out.write(buf, 0, len);
            in.close();
            out.close();
            Log.d(TAG, "Bundled DB copied: " + dbFile.length() + " bytes");
        } catch (Exception e2) {
            Log.e(TAG, "Bundled DB copy failed: " + e2.getMessage());
        }
        openDatabase(dbFile);
        mainHandler.post(() -> {
            hideSplash();
            webView.loadUrl("file:///android_asset/www/index.html");
        });
    }

    private void checkForUpdateInBackground(File dbFile) {
        executor.execute(() -> {
            Log.d(TAG, "Checking for DB update in background...");
            try {
                URL url = new URL(DB_URL);
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("HEAD");
                conn.setInstanceFollowRedirects(true);
                conn.setConnectTimeout(10000);
                conn.connect();
                long remoteSize = conn.getContentLengthLong();
                conn.disconnect();
                long localSize = dbFile.length();
                Log.d(TAG, "Remote size: " + remoteSize + " Local size: " + localSize);
                if (remoteSize > 0 && remoteSize != localSize) {
                    Log.d(TAG, "Update available — downloading in background");
                    mainHandler.post(() -> showUpdateBanner());
                } else {
                    prefs.edit().putLong(PREF_DB_DATE, System.currentTimeMillis()).apply();
                }
            } catch (Exception e) {
                Log.d(TAG, "Update check failed: " + e.getMessage());
            }
        });
    }

    private void openDatabase(File dbFile) {
        if (dbFile.exists() && dbFile.length() > 0) {
            db = SQLiteDatabase.openDatabase(dbFile.getPath(), null, SQLiteDatabase.OPEN_READONLY);
            Log.d(TAG, "Database opened: " + dbFile.length() + " bytes");
        } else {
            Log.e(TAG, "Database file missing or empty");
        }
    }

    private void hideSplash() {
        View splash = findViewById(R.id.splashOverlay);
        if (splash != null) splash.setVisibility(View.GONE);
    }

    private void showUpdateBanner() {
        mainHandler.post(() -> {
            new AlertDialog.Builder(this)
                .setTitle("Database Update Available")
                .setMessage("A fresh weekly database update is available. Download now for the latest data?\n\nThis requires a WiFi connection and takes 1-2 minutes.")
                .setPositiveButton("Update Now", (d, w) -> {
                    executor.execute(() -> downloadDatabase(getDbFile(), true));
                })
                .setNegativeButton("Later", null)
                .show();
        });
    }

    private void showSupportCard() {
        new AlertDialog.Builder(this)
            .setTitle("Support Flipocity Analytics")
            .setMessage("Treasure Coast Intelligence is free and open source.\n\nIf this app saves you time or helps you find deals, consider supporting development for $1/month on Patreon. Every contribution helps keep the data fresh and the platform growing.\n\nNo obligation — the app is always free.")
            .setPositiveButton("Support on Patreon", (d, w) -> {
                Intent intent = new Intent(Intent.ACTION_VIEW,
                    android.net.Uri.parse("https://www.patreon.com/flipocityanalytics"));
                startActivity(intent);
            })
            .setNegativeButton("Maybe Later", null)
            .show();
    }

    // JavaScript interface
    public class DBInterface {

        @JavascriptInterface
        public String query(String sql, String paramsJson) {
            if (db == null) return "[]";
            try {
                JSONArray params = new JSONArray(paramsJson);
                String[] args = new String[params.length()];
                for (int i = 0; i < params.length(); i++) args[i] = params.getString(i);

                Cursor cursor = db.rawQuery(sql, args);
                JSONArray result = new JSONArray();
                String[] cols = cursor.getColumnNames();
                while (cursor.moveToNext()) {
                    JSONObject row = new JSONObject();
                    for (int i = 0; i < cols.length; i++) {
                        row.put(cols[i], cursor.isNull(i) ? JSONObject.NULL : cursor.getString(i));
                    }
                    result.put(row);
                }
                cursor.close();
                return result.toString();
            } catch (Exception e) {
                Log.e(TAG, "Query error: " + sql, e);
                return "[]";
            }
        }

        @JavascriptInterface
        public String queryOne(String sql, String paramsJson) {
            if (db == null) return "{}";
            try {
                JSONArray params = new JSONArray(paramsJson);
                String[] args = new String[params.length()];
                for (int i = 0; i < params.length(); i++) args[i] = params.getString(i);

                Cursor cursor = db.rawQuery(sql, args);
                if (cursor.moveToFirst()) {
                    JSONObject row = new JSONObject();
                    String[] cols = cursor.getColumnNames();
                    for (int i = 0; i < cols.length; i++) {
                        row.put(cols[i], cursor.isNull(i) ? JSONObject.NULL : cursor.getString(i));
                    }
                    cursor.close();
                    return row.toString();
                }
                cursor.close();
                return "{}";
            } catch (Exception e) {
                Log.e(TAG, "QueryOne error: " + sql, e);
                return "{}";
            }
        }

        @JavascriptInterface
        public String getDbInfo() {
            if (db == null) return "{}";
            try {
                JSONObject info = new JSONObject();
                String[] tables = {"stluciecty_singleFamily", "martin_transfers",
                        "martin_flip_pairs", "entity_intelligence"};
                for (String table : tables) {
                    Cursor c = db.rawQuery("SELECT COUNT(*) FROM \"" + table + "\"", null);
                    if (c.moveToFirst()) info.put(table, c.getInt(0));
                    c.close();
                }
                return info.toString();
            } catch (Exception e) { return "{}"; }
        }

        @JavascriptInterface
        public String getDbDate() {
            long ts = prefs.getLong(PREF_DB_DATE, 0);
            if (ts == 0) return "Bundled";
            return new SimpleDateFormat("MMM dd, yyyy", Locale.US).format(new Date(ts));
        }
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (db != null && db.isOpen()) db.close();
        executor.shutdown();
        super.onDestroy();
    }
}
