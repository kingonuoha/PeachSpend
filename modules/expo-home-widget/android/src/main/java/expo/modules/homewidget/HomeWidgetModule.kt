package expo.modules.homewidget

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class HomeWidgetModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ExpoHomeWidget")

    AsyncFunction("updateSnapshot") { payload: Map<String, Any?> ->
      val context = appContext.reactContext ?: return@AsyncFunction false
      PeachSpendWidgetProvider.saveSnapshot(context, payload)
      PeachSpendWidgetProvider.refreshAllWidgets(context)
      true
    }

    AsyncFunction("clearSnapshot") {
      val context = appContext.reactContext ?: return@AsyncFunction false
      PeachSpendWidgetProvider.clearSnapshot(context)
      PeachSpendWidgetProvider.refreshAllWidgets(context)
      true
    }

    AsyncFunction("requestPinWidget") {
      val context = appContext.reactContext ?: return@AsyncFunction false
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return@AsyncFunction false
      val manager = AppWidgetManager.getInstance(context)
      if (!manager.isRequestPinAppWidgetSupported) return@AsyncFunction false
      val provider = ComponentName(context, PeachSpendWidgetProvider::class.java)
      try {
        manager.requestPinAppWidget(provider, null, null)
      } catch (_: Exception) {
        false
      }
    }
  }
}
