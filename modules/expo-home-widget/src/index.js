let nativeHomeWidget = null;

try {
  const { requireOptionalNativeModule } = require('expo-modules-core');
  nativeHomeWidget = requireOptionalNativeModule('ExpoHomeWidget');
} catch {
  nativeHomeWidget = null;
}

module.exports = {
  getHomeWidgetModule: () => nativeHomeWidget,
  updateSnapshot: async (payload) => {
    if (!nativeHomeWidget || typeof nativeHomeWidget.updateSnapshot !== 'function') return false;
    return Boolean(await nativeHomeWidget.updateSnapshot(payload));
  },
  clearSnapshot: async () => {
    if (!nativeHomeWidget || typeof nativeHomeWidget.clearSnapshot !== 'function') return false;
    return Boolean(await nativeHomeWidget.clearSnapshot());
  },
  requestPinWidget: async () => {
    if (!nativeHomeWidget || typeof nativeHomeWidget.requestPinWidget !== 'function') return false;
    return Boolean(await nativeHomeWidget.requestPinWidget());
  },
};
