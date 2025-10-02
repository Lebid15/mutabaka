const { withGradleProperties } = require('@expo/config-plugins');

const KOTLIN_VERSION = '2.0.21';

module.exports = function withMutabakaGradleProps(config) {
  return withGradleProperties(config, (config) => {
    const props = config.modResults ?? [];
    const ensureProperty = (key, value) => {
      const existing = props.find((item) => item.type === 'property' && item.key === key);
      if (existing) {
        existing.value = value;
      } else {
        props.push({ type: 'property', key, value });
      }
    };

    ensureProperty('android.kotlinVersion', KOTLIN_VERSION);
    ensureProperty('kotlinVersion', KOTLIN_VERSION);
    ensureProperty('org.jetbrains.kotlin.version', KOTLIN_VERSION);

    config.modResults = props;
    return config;
  });
};
