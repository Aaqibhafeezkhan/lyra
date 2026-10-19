package dev.lyra.android

import android.graphics.Color
import android.service.dreams.DreamService
import android.view.ViewGroup
import android.widget.FrameLayout

/**
 * Lyra as an Android screen saver ("dream"): Settings → Display → Screen saver → Lyra. Android starts it by itself
 * while the phone charges or sits on a dock, showing the same dim ambient lyrics as the ambient screen.
 */
class LyraDream : DreamService() {
    private var rpc: Rpc? = null
    private var web: LyraWebView? = null

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        isInteractive = false
        isFullscreen = true
        isScreenBright = false

        val root = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
        val view = LyraWebView(this).apply { layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT) }
        WebSetup.configure(view, this)
        root.addView(view)
        setContentView(root)
        rpc = Rpc(applicationContext, view).also { it.install() }
        web = view
        WebSetup.load(view, "?ambient=1")
    }

    override fun onDreamingStarted() {
        super.onDreamingStarted()
        rpc?.pushState()
    }

    override fun onDetachedFromWindow() {
        rpc?.dispose()
        web?.destroy()
        rpc = null
        web = null
        super.onDetachedFromWindow()
    }
}
