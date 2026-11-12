package expo.modules.autocapture

import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.UUID

// Native transaction parser mirroring app/data/AutoCaptureSource.ts so
// detections arriving while reactContext is null parse deterministically into
// structured fields without storing or logging raw notification text.
object AutoCaptureNativeParser {
  private const val DEFAULT_CURRENCY = "NGN"

  data class ParsedDetection(
    val draftId: String,
    val sourceId: String,
    val packageName: String,
    val appName: String,
    val receivedAt: Long,
    val amount: Double,
    val currency: String,
    val kind: String,
    val merchant: String,
    val sourceName: String?,
    val confidence: Double?,
    val directionAmbiguous: Boolean,
    val note: String,
    val amountText: String,
    val timeText: String,
  )

  private enum class Direction {
    DEBIT,
    CREDIT,
    AMBIGUOUS,
  }

  private val SHAPED_KEYWORD_PATTERN = Regex(
    "\\b(debit|credit|spend|spent|pay|receiv|sent|transfer|withdraw|deposit|transact|balance)\\w*",
    RegexOption.IGNORE_CASE,
  )

  private const val AMOUNT_CORE =
    """\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?|\d+,\d{1,2}"""
  private const val AMOUNT_PREFIX = """(?:[$€£₦]|USD|EUR|GBP|NGN|N(?=\s*\d))"""
  private const val AMOUNT_SUFFIX = """(?:[$€£₦]|USD|EUR|GBP|NGN)"""

  private val PREFIX_AMOUNT_PATTERN = Regex(
    "$AMOUNT_PREFIX\\s*($AMOUNT_CORE)",
    RegexOption.IGNORE_CASE,
  )
  private val SUFFIX_AMOUNT_PATTERN = Regex(
    "($AMOUNT_CORE)\\s*$AMOUNT_SUFFIX",
    RegexOption.IGNORE_CASE,
  )
  private val MERCHANT_PATTERN = Regex(
    """\b(?:at|to|from)\b\s+([^.;|]+?)(?:\s+(?:on|with|using)\b|[.;|]|$)""",
    RegexOption.IGNORE_CASE,
  )
  private val DEBIT_SIGNAL_PATTERN = Regex(
    """\btxn\s*:\s*dr\b|\bdebit(?:ed)?\b|\bsent\b|\bpaid\b|\bspent\b""",
    RegexOption.IGNORE_CASE,
  )
  private val CREDIT_SIGNAL_PATTERN = Regex(
    """\btxn\s*:\s*cr\b|\bcredit(?:ed)?\b|\breceived\b""",
    RegexOption.IGNORE_CASE,
  )
  private val DES_FIELD_PATTERN = Regex(
    """\bdes\s*:\s*([\s\S]*?)(?=\b(?:acc|amt|bal|date|txn|time|ref|narration|ac)\s*:|$)""",
    RegexOption.IGNORE_CASE,
  )
  private val FOOTER_CUT_PATTERN = Regex(
    """\bDial\s*\*|\bto\s+cancel\b|\bcancel\s+SMS\b|\bLoan\?""",
    RegexOption.IGNORE_CASE,
  )
  private val FOOTER_TEST_PATTERN = Regex(
    """\bDial\s*\*|\bcancel\s+SMS\b|\bLoan\?""",
    RegexOption.IGNORE_CASE,
  )
  private val BALANCE_ONLY_SEGMENT_PATTERN = Regex(
    """^\s*(?:Bal|Avl\.?\s*Bal|Available\s+Bal(?:ance)?)\s*:?\s*(?:[A-Z]{0,3}\s?)?[\d,.]+\s*$""",
    RegexOption.IGNORE_CASE,
  )
  private val DIAL_CLAUSE_PATTERN = Regex("""\bDial\s*\*[\d*]*(?:\*[\d*]+)*#?[^\n;|]*""", RegexOption.IGNORE_CASE)
  private val TO_CANCEL_CLAUSE_PATTERN = Regex("""\bto\s+cancel\s+SMS\s+Alerts?[^\n;|]*""", RegexOption.IGNORE_CASE)
  private val CANCEL_CLAUSE_PATTERN = Regex("""\bcancel\s+SMS\s+Alerts?[^\n;|]*""", RegexOption.IGNORE_CASE)
  private val LOAN_CLAUSE_PATTERN = Regex("""\bLoan\?[^\n;|]*""", RegexOption.IGNORE_CASE)
  private val INCOME_FROM_PATTERN = Regex("""\bfrom\s+([^/;|]+?)\s*$""", RegexOption.IGNORE_CASE)
  private val CODE_PREFIX_PATTERN = Regex("""^[A-Z]{2,}-""")
  private val WHITESPACE_PATTERN = Regex("""\s+""")
  private val GROUPED_THOUSANDS_PATTERN = Regex("""^\d{1,3}(?:,\d{3})+$""")
  private val FOR_PREFIX_PATTERN = Regex("""^For\s+""", RegexOption.IGNORE_CASE)

