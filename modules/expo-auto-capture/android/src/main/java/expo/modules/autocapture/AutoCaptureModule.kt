package expo.modules.autocapture

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class AutoCaptureModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ExpoAutoCapture")
    Events("onNotification")

    AsyncFunction("getPermissionState") { mapOf(
      "status" to if (isListenerEnabled()) "granted" else "denied",
      "canRequest" to false,
    ) }

    AsyncFunction("getSupportedSources") {
      supportedPackages.map { packageName ->
        mapOf(
          "id" to packageName,
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
      setCaptureEnabled(appContext.reactContext, enabled && permission == "granted")
    }

    OnCreate {
      setCaptureEnabled(appContext.reactContext, false)
      listener = this@AutoCaptureModule
    }
    OnDestroy {
      setCaptureEnabled(appContext.reactContext, false)
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
    private var listener: AutoCaptureModule? = null

    fun isSupportedPackage(packageName: String): Boolean = supportedPackages.contains(packageName)
    fun displayName(packageName: String): String = displayNames[packageName] ?: "Supported payment app"

    fun publishNotification(payload: Map<String, Any?>) {
      val context = listener?.appContext?.reactContext ?: return
      if (!isCaptureEnabled(context)) return
      listener?.sendEvent("onNotification", payload)
    }

    fun isCaptureEnabled(context: Context): Boolean = context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
      .getBoolean(CAPTURE_ENABLED_KEY, false)

    fun isListenerEnabled(context: Context): Boolean {
      val enabled = Settings.Secure.getString(context.contentResolver, "enabled_notification_listeners") ?: return false
      val component = ComponentName(context, AutoCaptureNotificationListenerService::class.java)
      return enabled.split(":").contains(component.flattenToString())
    }

    private fun setCaptureEnabled(context: Context?, enabled: Boolean) {
      context?.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
        ?.edit()
        ?.putBoolean(CAPTURE_ENABLED_KEY, enabled)
        ?.commit()
    }
  }
}
