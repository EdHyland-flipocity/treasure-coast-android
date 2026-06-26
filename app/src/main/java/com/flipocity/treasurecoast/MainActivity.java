package com.flipocity.treasurecoast;

import android.annotation.SuppressLint;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.appcompat.app.AppCompatActivity;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends AppCompatActivity {

    private static final String TAG = "TreasureCoast";
    private WebView webView;
    private SQLiteDatabase db;
    private ExecutorService executor = Executors.newFixedThreadPool(4);
    private Handler mainHandler = new Handler(Looper.getMainLooper());

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Edge to edge
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN,
                WindowManager.LayoutParams.FLAG_FULLSCREEN);
        getWindow().getDecorView().setSystemUiVisibility(
            android.view.View.SYSTEM_UI_FLAG_LAYOUT_STABLE |
            android.view.View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);

        setContentView(R.layout.activity_main);

        webView = findViewById(R.id.webView);

        // WebView settings
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
            public boolean onConsoleMessage(android.webkit.ConsoleMessage cm) {
                Log.d(TAG, "JS: " + cm.message());
                return true;
            }
        });
        webView.addJavascriptInterface(new DBInterface(), "AndroidDB");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return false;
            }
        });

        // Copy and open database, then load app
        executor.execute(() -> {
            copyDatabase();
            openDatabase();
            mainHandler.post(() -> webView.loadUrl("file:///android_asset/www/index.html"));
        });
    }

    private void copyDatabase() {
        File dbFile = new File(getFilesDir(), "treasure_coast.db");
        if (dbFile.exists() && dbFile.length() > 1000000) {
            Log.d(TAG, "Database already exists: " + dbFile.length() + " bytes");
            return;
        }
        Log.d(TAG, "Copying database from assets...");
        try {
            InputStream in = getAssets().open("db/treasure_coast.db");
            OutputStream out = new FileOutputStream(dbFile);
            byte[] buf = new byte[65536];
            int len;
            while ((len = in.read(buf)) > 0) out.write(buf, 0, len);
            in.close();
            out.close();
            Log.d(TAG, "Database copied: " + dbFile.length() + " bytes");
        } catch (Exception e) {
            Log.e(TAG, "Error copying database", e);
        }
    }

    private void openDatabase() {
        File dbFile = new File(getFilesDir(), "treasure_coast.db");
        db = SQLiteDatabase.openDatabase(dbFile.getPath(), null, SQLiteDatabase.OPEN_READONLY);
        Log.d(TAG, "Database opened");
    }

    // JavaScript interface — all DB queries go through here
    public class DBInterface {

        @JavascriptInterface
        public String query(String sql, String paramsJson) {
            try {
                JSONArray params = new JSONArray(paramsJson);
                String[] args = new String[params.length()];
                for (int i = 0; i < params.length(); i++) {
                    args[i] = params.getString(i);
                }

                Cursor cursor = db.rawQuery(sql, args);
                JSONArray result = new JSONArray();

                String[] cols = cursor.getColumnNames();
                while (cursor.moveToNext()) {
                    JSONObject row = new JSONObject();
                    for (int i = 0; i < cols.length; i++) {
                        if (cursor.isNull(i)) {
                            row.put(cols[i], JSONObject.NULL);
                        } else {
                            row.put(cols[i], cursor.getString(i));
                        }
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
            try {
                JSONArray params = new JSONArray(paramsJson);
                String[] args = new String[params.length()];
                for (int i = 0; i < params.length(); i++) {
                    args[i] = params.getString(i);
                }

                Cursor cursor = db.rawQuery(sql, args);
                if (cursor.moveToFirst()) {
                    JSONObject row = new JSONObject();
                    String[] cols = cursor.getColumnNames();
                    for (int i = 0; i < cols.length; i++) {
                        if (cursor.isNull(i)) {
                            row.put(cols[i], JSONObject.NULL);
                        } else {
                            row.put(cols[i], cursor.getString(i));
                        }
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
        public String getAppVersion() {
            return "1.0";
        }

        @JavascriptInterface
        public String getDbInfo() {
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
            } catch (Exception e) {
                return "{}";
            }
        }
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        if (db != null && db.isOpen()) db.close();
        executor.shutdown();
        super.onDestroy();
    }
}
