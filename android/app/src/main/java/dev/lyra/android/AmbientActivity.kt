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
        // touches do nothing (so a stray touch in bed can't switch it off); the tile / widget / shortcut / Back turn it off
        view.setOnTouchListener { _, _ -> true }
        AmbientController.activity = this
        AmbientController.changed(applicationContext)
        setContentView(root)
        rpc = Rpc(applicationContext, view, this).also { it.install() }
        web = view
        WebSetup.load(view, "?ambient=1")
    }

    override fun onResume() {
        super.onResume()
        rpc?.pushState()
    }

    override fun onDestroy() {
        if (AmbientController.activity === this) AmbientController.activity = null
        AmbientController.changed(applicationContext)
        rpc?.dispose()
        web?.destroy()
        super.onDestroy()
    }

    @Suppress("unused")
    private fun hideNow(v: View) = v.systemUiVisibility
}
