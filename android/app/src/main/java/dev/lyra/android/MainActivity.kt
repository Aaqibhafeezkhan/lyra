package dev.lyra.android

import android.annotation.SuppressLint
import android.app.Activity
import android.content.pm.ApplicationInfo
import android.graphics.Color
import android.os.Bundle
import android.webkit.WebView

/** Phase 0: just proves the WebView shell runs on the device. The real UI arrives in Phase 2. */
class MainActivity : Activity() {
    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // debug builds can be inspected from the PC (chrome://inspect, or the test harness)
        if (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0) WebView.setWebContentsDebuggingEnabled(true)
        val web = WebView(this).apply {
            setBackgroundColor(Color.BLACK)
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
        }
        setContentView(web)
        web.loadUrl("file:///android_asset/index.html")
    }
}
