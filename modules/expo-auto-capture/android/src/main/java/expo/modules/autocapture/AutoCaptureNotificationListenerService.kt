package expo.modules.autocapture

import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

class AutoCaptureNotificationListenerService : NotificationListenerService() {
  override fun onNotificationPosted(sbn: StatusBarNotification) {
    if (!AutoCaptureModule.isCaptureEnabled(applicationContext)) return
    if (!AutoCaptureModule.isListenerEnabled(applicationContext)) return
    val packageName = sbn.packageName
    if (!AutoCaptureModule.isSupportedPackage(packageName)) return
    val extras = sbn.notification.extras
    val text = sanitize(extras.getCharSequence("android.text")?.toString() ?: return) ?: return
    AutoCaptureModule.publishNotification(
      mapOf(
        "id" to "${packageName}:${sbn.id}:${sbn.postTime}",
        "packageName" to packageName,
         "appName" to AutoCaptureModule.displayName(packageName),
        "text" to text,
        "receivedAt" to sbn.postTime,
      ),
    )
  }

  private fun sanitize(value: String): String? {
    if (value.length > 500 || Regex("https?://|www\\.|\\b(?:card|account)\\s*[:#-]?\\s*\\d{3,}", RegexOption.IGNORE_CASE).containsMatchIn(value)) return null
    val projection = value.replace(Regex("\\b\\d{4,}\\b"), "").replace(Regex("\\s+"), " ").trim()
    return projection.takeIf { it.length in 4..240 }
  }
}
