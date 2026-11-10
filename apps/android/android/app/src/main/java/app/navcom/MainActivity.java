package app.navcom;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;
import androidx.activity.OnBackPressedCallback;
import androidx.core.content.ContextCompat;
import android.webkit.ServiceWorkerClient;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import java.util.Collections;
import android.webkit.ServiceWorkerController;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

/**
 * NavCom, served from the device: the site's own static build, bundled by Capacitor.
 *
 * One thing differs from Capacitor's default. Its on-device server answers any path without a file
 * extension with the root `index.html`, as a single-page app wants. NavCom's pages are prerendered,
 * each its own `index.html` — `/terminal/` is `terminal/index.html` — so that default opened the
 * landing page wherever a page was loaded whole: a reload, a link that reloads, a page the service
 * worker fetches. {@link PrerenderedPages} asks for the page's own file first, for the page and for
 * its service worker alike.
 *
 * **And no service worker.** The site registers one to keep itself for offline use; inside the app
 * its files are already on the device, and a worker's cache outlived an update, serving the previous
 * build over the one just installed. So the worker's script answers 404, registering it is refused,
 * and one left by an earlier install is removed with its caches before the page reloads, once.
 * Storage, the profile with it, is not touched.
 *
 * **Distress from the lock screen** (2026-11-04): the Quick Settings tile ({@link DistressTile}) and
 * the icon's shortcut open this activity with {@link #ACTION_DISTRESS}, on the Distress screen and
 * shown over the lock screen, so a locked phone reaches it without the code. Over the lock it is that
 * screen and nothing else: opening anything else puts the app back behind the lock, and unlocking
 * ends the exemption. It opens the screen; the hold sends, as everywhere.
 *
 * **The system back steps back through the page** (2026-11-10), as it does in a browser: out of Com,
 * a screen at a time, and off the page it came from. Capacitor's core leaves back to the activity,
 * which closed the app from wherever it was, Com open over the map among them. With nothing left to
 * step back to, it leaves the app as any other app does. Over the lock, a step back off the Distress
 * screen puts the app behind the lock, like opening anything else there.
 */
public class MainActivity extends BridgeActivity {

    /** Opens on the Distress screen, over the lock screen. */
    public static final String ACTION_DISTRESS = "app.navcom.DISTRESS";
    private static final String DISTRESS_PATH = "/terminal/distress/";

    /** Shown over the lock screen, for the Distress screen only. */
    private boolean overLock = false;
    /** Unlocking ends it: from then on this is an app like any other. */
    private final BroadcastReceiver unlocked = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            showOverLock(false);
        }
    };

    /** Refuses a registration, and removes a worker and its caches left by an earlier install. */
    private static final String NO_SERVICE_WORKER =
        "(function(){var w=navigator.serviceWorker;if(!w)return;" +
        "try{w.register=function(){return Promise.reject(new Error('no service worker in the app'))}}catch(e){}" +
        "w.getRegistrations().then(function(rs){if(!rs.length)return;" +
        "return Promise.all(rs.map(function(r){return r.unregister()}))" +
        ".then(function(){return caches.keys()})" +
        ".then(function(ks){return Promise.all(ks.map(function(k){return caches.delete(k)}))})" +
        ".then(function(){location.reload()})}).catch(function(){})})();";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Declared over the lock in the manifest, since a locked phone's tile can open nothing that is
        // not; turned off here, before anything is drawn, for every launch that is not a Distress.
        showOverLock(getIntent() != null && ACTION_DISTRESS.equals(getIntent().getAction()));
        super.onCreate(savedInstanceState);
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            WebViewCompat.addDocumentStartJavaScript(bridge.getWebView(), NO_SERVICE_WORKER, Collections.singleton("*"));
        }
        final PrerenderedPages pages = new PrerenderedPages(this, bridge);
        bridge.setWebViewClient(
            new BridgeWebViewClient(bridge) {
                @Override
                public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                    if (PrerenderedPages.isServiceWorker(request)) return notFound();
                    return bridge.getLocalServer().shouldInterceptRequest(pages.resolve(request));
                }

                /** Every page change, a client-side one too: off the Distress screen, back behind the lock. */
                @Override
                public void doUpdateVisitedHistory(WebView view, String url, boolean isReload) {
                    super.doUpdateVisitedHistory(view, url, isReload);
                    if (overLock && !onDistress(url)) showOverLock(false);
                }
            }
        );
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                final WebView view = bridge.getWebView();
                if (view.canGoBack()) {
                    view.goBack();
                    return;
                }
                setEnabled(false);
                getOnBackPressedDispatcher().onBackPressed();
                setEnabled(true);
            }
        });
        ContextCompat.registerReceiver(this, unlocked, new IntentFilter(Intent.ACTION_USER_PRESENT), ContextCompat.RECEIVER_NOT_EXPORTED);
        openDistress(getIntent());
        ServiceWorkerController.getInstance().setServiceWorkerClient(
            new ServiceWorkerClient() {
                @Override
                public WebResourceResponse shouldInterceptRequest(WebResourceRequest request) {
                    if (PrerenderedPages.isServiceWorker(request)) return notFound();
                    return bridge.getLocalServer().shouldInterceptRequest(pages.resolve(request));
                }
            }
        );
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        openDistress(intent);
    }

    @Override
    public void onDestroy() {
        try {
            unregisterReceiver(unlocked);
        } catch (IllegalArgumentException ignored) {
            // Never registered: nothing to undo.
        }
        super.onDestroy();
    }

    /**
     * Opened by the tile or the shortcut: the Distress screen, over the lock. A Distress already on the
     * screen is left as it is, never reloaded, so a second tap cannot restart one that is sending.
     */
    private void openDistress(Intent intent) {
        if (intent == null || !ACTION_DISTRESS.equals(intent.getAction())) return;
        showOverLock(true);
        final WebView view = bridge.getWebView();
        view.post(() -> {
            if (!onDistress(view.getUrl())) view.loadUrl(bridge.getLocalUrl() + DISTRESS_PATH);
        });
    }

    private static boolean onDistress(String url) {
        if (url == null) return false;
        String path = Uri.parse(url).getPath();
        return path != null && path.startsWith(DISTRESS_PATH.substring(0, DISTRESS_PATH.length() - 1));
    }

    @SuppressWarnings("deprecation")
    private void showOverLock(boolean on) {
        overLock = on;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(on);
            setTurnScreenOn(on);
        } else if (on) {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        } else {
            getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        }
    }

    private static WebResourceResponse notFound() {
        return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", Collections.emptyMap(), new java.io.ByteArrayInputStream(new byte[0]));
    }
}
