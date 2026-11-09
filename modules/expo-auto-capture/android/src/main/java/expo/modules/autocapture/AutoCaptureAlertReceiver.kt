package expo.modules.autocapture

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

// Phase 14 M2: handles the Confirm and Remind later actions of the rich
// detection alert. The receiver performs no ledger, draft, or inbox write
// itself: the data layer single writer rule keeps every table write in the TS
// store functions, and this receiver cannot call them without a live JS
// runtime. Instead it records the action intent durably in SharedPreferences
// and emits it to JS when the runtime is alive. The JS drain
// (consumePendingAlertAction plus onAlertAction) applies Confirm through the
// shared save boundary and Remind later through the 24 hour snooze, then
// cancels the device ping. A Confirm recorded while the process is dead
// completes on the next app start through the same boundary; it is never
// applied twice because the drain consumes each record once and the store
// reports already resolved drafts instead of re applying them.
//
// Stored records carry the draft id, the action, and the timestamp only. No
// raw notification text, no amount, no key.
class AutoCaptureAlertReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val draftId = intent.getStringExtra(AutoCaptureDetectionAlert.EXTRA_DRAFT_ID)?.trim()
    if (draftId.isNullOrEmpty()) return
    val action = when (intent.action) {
      AutoCaptureDetectionAlert.ACTION_CONFIRM -> PENDING_CONFIRM
      AutoCaptureDetectionAlert.ACTION_SNOOZE -> PENDING_SNOOZE
      else -> return
    }
    try {
      recordPendingAction(context, draftId, action)
    } catch (_: Exception) {
      return
    }
    // Live runtime delivery is best effort: the durable record above is the
    // source of truth and the JS drain picks it up even if the emit lands
    // nowhere.
    try {
      AutoCaptureModule.publishAlertAction(draftId, action)
    } catch (_: Exception) {
      return
    }
  }

  companion object {
    const val PENDING_CONFIRM = "confirm"
    const val PENDING_SNOOZE = "snooze"

    private const val PREFERENCES_NAME = "expo_auto_capture_alert_actions"

    fun recordPendingAction(context: Context, draftId: String, action: String) {
      context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
        .edit()
        .putString(keyFor(draftId), action + "|" + System.currentTimeMillis())
        .apply()
    }

    // Consumes one pending record, oldest recorded action first. Each draft
    // holds a single slot, so a later action overwrites an earlier one for the
    // same draft: a Remind later after a Confirm reads as snooze. The JS layer
    // resolves the outcome (already resolved drafts report instead of re
    // applying), so the overwrite cannot double apply.
    fun consumePendingAction(context: Context): Map<String, String?>? {
      val prefs = context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
      val parsed = prefs.all.entries
        .filter { it.value is String }
        .mapNotNull { entry ->
          val raw = entry.value as String
          val draftId = entry.key.removePrefix("draft:")
          val parts = raw.split("|")
          if (draftId.isBlank() || parts.isEmpty() || parts[0].isBlank()) {
            prefs.edit().remove(entry.key).apply()
            null
          } else {
            Triple(entry.key, draftId, parts)
          }
        }
        .sortedBy { it.third.getOrNull(1)?.toLongOrNull() ?: Long.MAX_VALUE }
      if (parsed.isEmpty()) return null
      val (key, draftId, parts) = parsed.first()
      prefs.edit().remove(key).apply()
      return mapOf(
        "draftId" to draftId,
        "action" to parts[0],
        "receivedAt" to (parts.getOrNull(1) ?: "0"),
      )
    }

    private fun keyFor(draftId: String): String = "draft:$draftId"
  }
}
