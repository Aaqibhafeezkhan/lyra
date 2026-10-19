package dev.lyra.android

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.drawable.Icon
import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.SystemClock
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.core.app.ServiceCompat
import org.json.JSONArray

/**
 * The "Lyrics notification": one quiet notification, in the shade and on the lock screen, showing the current line,
 * the next lines, the cover, and previous / play-pause / next. The web UI sends the synced lines once per song; this
 * service keeps time itself (from the media session), so it keeps working even if Lyra's screen is closed.
 */
object LyricsNotifier {
    data class Line(val t: Long, val text: String)

    @Volatile var lines: List<Line> = emptyList()
        private set
    @Volatile var linesTrack: String? = null
        private set
    @Volatile var offsetMs: Long = 0
        private set
    /** "synced", "none" (no synced lyrics for this song) or "loading" */
    @Volatile var status: String = "loading"
        private set

    private fun prefs(ctx: Context) = ctx.getSharedPreferences("lyrics-notification", Context.MODE_PRIVATE)
    fun enabled(ctx: Context): Boolean = prefs(ctx).getBoolean("enabled", false)
    fun publicOnLock(ctx: Context): Boolean = prefs(ctx).getBoolean("public", true)

    fun set(ctx: Context, on: Boolean, publicLock: Boolean) {
        prefs(ctx).edit().putBoolean("enabled", on).putBoolean("public", publicLock).apply()
        val i = Intent(ctx, LyricsNotificationService::class.java)
        if (on) ctx.startForegroundService(i) else ctx.stopService(i)
        LyricsNotificationService.instance?.refresh(force = true)
    }

    fun restoreIfEnabled(ctx: Context) {
        if (enabled(ctx) && LyricsNotificationService.instance == null) ctx.startForegroundService(Intent(ctx, LyricsNotificationService::class.java))
    }

    /** From the web UI: the synced lines for a song (JSON `[[timeMs, "text"], ...]`), already offset-adjusted by [offset]. */
    fun setLyrics(trackId: String, json: String, offset: Long, state: String) {
        val arr = JSONArray(json)
        val list = ArrayList<Line>(arr.length())
        for (i in 0 until arr.length()) {
            val p = arr.getJSONArray(i)
            list.add(Line(p.getLong(0), p.getString(1)))
        }
        lines = list
        linesTrack = trackId
        offsetMs = offset
        status = state
        LyricsNotificationService.instance?.refresh()
    }

    /** Index of the line active at [positionMs], -1 before the first. */
    fun activeIndex(positionMs: Long): Int {
        val l = lines
        var lo = 0
        var hi = l.size - 1
        var ans = -1
        val p = positionMs + offsetMs
        while (lo <= hi) {
            val mid = (lo + hi) ushr 1
            if (l[mid].t <= p) {
                ans = mid
                lo = mid + 1
            } else hi = mid - 1
        }
        return ans
    }
}

class LyricsNotificationService : Service() {
    private val main = Handler(Looper.getMainLooper())
    private val listener = { refresh() }
    private var started = false
    private var session: MediaSession? = null
    private var lastNotificationSig = ""
    private var lastMetaSig = ""
    private var lastPlaying: Boolean? = null
    private var anchorPos = 0L
    private var anchorAt = 0L
    private val tick = object : Runnable {
        override fun run() {
            refresh()
            main.postDelayed(this, 500)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        instance = this
        if (!started) {
            started = true
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL, "Lyrics", NotificationManager.IMPORTANCE_LOW).apply {
                    description = "Live lyrics on the lock screen and in the notification shade"
                    setShowBadge(false)
                    lockscreenVisibility = Notification.VISIBILITY_PUBLIC
                }
            )
            ensureSession()
            ServiceCompat.startForeground(this, ID, buildNotification(MediaMonitor.now()), ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
            MediaMonitor.addListener(listener)
            MediaMonitor.refresh(this)
            main.post(tick)
        }
        return START_STICKY
    }

