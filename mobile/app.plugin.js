const {
  withGradleProperties,
  withProjectBuildGradle,
  withAppBuildGradle,
  withDangerousMod,
} = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const KOTLIN_VERSION = '1.9.24'; // نسخة موصى بها مع React Native 0.81
const GOOGLE_SERVICES_CLASSPATH = 'com.google.gms:google-services:4.4.1';
const ANDROID_GRADLE_PLUGIN = 'com.android.tools.build:gradle:8.1.1';
const KOTLIN_GRADLE_PLUGIN = 'org.jetbrains.kotlin:kotlin-gradle-plugin:1.9.24';
const GRADLE_WRAPPER_VERSION = '8.4';

const ensureClasspath = (contents, dependency) => {
  const target = `classpath("${dependency}")`;
  const patterns = [
    new RegExp(`classpath\\((['"])${dependency.replace(/[.*+?^${}()|[\]\\]/g, r => `\\${r}`)}\\1\\)`),
    new RegExp(`classpath\\s+(['"])${dependency.replace(/[.*+?^${}()|[\]\\]/g, r => `\\${r}`)}\\1`),
    new RegExp(`classpath\\((['"])${dependency.split(':').slice(0, 2).join(':')}(:[^'"]+)?\\1\\)`),
    new RegExp(`classpath\\s+(['"])${dependency.split(':').slice(0, 2).join(':')}(:[^'"]+)?\\1`),
  ];

  let updated = contents;
  let matched = false;
  for (const pattern of patterns) {
    if (pattern.test(updated)) {
      updated = updated.replace(pattern, target);
      matched = true;
    }
  }

  if (!matched || !updated.includes(target)) {
    updated = updated.replace(/dependencies\s*{/, match => `${match}\n    ${target}`);
  }

  return updated;
};

const withGradleWrapperVersion = config =>
  withDangerousMod(config, [
    'android',
    async config => {
      const wrapperPath = path.join(
        config.modRequest.platformProjectRoot,
        'gradle',
        'wrapper',
        'gradle-wrapper.properties'
      );
      const contents = await fs.promises.readFile(wrapperPath, 'utf8');
      const distributionLine = `distributionUrl=https\\://services.gradle.org/distributions/gradle-${GRADLE_WRAPPER_VERSION}-bin.zip`;
      const newContents = contents.replace(
        /distributionUrl=https\\:\/\/services\.gradle\.org\/distributions\/gradle-[^\n]+/,
        distributionLine
      );
      if (newContents !== contents) {
        await fs.promises.writeFile(wrapperPath, newContents, 'utf8');
      }
      return config;
    },
  ]);

/**
 * Plugin لإضافة Firebase و Google Services
 */
function withFirebasePlugin(config) {
  // إضافة Google Services و ضبط إصدارات Gradle plugins
  config = withProjectBuildGradle(config, (config) => {
    if (!config.modResults || !config.modResults.contents) {
      console.warn('[Plugin] No project build.gradle found, skipping Gradle setup');
      return config;
    }

    let contents = config.modResults.contents;
    contents = ensureClasspath(contents, GOOGLE_SERVICES_CLASSPATH);
    contents = ensureClasspath(contents, ANDROID_GRADLE_PLUGIN);
    contents = ensureClasspath(contents, KOTLIN_GRADLE_PLUGIN);

    // تأكد من تنسيق classpath باستخدام علامات تنصيص مزدوجة كما تتوقع ensureClasspath
    contents = contents.replace(/classpath\s+'([^']+)'/g, (_, dep) => `classpath("${dep}")`);

    config.modResults.contents = contents;
    return config;
  });

  // إضافة Google Services plugin للـ app-level build.gradle
  config = withAppBuildGradle(config, (config) => {
    if (!config.modResults || !config.modResults.contents) {
      console.warn('[Plugin] No app build.gradle found, skipping Google Services apply');
      return config;
    }
    
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
  try {
    // إضافة Firebase Plugin
    config = withFirebasePlugin(config);
    config = withGradleWrapperVersion(config);
    
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
  } catch (error) {
    console.error('[Plugin] Error in withMutabakaGradleProps:', error);
    return config;
  }
};
