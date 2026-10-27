package dev.lyra.android

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.IBinder
import android.os.ParcelFileDescriptor
import android.provider.MediaStore
import androidx.annotation.RequiresApi
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import java.io.File

/**
 * Owns a lyric-video recording. Android only hands out a screen-capture session to a foreground service of type
 * "mediaProjection", so [RecordActivity] starts this with the user's consent result and later calls [go] / [finish].
 */
@RequiresApi(Build.VERSION_CODES.Q)
class RecordService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    @Suppress("DEPRECATION")
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            // "Stop" in the notification: ask the recording page to wrap up (end card), then save
            RecordActivity.current?.requestFinish()
            return START_NOT_STICKY
        }
        val code = intent?.getIntExtra("code", 0) ?: 0
        val data = intent?.getParcelableExtra<Intent>("data")
        if (code == 0 || data == null) {
            stopSelf()
            return START_NOT_STICKY
        }
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.createNotificationChannel(NotificationChannel(CHANNEL, "Lyric video recording", NotificationManager.IMPORTANCE_LOW))
        val stop = PendingIntent.getService(this, 0, Intent(this, RecordService::class.java).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE)
        val n: Notification = NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentTitle("Lyra is recording a lyric video")
            .setContentText("The Lyra screen and the song's sound. Tap Stop to finish.")
            .setOngoing(true)
            .addAction(0, "Stop", stop)
            .build()
        // the foreground service must be running (type mediaProjection) before the projection is requested
        ServiceCompat.startForeground(this, 2, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
        projection = (getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager).getMediaProjection(code, data)
        instance = this
        listener?.invoke()
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        projection = null
        instance = null
        super.onDestroy()
    }

    companion object {
        private const val CHANNEL = "record"
        private const val ACTION_STOP = "dev.lyra.android.RECORD_STOP"

        /** called when the projection is ready; the activity hops to the UI thread itself */
        @Volatile var listener: (() -> Unit)? = null
        @Volatile private var instance: RecordService? = null
        @Volatile private var projection: MediaProjection? = null
        private var recorder: ScreenRecorder? = null
        private var pfd: ParcelFileDescriptor? = null
        private var uri: Uri? = null
        private var cacheFile: File? = null

        /** which sound the last saved video got: "capture", "microphone" or "none" */
        @Volatile var lastSound: String = "not tested"
        @Volatile var lastSoundLevelDbfs: Double? = null

        fun begin(ctx: Context, code: Int, data: Intent) {
            ctx.startForegroundService(Intent(ctx, RecordService::class.java).putExtra("code", code).putExtra("data", data))
        }

        /** Start recording a [width] x [height] screen into Movies/Lyra. Returns an error message, or null when running. */
        @Synchronized
        fun go(ctx: Context, width: Int, height: Int, dpi: Int, title: String): String? {
            val p = projection ?: return "The screen recording permission is gone. Try again."
            if (recorder != null) return null
            return try {
                val clean = title.replace(Regex("[^\\p{L}\\p{N} .,'()&-]"), "").trim().take(60).ifBlank { "lyric video" }
                val stamp = java.text.SimpleDateFormat("yyyyMMdd-HHmmss", java.util.Locale.US).format(java.util.Date())
                val name = "Lyra - $clean $stamp"
                val fd: ParcelFileDescriptor
                if (Build.VERSION.SDK_INT >= 29) {
                    val v = ContentValues().apply {
                        put(MediaStore.Video.Media.DISPLAY_NAME, "$name.mp4")
                        put(MediaStore.Video.Media.MIME_TYPE, "video/mp4")
                        put(MediaStore.Video.Media.RELATIVE_PATH, Environment.DIRECTORY_MOVIES + "/Lyra")
                        put(MediaStore.Video.Media.IS_PENDING, 1)
                    }
                    val u = ctx.contentResolver.insert(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, v) ?: return "Could not create the video file."
                    uri = u
                    fd = ctx.contentResolver.openFileDescriptor(u, "rw") ?: return "Could not open the video file."
                } else {
                    val dir = File(ctx.cacheDir, "share").apply { mkdirs() }
                    val f = File(dir, "$name.mp4")
                    cacheFile = f
                    fd = ParcelFileDescriptor.open(f, ParcelFileDescriptor.MODE_READ_WRITE or ParcelFileDescriptor.MODE_CREATE or ParcelFileDescriptor.MODE_TRUNCATE)
                }
                pfd = fd
                // only Spotify's sound goes into the video (not notifications or other apps)
                val uid = try {
                    ctx.packageManager.getApplicationInfo(MediaMonitor.SPOTIFY, 0).uid
                } catch (_: Exception) {
                    null
                }
                val r = ScreenRecorder(p, fd.fileDescriptor, ctx.cacheDir, width, height, dpi, uid)
                r.start()
                recorder = r
                null
            } catch (e: Exception) {
                android.util.Log.e("LyraRec", "could not start", e)
                discard(ctx)
                friendly(e.message)
            }
        }

        /** Plain words for the errors people actually hit. */
        private fun friendly(m: String?): String = when {
            m == null -> "Recording could not start."
            m.contains("audio policy", true) -> "Android is still holding the sound capture from an earlier recording. Close Lyra completely (swipe it away) and try again."
            m.contains("capture the sound", true) -> "Android would not let Lyra capture the sound. Close Lyra completely and try again."
            else -> m
        }

        /** Stop and save. Returns the video's address (null when nothing was recorded) and any problem. */
        @Synchronized
        fun finish(ctx: Context): Pair<Uri?, String?> {
            val r = recorder
            recorder = null
            if (r == null) {
                release()
                return Pair(null, "Nothing was recorded.")
            }
            r.stop()
            lastSound = r.soundSource
            lastSoundLevelDbfs = r.soundLevelDbfs
            val problem = r.failure
            pfd?.close()
            pfd = null
            if (problem != null) {
                // a broken file is worse than none
                uri?.let { runCatching { ctx.contentResolver.delete(it, null, null) } }
                cacheFile?.delete()
                uri = null
                cacheFile = null
                release()
                return Pair(null, problem)
            }
            val u: Uri? = if (Build.VERSION.SDK_INT >= 29) {
                uri?.also { ctx.contentResolver.update(it, ContentValues().apply { put(MediaStore.Video.Media.IS_PENDING, 0) }, null, null) }
            } else cacheFile?.let { androidx.core.content.FileProvider.getUriForFile(ctx, ctx.packageName + ".share", it) }
            uri = null
            cacheFile = null
            release()
            return Pair(u, problem)
        }

        /** Throw a half-made recording away. */
        @Synchronized
        fun discard(ctx: Context) {
            try {
                recorder?.stop()
            } catch (_: Exception) {
            }
            recorder = null
            try {
                pfd?.close()
            } catch (_: Exception) {
            }
            pfd = null
            uri?.let { runCatching { ctx.contentResolver.delete(it, null, null) } }
            cacheFile?.delete()
            uri = null
            cacheFile = null
            release()
        }

        /** Stop the foreground service (and with it the notification). */
        @Synchronized
        fun release() {
            val s = instance
            projection = null
            instance = null
            s?.stopSelf()
        }
    }
}
