package app.navcom;

import android.os.Bundle;
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
 */
public class MainActivity extends BridgeActivity {

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
            }
        );
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

    private static WebResourceResponse notFound() {
        return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", Collections.emptyMap(), new java.io.ByteArrayInputStream(new byte[0]));
    }
}
