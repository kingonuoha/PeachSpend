package expo.modules.autocapture

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

// Phase 14 M1: persistent keep alive for the notification listener. Android may
// kill a lone NotificationListenerService process under memory pressure, so a
// lightweight foreground service holds a persistent status bar notice (the OS
// sanctioned pattern) while capture is enabled. The service carries no overlay,
// reads no SMS, and opens no network destination. It only re checks the same
// two gates the listener uses (capture enabled plus listener granted) and stops
// itself when either gate is off, so disabling capture always removes the
// notice. M2 owns the rich detection notification; this notice is the static
// persistent one only.
class AutoCaptureGuardService : Service() {
  override fun onCreate() {
    super.onCreate()
    AutoCaptureModule.setGuardRunning(true)
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (!AutoCaptureModule.isCaptureEnabled(this) || !AutoCaptureModule.isListenerEnabled(this)) {
      stopSelf()
      return START_NOT_STICKY
    }
    startAsForeground()
    return START_STICKY
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onDestroy() {
    AutoCaptureModule.setGuardRunning(false)
    super.onDestroy()
  }

  private fun startAsForeground() {
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val existing = try {
        manager.getNotificationChannel(CHANNEL_ID)
      } catch (_: Exception) {
        null
      }
      if (existing == null) {
        manager.createNotificationChannel(
          NotificationChannel(CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_LOW),
        )
      }
    }
    val launch = packageManager.getLaunchIntentForPackage(packageName)
    val pending = launch?.let {
      android.app.PendingIntent.getActivity(
        this,
        0,
        it,
        android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE,
      )
    }
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(this)
    }
    builder
      .setContentTitle(NOTICE_TITLE)
      .setContentText(NOTICE_TEXT)
      .setSmallIcon(android.R.drawable.ic_dialog_info)
      .setOngoing(true)
    if (pending != null) builder.setContentIntent(pending)
    val notice = builder.build()
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        startForeground(
          NOTICE_ID,
          notice,
          ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
        )
      } else {
        startForeground(NOTICE_ID, notice)
      }
    } catch (_: Exception) {
      stopSelf()
    }
  }

  companion object {
    const val CHANNEL_ID = "peachspend_auto_capture_guard"
    private const val CHANNEL_NAME = "Auto-capture listener"
    private const val NOTICE_ID = 1001
    private const val NOTICE_TITLE = "PeachSpend auto-capture is on"
    private const val NOTICE_TEXT = "Listening for payment notifications. Tap to manage."
  }
}
