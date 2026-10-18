package dev.lyra.android

import android.content.ComponentName
import android.content.Context
import android.graphics.Bitmap
import android.graphics.drawable.BitmapDrawable
import android.media.MediaMetadata
import android.media.session.MediaController
import android.media.session.MediaSessionManager
import android.media.session.PlaybackState
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import android.util.Base64
import androidx.core.app.NotificationManagerCompat
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.security.MessageDigest

/**
 * Reads what is playing from Android's media sessions (Spotify, YouTube Music, ...) and turns it into the same
 * JSON shape the desktop app produces (PlaybackSnapshot), so the UI cannot tell the difference.
 */
object MediaMonitor {
    private const val SPOTIFY = "com.spotify.music"

    private val main = Handler(Looper.getMainLooper())
    private val listeners = mutableListOf<() -> Unit>()
    private var manager: MediaSessionManager? = null
    private var componentName: ComponentName? = null
    private var controllers: List<MediaController> = emptyList()
    private val callbacks = mutableMapOf<MediaController, MediaController.Callback>()
    private var pushScheduled = false
    private var artKey: String? = null
    private var artData: String? = null

    fun hasAccess(ctx: Context): Boolean = NotificationManagerCompat.getEnabledListenerPackages(ctx).contains(ctx.packageName)

    fun addListener(l: () -> Unit) {
        main.post { listeners.add(l) }
    }

    fun removeListener(l: () -> Unit) {
        main.post { listeners.remove(l) }
    }

    /** (Re)attach to the active sessions. Safe to call any time; does nothing without notification access. */
    fun refresh(ctx: Context) {
        main.post {
            val app = ctx.applicationContext
            if (!hasAccess(app)) {
                detach()
                schedulePush()
                return@post
            }
            val mgr = manager ?: (app.getSystemService(Context.MEDIA_SESSION_SERVICE) as MediaSessionManager).also { manager = it }
            val cn = componentName ?: ComponentName(app, MediaListenerService::class.java).also { componentName = it }
            try {
                if (callbacks.isEmpty() && controllers.isEmpty()) mgr.addOnActiveSessionsChangedListener(sessionsChanged, cn, main)
                attach(mgr.getActiveSessions(cn))
            } catch (_: SecurityException) {
                detach()
            }
            schedulePush()
        }
    }

    private val sessionsChanged = MediaSessionManager.OnActiveSessionsChangedListener { list -> attach(list ?: emptyList()) ; schedulePush() }

    private fun attach(list: List<MediaController>) {
        callbacks.forEach { (c, cb) -> c.unregisterCallback(cb) }
        callbacks.clear()
        controllers = list
        list.forEach { c ->
            val cb = object : MediaController.Callback() {
                override fun onMetadataChanged(metadata: MediaMetadata?) = schedulePush()
                override fun onPlaybackStateChanged(state: PlaybackState?) = schedulePush()
                override fun onSessionDestroyed() = schedulePush()
            }
            c.registerCallback(cb, main)
            callbacks[c] = cb
        }
    }

    private fun detach() {
        callbacks.forEach { (c, cb) -> c.unregisterCallback(cb) }
        callbacks.clear()
        controllers = emptyList()
        try {
            manager?.removeOnActiveSessionsChangedListener(sessionsChanged)
        } catch (_: Exception) {
        }
    }

    private fun schedulePush() {
        if (pushScheduled) return
        pushScheduled = true
        main.postDelayed({
            pushScheduled = false
            listeners.toList().forEach { it() }
        }, 120)
    }

    /** The session to show: something that is playing wins, then Spotify, then whatever is first. */
    private fun pick(): MediaController? =
        controllers.firstOrNull { it.playbackState?.state == PlaybackState.STATE_PLAYING }
            ?: controllers.firstOrNull { it.packageName == SPOTIFY }
            ?: controllers.firstOrNull()

    fun statusJson(ctx: Context): String {
        val o = JSONObject()
        if (!hasAccess(ctx)) {
            o.put("state", "needs-setup")
            o.put("message", "Allow notification access so Lyra can see what is playing.")
        } else {
            o.put("state", "local")
        }
        return o.toString()
    }

