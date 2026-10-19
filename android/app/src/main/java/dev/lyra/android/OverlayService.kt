package dev.lyra.android

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.os.IBinder
import android.provider.Settings
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat

/**
 * The floating lyrics widget: a small window over other apps that shows the compact Lyra widget (cover, title,
 * the current lyric line, play controls). It hides itself while Lyra's own screen is open.
 *
 * Needs the "Display over other apps" permission, which the user grants in Android settings.
 */
class OverlayService : Service() {
    private var wm: WindowManager? = null
    private var root: LinearLayout? = null
    private var web: LyraWebView? = null
    private var rpc: Rpc? = null
    private var params: WindowManager.LayoutParams? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (!Settings.canDrawOverlays(this)) {
            prefs(this).edit().putBoolean(KEY, false).apply()
            stopSelf()
            return START_NOT_STICKY
        }
        startForeground()
        if (root == null) create()
        instance = this
        applyVisibility()
        return START_STICKY
    }

    private fun startForeground() {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.createNotificationChannel(NotificationChannel(CHANNEL, "Floating lyrics", NotificationManager.IMPORTANCE_MIN))
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        val n: Notification = NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentTitle("Floating lyrics are on")
            .setContentText("Shown over other apps. Turn off in Lyra settings.")
            .setContentIntent(open)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .build()
        ServiceCompat.startForeground(this, 2, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
    }

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()

    private fun create() {
        val manager = getSystemService(Context.WINDOW_SERVICE) as WindowManager
        wm = manager
        val dm = resources.displayMetrics
        val width = dm.widthPixels - dp(20)
        val p = prefs(this)

        val lp = WindowManager.LayoutParams(
            width,
            dp(26) + dp(150),
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = p.getInt("x", (dm.widthPixels - width) / 2)
            y = p.getInt("y", dp(120))
        }
        params = lp

        // a native strip to drag the widget by (the web view itself would swallow the touches) and to close it
        val strip = FrameLayout(this)
        val grip = View(this).apply {
            background = GradientDrawable().apply {
                cornerRadius = dp(3).toFloat()
                setColor(Color.argb(150, 255, 255, 255))
            }
        }
        strip.addView(grip, FrameLayout.LayoutParams(dp(44), dp(5), Gravity.CENTER))
        val close = TextView(this).apply {
            text = "✕"
            setTextColor(Color.argb(200, 255, 255, 255))
            textSize = 14f
            gravity = Gravity.CENTER
            setOnClickListener { set(this@OverlayService, false) }
        }
        strip.addView(close, FrameLayout.LayoutParams(dp(40), dp(26), Gravity.END or Gravity.CENTER_VERTICAL))
        var downX = 0f
        var downY = 0f
        var startX = 0
        var startY = 0
        strip.setOnTouchListener { _, e ->
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    downX = e.rawX; downY = e.rawY; startX = lp.x; startY = lp.y
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    lp.x = (startX + (e.rawX - downX)).toInt().coerceIn(0, dm.widthPixels - lp.width)
                    lp.y = (startY + (e.rawY - downY)).toInt().coerceIn(0, dm.heightPixels - lp.height)
                    root?.let { manager.updateViewLayout(it, lp) }
                    true
                }
                MotionEvent.ACTION_UP -> {
                    p.edit().putInt("x", lp.x).putInt("y", lp.y).apply()
                    true
                }
                else -> false
            }
        }

        val view = LyraWebView(this)
        WebSetup.configure(view, this, transparent = true)
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = GradientDrawable().apply {
                cornerRadius = dp(22).toFloat()
                setColor(Color.argb(235, 14, 14, 18))
            }
            clipToOutline = true
            addView(strip, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(26)))
            addView(view, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        }
        root = box
        web = view
        manager.addView(box, lp)
        rpc = Rpc(applicationContext, view).also { it.install() }
        WebSetup.load(view, "?overlay=compact")
    }

    fun applyVisibility() {
        root?.visibility = if (appInForeground) View.GONE else View.VISIBLE
    }

    override fun onDestroy() {
        if (instance === this) instance = null
        rpc?.dispose()
        root?.let { runCatching { wm?.removeView(it) } }
        web?.destroy()
        root = null
        web = null
        super.onDestroy()
    }

    companion object {
        private const val CHANNEL = "overlay"
        private const val KEY = "enabled"
        private var instance: OverlayService? = null
        private var appInForeground = false

        private fun prefs(ctx: Context) = ctx.getSharedPreferences("overlay", Context.MODE_PRIVATE)

        fun enabled(ctx: Context): Boolean = prefs(ctx).getBoolean(KEY, false)

        fun set(ctx: Context, on: Boolean) {
            prefs(ctx).edit().putBoolean(KEY, on).apply()
            val i = Intent(ctx, OverlayService::class.java)
            if (on) ctx.startForegroundService(i) else ctx.stopService(i)
        }

        /** Called when the app starts: bring the widget back if it was on and the permission is still granted. */
        fun restoreIfEnabled(ctx: Context) {
            if (enabled(ctx) && Settings.canDrawOverlays(ctx) && instance == null) ctx.startForegroundService(Intent(ctx, OverlayService::class.java))
        }

        fun appForeground(inFront: Boolean) {
            appInForeground = inFront
            instance?.applyVisibility()
        }
    }
}
