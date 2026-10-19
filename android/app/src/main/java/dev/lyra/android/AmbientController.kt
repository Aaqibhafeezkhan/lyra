package dev.lyra.android

import android.app.Activity
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import android.widget.RemoteViews

/**
 * One switch for the ambient (always-on-display style) screen, used by the Quick Settings tile, the home-screen
 * widget, the app-icon shortcut and Settings. Touching the ambient screen does NOT leave it; the switch does.
 */
object AmbientController {
    @Volatile var activity: AmbientActivity? = null

    fun isOn(): Boolean = activity != null

    fun toggle(ctx: Context) {
        val a = activity
        if (a != null) a.finishAndRemoveTask()
        else ctx.startActivity(Intent(ctx, AmbientActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    /** Called whenever ambient mode starts or stops: refresh the tile and the widget. */
    fun changed(ctx: Context) {
        runCatching { TileService.requestListeningState(ctx, ComponentName(ctx, AmbientTileService::class.java)) }
        AmbientWidget.refresh(ctx)
    }
}

/** Quick Settings tile ("Lyra ambient"): tap to turn the ambient screen on or off. */
class AmbientTileService : TileService() {
    override fun onStartListening() {
        super.onStartListening()
        render()
    }

    override fun onClick() {
        super.onClick()
        val a = AmbientController.activity
        if (a != null) {
            a.finishAndRemoveTask()
        } else {
            val i = Intent(this, AmbientActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            if (Build.VERSION.SDK_INT >= 34) startActivityAndCollapse(PendingIntent.getActivity(this, 0, i, PendingIntent.FLAG_IMMUTABLE))
            else @Suppress("DEPRECATION") startActivityAndCollapse(i)
        }
        render()
    }

    private fun render() {
        val t = qsTile ?: return
        val on = AmbientController.isOn()
        t.state = if (on) Tile.STATE_ACTIVE else Tile.STATE_INACTIVE
        t.label = "Lyra ambient"
        if (Build.VERSION.SDK_INT >= 29) t.subtitle = if (on) "On" else "Off"
        t.updateTile()
    }
}

/** Opens and closes ambient mode from a shortcut or the widget, without showing any screen of its own. */
class AmbientToggleActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        AmbientController.toggle(this)
        finish()
    }
}

/** Home-screen widget: one button that switches ambient mode on or off and shows which it is. */
class AmbientWidget : android.appwidget.AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        refresh(context)
    }

    companion object {
        fun refresh(ctx: Context) {
            val mgr = AppWidgetManager.getInstance(ctx)
            val ids = mgr.getAppWidgetIds(ComponentName(ctx, AmbientWidget::class.java))
            if (ids.isEmpty()) return
            val on = AmbientController.isOn()
            val views = RemoteViews(ctx.packageName, R.layout.ambient_widget)
            views.setTextViewText(R.id.ambient_widget_label, if (on) "Ambient · On" else "Ambient · Off")
            views.setInt(R.id.ambient_widget_root, "setBackgroundResource", if (on) R.drawable.widget_bg_on else R.drawable.widget_bg_off)
            val pi = PendingIntent.getActivity(ctx, 5, Intent(ctx, AmbientToggleActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), PendingIntent.FLAG_IMMUTABLE)
            views.setOnClickPendingIntent(R.id.ambient_widget_root, pi)
            mgr.updateAppWidget(ids, views)
        }
    }
}