    /** A media session of our own, mirroring the player: this is what makes Android draw a proper media card (like Spotify's). */
    private fun ensureSession(): MediaSession =
        session ?: MediaSession(this, "Lyra lyrics").also { s ->
            s.setCallback(object : MediaSession.Callback() {
                override fun onPlay() {
                    MediaMonitor.command("""{"type":"play"}""")
                }

                override fun onPause() {
                    MediaMonitor.command("""{"type":"pause"}""")
                }

                override fun onSkipToNext() {
                    MediaMonitor.command("""{"type":"next"}""")
                }

                override fun onSkipToPrevious() {
                    MediaMonitor.command("""{"type":"previous"}""")
                }

                override fun onSeekTo(pos: Long) {
                    MediaMonitor.command("""{"type":"seek","positionMs":$pos}""")
                }
            })
            session = s
        }

    private class Display(val title: String, val text: String, val sub: String)

    private fun display(now: MediaMonitor.Now): Display {
        val lines = if (LyricsNotifier.linesTrack == now.id) LyricsNotifier.lines else emptyList()
        val sub = if (now.artist.isNotEmpty()) "${now.title} · ${now.artist}" else now.title
        if (lines.isEmpty()) {
            val note = when {
                LyricsNotifier.linesTrack != now.id -> "Lyrics load while Lyra is open"
                LyricsNotifier.status == "loading" -> "Loading lyrics…"
                else -> "No synced lyrics for this song"
            }
            return Display(now.title, if (now.artist.isNotEmpty()) "${now.artist} · $note" else note, sub)
        }
        val idx = LyricsNotifier.activeIndex(now.positionMs)
        fun text(i: Int): String = lines.getOrNull(i)?.text?.ifBlank { "♪" } ?: ""
        return Display(if (idx < 0) "♪" else text(idx), text(idx + 1), sub)
    }

