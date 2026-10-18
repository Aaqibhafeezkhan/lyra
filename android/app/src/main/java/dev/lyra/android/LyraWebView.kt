package dev.lyra.android

import android.content.Context
import android.webkit.WebView

/**
 * Chromium inside a WebView asks Android to keep the screen on whenever it thinks media is active. Lyra has its own
 * switch for that ("Keep screen on while playing"), so ignore those requests and apply only the user's choice.
 */
class LyraWebView(context: Context) : WebView(context) {
    /** Set from the Settings switch (and only while a song plays). */
    var userKeepsScreenOn = false

    override fun setKeepScreenOn(keepScreenOn: Boolean) {
        super.setKeepScreenOn(keepScreenOn && userKeepsScreenOn)
    }
}
