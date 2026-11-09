package expo.modules.autocapture

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build

// Phase 14 M1: re arm after reboot. Holds RECEIVE_BOOT_COMPLETED (declared via
// the config plugin) and restarts the guard service only when the persisted
// capture toggle is on and the listener grant survived the reboot. When either
// gate is off nothing starts, so a user who disabled capture never gets a
// resurrected notice. No overlay, no SMS, no network. Starting a foreground
// service from the background is refused on newer Android, so the start is
// guarded and a refusal simply leaves the listener dormant until the app opens.
class AutoCaptureBootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
    if (!AutoCaptureModule.isCaptureEnabled(context)) return
    if (!AutoCaptureModule.isListenerEnabled(context)) return
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
