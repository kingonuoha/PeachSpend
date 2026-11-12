package expo.modules.autocapture

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

// Capped ring buffer persisting parsed detection fields only when the JS
// runtime is dead. Never writes raw notification text or unredacted bodies
// to SharedPreferences or logs.
object PendingDetectionQueue {
  private const val PREFERENCES_NAME = "expo_auto_capture_pending_detections"
  private const val QUEUE_KEY = "pending_detections"
  private const val MAX_ENTRIES = 50
  private val lock = Any()

  fun enqueue(context: Context, detection: AutoCaptureNativeParser.ParsedDetection) {
    synchronized(lock) {
      val entries = readArray(context)
      for (i in 0 until entries.length()) {
        val existing = entries.optJSONObject(i) ?: continue
        if (existing.optString("draftId") == detection.draftId) {
          return
        }
      }
      while (entries.length() >= MAX_ENTRIES) {
        entries.remove(0)
      }
      entries.put(toJson(detection))
      writeArray(context, entries)
    }
  }

  fun consumeNext(context: Context): Map<String, Any?>? {
    synchronized(lock) {
      val entries = readArray(context)
      while (entries.length() > 0) {
        val head = entries.optJSONObject(0)
        entries.remove(0)
        if (head == null) {
          writeArray(context, entries)
          continue
        }
        val mapped = toMap(head)
        writeArray(context, entries)
        if (mapped != null) return mapped
      }
      return null
    }
  }

  private fun readArray(context: Context): JSONArray {
    val raw = context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
      .getString(QUEUE_KEY, null)
      ?: return JSONArray()
    return try {
      JSONArray(raw)
    } catch (_: Exception) {
      JSONArray()
    }
  }

  private fun writeArray(context: Context, entries: JSONArray) {
    context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
      .edit()
      .putString(QUEUE_KEY, entries.toString())
      .commit()
  }

  private fun toJson(detection: AutoCaptureNativeParser.ParsedDetection): JSONObject {
    return JSONObject().apply {
      put("draftId", detection.draftId)
      put("sourceId", detection.sourceId)
      put("packageName", detection.packageName)
      put("appName", detection.appName)
      put("receivedAt", detection.receivedAt)
      put("amount", detection.amount)
      put("currency", detection.currency)
      put("kind", detection.kind)
      put("merchant", detection.merchant)
      if (detection.sourceName != null) {
        put("sourceName", detection.sourceName)
      } else {
        put("sourceName", JSONObject.NULL)
      }
      if (detection.confidence != null) {
        put("confidence", detection.confidence)
      } else {
        put("confidence", JSONObject.NULL)
      }
      put("directionAmbiguous", detection.directionAmbiguous)
      put("note", detection.note)
    }
  }

  private fun toMap(obj: JSONObject): Map<String, Any?>? {
    val draftId = obj.optString("draftId", "").trim()
    val packageName = obj.optString("packageName", "").trim()
    val merchant = obj.optString("merchant", "").trim()
    val currency = obj.optString("currency", "").trim()
    val kind = obj.optString("kind", "").trim()
    val receivedAt = obj.optLong("receivedAt", 0L)
    val amount = obj.optDouble("amount", Double.NaN)
    if (
      draftId.isEmpty() ||
      packageName.isEmpty() ||
      merchant.isEmpty() ||
      currency.isEmpty() ||
      (kind != "expense" && kind != "income") ||
      receivedAt <= 0L ||
      !amount.isFinite() ||
      amount <= 0.0
    ) {
      return null
    }
    val sourceName = if (obj.isNull("sourceName")) null else obj.optString("sourceName", "").trim().takeIf { it.isNotEmpty() }
    val confidence = if (obj.isNull("confidence")) {
      null
    } else {
      val value = obj.optDouble("confidence", Double.NaN)
      value.takeIf { it.isFinite() && it > 0.0 && it <= 1.0 }
    }
    return mapOf(
      "draftId" to draftId,
      "sourceId" to obj.optString("sourceId", packageName),
      "packageName" to packageName,
      "appName" to obj.optString("appName", "Payment app"),
      "receivedAt" to receivedAt,
      "amount" to amount,
      "currency" to currency,
      "kind" to kind,
      "merchant" to merchant,
      "sourceName" to sourceName,
      "confidence" to confidence,
      "directionAmbiguous" to obj.optBoolean("directionAmbiguous", false),
      "note" to obj.optString("note", ""),
    )
  }
}
