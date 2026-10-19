package dev.lyra.android

import android.graphics.Color
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

/**
 * "Ambient lyrics": an always-on-display style screen. Pure black, very dim lyrics, minimum brightness, no system
 * bars, and it slowly shifts so an OLED panel is never lit in the same place. Touch or Back to leave.
 * It also shows over the lock screen, like an alarm does.
 */
class AmbientActivity : ComponentActivity() {
    private var rpc: Rpc? = null
    private var web: LyraWebView? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setShowWhenLocked(true)
        setTurnScreenOn(true)
        window.attributes = window.attributes.apply { screenBrightness = 0.1f }
        WindowCompat.setDecorFitsSystemWindows(window, false)
        WindowInsetsControllerCompat(window, window.decorView).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }

        val root = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
        val view = LyraWebView(this).apply { layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT) }
        WebSetup.configure(view, this)
        root.addView(view)
        AmbientController.activity = this
        AmbientController.changed(applicationContext)
        setContentView(root)
        rpc = Rpc(applicationContext, view, this).also { it.install() }
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) // until we know whether music is playing
        MediaMonitor.addListener(playbackListener)
        updateAwake()
        web = view
        WebSetup.load(view, "?ambient=1")
    }

    private var sensors: android.hardware.SensorManager? = null
    private var level = 0.2f
    private var auto = false
    private var smoothed = -1f

    private val lightListener = object : android.hardware.SensorEventListener {
        override fun onAccuracyChanged(sensor: android.hardware.Sensor?, accuracy: Int) {}

        override fun onSensorChanged(e: android.hardware.SensorEvent) {
            // room light on a log scale: a dark room (~0 lux) -> half of the slider value, a bright room (~1000 lux) -> all of it
            val f = (kotlin.math.log10(e.values[0] + 1f) / 3f).coerceIn(0f, 1f)
            val target = 0.5f + 0.5f * f
            smoothed = if (smoothed < 0) target else smoothed * 0.85f + target * 0.15f // no flicker when a light switches
            apply()
        }
    }

    private fun apply() {
        val factor = if (auto && smoothed >= 0) smoothed else 1f
        window.attributes = window.attributes.apply { screenBrightness = (level * factor).coerceIn(0.03f, 1f) }
    }

    /**
     * Screen brightness for ambient mode, sent by the ambient page. [value] is the slider (what you set is what you
     * get); with [automatic] the light sensor scales it between 50% (dark room) and 100% (bright room).
     */
    fun setBrightness(value: Float, automatic: Boolean) {
        level = value.coerceIn(0.03f, 1f)
        auto = automatic
        sensors?.unregisterListener(lightListener)
        MediaMonitor.removeListener(playbackListener)
        awake.removeCallbacks(releaseAwake)
        val sm = sensors ?: (getSystemService(SENSOR_SERVICE) as android.hardware.SensorManager).also { sensors = it }
        val light = sm.getDefaultSensor(android.hardware.Sensor.TYPE_LIGHT)
        if (automatic && light != null) sm.registerListener(lightListener, light, android.hardware.SensorManager.SENSOR_DELAY_NORMAL)
        else smoothed = -1f
        apply()
    }

    // The screen stays on while music is playing. When the music stops it may go to sleep after a few minutes (battery).
    private val awake = android.os.Handler(android.os.Looper.getMainLooper())
    private val releaseAwake = Runnable { window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) }
    private val playbackListener = { updateAwake() }

    private fun updateAwake() {
        awake.post {
            if (MediaMonitor.now()?.playing == true) {
                awake.removeCallbacks(releaseAwake)
                window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            } else {
                awake.removeCallbacks(releaseAwake)
                awake.postDelayed(releaseAwake, 3 * 60_000L)
            }
        }
    }

    override fun onResume() {
        super.onResume()
        OverlayService.appForeground(true)
        rpc?.pushState()
    }

    override fun onPause() {
        OverlayService.appForeground(false)
        super.onPause()
    }

    override fun onDestroy() {
        sensors?.unregisterListener(lightListener)
        if (AmbientController.activity === this) AmbientController.activity = null
        AmbientController.changed(applicationContext)
        rpc?.dispose()
        web?.destroy()
        super.onDestroy()
    }

    @Suppress("unused")
    private fun hideNow(v: View) = v.systemUiVisibility
}
