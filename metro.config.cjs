/* global __dirname */
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

config.resolver.assetExts.push('wasm');

// Keep test/spec files out of app bundles. expo-router's require.context scans the
// routes directory and would otherwise bundle co-located test files (and their
// dev-only dependencies such as vitest) into the shipped app.
const existingBlockList = config.resolver.blockList;
config.resolver.blockList = [
  ...(Array.isArray(existingBlockList)
    ? existingBlockList
    : existingBlockList
      ? [existingBlockList]
      : []),
  /\.(test|spec)\.[jt]sx?$/,
];

module.exports = withNativeWind(config, { input: './global.css' });