    fun refresh(force: Boolean = false) {
        main.post {
            val now = MediaMonitor.now()
            val s = ensureSession()
            if (now == null || now.isAd) {
                s.isActive = false
                lastPlaying = null
                lastMetaSig = ""
                notifyIfChanged("idle|${now?.isAd}", buildNotification(now), force)
                return@post
            }
            val d = display(now)

            // card contents: only touch the session when the text / cover changed (this is what the system redraws)
            val metaSig = "${now.id}|${d.title}|${d.text}|${now.durationMs}"
            if (metaSig != lastMetaSig) {
                lastMetaSig = metaSig
                s.setMetadata(
                    MediaMetadata.Builder()
                        .putString(MediaMetadata.METADATA_KEY_TITLE, d.title)
                        .putString(MediaMetadata.METADATA_KEY_ARTIST, d.text)
                        .putString(MediaMetadata.METADATA_KEY_ALBUM, d.sub)
                        .putLong(MediaMetadata.METADATA_KEY_DURATION, now.durationMs)
                        .putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, now.art)
                        .putBitmap(MediaMetadata.METADATA_KEY_ART, now.art)
                        .build()
                )
            }
            // seek bar: only re-anchor when play/pause changed or the position jumped (a seek)
            val predicted = if (lastPlaying == true) anchorPos + (SystemClock.elapsedRealtime() - anchorAt) else anchorPos
            if (lastPlaying != now.playing || kotlin.math.abs(predicted - now.positionMs) > 1500) {
                lastPlaying = now.playing
                anchorPos = now.positionMs
                anchorAt = SystemClock.elapsedRealtime()
                s.setPlaybackState(
                    PlaybackState.Builder()
                        .setActions(
                            PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE or PlaybackState.ACTION_PLAY_PAUSE or
                                PlaybackState.ACTION_SKIP_TO_NEXT or PlaybackState.ACTION_SKIP_TO_PREVIOUS or PlaybackState.ACTION_SEEK_TO
                        )
                        .setState(if (now.playing) PlaybackState.STATE_PLAYING else PlaybackState.STATE_PAUSED, now.positionMs, if (now.playing) 1f else 0f, SystemClock.elapsedRealtime())
                        .build()
                )
            }
            s.isActive = true
            notifyIfChanged("${d.title}|${d.text}|${d.sub}|${now.playing}|${now.id}", buildNotification(now), force)
        }
    }

    private fun notifyIfChanged(sig: String, n: Notification, force: Boolean) {
        if (force || sig != lastNotificationSig) {
            lastNotificationSig = sig
            (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).notify(ID, n)
        }
    }

    private fun action(icon: Int, title: String, act: String): Notification.Action {
        val pi = PendingIntent.getBroadcast(this, act.hashCode(), Intent(this, LyricsActionReceiver::class.java).setAction(act), PendingIntent.FLAG_IMMUTABLE)
        return Notification.Action.Builder(Icon.createWithResource(this, icon), title, pi).build()
    }

    /** The cover's average colour, darkened so white text always reads. */
    private fun tint(bmp: Bitmap?): Int {
        if (bmp == null) return Color.rgb(40, 40, 48)
        val s = Bitmap.createScaledBitmap(bmp, 1, 1, true).getPixel(0, 0)
        return Color.rgb((Color.red(s) * 0.55).toInt(), (Color.green(s) * 0.55).toInt(), (Color.blue(s) * 0.55).toInt())
    }

    private fun buildNotification(now: MediaMonitor.Now?): Notification {
        val publicLock = LyricsNotifier.publicOnLock(this)
        val open = PendingIntent.getActivity(
            this, 1,
            Intent(this, MainActivity::class.java).putExtra("fromLock", true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE
        )
        val b = Notification.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentIntent(open)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setCategory(Notification.CATEGORY_TRANSPORT)
            .setVisibility(if (publicLock) Notification.VISIBILITY_PUBLIC else Notification.VISIBILITY_PRIVATE)
            .setPublicVersion(Notification.Builder(this, CHANNEL).setSmallIcon(android.R.drawable.ic_media_play).setContentTitle("Lyra").setContentText("Lyrics are on").build())

        if (now == null || now.isAd) {
            return b.setContentTitle("Lyra").setContentText(if (now?.isAd == true) "Ad playing" else "Nothing playing").build()
        }
        val d = display(now)
        return b.setContentTitle(d.title)
            .setContentText(d.text)
            .setSubText(d.sub)
            .setLargeIcon(now.art)
            .setColor(tint(now.art))
            .setColorized(true)
            .setStyle(Notification.MediaStyle().setMediaSession(ensureSession().sessionToken).setShowActionsInCompactView(0, 1, 2))
            .addAction(action(android.R.drawable.ic_media_previous, "Previous", "dev.lyra.android.PREV"))
            .addAction(
                if (now.playing) action(android.R.drawable.ic_media_pause, "Pause", "dev.lyra.android.TOGGLE")
                else action(android.R.drawable.ic_media_play, "Play", "dev.lyra.android.TOGGLE")
            )
            .addAction(action(android.R.drawable.ic_media_next, "Next", "dev.lyra.android.NEXT"))
            .build()
    }

    override fun onDestroy() {
        main.removeCallbacks(tick)
        MediaMonitor.removeListener(listener)
        session?.release()
        session = null
        if (instance === this) instance = null
        super.onDestroy()
    }

    companion object {
        private const val CHANNEL = "lyrics"
        private const val ID = 3
        @Volatile var instance: LyricsNotificationService? = null
    }
}

class LyricsActionReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        MediaMonitor.refresh(ctx)
        val type = when (intent.action) {
            "dev.lyra.android.PREV" -> "previous"
            "dev.lyra.android.NEXT" -> "next"
            else -> "toggle"
        }
        Handler(Looper.getMainLooper()).postDelayed({ MediaMonitor.command("""{"type":"$type"}""") }, 80)
    }
}
