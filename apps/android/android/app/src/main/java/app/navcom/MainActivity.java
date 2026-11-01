package app.navcom;

import android.os.Bundle;
import android.webkit.ServiceWorkerClient;
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
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        final PrerenderedPages pages = new PrerenderedPages(this, bridge);
        bridge.setWebViewClient(
            new BridgeWebViewClient(bridge) {
                @Override
                public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                    return bridge.getLocalServer().shouldInterceptRequest(pages.resolve(request));
                }
            }
        );
        ServiceWorkerController.getInstance().setServiceWorkerClient(
            new ServiceWorkerClient() {
                @Override
                public WebResourceResponse shouldInterceptRequest(WebResourceRequest request) {
                    return bridge.getLocalServer().shouldInterceptRequest(pages.resolve(request));
                }
            }
        );
    }
}
