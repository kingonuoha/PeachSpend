package expo.modules.autocapture

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.UserManager

// Re-arms listener rebind and periodic keep-alive after boot or app update.
// Never relies on starting a dataSync foreground service from BOOT_COMPLETED on
// Android 12+ where background FGS starts throw ForegroundServiceStartNotAllowedException.
class AutoCaptureBootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val action = intent.action ?: return
    val isSupportedAction = action == Intent.ACTION_BOOT_COMPLETED ||
      action == Intent.ACTION_MY_PACKAGE_REPLACED ||
      (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N && action == Intent.ACTION_LOCKED_BOOT_COMPLETED)
    if (!isSupportedAction) return

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      val userManager = context.getSystemService(Context.USER_SERVICE) as? UserManager
      if (userManager != null && !userManager.isUserUnlocked) return
    }

    val captureEnabled = try {
      AutoCaptureModule.isCaptureEnabled(context)
    } catch (_: Exception) {
      return
    }
    if (!captureEnabled || !AutoCaptureModule.isListenerEnabled(context)) {
      AutoCaptureKeepAliveScheduler.cancel(context)
      return
    }

    AutoCaptureModule.requestListenerRebind(context)
    AutoCaptureKeepAliveScheduler.schedule(context)

    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
      try {
        val guard = Intent(context, AutoCaptureGuardService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          context.startForegroundService(guard)
        } else {
          context.startService(guard)
        }
      } catch (_: Exception) {
        return
      }
    }
  }
}
