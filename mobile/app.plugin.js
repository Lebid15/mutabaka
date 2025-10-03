const { withGradleProperties, withProjectBuildGradle, withAppBuildGradle } = require('@expo/config-plugins');

const KOTLIN_VERSION = '2.0.20'; // استخدام نسخة مستقرة

/**
 * Plugin لإضافة Firebase و Google Services
 */
function withFirebasePlugin(config) {
  // إضافة Google Services classpath للـ project-level build.gradle
  config = withProjectBuildGradle(config, (config) => {
    const buildGradle = config.modResults.contents;
    
    // إضافة Google Services plugin
    if (!buildGradle.includes('com.google.gms:google-services')) {
      config.modResults.contents = buildGradle.replace(
        /dependencies\s*{/,
        `dependencies {
        classpath 'com.google.gms:google-services:4.4.0'`
      );
    }
    
    return config;
  });

  // إضافة Google Services plugin للـ app-level build.gradle
  config = withAppBuildGradle(config, (config) => {
    const buildGradle = config.modResults.contents;
    
    // إضافة apply plugin في نهاية الملف
    if (!buildGradle.includes("apply plugin: 'com.google.gms.google-services'")) {
      config.modResults.contents = buildGradle + "\napply plugin: 'com.google.gms.google-services'\n";
    }
    
    return config;
  });

  return config;
}

module.exports = function withMutabakaGradleProps(config) {
  // إضافة Firebase Plugin
  config = withFirebasePlugin(config);
  
  // إضافة Gradle Properties
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
