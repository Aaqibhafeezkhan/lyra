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
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        window.attributes = window.attributes.apply { screenBrightness = 0.02f }
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
        web = view
        WebSetup.load(view, "?ambient=1")
    }

    private var sensors: android.hardware.SensorManager? = null
    private var maxLevel = 0.3f
    private var floorLevel = 0.03f
    private var auto = false
    private var smoothed = -1f

    private val lightListener = object : android.hardware.SensorEventListener {
        override fun onAccuracyChanged(sensor: android.hardware.Sensor?, accuracy: Int) {}

        override fun onSensorChanged(e: android.hardware.SensorEvent) {
            // room light (lux) on a log scale: ~0 lux dark bedroom -> floor, ~1000 lux bright room -> the maximum
            val f = (kotlin.math.log10(e.values[0] + 1f) / 3f).coerceIn(0f, 1f)
            val target = floorLevel + (maxLevel - floorLevel) * f
            smoothed = if (smoothed < 0) target else smoothed * 0.85f + target * 0.15f // no flicker when a light switches
            applyLevel(smoothed)
        }
    }

    private fun applyLevel(level: Float) {
        window.attributes = window.attributes.apply { screenBrightness = level.coerceIn(0.01f, 1f) }
    }

    /**
     * Screen brightness for ambient mode, set by the ambient page. With [automatic] the phone's light sensor drives it
     * between [floor] (dark room) and [level] (bright room); otherwise [level] is used as is.
     */
    fun setBrightness(level: Float, automatic: Boolean, floor: Float) {
        maxLevel = level.coerceIn(0.02f, 1f)
        floorLevel = floor.coerceIn(0.01f, maxLevel)
        sensors?.unregisterListener(lightListener)
        auto = automatic
        val sm = sensors ?: (getSystemService(SENSOR_SERVICE) as android.hardware.SensorManager).also { sensors = it }
        val light = sm.getDefaultSensor(android.hardware.Sensor.TYPE_LIGHT)
        if (automatic && light != null) {
            sm.registerListener(lightListener, light, android.hardware.SensorManager.SENSOR_DELAY_NORMAL)
        } else {
            applyLevel(maxLevel)
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