  private val EUR_PATTERN = Regex("""€|EUR""", RegexOption.IGNORE_CASE)
  private val GBP_PATTERN = Regex("""£|GBP""", RegexOption.IGNORE_CASE)
  private val NGN_PATTERN = Regex("""₦|NGN""", RegexOption.IGNORE_CASE)
  private val BARE_N_PATTERN = Regex("""(?:^|\s)N(?=\s*\d)""")
  private val USD_PATTERN = Regex("""\$|USD""", RegexOption.IGNORE_CASE)

  fun parse(payload: Map<String, Any?>, nowMs: Long = System.currentTimeMillis()): ParsedDetection? {
    val notificationId = (payload["id"] as? String)?.trim().orEmpty()
    val packageName = (payload["packageName"] as? String)?.trim().orEmpty()
    val rawText = (payload["text"] as? String)?.trim().orEmpty()
    val rawTitle = (payload["title"] as? String)?.trim()?.takeIf { it.isNotEmpty() }
    val receivedAt = (payload["receivedAt"] as? Number)?.toLong() ?: 0L
    if (packageName.isEmpty() || rawText.isEmpty() || receivedAt <= 0L) return null

    val combined = if (rawTitle != null) "$rawTitle $rawText" else rawText
    if (!AutoCaptureModule.isSupportedPackage(packageName) && !SHAPED_KEYWORD_PATTERN.containsMatchIn(combined)) {
      return null
    }

    val stripped = stripSmsFooters(combined)
    val amountToken = PREFIX_AMOUNT_PATTERN.find(stripped)?.groupValues?.getOrNull(1)
      ?: SUFFIX_AMOUNT_PATTERN.find(stripped)?.groupValues?.getOrNull(1)
      ?: return null
    val amount = normalizeGroupedAmount(amountToken) ?: return null
    val currency = inferCurrency(stripped)
    val displayName = resolveSourceDisplayName(packageName)
    val sourceId = AutoCaptureModule.sourceId(packageName)
    val desValue = extractDesField(stripped)
    val direction = detectTransferDirection(stripped)

    val kind: String
    val merchant: String
    val sourceName: String?
    val directionAmbiguous: Boolean
    val note: String

    if (direction == Direction.CREDIT) {
      val resolvedSender = extractIncomeSourceName(desValue, resolveDesMerchant(desValue, stripped)) ?: return null
      kind = "income"
      merchant = resolvedSender
      sourceName = resolvedSender
      directionAmbiguous = false
      note = "Detected from $displayName"
    } else {
      val resolvedMerchant = resolveDesMerchant(desValue, stripped) ?: return null
      kind = "expense"
      merchant = resolvedMerchant
      sourceName = null
      directionAmbiguous = (direction == Direction.AMBIGUOUS)
      note = if (directionAmbiguous) {
        "Detected from $displayName (direction unclear, kept as expense)"
      } else {
        "Detected from $displayName"
      }
    }

    val draftId = buildDeterministicDraftId(notificationId, packageName, receivedAt, kind, merchant, amount)
    return ParsedDetection(
      draftId = draftId,
      sourceId = sourceId,
      packageName = packageName,
      appName = displayName,
      receivedAt = receivedAt,
      amount = amount,
      currency = currency,
      kind = kind,
      merchant = merchant,
      sourceName = sourceName,
      confidence = null,
      directionAmbiguous = directionAmbiguous,
      note = note,
      amountText = formatCurrency(amount, currency),
      timeText = formatRelativeTime(receivedAt, nowMs),
    )
  }

  fun resolveSourceDisplayName(packageName: String): String {
    val clean = packageName.trim()
    if (clean.isEmpty()) return "Payment app"
    AutoCaptureModule.registryDisplayName(clean)?.let { return it }
    if (clean == "com.android.mms") return "Messages"
    return clean.split('.').lastOrNull { it.isNotEmpty() } ?: clean
  }

  private fun buildDeterministicDraftId(
    notificationId: String,
    packageName: String,
    receivedAt: Long,
    kind: String,
    merchant: String,
    amount: Double,
  ): String {
    val seed = notificationId.ifEmpty { "$packageName|$receivedAt|$kind|$merchant|$amount" }
    val uuid = UUID.nameUUIDFromBytes(seed.toByteArray(Charsets.UTF_8)).toString()
    return "native-$uuid"
  }

  private fun detectTransferDirection(text: String): Direction {
    val debit = DEBIT_SIGNAL_PATTERN.containsMatchIn(text)
    val credit = CREDIT_SIGNAL_PATTERN.containsMatchIn(text)
    return when {
      debit && !credit -> Direction.DEBIT
      credit && !debit -> Direction.CREDIT
      else -> Direction.AMBIGUOUS
    }
  }

  private fun extractDesField(text: String): String? {
    val value = DES_FIELD_PATTERN.find(text)?.groupValues?.getOrNull(1)?.trim()
    return value?.takeIf { it.isNotEmpty() }
  }

