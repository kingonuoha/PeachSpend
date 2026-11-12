package expo.modules.autocapture

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.widget.RemoteViews

// Phase 14 M2: the rich detection alert. An expanded custom notification that
// carries the parsed transaction details (merchant, formatted amount, source
// app, detected time) with three actions: Confirm, Edit, Remind later. The
// Confirm and Remind later actions go to AutoCaptureAlertReceiver as explicit
// broadcasts; the receiver never writes ledger tables, it only records the
// action intent for the JS layer, which applies it through the shared Data and
// AI store boundary. The content tap and the Edit action are VIEW deep links
// into the queued draft sheet (app://detection/<draftId>), so the notification
// tap and the inbox row tap land on the same sheet. A full screen intent
// carries the same deep link so the alert can surface over the lock screen;
// USE_FULL_SCREEN_INTENT is declared via the config plugin, and when the OS
// denies it the alert degrades to an expanded heads up notification.
//
// All strings arrive preformatted from JS (parsed fields only, never raw
// notification text). Nothing is logged here.
object AutoCaptureDetectionAlert {
  const val CHANNEL_ID = "peachspend_detection_alert"
  private const val CHANNEL_NAME = "Payment detection alerts"
  private const val ALERT_NOTIFICATION_ID = 2002
  private const val MAX_FIELD_CHARS = 120

  const val ACTION_CONFIRM = "expo.modules.autocapture.ACTION_DETECTION_CONFIRM"
  const val ACTION_SNOOZE = "expo.modules.autocapture.ACTION_DETECTION_SNOOZE"
  const val EXTRA_DRAFT_ID = "draft_id"

  fun notificationTag(draftId: String): String = "detection:$draftId"

  private fun requestCode(draftId: String, action: String): Int {
    return (draftId + ":" + action).hashCode()
  }

  private fun clean(value: String): String {
    val trimmed = value.trim().replace(Regex("\\s+"), " ")
    return if (trimmed.length > MAX_FIELD_CHARS) trimmed.take(MAX_FIELD_CHARS) else trimmed
  }

  private fun deepLinkIntent(context: Context, draftId: String, view: String?, requestAction: String): PendingIntent {
    val uri = if (view != null) {
      Uri.parse("app://detection/$draftId?view=$view")
    } else {
      Uri.parse("app://detection/$draftId")
    }
    val intent = Intent(Intent.ACTION_VIEW, uri).apply {
      setPackage(context.packageName)
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    }
    return PendingIntent.getActivity(
      context,
      requestCode(draftId, requestAction),
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  private fun receiverIntent(context: Context, action: String, draftId: String): PendingIntent {
    val intent = Intent(context, AutoCaptureAlertReceiver::class.java).apply {
      setAction(action)
      putExtra(EXTRA_DRAFT_ID, draftId)
    }
    return PendingIntent.getBroadcast(
      context,
      requestCode(draftId, action),
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  // Posts the alert. Returns true when the notification manager accepted it.
  // Never throws: a refusal (missing channel, denied post permission on newer
  // Android) reads as false so the JS raiser keeps the draft plus inbox row
  // and the inbox remains the source of truth.
  fun show(
    context: Context,
    draftId: String,
    merchant: String,
    amountText: String,
    sourceLabel: String,
    timeText: String,
    heading: String = "Payment detected",
  ): Boolean {
    if (draftId.isBlank()) return false
    return try {
      val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        val existing = try {
          manager.getNotificationChannel(CHANNEL_ID)
        } catch (_: Exception) {
          null
        }
        if (existing == null) {
          manager.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_HIGH),
          )
        }
      }
      val headingText = clean(heading).ifEmpty { "Payment detected" }
      val merchantText = clean(merchant).ifEmpty { "Payment" }
      val amount = clean(amountText).ifEmpty { "" }
      val source = clean(sourceLabel).ifEmpty { "Payment app" }
      val time = clean(timeText)

      val collapsed = RemoteViews(context.packageName, R.layout.autocapture_detection_small).apply {
        setTextViewText(R.id.detection_title, merchantText)
        setTextViewText(R.id.detection_source, source)
        setTextViewText(R.id.detection_amount, amount)
      }
      val expanded = RemoteViews(context.packageName, R.layout.autocapture_detection_expanded).apply {
        setTextViewText(R.id.detection_heading, headingText)
        setTextViewText(R.id.detection_amount, amount)
        setTextViewText(R.id.detection_merchant, merchantText)
        setTextViewText(R.id.detection_source, if (time.isEmpty()) source else "$source  •  $time")
      }

      val contentIntent = deepLinkIntent(context, draftId, null, "content")
      val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        Notification.Builder(context, CHANNEL_ID)
      } else {
        @Suppress("DEPRECATION")
        Notification.Builder(context)
      }
      builder
        .setSmallIcon(android.R.drawable.ic_dialog_info)
        .setContentTitle(merchantText)
        .setContentText(amount)
        .setContentIntent(contentIntent)
        .setAutoCancel(true)
        .setFullScreenIntent(deepLinkIntent(context, draftId, null, "full_screen"), true)
      // The three argument addAction is deprecated since API 23 in favor of the
      // Action builder, but it is the only form present on every API level,
      // so the actions post on any minSdk without a version branch. Behavior
      // on modern Android is identical: each action lands in the same list.
      // Edit is a deep link, not a broadcast: it opens the queued draft sheet
      // with fields prefilled. The biometric gate wraps the whole tree, so the
      // sheet stays behind the prompt exactly like a manual open.
      @Suppress("DEPRECATION")
      builder
        .addAction(android.R.drawable.ic_dialog_info, "Confirm", receiverIntent(context, ACTION_CONFIRM, draftId))
        .addAction(android.R.drawable.ic_dialog_info, "Edit", deepLinkIntent(context, draftId, "edit", "edit"))
        .addAction(android.R.drawable.ic_dialog_info, "Remind later", receiverIntent(context, ACTION_SNOOZE, draftId))
      // Custom faces need API 26 for the packaged font resources; below that
      // the same strings render through the platform big text style. The
      // guard makes the layout reference safe on every supported device.
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        builder.setStyle(Notification.DecoratedCustomViewStyle())
        builder.setCustomContentView(collapsed)
        builder.setCustomBigContentView(expanded)
      } else {
        @Suppress("DEPRECATION")
        builder.setPriority(Notification.PRIORITY_HIGH)
        builder.setStyle(Notification.BigTextStyle().bigText("$merchantText\n$amount\n$source"))
      }
      manager.notify(notificationTag(draftId), ALERT_NOTIFICATION_ID, builder.build())
      true
    } catch (_: Exception) {
      false
    }
  }

  fun cancel(context: Context, draftId: String) {
    if (draftId.isBlank()) return
    try {
      val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      manager.cancel(notificationTag(draftId), ALERT_NOTIFICATION_ID)
    } catch (_: Exception) {
      return
    }
  }
}
