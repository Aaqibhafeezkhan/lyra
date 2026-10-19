package dev.lyra.android

import android.graphics.Color
import android.os.Bundle
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import android.net.Uri
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat

/** Hosts Lyra's web UI. All data comes through [Rpc]; the UI itself is the same React app as on Windows. */
class MainActivity : ComponentActivity() {
    private var web: LyraWebView? = null
    private var rpc: Rpc? = null
    private var pickCallback: ((Uri?) -> Unit)? = null
    private val picker = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        pickCallback?.invoke(uri)
        pickCallback = null
    }

    /** Opens Android's file picker for a video / GIF / image. The result arrives through [done]. */
    fun pickMedia(done: (Uri?) -> Unit) {
        pickCallback = done
        picker.launch(arrayOf("video/mp4", "video/webm", "image/gif", "image/png", "image/jpeg", "image/webp"))
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)

        val root = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
        val view = LyraWebView(this).apply {
            layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }
        WebSetup.configure(view, this)
        root.addView(view)
        setContentView(root)
        ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
            val b = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            v.setPadding(b.left, b.top, b.right, b.bottom)
            insets
        }

        rpc = Rpc(applicationContext, view, this).also { it.install() }
        web = view
        WebSetup.load(view)

        // bring the floating widget back after the process was restarted
        OverlayService.restoreIfEnabled(this)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                // Let the UI close a panel / leave full screen first; if it has nothing to close, send the app to the background.
                view.evaluateJavascript("window.__lyraNative ? window.__lyraNative.back() : false") { r ->
                    if (r != "true") moveTaskToBack(true)
                }
            }
        })
    }

    override fun onResume() {
        super.onResume()
        OverlayService.appForeground(true) // the widget would only get in the way of Lyra's own screen
        MediaMonitor.refresh(this) // e.g. coming back from the notification-access settings screen
        rpc?.pushState()
    }

    override fun onPause() {
        OverlayService.appForeground(false)
        super.onPause()
    }

    override fun onDestroy() {
        rpc?.dispose()
        web?.destroy()
        super.onDestroy()
    }
}
