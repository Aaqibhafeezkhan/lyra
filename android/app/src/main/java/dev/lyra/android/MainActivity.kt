package dev.lyra.android

import android.annotation.SuppressLint
import android.content.pm.ApplicationInfo
import android.graphics.Color
import android.os.Bundle
import android.util.Base64
import android.view.ViewGroup
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat
import java.net.HttpURLConnection
import java.net.URL

/** Hosts Lyra's web UI. All data comes through [Rpc]; the UI itself is the same React app as on Windows. */
class MainActivity : ComponentActivity() {
    private var web: WebView? = null
    private var rpc: Rpc? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        if (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0) WebView.setWebContentsDebuggingEnabled(true)

        val root = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
        val view = WebView(this).apply {
            setBackgroundColor(Color.BLACK)
            layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        }
        root.addView(view)
        setContentView(root)
        ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
            val b = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            v.setPadding(b.left, b.top, b.right, b.bottom)
            insets
        }

        val assets = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()
        view.webViewClient = object : WebViewClientCompat() {
            override fun shouldInterceptRequest(v: WebView, request: WebResourceRequest): WebResourceResponse? {
                val path = request.url.path ?: ""
                if (Rpc.isLyraPage(request.url) && path.startsWith("/preview/")) return previewProxy(path.removePrefix("/preview/"), request)
                return assets.shouldInterceptRequest(request.url)
            }

            // Only Lyra's own page may load as the top-level document; links to other sites are not followed.
            override fun shouldOverrideUrlLoading(v: WebView, request: WebResourceRequest): Boolean = !Rpc.isLyraPage(request.url)
        }

        rpc = Rpc(this, view).also { it.install() }
        web = view
        view.loadUrl("${Rpc.ASSET_ORIGIN}/assets/ui/android.html")

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                // Let the UI close a panel / leave full screen first; if it has nothing to close, send the app to the background.
                view.evaluateJavascript("window.__lyraNative ? window.__lyraNative.back() : false") { r ->
                    if (r != "true") moveTaskToBack(true)
                }
            }
        })
    }

    override fun onResume() {
        super.onResume()
        MediaMonitor.refresh(this) // e.g. coming back from the notification-access settings screen
        rpc?.pushState()
    }

    override fun onDestroy() {
        rpc?.dispose()
        web?.destroy()
        super.onDestroy()
    }

    /**
     * Streams an Apple preview clip through Lyra's own origin so the page can read its frames (brightness, black
     * bars). Only Apple's preview hosts are allowed, nothing is stored, and HTTP Range works for seeking.
     */
    private fun previewProxy(encoded: String, request: WebResourceRequest): WebResourceResponse? {
        return try {
            val target = String(Base64.decode(encoded, Base64.URL_SAFE or Base64.NO_WRAP))
            if (!Regex("^https://[a-z0-9-]+\\.itunes\\.apple\\.com/", RegexOption.IGNORE_CASE).containsMatchIn(target)) {
                return WebResourceResponse("text/plain", "utf-8", 403, "Forbidden", emptyMap(), "forbidden".byteInputStream())
            }
            val c = URL(target).openConnection() as HttpURLConnection
            c.connectTimeout = 12_000
            c.readTimeout = 20_000
            request.requestHeaders["Range"]?.let { c.setRequestProperty("Range", it) }
            val code = c.responseCode
            val headers = mutableMapOf("Access-Control-Allow-Origin" to Rpc.ASSET_ORIGIN, "Accept-Ranges" to "bytes")
            c.getHeaderField("Content-Range")?.let { headers["Content-Range"] = it }
            c.getHeaderField("Content-Length")?.let { headers["Content-Length"] = it }
            WebResourceResponse(c.contentType?.substringBefore(';') ?: "video/mp4", null, code, if (code == 206) "Partial Content" else "OK", headers, c.inputStream)
        } catch (e: Exception) {
            WebResourceResponse("text/plain", "utf-8", 502, "Bad Gateway", emptyMap(), (e.message ?: "error").byteInputStream())
        }
    }
}
