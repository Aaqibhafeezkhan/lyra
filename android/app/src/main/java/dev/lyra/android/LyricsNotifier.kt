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
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.style.RelativeSizeSpan
import android.text.style.StyleSpan
import androidx.core.app.NotificationCompat
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
    private var lastSignature = ""
    private var started = false
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
            ServiceCompat.startForeground(this, ID, build(), ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
            MediaMonitor.addListener(listener)
            MediaMonitor.refresh(this)
            main.post(tick)
        }
        return START_STICKY
    }

    fun refresh(force: Boolean = false) {
        main.post {
            val n = build()
            val sig = n.extras.run { "${getCharSequence(Notification.EXTRA_TITLE)}|${getCharSequence(Notification.EXTRA_TEXT)}|${getCharSequence(Notification.EXTRA_BIG_TEXT)}|${getCharSequence(Notification.EXTRA_SUB_TEXT)}|${n.actions?.firstOrNull { it.title == "Pause" || it.title == "Play" }?.title}" }
            if (force || sig != lastSignature) {
                lastSignature = sig
                (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).notify(ID, n)
            }
        }
    }

    private fun action(icon: Int, title: String, act: String): NotificationCompat.Action {
        val pi = PendingIntent.getBroadcast(this, act.hashCode(), Intent(this, LyricsActionReceiver::class.java).setAction(act), PendingIntent.FLAG_IMMUTABLE)
        return NotificationCompat.Action.Builder(icon, title, pi).build()
    }

    private fun average(bmp: Bitmap?): Int {
        if (bmp == null) return Color.rgb(40, 40, 48)
        val s = Bitmap.createScaledBitmap(bmp, 1, 1, true).getPixel(0, 0)
        // keep it dark enough for white text
        return Color.rgb((Color.red(s) * 0.55).toInt(), (Color.green(s) * 0.55).toInt(), (Color.blue(s) * 0.55).toInt())
    }

    private fun build(): Notification {
        val now = MediaMonitor.now()
        val publicLock = LyricsNotifier.publicOnLock(this)
        val open = PendingIntent.getActivity(
            this, 1,
            Intent(this, MainActivity::class.java).putExtra("fromLock", true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE
        )
        val b = NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentIntent(open)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setShowWhen(false)
            .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
            .setVisibility(if (publicLock) NotificationCompat.VISIBILITY_PUBLIC else NotificationCompat.VISIBILITY_PRIVATE)
            .setPublicVersion(
                NotificationCompat.Builder(this, CHANNEL).setSmallIcon(android.R.drawable.ic_media_play).setContentTitle("Lyra").setContentText("Lyrics are on").build()
            )

        if (now == null || now.isAd) {
            return b.setContentTitle("Lyra").setContentText(if (now?.isAd == true) "Ad playing" else "Nothing playing").build()
        }

        val lines = if (LyricsNotifier.linesTrack == now.id) LyricsNotifier.lines else emptyList()
        val idx = if (lines.isEmpty()) -1 else LyricsNotifier.activeIndex(now.positionMs)
        fun text(i: Int): String = lines.getOrNull(i)?.text?.ifBlank { "♪" } ?: ""
        val cur = if (lines.isEmpty()) now.title else if (idx < 0) "♪" else text(idx)
        val next = if (lines.isEmpty()) now.artist else text(idx + 1)
        val big = SpannableStringBuilder().apply {
            if (lines.isEmpty()) {
                append(now.title).setSpan(StyleSpan(android.graphics.Typeface.BOLD), 0, length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
                append("\n").append(if (now.artist.isNotEmpty()) now.artist else "")
                val note = when {
                    LyricsNotifier.linesTrack != now.id -> "Lyrics load while Lyra is open"
                    LyricsNotifier.status == "loading" -> "Loading lyrics…"
                    else -> "No synced lyrics for this song"
                }
                append("\n").append(note)
            } else {
                val s = length
                append(cur)
                setSpan(StyleSpan(android.graphics.Typeface.BOLD), s, length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
                setSpan(RelativeSizeSpan(1.12f), s, length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
                for (k in 1..2) text(idx + k).takeIf { it.isNotEmpty() }?.let { append("\n").append(it) }
            }
        }
        b.setContentTitle(cur)
            .setContentText(next)
            .setSubText(if (now.artist.isNotEmpty()) "${now.title} · ${now.artist}" else now.title)
            .setStyle(NotificationCompat.BigTextStyle().bigText(big))
            .setLargeIcon(now.art)
            .setColor(average(now.art))
            .addAction(action(android.R.drawable.ic_media_previous, "Previous", "dev.lyra.android.PREV"))
            .addAction(
                if (now.playing) action(android.R.drawable.ic_media_pause, "Pause", "dev.lyra.android.TOGGLE")
                else action(android.R.drawable.ic_media_play, "Play", "dev.lyra.android.TOGGLE")
            )
            .addAction(action(android.R.drawable.ic_media_next, "Next", "dev.lyra.android.NEXT"))
        return b.build()
    }

    override fun onDestroy() {
        main.removeCallbacks(tick)
        MediaMonitor.removeListener(listener)
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