  private fun cleanDesValue(raw: String): String {
    val match = FOOTER_CUT_PATTERN.find(raw)
    val sliced = if (match != null) raw.substring(0, match.range.first) else raw
    val normalized = sliced.replace(WHITESPACE_PATTERN, " ").trim()
    return normalized.replace(FOR_PREFIX_PATTERN, "")
  }

  private fun isFooterText(value: String): Boolean = FOOTER_TEST_PATTERN.containsMatchIn(value)

  private fun isBalanceOnlySegment(segment: String): Boolean = BALANCE_ONLY_SEGMENT_PATTERN.matches(segment)

  private fun stripSmsFooters(text: String): String {
    val withoutClauses = text
      .replace(DIAL_CLAUSE_PATTERN, " ")
      .replace(TO_CANCEL_CLAUSE_PATTERN, " ")
      .replace(CANCEL_CLAUSE_PATTERN, " ")
      .replace(LOAN_CLAUSE_PATTERN, " ")
    return withoutClauses
      .split('|', '\n')
      .filter { !isBalanceOnlySegment(it) }
      .joinToString(" ")
      .replace(WHITESPACE_PATTERN, " ")
      .trim()
  }

  private fun resolveDesMerchant(desValue: String?, strippedText: String): String? {
    if (desValue != null) {
      val cleaned = cleanDesValue(desValue)
      if (cleaned.isNotEmpty() && !isFooterText(cleaned)) {
        val inner = MERCHANT_PATTERN.find(cleaned)?.groupValues?.getOrNull(1)?.trim()
        if (!inner.isNullOrEmpty() && !isFooterText(inner)) return inner
        return cleaned
      }
    }
    val generic = MERCHANT_PATTERN.find(strippedText)?.groupValues?.getOrNull(1)?.trim()
    return generic?.takeIf { it.isNotEmpty() }
  }

  private fun extractIncomeSourceName(desValue: String?, fallbackMerchant: String?): String? {
    if (desValue != null) {
      val fromMatch = INCOME_FROM_PATTERN.find(desValue)?.groupValues?.getOrNull(1)?.trim()
      if (!fromMatch.isNullOrEmpty()) return fromMatch
      val firstSegment = desValue.split('/')[0].trim().replace(CODE_PREFIX_PATTERN, "")
      if (firstSegment.isNotEmpty()) return firstSegment
    }
    return fallbackMerchant
  }

  private fun normalizeGroupedAmount(raw: String): Double? {
    val value = raw.trim()
    if (value.isEmpty()) return null
    val canonical = when {
      value.contains('.') && value.contains(',') -> value.replace(",", "")
      value.contains(',') && GROUPED_THOUSANDS_PATTERN.matches(value) -> value.replace(",", "")
      value.contains(',') -> value.replace(',', '.')
      else -> value
    }
    val parsed = canonical.toDoubleOrNull() ?: return null
    return parsed.takeIf { it.isFinite() && it > 0.0 }
  }

  private fun inferCurrency(text: String): String = when {
    EUR_PATTERN.containsMatchIn(text) -> "EUR"
    GBP_PATTERN.containsMatchIn(text) -> "GBP"
    NGN_PATTERN.containsMatchIn(text) || BARE_N_PATTERN.containsMatchIn(text) -> "NGN"
    USD_PATTERN.containsMatchIn(text) -> "USD"
    else -> DEFAULT_CURRENCY
  }

  private fun formatCurrency(amount: Double, currency: String): String {
    val magnitude = kotlin.math.abs(amount)
    val whole = magnitude == kotlin.math.rint(magnitude) && magnitude < Long.MAX_VALUE.toDouble()
    val pattern = if (whole) "#,##0" else "#,##0.00"
    val number = DecimalFormat(pattern, DecimalFormatSymbols(Locale.US)).format(magnitude)
    val prefix = if (amount < 0.0) "-" else ""
    return when (currency.uppercase(Locale.US)) {
      "USD", "CAD", "AUD" -> "$prefix$" + number
      "EUR" -> "$prefix€$number"
      "GBP" -> "$prefix£$number"
      "JPY" -> "$prefix¥$number"
      "NGN" -> "$prefix₦$number"
      "SEK" -> "$prefix$number kr"
      else -> "$prefix$currency $number"
    }
  }

  private fun formatRelativeTime(timestampMs: Long, nowMs: Long): String {
    val diffMs = (nowMs - timestampMs).coerceAtLeast(0L)
    val mins = diffMs / 60_000L
    if (mins < 1L) return "Just now"
    if (mins < 60L) return if (mins == 1L) "1 min ago" else "$mins mins ago"
    val hours = diffMs / 3_600_000L
    if (hours < 24L) return if (hours == 1L) "1 hr ago" else "$hours hrs ago"
    return SimpleDateFormat("MMM dd, HH:mm", Locale.US).format(Date(timestampMs))
  }
}
