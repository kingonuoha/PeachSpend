package expo.modules.homewidget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.view.View
import android.widget.RemoteViews
import org.json.JSONArray
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

data class WidgetSnapshot(
  val hasSynced: Boolean,
  val monthSpentText: String,
  val todaySpentText: String,
  val zeroAmountText: String,
  val snapshotDate: String,
  val pricesHidden: Boolean,
  val hasBudget: Boolean,
  val budgetPercent: Int,
  val budgetStatusText: String,
  val streakDays: Int,
  val unreadAlertsCount: Int,
  val updatedAt: Long,
)

class PeachSpendWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(
    context: Context,
    appWidgetManager: AppWidgetManager,
    appWidgetIds: IntArray,
  ) {
    for (appWidgetId in appWidgetIds) {
      updateWidget(context, appWidgetManager, appWidgetId)
    }
    super.onUpdate(context, appWidgetManager, appWidgetIds)
  }

  override fun onReceive(context: Context, intent: Intent) {
    super.onReceive(context, intent)
    val action = intent.action ?: return
    if (
      action == ACTION_REFRESH ||
      action == Intent.ACTION_DATE_CHANGED ||
      action == Intent.ACTION_TIME_CHANGED ||
      action == Intent.ACTION_TIMEZONE_CHANGED ||
      action == Intent.ACTION_MY_PACKAGE_REPLACED
    ) {
      refreshAllWidgets(context)
    }
  }

  companion object {
    const val ACTION_REFRESH = "expo.modules.homewidget.ACTION_REFRESH"
    private const val PREFERENCES_NAME = "expo_peachspend_widget_snapshot"
    private const val AUTO_CAPTURE_PREFERENCES = "expo_auto_capture_pending_detections"
    private const val AUTO_CAPTURE_QUEUE_KEY = "pending_detections"

    private const val KEY_HAS_SYNCED = "has_synced"
    private const val KEY_MONTH_SPENT_TEXT = "month_spent_text"
    private const val KEY_TODAY_SPENT_TEXT = "today_spent_text"
    private const val KEY_ZERO_AMOUNT_TEXT = "zero_amount_text"
    private const val KEY_SNAPSHOT_DATE = "snapshot_date"
    private const val KEY_PRICES_HIDDEN = "prices_hidden"
    private const val KEY_HAS_BUDGET = "has_budget"
    private const val KEY_BUDGET_PERCENT = "budget_percent"
    private const val KEY_BUDGET_STATUS_TEXT = "budget_status_text"
    private const val KEY_STREAK_DAYS = "streak_days"
    private const val KEY_UNREAD_ALERTS_COUNT = "unread_alerts_count"
    private const val KEY_UPDATED_AT = "updated_at"

    private const val RC_ROOT = 1001
    private const val RC_EXPENSE = 1002
    private const val RC_SCAN = 1003
    private const val RC_ALERTS = 1004
    private const val RC_ALERTS_PILL = 1005

    fun saveSnapshot(context: Context, payload: Map<String, Any?>) {
      val prefs = context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
      val budgetPercent = (payload["budgetPercent"] as? Number)?.toInt() ?: 0
      val streakDays = (payload["streakDays"] as? Number)?.toInt() ?: 0
      val unreadAlertsCount = (payload["unreadAlertsCount"] as? Number)?.toInt() ?: 0
      val updatedAt = (payload["updatedAt"] as? Number)?.toLong() ?: System.currentTimeMillis()

      prefs.edit()
        .putBoolean(KEY_HAS_SYNCED, true)
        .putString(KEY_MONTH_SPENT_TEXT, (payload["monthSpentText"] as? String)?.trim().orEmpty())
        .putString(KEY_TODAY_SPENT_TEXT, (payload["todaySpentText"] as? String)?.trim().orEmpty())
        .putString(KEY_ZERO_AMOUNT_TEXT, (payload["zeroAmountText"] as? String)?.trim().orEmpty())
        .putString(KEY_SNAPSHOT_DATE, (payload["snapshotDate"] as? String)?.trim().orEmpty())
        .putBoolean(KEY_PRICES_HIDDEN, payload["pricesHidden"] as? Boolean ?: false)
        .putBoolean(KEY_HAS_BUDGET, payload["hasBudget"] as? Boolean ?: false)
        .putInt(KEY_BUDGET_PERCENT, budgetPercent.coerceAtLeast(0))
        .putString(KEY_BUDGET_STATUS_TEXT, (payload["budgetStatusText"] as? String)?.trim().orEmpty())
        .putInt(KEY_STREAK_DAYS, streakDays.coerceAtLeast(0))
        .putInt(KEY_UNREAD_ALERTS_COUNT, unreadAlertsCount.coerceAtLeast(0))
        .putLong(KEY_UPDATED_AT, updatedAt)
        .commit()
    }

    fun clearSnapshot(context: Context) {
      context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
        .edit()
        .clear()
        .commit()
    }

    fun refreshAllWidgets(context: Context) {
      val manager = AppWidgetManager.getInstance(context)
      val component = ComponentName(context, PeachSpendWidgetProvider::class.java)
      val ids = try {
        manager.getAppWidgetIds(component)
      } catch (_: Exception) {
        intArrayOf()
      }
      for (appWidgetId in ids) {
        updateWidget(context, manager, appWidgetId)
      }
    }

    private fun readSnapshot(context: Context): WidgetSnapshot {
      val prefs = context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
      return WidgetSnapshot(
        hasSynced = prefs.getBoolean(KEY_HAS_SYNCED, false),
        monthSpentText = prefs.getString(KEY_MONTH_SPENT_TEXT, "") ?: "",
        todaySpentText = prefs.getString(KEY_TODAY_SPENT_TEXT, "") ?: "",
        zeroAmountText = prefs.getString(KEY_ZERO_AMOUNT_TEXT, "") ?: "",
        snapshotDate = prefs.getString(KEY_SNAPSHOT_DATE, "") ?: "",
        pricesHidden = prefs.getBoolean(KEY_PRICES_HIDDEN, false),
        hasBudget = prefs.getBoolean(KEY_HAS_BUDGET, false),
        budgetPercent = prefs.getInt(KEY_BUDGET_PERCENT, 0).coerceAtLeast(0),
        budgetStatusText = prefs.getString(KEY_BUDGET_STATUS_TEXT, "") ?: "",
        streakDays = prefs.getInt(KEY_STREAK_DAYS, 0).coerceAtLeast(0),
        unreadAlertsCount = prefs.getInt(KEY_UNREAD_ALERTS_COUNT, 0).coerceAtLeast(0),
        updatedAt = prefs.getLong(KEY_UPDATED_AT, 0L),
      )
    }

    private fun readPendingNativeDetectionsCount(context: Context): Int {
      return try {
        val raw = context.getSharedPreferences(AUTO_CAPTURE_PREFERENCES, Context.MODE_PRIVATE)
          .getString(AUTO_CAPTURE_QUEUE_KEY, null)
          ?: return 0
        JSONArray(raw).length().coerceAtLeast(0)
      } catch (_: Exception) {
        0
      }
    }

    private fun currentLocalDate(): String {
      return SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())
    }

    private fun deepLinkPendingIntent(context: Context, uriString: String, requestCode: Int): PendingIntent {
      val intent = Intent(Intent.ACTION_VIEW, Uri.parse(uriString)).apply {
        setPackage(context.packageName)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
      }
      return PendingIntent.getActivity(
        context,
        requestCode,
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    }

    private fun updateWidget(
      context: Context,
      appWidgetManager: AppWidgetManager,
      appWidgetId: Int,
    ) {
      val snapshot = readSnapshot(context)
      val pendingNativeCount = readPendingNativeDetectionsCount(context)
      val totalAlerts = snapshot.unreadAlertsCount + pendingNativeCount
      val todayDate = currentLocalDate()

      val views = RemoteViews(context.packageName, R.layout.peachspend_home_widget)

      views.setOnClickPendingIntent(R.id.widget_root, deepLinkPendingIntent(context, "app://", RC_ROOT))
      views.setOnClickPendingIntent(R.id.widget_alerts_pill, deepLinkPendingIntent(context, "app://notifications", RC_ALERTS_PILL))
      views.setOnClickPendingIntent(R.id.widget_action_expense, deepLinkPendingIntent(context, "app://expense/manual", RC_EXPENSE))
      views.setOnClickPendingIntent(R.id.widget_action_scan, deepLinkPendingIntent(context, "app://scan", RC_SCAN))
      views.setOnClickPendingIntent(R.id.widget_action_alerts, deepLinkPendingIntent(context, "app://notifications", RC_ALERTS))

      val streakLabel = if (snapshot.streakDays > 0) {
        "${snapshot.streakDays}d streak"
      } else {
        context.getString(R.string.widget_no_streak)
      }
      views.setTextViewText(R.id.widget_streak_pill, streakLabel)

      val alertsPillLabel = if (totalAlerts > 0) {
        "$totalAlerts pending"
      } else {
        context.getString(R.string.widget_alerts_inbox)
      }
      views.setTextViewText(R.id.widget_alerts_pill, alertsPillLabel)

      val alertsButtonLabel = if (totalAlerts > 0) {
        "Alerts ($totalAlerts)"
      } else {
        context.getString(R.string.widget_action_alerts)
      }
      views.setTextViewText(R.id.widget_action_alerts, alertsButtonLabel)

      if (!snapshot.hasSynced || snapshot.monthSpentText.isEmpty()) {
        views.setTextViewText(R.id.widget_month_spent, context.getString(R.string.widget_empty_spend))
        views.setViewVisibility(R.id.widget_today_spent, View.GONE)
        views.setTextViewText(R.id.widget_budget_status, context.getString(R.string.widget_no_budget))
        hideAllProgressBars(views)
      } else {
        views.setTextViewText(R.id.widget_month_spent, snapshot.monthSpentText)

        val todayDisplay = when {
          snapshot.pricesHidden -> snapshot.todaySpentText
          snapshot.snapshotDate != todayDate && snapshot.zeroAmountText.isNotEmpty() -> snapshot.zeroAmountText
          else -> snapshot.todaySpentText
        }
        if (todayDisplay.isNotEmpty()) {
          views.setTextViewText(R.id.widget_today_spent, "Today: $todayDisplay")
          views.setViewVisibility(R.id.widget_today_spent, View.VISIBLE)
        } else {
          views.setViewVisibility(R.id.widget_today_spent, View.GONE)
        }

        val budgetText = snapshot.budgetStatusText.ifEmpty { context.getString(R.string.widget_no_budget) }
        views.setTextViewText(R.id.widget_budget_status, budgetText)

        if (snapshot.hasBudget) {
          val clamped = snapshot.budgetPercent.coerceIn(0, 100)
          when {
            snapshot.budgetPercent >= 100 -> showProgressBar(views, R.id.widget_budget_progress_danger, clamped)
            snapshot.budgetPercent >= 80 -> showProgressBar(views, R.id.widget_budget_progress_warning, clamped)
            else -> showProgressBar(views, R.id.widget_budget_progress_normal, clamped)
          }
        } else {
          hideAllProgressBars(views)
        }
      }

      appWidgetManager.updateAppWidget(appWidgetId, views)
    }

    private fun hideAllProgressBars(views: RemoteViews) {
      views.setViewVisibility(R.id.widget_budget_progress_normal, View.GONE)
      views.setViewVisibility(R.id.widget_budget_progress_warning, View.GONE)
      views.setViewVisibility(R.id.widget_budget_progress_danger, View.GONE)
    }

    private fun showProgressBar(views: RemoteViews, activeViewId: Int, progress: Int) {
      val allIds = intArrayOf(
        R.id.widget_budget_progress_normal,
        R.id.widget_budget_progress_warning,
        R.id.widget_budget_progress_danger,
      )
      for (viewId in allIds) {
        if (viewId == activeViewId) {
          views.setViewVisibility(viewId, View.VISIBLE)
          views.setProgressBar(viewId, 100, progress, false)
        } else {
          views.setViewVisibility(viewId, View.GONE)
        }
      }
    }
  }
}
