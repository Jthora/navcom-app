package app.navcom;

import android.content.Context;
import android.net.Uri;
import android.webkit.WebResourceRequest;
import com.getcapacitor.Bridge;
import java.io.IOException;
import java.io.InputStream;
import java.util.Map;

/**
 * Each prerendered page by its own file: a request for `/terminal/` or `/terminal` becomes one for
 * `/terminal/index.html` when the bundle holds that file, and is left as it was otherwise, so a path
 * the build has no page for still opens the app at its root.
 */
final class PrerenderedPages {

    private final Context context;
    private final Bridge bridge;

    PrerenderedPages(Context context, Bridge bridge) {
        this.context = context;
        this.bridge = bridge;
    }

    /** The site's service worker script, which the app never runs [MainActivity]. */
    static boolean isServiceWorker(WebResourceRequest request) {
        return "/service-worker.js".equals(request.getUrl().getPath());
    }

    WebResourceRequest resolve(WebResourceRequest request) {
        Uri url = request.getUrl();
        String path = url.getPath();
        String last = url.getLastPathSegment();
        if (!bridge.getHost().equals(url.getHost()) || path == null || path.equals("/") || (last != null && last.contains("."))) {
            return request;
        }
        String page = (path.endsWith("/") ? path : path + "/") + "index.html";
        if (!bundled(page)) return request;
        return new Rewritten(request, url.buildUpon().path(page).build());
    }

    /** Whether the bundle holds `page`, under the folder Capacitor copies the build into. */
    private boolean bundled(String page) {
        try (InputStream in = context.getAssets().open("public" + page)) {
            return true;
        } catch (IOException e) {
            return false;
        }
    }

    /** The same request, for another address. */
    private static final class Rewritten implements WebResourceRequest {

        private final WebResourceRequest original;
        private final Uri url;

        Rewritten(WebResourceRequest original, Uri url) {
            this.original = original;
            this.url = url;
        }

        @Override
        public Uri getUrl() {
            return url;
        }

        @Override
        public boolean isForMainFrame() {
            return original.isForMainFrame();
        }

        @Override
        public boolean isRedirect() {
            return original.isRedirect();
        }

        @Override
        public boolean hasGesture() {
            return original.hasGesture();
        }

        @Override
        public String getMethod() {
            return original.getMethod();
        }

        @Override
        public Map<String, String> getRequestHeaders() {
            return original.getRequestHeaders();
        }
    }
}
