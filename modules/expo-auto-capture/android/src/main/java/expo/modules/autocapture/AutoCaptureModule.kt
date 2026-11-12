package expo.modules.autocapture

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import android.service.notification.NotificationListenerService
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class AutoCaptureModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ExpoAutoCapture")
    Events("onNotification", "onAlertAction")

    OnStartObserving("onNotification") {
      hasNotificationObserver = true
    }

    OnStopObserving("onNotification") {
      hasNotificationObserver = false
    }

    AsyncFunction("getPermissionState") { mapOf(
      "status" to if (isListenerEnabled()) "granted" else "denied",
      "canRequest" to false,
    ) }

    AsyncFunction("getSupportedSources") {
      supportedPackages.map { packageName ->
        mapOf(
          "id" to sourceId(packageName),
          "packageName" to packageName,
          "displayName" to displayNames[packageName]!!,
          "status" to if (isPackageInstalled(packageName)) "active" else "not_detected",
        )
      }
    }

    AsyncFunction("openSystemSettings") {
      appContext.reactContext?.startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    AsyncFunction("setLifecycle") { enabled: Boolean, permission: String ->
      val context = appContext.reactContext
      val granted = enabled && permission == "granted"
      setCaptureEnabled(context, granted)
      syncGuardService(context, granted)
      if (context != null) {
        if (granted) {
          if (isListenerEnabled(context) && !listenerConnected) {
            requestListenerRebind(context)
          }
          AutoCaptureKeepAliveScheduler.schedule(context)
        } else {
          AutoCaptureKeepAliveScheduler.cancel(context)
        }
      }
    }

    AsyncFunction("getBatteryExemption") {
      mapOf("exempt" to isBatteryExempt(appContext.reactContext))
    }

    AsyncFunction("openBatterySettings") {
      openBatterySettings(appContext.reactContext)
    }

    AsyncFunction("openAutostartSettings") {
      openAutostartSettings(appContext.reactContext)
    }

    // Phase 14 M2 rich detection alert. The builder posts an expanded custom
    // notification with Confirm, Edit, and Remind later actions; Confirm and
    // Remind later land in AutoCaptureAlertReceiver, which records the intent
    // for the JS drain instead of writing any table. Edit and the content tap
    // are deep links into the queued draft sheet. All strings arrive
    // preformatted from JS (parsed fields only); nothing is logged here.
    AsyncFunction("showDetectionAlert") { draftId: String, merchant: String, amountText: String, sourceLabel: String, timeText: String ->
      val context = appContext.reactContext
      mapOf("posted" to (context?.let { AutoCaptureDetectionAlert.show(it, draftId, merchant, amountText, sourceLabel, timeText) } ?: false))
    }

    AsyncFunction("cancelDetectionAlert") { draftId: String ->
      appContext.reactContext?.let { AutoCaptureDetectionAlert.cancel(it, draftId) }
    }

    // Drains one durable receiver action per call, oldest first. The JS action
    // host loops until null. Returns null when nothing is pending.
    AsyncFunction("consumePendingAlertAction") {
      val context = appContext.reactContext
      context?.let { AutoCaptureAlertReceiver.consumePendingAction(it) }
    }

    // Drains one parsed native detection record per call, oldest first, when
    // detections arrived while the JS runtime was unloaded. Returns null when empty.
    AsyncFunction("consumePendingNativeDetections") {
      val context = appContext.reactContext
      context?.let { PendingDetectionQueue.consumeNext(it) }
    }

    // Phase 14 M1 / Phase 17 setup state for S-22. Reports guard running state
    // alongside real NotificationListenerService connection state, and nudges
    // requestRebind when enabled, granted, and currently disconnected.
    AsyncFunction("getGuardState") {
      val context = appContext.reactContext
      val captureEnabled = context?.let(::isCaptureEnabled) ?: false
      val listenerGranted = context?.let(::isListenerEnabled) ?: false
      if (context != null && captureEnabled && listenerGranted && !listenerConnected) {
        requestListenerRebind(context)
      }
      mapOf(
        "running" to guardRunning,
        "connected" to listenerConnected,
        "captureEnabled" to captureEnabled,
        "listenerGranted" to listenerGranted,
      )
    }

    OnCreate {
      // Phase 14 M1: the persisted capture toggle must survive process start so
      // the boot receiver can re arm after reboot. Lifecycle ownership rests
      // with setLifecycle (JS) plus the boot receiver, never with a reset here.
      listener = this@AutoCaptureModule
    }
    OnDestroy {
      hasNotificationObserver = false
      if (listener === this@AutoCaptureModule) listener = null
    }
  }

  private fun isListenerEnabled(): Boolean {
    return appContext.reactContext?.let(::isListenerEnabled) ?: false
  }

  private fun isPackageInstalled(packageName: String): Boolean = try {
    appContext.reactContext?.packageManager?.getApplicationInfo(packageName, 0) != null
  } catch (_: Exception) {
    false
  }

  companion object {
    private const val PREFERENCES_NAME = "expo_auto_capture"
    private const val CAPTURE_ENABLED_KEY = "capture_enabled"
    private val supportedPackages = listOf(
      "com.google.android.apps.walletnfcrel",
      "com.chase.sig.android",
      "com.paypal.android.p2pmobile",
      "com.squareup.cash",
      "com.accessbank.nextgen",
      "com.firstbank.firstmobile",
      "com.gtbank.gtworldv1",
      "com.uba.vericash",
      "com.ubanquity.redd.uba",
      "com.zenithBank.eazymoney",
      "com.interswitchng.www",
      "com.appzonegroup.fcmb",
      "com.ceva.ubmobile.stallion",
      "com.sterlingng.sterlingmobile",
      "com.wemabank.alat.prod",
      "com.StanbicMobile",
      "com.app.ecobank",
      "com.ecobank.mobileapp5",
      "team.opay.pay",
      "com.transsnet.palmpay",
      "com.moniepoint.personal",
      "com.moniepoint.business",
      "com.kudabank.app",
      "com.lenddo.mobile.paylater",
      "ng.com.fairmoney.fairmoney",
      "com.mypaga.customer",
      "com.chippercash",
      "com.vfd.app",
    )
    private val sourceIds = mapOf(
      "com.google.android.apps.walletnfcrel" to "google-wallet",
      "com.chase.sig.android" to "chase",
      "com.paypal.android.p2pmobile" to "paypal",
      "com.squareup.cash" to "cash-app",
      "com.accessbank.nextgen" to "access-bank",
      "com.firstbank.firstmobile" to "first-bank",
      "com.gtbank.gtworldv1" to "gtbank",
      "com.uba.vericash" to "uba",
      "com.ubanquity.redd.uba" to "uba-mobile-app",
      "com.zenithBank.eazymoney" to "zenith-bank",
      "com.interswitchng.www" to "fidelity-bank",
      "com.appzonegroup.fcmb" to "fcmb",
      "com.ceva.ubmobile.stallion" to "union-bank",
      "com.sterlingng.sterlingmobile" to "sterling-bank",
      "com.wemabank.alat.prod" to "wema-alat",
      "com.StanbicMobile" to "stanbic-ibtc",
      "com.app.ecobank" to "ecobank",
      "com.ecobank.mobileapp5" to "ecobank-mobile",
      "team.opay.pay" to "opay",
      "com.transsnet.palmpay" to "palmpay",
      "com.moniepoint.personal" to "moniepoint",
      "com.moniepoint.business" to "moniepoint-business",
      "com.kudabank.app" to "kuda",
      "com.lenddo.mobile.paylater" to "carbon",
      "ng.com.fairmoney.fairmoney" to "fairmoney",
      "com.mypaga.customer" to "paga",
      "com.chippercash" to "chipper-cash",
      "com.vfd.app" to "vbank",
    )
    private val displayNames = mapOf(
      "com.google.android.apps.walletnfcrel" to "Google Wallet",
      "com.chase.sig.android" to "Chase Mobile",
      "com.paypal.android.p2pmobile" to "PayPal",
      "com.squareup.cash" to "Cash App",
      "com.accessbank.nextgen" to "Access Bank",
      "com.firstbank.firstmobile" to "First Bank",
      "com.gtbank.gtworldv1" to "GTBank",
      "com.uba.vericash" to "UBA",
      "com.ubanquity.redd.uba" to "UBA Mobile App",
      "com.zenithBank.eazymoney" to "Zenith Bank",
      "com.interswitchng.www" to "Fidelity Bank",
      "com.appzonegroup.fcmb" to "FCMB",
      "com.ceva.ubmobile.stallion" to "Union Bank",
      "com.sterlingng.sterlingmobile" to "Sterling Bank",
      "com.wemabank.alat.prod" to "ALAT by Wema",
      "com.StanbicMobile" to "Stanbic IBTC",
      "com.app.ecobank" to "Ecobank",
      "com.ecobank.mobileapp5" to "Ecobank Mobile",
      "team.opay.pay" to "OPay",
      "com.transsnet.palmpay" to "PalmPay",
      "com.moniepoint.personal" to "Moniepoint",
      "com.moniepoint.business" to "Moniepoint Business",
      "com.kudabank.app" to "Kuda",
      "com.lenddo.mobile.paylater" to "Carbon",
      "ng.com.fairmoney.fairmoney" to "FairMoney",
      "com.mypaga.customer" to "Paga",
      "com.chippercash" to "Chipper Cash",
      "com.vfd.app" to "Vbank",
    )
    @Volatile
    private var listener: AutoCaptureModule? = null
    @Volatile
    private var hasNotificationObserver: Boolean = false
    @Volatile
    private var guardRunning: Boolean = false
    @Volatile
    private var listenerConnected: Boolean = false

    fun setGuardRunning(running: Boolean) {
      guardRunning = running
    }

    fun setListenerConnected(connected: Boolean) {
      listenerConnected = connected
    }

    fun isListenerConnected(): Boolean = listenerConnected

    fun isSupportedPackage(packageName: String): Boolean = supportedPackages.contains(packageName)
    fun sourceId(packageName: String): String = sourceIds[packageName] ?: packageName
    fun registryDisplayName(packageName: String): String? = displayNames[packageName]
    fun displayName(packageName: String): String = displayNames[packageName] ?: "Supported payment app"

    fun publishNotification(payload: Map<String, Any?>) {
      publishNotification(listener?.appContext?.reactContext, payload)
    }

    fun publishNotification(context: Context?, payload: Map<String, Any?>) {
      val resolvedContext = context ?: listener?.appContext?.reactContext ?: return
      if (!isCaptureEnabled(resolvedContext)) return

      val activeModule = listener
      val activeReactContext = activeModule?.appContext?.reactContext
      if (activeModule != null && activeReactContext != null && hasNotificationObserver) {
        try {
          activeModule.sendEvent("onNotification", payload)
          return
        } catch (_: Exception) {
          // Fall through to zero-drop native handling if the JS bridge is tearing down.
        }
      }

      val parsed = AutoCaptureNativeParser.parse(payload) ?: return
      PendingDetectionQueue.enqueue(resolvedContext, parsed)
      notifyHomeWidgetRefresh(resolvedContext)
      val heading = if (parsed.kind == "income") "Income detected" else "Payment detected"
      AutoCaptureDetectionAlert.show(
        resolvedContext,
        parsed.draftId,
        parsed.merchant,
        parsed.amountText,
        parsed.appName,
        parsed.timeText,
        heading,
      )
    }

    // Phase 14 M2: live delivery of a receiver action intent to JS. Best
    // effort only; the receiver persists the record first, so a dead runtime
    // loses nothing and the JS drain picks it up on the next start.
    fun publishAlertAction(draftId: String, action: String) {
      val context = listener?.appContext?.reactContext ?: return
      if (!isCaptureEnabled(context)) return
      listener?.sendEvent(
        "onAlertAction",
        mapOf("draftId" to draftId, "action" to action, "receivedAt" to System.currentTimeMillis().toString()),
      )
    }

    fun isCaptureEnabled(context: Context): Boolean = context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
      .getBoolean(CAPTURE_ENABLED_KEY, false)

    fun isListenerEnabled(context: Context): Boolean {
      val enabled = Settings.Secure.getString(context.contentResolver, "enabled_notification_listeners") ?: return false
      val component = ComponentName(context, AutoCaptureNotificationListenerService::class.java)
      return enabled.split(":").contains(component.flattenToString())
    }

    fun requestListenerRebind(context: Context?) {
      if (context == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return
      if (!isCaptureEnabled(context) || !isListenerEnabled(context)) return
      try {
        NotificationListenerService.requestRebind(
          ComponentName(context, AutoCaptureNotificationListenerService::class.java),
        )
      } catch (_: Exception) {
        return
      }
    }

    private fun setCaptureEnabled(context: Context?, enabled: Boolean) {
      context?.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
        ?.edit()
        ?.putBoolean(CAPTURE_ENABLED_KEY, enabled)
        ?.commit()
    }

    // Battery exemption is directly detectable via PowerManager (API 23 and up).
    // Below API 23 there is no Doze allowlist, so the check reads as exempt.
    private fun isBatteryExempt(context: Context?): Boolean {
      if (context == null) return false
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true
      val power = context.getSystemService(Context.POWER_SERVICE) as PowerManager
      return try {
        power.isIgnoringBatteryOptimizations(context.packageName)
      } catch (_: Exception) {
        false
      }
    }

    private fun openBatterySettings(context: Context?) {
      if (context == null) return
      val direct = try {
        Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${context.packageName}"))
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      } catch (_: Exception) {
        null
      }
      try {
        if (direct != null) context.startActivity(direct)
      } catch (_: Exception) {
        try {
          context.startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (_: Exception) {
          return
        }
      }
    }

    private fun openAutostartSettings(context: Context?): Boolean {
      if (context == null) return false
      val candidates = listOf(
        ComponentName("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity"),
        ComponentName("com.miui.securitycenter", "com.miui.powercenter.PowerSettings"),
        ComponentName("com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity"),
        ComponentName("com.oppo.safe", "com.oppo.safe.permission.startup.StartupAppListActivity"),
        ComponentName("com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity"),
        ComponentName("com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity"),
        ComponentName("com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity"),
        ComponentName("com.oneplus.security", "com.oneplus.security.chainlaunch.view.ChainLaunchAppListActivity"),
        ComponentName("com.samsung.android.lool", "com.samsung.android.sm.ui.battery.BatteryActivity"),
      )
      val pm = context.packageManager
      for (component in candidates) {
        val intent = Intent().apply {
          setComponent(component)
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        val resolvable = try {
          pm.resolveActivity(intent, PackageManager.MATCH_DEFAULT_ONLY) != null
        } catch (_: Exception) {
          false
        }
        if (resolvable) {
          try {
            context.startActivity(intent)
            return true
          } catch (_: Exception) {
            continue
          }
        }
      }
      return try {
        val fallback = Intent(
          Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
          Uri.fromParts("package", context.packageName, null),
        ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(fallback)
        true
      } catch (_: Exception) {
        false
      }
    }

    private fun notifyHomeWidgetRefresh(context: Context) {
      try {
        val intent = Intent("expo.modules.homewidget.ACTION_REFRESH").apply {
          setPackage(context.packageName)
          setComponent(ComponentName(context.packageName, "expo.modules.homewidget.PeachSpendWidgetProvider"))
        }
        context.sendBroadcast(intent)
      } catch (_: Exception) {
        return
      }
    }

    private fun syncGuardService(context: Context?, enabled: Boolean) {
      if (context == null) return
      try {
        val guard = Intent(context, AutoCaptureGuardService::class.java)
        if (enabled) {
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(guard)
          else context.startService(guard)
        } else {
          context.stopService(guard)
        }
      } catch (_: Exception) {
        return
      }
    }
  }
}
