package expo.modules.autocapture

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

class AutoCaptureNotificationListenerService : NotificationListenerService() {
  override fun onListenerConnected() {
    super.onListenerConnected()
    AutoCaptureModule.setListenerConnected(true)
    if (AutoCaptureModule.isCaptureEnabled(applicationContext) && AutoCaptureModule.isListenerEnabled(applicationContext)) {
      AutoCaptureKeepAliveScheduler.schedule(applicationContext)
    }
  }

  override fun onListenerDisconnected() {
    AutoCaptureModule.setListenerConnected(false)
    if (AutoCaptureModule.isCaptureEnabled(applicationContext) && AutoCaptureModule.isListenerEnabled(applicationContext)) {
      AutoCaptureModule.requestListenerRebind(applicationContext)
      AutoCaptureKeepAliveScheduler.schedule(applicationContext)
    }
    super.onListenerDisconnected()
  }

  override fun onNotificationPosted(sbn: StatusBarNotification) {
    if (!AutoCaptureModule.isCaptureEnabled(applicationContext)) return
    if (!AutoCaptureModule.isListenerEnabled(applicationContext)) return
    val packageName = sbn.packageName
    val extras = sbn.notification.extras
    val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()
    val text = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString()
    val bigText = extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString()
    val sanitized = sanitize(title, text, bigText) ?: return
    // Single pipeline forward gate (Phase 13, FR-SHNEW.2): a named registry
    // package forwards as today; any other package forwards only when the
    // sanitized signal carries an amount like pattern. This is a cheap native
    // pre-check to limit bridge wakeups only. The full keyword plus amount
    // plus merchant gate lives in JS (parseNotificationCandidate), which is
    // the sole decider of whether a draft is produced.
    val combined = if (sanitized.title != null) "${sanitized.title} ${sanitized.text}" else sanitized.text
    if (!AutoCaptureModule.isSupportedPackage(packageName) && !hasAmountLikeSignal(combined)) return
    val payload = mutableMapOf<String, Any?>(
      "id" to "${packageName}:${sbn.id}:${sbn.postTime}",
      "packageName" to packageName,
      "appName" to AutoCaptureModule.displayName(packageName),
      "text" to sanitized.text,
      "receivedAt" to sbn.postTime,
    )
    if (sanitized.title != null) payload["title"] = sanitized.title
    AutoCaptureModule.publishNotification(applicationContext, payload)
  }

  private data class SanitizedNotification(val title: String?, val text: String)

  // Parity rule with the Data and AI boundary (app/data/AutoCaptureSource.ts):
  // reject when the combined title plus text exceeds 280 chars, when the
  // combined signal contains a URL or a card or account identifier (13 to 19
  // digit run included), or when the body is blank. Plain amounts are never
  // stripped or redacted. A rejection returns null with no log of raw text.
  private fun sanitize(title: String?, text: String?, bigText: String?): SanitizedNotification? {
    val body = combineBody(text, bigText) ?: return null
    val cleanTitle = title?.let { normalize(it) }?.takeIf { it.isNotEmpty() }
    val combined = if (cleanTitle != null) "$cleanTitle $body" else body
    if (combined.length > MAX_NOTIFICATION_TEXT) return null
    if (UNSAFE_PATTERN.containsMatchIn(combined)) return null
    return SanitizedNotification(cleanTitle, body)
  }

  private fun combineBody(text: String?, bigText: String?): String? {
    val short = normalize(text)
    val expanded = normalize(bigText)
    val body = when {
      short.isEmpty() -> expanded
      expanded.isEmpty() -> short
      expanded.contains(short) -> expanded
      short.contains(expanded) -> short
      else -> "$short $expanded"
    }
    return body.takeIf { it.isNotEmpty() }
  }

  private fun normalize(value: String?): String {
    if (value == null) return ""
    return value.replace(Regex("\\s+"), " ").trim()
  }

  companion object {
    private const val MAX_NOTIFICATION_TEXT = 280
    private val UNSAFE_PATTERN = Regex(
      "https?://|www\\.|\\b(?:card|account)\\s*(?:ending|number|no\\.?|#)?\\s*\\d{2,}|\\b\\d{13,19}\\b",
      RegexOption.IGNORE_CASE,
    )
    // Cheap amount like pre-check for the forward gate above. Matches a
    // currency token next to digits, a grouped or decimal digit run, or a
    // bare run of 3 or more digits. Deliberately looser than the JS amount
    // pattern so it never drops a transaction the full gate would accept;
    // anything forwarded still passes the JS keyword plus merchant gate
    // before a draft can exist.
    private val AMOUNT_LIKE_PATTERN = Regex(
      "(?:[$€£₦]|USD|EUR|GBP|NGN|N(?=\\s*\\d))\\s*\\d|\\d[\\d,]*\\.\\d{1,2}|\\d{1,3}(?:,\\d{3})+|\\b\\d{3,}\\b",
      RegexOption.IGNORE_CASE,
    )
  }

  private fun hasAmountLikeSignal(combined: String): Boolean = AMOUNT_LIKE_PATTERN.containsMatchIn(combined)
}
