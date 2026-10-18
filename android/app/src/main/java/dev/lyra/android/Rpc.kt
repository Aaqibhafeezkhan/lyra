package dev.lyra.android

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.net.Uri
import android.util.Base64
import android.webkit.WebView
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/**
 * The only door between the web UI and Android. It is restricted to Lyra's own page (a YouTube iframe on the
 * same screen cannot call it) and answers a small fixed set of methods; nothing here runs arbitrary code.
 */
class Rpc(private val activity: Activity, private val web: WebView) {
    private val io = Executors.newCachedThreadPool()
    private val listener = { pushState() }

    fun install() {
        check(WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) { "This WebView is too old for Lyra" }
        WebViewCompat.addWebMessageListener(web, "AndroidRpc", setOf(ASSET_ORIGIN)) { _, message, _, isMainFrame, reply ->
            if (isMainFrame) handle(message, reply)
        }
        MediaMonitor.addListener(listener)
        MediaMonitor.refresh(activity)
    }

    fun dispose() = MediaMonitor.removeListener(listener)

    /** Push the latest playback state to the page (main frame only, via evaluateJavascript). */
    fun pushState() {
        val snap = MediaMonitor.snapshotJson(activity)
        val status = MediaMonitor.statusJson(activity)
        web.post {
            web.evaluateJavascript(
                "window.__lyraNative&&window.__lyraNative.push(${JSONObject.quote(snap)},${JSONObject.quote(status)})",
                null
            )
        }
    }

    private fun handle(message: WebMessageCompat, reply: JavaScriptReplyProxy) {
        val text = message.data ?: return
        val req = try {
            JSONObject(text)
        } catch (_: Exception) {
            return
        }
        val id = req.optString("id")
        val args = req.optJSONArray("args") ?: JSONArray()
        fun ok(result: Any?) = reply.postMessage(JSONObject().put("id", id).put("ok", true).put("result", result ?: JSONObject.NULL).toString())
        fun fail(e: String) = reply.postMessage(JSONObject().put("id", id).put("ok", false).put("error", e).toString())

        when (req.optString("method")) {
            "snapshot" -> activity.runOnUiThread { ok(MediaMonitor.snapshotJson(activity)) }
            "status" -> activity.runOnUiThread { ok(MediaMonitor.statusJson(activity)) }
            "command" -> activity.runOnUiThread { ok(MediaMonitor.command(args.getString(0))) }
            "hasAccess" -> ok(MediaMonitor.hasAccess(activity))
            "refresh" -> {
                MediaMonitor.refresh(activity)
                ok(true)
            }
            "openAccessSettings" -> activity.runOnUiThread { MediaMonitor.openAccessSettings(activity); ok(true) }
            "openSpotify" -> activity.runOnUiThread { MediaMonitor.openSpotify(activity); ok(true) }
            "copy" -> activity.runOnUiThread {
                (activity.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("Lyra", args.getString(0)))
                ok(true)
            }
            "version" -> ok(activity.packageManager.getPackageInfo(activity.packageName, 0).versionName)
            "minimize" -> activity.runOnUiThread { activity.moveTaskToBack(true); ok(true) }
            "finish" -> activity.runOnUiThread { activity.finishAffinity(); ok(true) }
            "fetch" -> io.execute {
                try {
                    ok(fetch(args.getString(0), args.optJSONObject(1)))
                } catch (e: Exception) {
                    fail(e.message ?: "fetch failed")
                }
            }
            else -> fail("unknown method")
        }
    }

    /** HTTPS GET without browser CORS limits, so the shared core can call LRCLIB, Apple, YouTube from the phone. */
    private fun fetch(url: String, headers: JSONObject?): JSONObject {
        val u = URL(url)
        require(u.protocol == "https") { "https only" }
        val c = u.openConnection() as HttpURLConnection
        c.connectTimeout = 12_000
        c.readTimeout = 20_000
        c.setRequestProperty("User-Agent", "Lyra-Android")
        headers?.keys()?.forEach { k -> c.setRequestProperty(k, headers.getString(k)) }
        val status = c.responseCode
        val stream = if (status >= 400) c.errorStream else c.inputStream
        val body = stream?.use { it.readBytes() } ?: ByteArray(0)
        require(body.size <= 12 * 1024 * 1024) { "response too large" }
        val h = JSONObject()
        c.headerFields.forEach { (k, v) -> if (k != null && v.isNotEmpty()) h.put(k.lowercase(), v.last()) }
        return JSONObject().put("status", status).put("headers", h).put("body", Base64.encodeToString(body, Base64.NO_WRAP))
    }

    companion object {
        const val ASSET_ORIGIN = "https://appassets.androidplatform.net"
        fun isLyraPage(uri: Uri): Boolean = "${uri.scheme}://${uri.host}" == ASSET_ORIGIN
    }
}
