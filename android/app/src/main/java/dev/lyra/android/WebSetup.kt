package dev.lyra.android

import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.ApplicationInfo
import android.graphics.Color
import android.util.Base64
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat
import java.net.HttpURLConnection
import java.net.URL

/** Shared by the app screen and the floating widget: both run the same Lyra web UI in a locked-down WebView. */
object WebSetup {
    @SuppressLint("SetJavaScriptEnabled")
    fun configure(web: LyraWebView, ctx: Context, transparent: Boolean = false) {
        if (ctx.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0) WebView.setWebContentsDebuggingEnabled(true)
        web.setBackgroundColor(if (transparent) Color.TRANSPARENT else Color.BLACK)
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.settings.mediaPlaybackRequiresUserGesture = false
        web.settings.allowFileAccess = false
        web.settings.allowContentAccess = false
        web.settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW

        val assets = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(ctx))
            .build()
        web.webViewClient = object : WebViewClientCompat() {
            override fun shouldInterceptRequest(v: WebView, request: WebResourceRequest): WebResourceResponse? {
                val path = request.url.path ?: ""
                if (Rpc.isLyraPage(request.url) && path.startsWith("/preview/")) return previewProxy(path.removePrefix("/preview/"), request)
                if (Rpc.isLyraPage(request.url) && path.startsWith("/bg/")) return MediaFiles.serve(ctx, path.removePrefix("/bg/"), request)
                return assets.shouldInterceptRequest(request.url)
            }

            // Only Lyra's own page may load as the top-level document; links to other sites are not followed.
            override fun shouldOverrideUrlLoading(v: WebView, request: WebResourceRequest): Boolean = !Rpc.isLyraPage(request.url)
        }
    }

    fun load(web: WebView, query: String = "") {
        web.loadUrl("${Rpc.ASSET_ORIGIN}/assets/ui/android.html$query")
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
