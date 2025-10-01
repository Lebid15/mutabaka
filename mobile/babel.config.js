module.exports = function (api) {
  api.cache(true);
  const cssInteropConfig = require('react-native-css-interop/babel')() ?? {};
  const cssInteropPlugins = (cssInteropConfig.plugins ?? []).filter((plugin) => {
    if (typeof plugin === 'string') {
      return plugin !== 'react-native-worklets/plugin';
    }
    if (Array.isArray(plugin)) {
      const [name] = plugin;
      return name !== 'react-native-worklets/plugin';
    }
    return true;
  });
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      ...cssInteropPlugins,
      'react-native-reanimated/plugin',
    ],
  };
};
