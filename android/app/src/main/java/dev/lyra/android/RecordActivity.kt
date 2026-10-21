package dev.lyra.android

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Bundle
import android.util.DisplayMetrics
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.annotation.RequiresApi
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import java.util.concurrent.Executors

/**
 * Records a lyric video of the song playing now: the recording page (clean full-screen lyrics + the song's video) is
 * shown, and the screen plus Spotify's sound are captured while it plays, then saved to Movies/Lyra and offered for
 * sharing. First it asks for the two permissions Android requires (sound capture, screen capture); nothing is
 * recorded before the countdown ends.
 */
@RequiresApi(Build.VERSION_CODES.Q)
class RecordActivity : ComponentActivity() {
    private var web: LyraWebView? = null
    private var rpc: Rpc? = null
    private var pageLoaded = false
    private var recording = false
    private var finishing = false
    private val io = Executors.newSingleThreadExecutor()

    private val audioPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) askScreen() else leave("Lyra needs the sound permission to put the song's audio in the video.")
    }
    private val screenConsent = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        val data = r.data
        if (r.resultCode == RESULT_OK && data != null) {
            RecordService.listener = { runOnUiThread { showPage() } }
            RecordService.begin(applicationContext, r.resultCode, data)
        } else leave(null)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        current = this
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        window.attributes = window.attributes.apply { layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS }
        WindowCompat.setDecorFitsSystemWindows(window, false)
        WindowInsetsControllerCompat(window, window.decorView).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
        setContentView(FrameLayout(this).apply { setBackgroundColor(Color.BLACK) })

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (recording) requestFinish() else leave(null)
            }
        })

        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) askScreen()
        else audioPermission.launch(Manifest.permission.RECORD_AUDIO)
    }

    private fun askScreen() {
        val mpm = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        // Android 14+ would also offer "share one app", which would film only that app; Lyra needs the whole screen
        val intent = if (Build.VERSION.SDK_INT >= 34) mpm.createScreenCaptureIntent(android.media.projection.MediaProjectionConfig.createConfigForDefaultDisplay())
        else mpm.createScreenCaptureIntent()
        screenConsent.launch(intent)
    }

    /** The projection exists: show the recording page (its countdown calls recordGo). */
    private fun showPage() {
        if (pageLoaded || isFinishing) return
        pageLoaded = true
        val root = findViewById<FrameLayout>(android.R.id.content).getChildAt(0) as FrameLayout
        val view = LyraWebView(this).apply { layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT) }
        WebSetup.configure(view, this)
        root.addView(view)
        rpc = Rpc(applicationContext, view, this).also { it.install() }
        web = view
        WebSetup.load(view, "?record=1" + if (intent.getBooleanExtra("fromStart", true)) "&fromStart=1" else "")
    }

    /** Called by the page when its countdown ends. Returns an error message, or null once the recording runs. */
    fun go(title: String): String? {
        val (w, h) = captureSize()
        val dpi = resources.displayMetrics.densityDpi
        val err = RecordService.go(applicationContext, w, h, dpi, title)
        if (err == null) recording = true
        return err
    }

    /** The whole display, scaled down to at most 1080 px wide, with even sides (an encoder needs that). */
    private fun captureSize(): Pair<Int, Int> {
        val m = DisplayMetrics()
        @Suppress("DEPRECATION") windowManager.defaultDisplay.getRealMetrics(m)
        val scale = minOf(1f, 1080f / m.widthPixels)
        val w = (m.widthPixels * scale).toInt() / 2 * 2
        val h = (m.heightPixels * scale).toInt() / 2 * 2
        return Pair(w, h)
    }

    /** Ask the page to play its end card and then stop (the notification's Stop button and Back use this). */
    fun requestFinish() {
        web?.post { web?.evaluateJavascript("window.__lyraRecord&&window.__lyraRecord.finish()", null) }
    }

    /** Stop, save and offer to share. [done] gets the outcome for the page. */
    fun finishNow(done: (String?) -> Unit) {
        if (finishing) return done(null)
        finishing = true
        recording = false
        io.execute {
            val (uri, problem) = RecordService.finish(applicationContext)
            runOnUiThread {
                if (uri == null) {
                    done(problem ?: "The video could not be saved.")
                    leave(problem ?: "The video could not be saved.")
                } else {
                    done(null)
                    Toast.makeText(this, "Saved to Movies/Lyra", Toast.LENGTH_LONG).show()
                    startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT))
                    val send = Intent(Intent.ACTION_SEND).apply {
                        type = "video/mp4"
                        putExtra(Intent.EXTRA_STREAM, uri)
                        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    }
                    startActivity(Intent.createChooser(send, "Share lyric video"))
                    finish()
                }
            }
        }
    }

    /** Cancel without saving anything. */
    fun leave(message: String?) {
        RecordService.discard(applicationContext)
        recording = false
        if (message != null) Toast.makeText(this, message, Toast.LENGTH_LONG).show()
        finish()
    }

    override fun onStop() {
        // leaving the recording page (Home, another app) would record something else: save what we have
        if (recording && !finishing) finishNow { }
        super.onStop()
    }

    override fun onDestroy() {
        if (current === this) current = null
        RecordService.listener = null
        rpc?.dispose()
        web?.destroy()
        io.shutdown()
        super.onDestroy()
    }

    companion object {
        @Volatile var current: RecordActivity? = null

        fun start(ctx: Context, fromStart: Boolean) {
            ctx.startActivity(Intent(ctx, RecordActivity::class.java).putExtra("fromStart", fromStart).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
    }
}