    fun snapshotJson(ctx: Context): String {
        val c = pick() ?: return "null"
        val md = c.metadata ?: return "null"
        val title = md.getString(MediaMetadata.METADATA_KEY_TITLE) ?: md.getString(MediaMetadata.METADATA_KEY_DISPLAY_TITLE) ?: return "null"
        val artist = md.getString(MediaMetadata.METADATA_KEY_ARTIST) ?: md.getString(MediaMetadata.METADATA_KEY_DISPLAY_SUBTITLE) ?: ""
        val album = md.getString(MediaMetadata.METADATA_KEY_ALBUM) ?: ""
        val duration = md.getLong(MediaMetadata.METADATA_KEY_DURATION)
        val mediaId = md.getString(MediaMetadata.METADATA_KEY_MEDIA_ID) ?: ""

        val state = c.playbackState
        val playing = state?.state == PlaybackState.STATE_PLAYING || state?.state == PlaybackState.STATE_BUFFERING
        var pos = state?.position ?: 0L
        if (state != null && playing && state.lastPositionUpdateTime > 0) {
            pos += ((SystemClock.elapsedRealtime() - state.lastPositionUpdateTime) * state.playbackSpeed).toLong()
        }
        if (duration > 0) pos = pos.coerceIn(0, duration)

        val track = JSONObject()
        track.put("id", trackId(c.packageName, mediaId, title, artist, album))
        track.put("uri", mediaId.ifEmpty { "android:${c.packageName}" })
        track.put("title", title)
        track.put("artists", JSONArray().apply { if (artist.isNotEmpty()) put(artist) })
        track.put("album", album)
        track.put("releaseYear", JSONObject.NULL)
        track.put("durationMs", duration)
        track.put("artworkUrl", artworkDataUrl(md, "$title|$artist|$album") ?: JSONObject.NULL)
        track.put("explicit", false)
        track.put("webUrl", spotifyWebUrl(mediaId) ?: JSONObject.NULL)

        val device = JSONObject().apply {
            put("id", JSONObject.NULL)
            put("name", "This phone")
            put("type", "Smartphone")
            put("volumePercent", JSONObject.NULL)
            put("supportsVolume", false)
        }
        val o = JSONObject()
        o.put("track", track)
        o.put("isPlaying", playing)
        o.put("positionMs", pos)
        o.put("sampledAt", System.currentTimeMillis())
        o.put("device", device)
        o.put("shuffle", false)
        o.put("repeat", "off")
        o.put("isAdOrUnknown", title.equals("Advertisement", true) || mediaId.contains(":ad:"))
        o.put("packageName", c.packageName)
        return o.toString()
    }

    private fun spotifyWebUrl(mediaId: String): String? {
        val m = Regex("^spotify:track:([A-Za-z0-9]+)$").find(mediaId) ?: return null
        return "https://open.spotify.com/track/${m.groupValues[1]}"
    }

    private fun trackId(pkg: String, mediaId: String, title: String, artist: String, album: String): String {
        val m = Regex("^spotify:track:([A-Za-z0-9]+)$").find(mediaId)
        if (m != null) return m.groupValues[1]
        val h = MessageDigest.getInstance("SHA-1").digest("$pkg|$title|$artist|$album".toByteArray())
        return "android:" + h.take(8).joinToString("") { "%02x".format(it) }
    }

    /** Cover art as a small JPEG data URL (cached per song so snapshots stay cheap). */
    private fun artworkDataUrl(md: MediaMetadata, key: String): String? {
        if (key == artKey) return artData
        val bmp: Bitmap? = md.getBitmap(MediaMetadata.METADATA_KEY_ART)
            ?: md.getBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART)
            ?: md.getBitmap(MediaMetadata.METADATA_KEY_DISPLAY_ICON)
        val out = bmp?.let {
            val max = 640
            val scaled = if (it.width > max || it.height > max) {
                val r = max.toFloat() / maxOf(it.width, it.height)
                Bitmap.createScaledBitmap(it, (it.width * r).toInt(), (it.height * r).toInt(), true)
            } else it
            val bos = ByteArrayOutputStream()
            scaled.compress(Bitmap.CompressFormat.JPEG, 86, bos)
            "data:image/jpeg;base64," + Base64.encodeToString(bos.toByteArray(), Base64.NO_WRAP)
        }
        artKey = key
        artData = out
        return out
    }

    /** Transport commands from the UI. Returns false when nothing is playing or the app refuses. */
    fun command(json: String): Boolean {
        val c = pick() ?: return false
        val cmd = JSONObject(json)
        val t = c.transportControls
        when (cmd.getString("type")) {
            "play" -> t.play()
            "pause" -> t.pause()
            "toggle" -> if (c.playbackState?.state == PlaybackState.STATE_PLAYING) t.pause() else t.play()
            "next" -> t.skipToNext()
            "previous" -> t.skipToPrevious()
            "seek" -> t.seekTo(cmd.getLong("positionMs"))
            else -> return false
        }
        return true
    }

    fun openAccessSettings(ctx: Context) {
        val i = android.content.Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
        ctx.startActivity(i)
    }

    fun openSpotify(ctx: Context) {
        val i = ctx.packageManager.getLaunchIntentForPackage(SPOTIFY) ?: return
        ctx.startActivity(i.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK))
    }
}
