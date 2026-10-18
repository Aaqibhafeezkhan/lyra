package dev.lyra.android

import android.service.notification.NotificationListenerService

/**
 * Lyra never reads notifications. Android only lets an app list other apps' media sessions (what is playing)
 * if it is an enabled "notification listener", so this empty service exists purely to hold that permission.
 */
class MediaListenerService : NotificationListenerService() {
    override fun onListenerConnected() {
        MediaMonitor.refresh(applicationContext)
    }
}
