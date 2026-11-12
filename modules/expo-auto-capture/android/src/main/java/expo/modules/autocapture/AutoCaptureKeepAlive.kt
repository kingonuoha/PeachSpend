package expo.modules.autocapture

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.SystemClock
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

class AutoCaptureKeepAliveWorker(
  appContext: Context,
  params: WorkerParameters,
) : Worker(appContext, params) {
  override fun doWork(): Result {
    AutoCaptureKeepAliveScheduler.reconcile(applicationContext)
    return Result.success()
  }
}

class AutoCaptureKeepAliveReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    AutoCaptureKeepAliveScheduler.reconcile(context)
  }
}

object AutoCaptureKeepAliveScheduler {
  private const val UNIQUE_WORK_NAME = "expo_auto_capture_keep_alive"
  private const val ALARM_REQUEST_CODE = 4091

  fun reconcile(context: Context) {
    val appContext = context.applicationContext
    if (!AutoCaptureModule.isCaptureEnabled(appContext) || !AutoCaptureModule.isListenerEnabled(appContext)) {
      cancel(appContext)
      return
    }
    if (!AutoCaptureModule.isListenerConnected()) {
      AutoCaptureModule.requestListenerRebind(appContext)
    }
  }

  fun schedule(context: Context) {
    val appContext = context.applicationContext
    if (!AutoCaptureModule.isCaptureEnabled(appContext) || !AutoCaptureModule.isListenerEnabled(appContext)) {
      cancel(appContext)
      return
    }
    try {
      val request = PeriodicWorkRequestBuilder<AutoCaptureKeepAliveWorker>(15, TimeUnit.MINUTES).build()
      WorkManager.getInstance(appContext).enqueueUniquePeriodicWork(
        UNIQUE_WORK_NAME,
        ExistingPeriodicWorkPolicy.KEEP,
        request,
      )
    } catch (_: Exception) {
      // WorkManager may not be initialized in isolated test harnesses.
    }
    try {
      val alarm = appContext.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
      val pending = alarmIntent(appContext)
      alarm.setInexactRepeating(
        AlarmManager.ELAPSED_REALTIME_WAKEUP,
        SystemClock.elapsedRealtime() + AlarmManager.INTERVAL_FIFTEEN_MINUTES,
        AlarmManager.INTERVAL_HOUR,
        pending,
      )
    } catch (_: Exception) {
      return
    }
  }

  fun cancel(context: Context) {
    val appContext = context.applicationContext
    try {
      WorkManager.getInstance(appContext).cancelUniqueWork(UNIQUE_WORK_NAME)
    } catch (_: Exception) {
      // Ignore if WorkManager is unavailable.
    }
    try {
      val alarm = appContext.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
      alarm.cancel(alarmIntent(appContext))
    } catch (_: Exception) {
      return
    }
  }

  private fun alarmIntent(context: Context): PendingIntent {
    val intent = Intent(context, AutoCaptureKeepAliveReceiver::class.java)
    return PendingIntent.getBroadcast(
      context,
      ALARM_REQUEST_CODE,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }
}
