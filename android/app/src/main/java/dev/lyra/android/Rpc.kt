package dev.lyra.android

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.media.MediaCodecList
import android.media.MediaFormat
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Base64
import android.view.WindowManager
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
 *
 * Serves both the app screen (with an [activity]) and the floating widget (without one).
 */
class Rpc(private val ctx: Context, private val web: LyraWebView, private val activity: Activity? = null) {
    private val io = Executors.newCachedThreadPool()
    private val main = Handler(Looper.getMainLooper())
    private val listener = { pushState() }

    private fun ui(r: Runnable) {
        if (Looper.myLooper() == Looper.getMainLooper()) r.run() else main.post(r)
    }

    fun install() {
        check(WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) { "This WebView is too old for Lyra" }
        WebViewCompat.addWebMessageListener(web, "AndroidRpc", setOf(ASSET_ORIGIN)) { _, message, _, isMainFrame, reply ->
            if (isMainFrame) handle(message, reply)
        }
        MediaMonitor.addListener(listener)
        MediaMonitor.refresh(ctx)
    }

    fun dispose() = MediaMonitor.removeListener(listener)

    /** Push the latest playback state to the page (main frame only, via evaluateJavascript). */
    fun pushState() {
        val snap = MediaMonitor.snapshotJson(ctx)
        val status = MediaMonitor.statusJson(ctx)
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
        fun activityOnly(block: (Activity) -> Unit) = ui {
            if (activity == null) ok(false) else {
                block(activity)
                ok(true)
            }
        }

        when (req.optString("method")) {
            "snapshot" -> ui { ok(MediaMonitor.snapshotJson(ctx)) }
            "status" -> ui { ok(MediaMonitor.statusJson(ctx)) }
            "command" -> ui { ok(MediaMonitor.command(args.getString(0))) }
            "hasAccess" -> ok(MediaMonitor.hasAccess(ctx))
            "refresh" -> {
                MediaMonitor.refresh(ctx)
                ok(true)
            }
            "openAccessSettings" -> ui { MediaMonitor.openAccessSettings(ctx); ok(true) }
            "openSpotify" -> ui { MediaMonitor.openSpotify(ctx); ok(true) }
            "openApp" -> ui {
                ctx.startActivity(Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT))
                ok(true)
            }
            "shareImage" -> ui {
                // a lyric card from the web UI: write it to our cache and hand it to the system share sheet
                val bytes = Base64.decode(args.getString(0), Base64.DEFAULT)
                val dir = java.io.File(ctx.cacheDir, "share").apply { mkdirs() }
                dir.listFiles()?.forEach { it.delete() }
                val file = java.io.File(dir, "lyra-card.png").apply { writeBytes(bytes) }
                val uri = androidx.core.content.FileProvider.getUriForFile(ctx, ctx.packageName + ".share", file)
                val send = Intent(Intent.ACTION_SEND).apply {
                    type = "image/png"
                    putExtra(Intent.EXTRA_STREAM, uri)
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }
                ctx.startActivity(Intent.createChooser(send, "Share lyric card").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                ok(true)
            }
            "audioRoute" -> {
                val am = ctx.getSystemService(Context.AUDIO_SERVICE) as android.media.AudioManager
                val types = am.getDevices(android.media.AudioManager.GET_DEVICES_OUTPUTS).map { it.type }
                val phones = types.any { it == android.media.AudioDeviceInfo.TYPE_WIRED_HEADPHONES || it == android.media.AudioDeviceInfo.TYPE_WIRED_HEADSET || it == android.media.AudioDeviceInfo.TYPE_BLUETOOTH_A2DP || it == android.media.AudioDeviceInfo.TYPE_BLE_HEADSET || it == android.media.AudioDeviceInfo.TYPE_USB_HEADSET || it == android.media.AudioDeviceInfo.TYPE_HEARING_AID }
                ok(JSONObject().put("headphones", phones))
            }
            "compatibilityReport" -> ui {
                val report = buildCompatibilityReport()
                (ctx.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager)
                    .setPrimaryClip(ClipData.newPlainText("Lyra compatibility report", report))
                ok(report)
            }
            "recordVideo" -> ui {
                if (android.os.Build.VERSION.SDK_INT >= 29) {
                    RecordActivity.start(ctx, args.optBoolean(0, true))
                    ok(JSONObject().put("ok", true))
                } else ok(JSONObject().put("ok", false).put("error", "Recording a lyric video needs Android 10 or newer."))
            }
            "recordGo" -> ui {
                val a = if (android.os.Build.VERSION.SDK_INT >= 29) activity as? RecordActivity else null
                val err = a?.go(args.optString(0, ""))
                if (a == null) ok(JSONObject().put("ok", false).put("error", "Not on the recording screen."))
                else ok(JSONObject().put("ok", err == null).put("error", err ?: JSONObject.NULL))
            }
            "recordFinish" -> ui {
                val a = if (android.os.Build.VERSION.SDK_INT >= 29) activity as? RecordActivity else null
                if (a == null) ok(JSONObject().put("ok", false))
                else a.finishNow { err -> ok(JSONObject().put("ok", err == null).put("error", err ?: JSONObject.NULL)) }
            }
            "recordAbort" -> ui {
                val a = if (android.os.Build.VERSION.SDK_INT >= 29) activity as? RecordActivity else null
                a?.leave(null)
                ok(true)
            }
            "copy" -> ui {
                (ctx.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("Lyra", args.getString(0)))
                ok(true)
            }
            "secretLoad" -> ok(SecretStore.load(ctx, args.getString(0)))
            "secretSave" -> { SecretStore.save(ctx, args.getString(0), args.getString(1)); ok(true) }
            "secretClear" -> { SecretStore.clear(ctx, args.getString(0)); ok(true) }
            "keepScreenOn" -> activityOnly { a ->
                val on = args.getBoolean(0)
                web.userKeepsScreenOn = on
                web.keepScreenOn = on
                if (on) a.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                else a.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            }
            "keepRunning" -> ui {
                val on = args.getBoolean(0)
                if (on && activity != null && android.os.Build.VERSION.SDK_INT >= 33 &&
                    activity.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED
                ) activity.requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 7)
                try {
                    KeepAliveService.set(ctx, on)
                    ok(true)
                } catch (e: Exception) {
                    fail(e.message ?: "could not start the service")
                }
            }
            "pickMedia" -> ui {
                val a = activity as? MainActivity
                if (a == null) ok(JSONObject().put("ok", false).put("error", "Open Lyra to choose a file."))
                else a.pickMedia { uri ->
                    if (uri == null) ok(JSONObject().put("ok", false))
                    else io.execute { ok(MediaFiles.import(ctx, uri)) }
                }
            }
            "mediaDelete" -> { MediaFiles.delete(ctx, args.getString(0)); ok(true) }
            "lyricsNotificationState" -> ok(JSONObject().put("enabled", LyricsNotifier.enabled(ctx)).put("public", LyricsNotifier.publicOnLock(ctx)))
            "lyricsNotification" -> ui {
                val on = args.getBoolean(0)
                if (on && activity != null && android.os.Build.VERSION.SDK_INT >= 33 &&
                    activity.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED
                ) activity.requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 8)
                try {
                    LyricsNotifier.set(ctx, on, args.getBoolean(1))
                    ok(true)
                } catch (e: Exception) {
                    fail(e.message ?: "could not start the lyrics notification")
                }
            }
            "setLyrics" -> { LyricsNotifier.setLyrics(args.getString(0), args.getString(1), args.optLong(2, 0), args.optString(3, "synced")); ok(true) }
            "ambientBrightness" -> ui {
                AmbientController.activity?.setBrightness(args.getDouble(0).toFloat(), args.optBoolean(1, false))
                ok(true)
            }
            "toggleAmbient" -> ui {
                AmbientController.toggle(ctx)
                ok(true)
            }
            "addAmbientTile" -> ui {
                if (android.os.Build.VERSION.SDK_INT >= 33) {
                    val sbm = ctx.getSystemService(android.app.StatusBarManager::class.java)
                    sbm.requestAddTileService(
                        android.content.ComponentName(ctx, AmbientTileService::class.java),
                        "Lyra ambient",
                        android.graphics.drawable.Icon.createWithResource(ctx, R.drawable.ic_ambient),
                        ctx.mainExecutor
                    ) { }
                    ok(true)
                } else ok(false)
            }
            "openAmbient" -> ui {
                ctx.startActivity(Intent(ctx, AmbientActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                ok(true)
            }
            "overlayState" -> ok(JSONObject().put("enabled", OverlayService.enabled(ctx)).put("canDraw", Settings.canDrawOverlays(ctx)))
            "overlaySet" -> ui {
                val on = args.getBoolean(0)
                if (on && !Settings.canDrawOverlays(ctx)) {
                    // the user must grant "Display over other apps" themselves; open the right screen for them
                    ctx.startActivity(
                        Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${ctx.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    )
                    ok(JSONObject().put("ok", false).put("needsPermission", true))
                } else {
                    OverlayService.set(ctx, on)
                    ok(JSONObject().put("ok", true))
                }
            }
            "openBatterySettings" -> ui {
                ctx.startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                ok(true)
            }
            "version" -> ok(ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName)
            "minimize" -> activityOnly { it.moveTaskToBack(true) }
            "finish" -> activityOnly { it.finishAffinity() }
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

    /** A shareable device report. It deliberately excludes account, app-list, and identifier data. */
    private fun buildCompatibilityReport(): String {
        val webViewVersion = runCatching { WebView.getCurrentWebViewPackage()?.versionName }.getOrNull() ?: "unavailable"
        val supports1080p60 = runCatching {
            MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos.any { codec ->
                codec.isEncoder && codec.supportedTypes.any { it.equals(MediaFormat.MIMETYPE_VIDEO_AVC, ignoreCase = true) } &&
                    runCatching {
                        codec.getCapabilitiesForType(MediaFormat.MIMETYPE_VIDEO_AVC)
                            .videoCapabilities?.areSizeAndRateSupported(1920, 1080, 60.0) == true
                    }.getOrDefault(false)
            }
        }.getOrDefault(false)
        val audioPath = when (RecordService.lastSound) {
            "capture" -> "direct playback capture"
            "microphone" -> "microphone"
            "none" -> "silent / no usable audio"
            else -> "not tested yet"
        }
        val level = RecordService.lastSoundLevelDbfs?.let { "%.1f dBFS peak".format(java.util.Locale.US, it) } ?: "not measured"
        return listOf(
            "Lyra Android compatibility report",
            "Device: ${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL}".trim(),
            "Android: ${android.os.Build.VERSION.RELEASE} (API ${android.os.Build.VERSION.SDK_INT})",
            "WebView: $webViewVersion",
            "Audio path: $audioPath",
            "Measured audio level: $level",
            "H.264 encoder supports 1080p60: ${if (supports1080p60) "yes" else "no"}"
        ).joinToString("\\n")
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
