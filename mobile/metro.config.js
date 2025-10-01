const { getDefaultConfig } = require('expo/metro-config');
const { withCssInterop } = require('react-native-css-interop/metro');
const path = require('path');
const { debug } = require('debug');
const { cssToReactNativeRuntimeOptions } = require('nativewind/dist/metro/common');
const { tailwindCli, tailwindConfig } = require('nativewind/dist/metro/tailwind');
const { setupTypeScript } = require('nativewind/dist/metro/typescript');

const config = getDefaultConfig(__dirname);

config.transformer ??= {};
config.transformer.unstable_allowRequireContext = true;

if (config?.resolver) {
	const { resolver } = config;
	if (Array.isArray(resolver.assetExts)) {
		resolver.assetExts = resolver.assetExts.filter((ext) => ext !== 'cjs');
	}
	if (Array.isArray(resolver.sourceExts)) {
		const sourceExts = resolver.sourceExts.filter((ext) => ext !== 'mjs');
		if (!sourceExts.includes('cjs')) {
			sourceExts.push('cjs');
		}
		resolver.sourceExts = sourceExts;
	}
}

const input = path.resolve(__dirname, './global.css');
const tailwindConfigPath = path.resolve(__dirname, './tailwind.config');
const envPath = path.resolve(__dirname, './nativewind-env.d.ts');
const log = debug('mutabaka:nativewind');

const { important } = tailwindConfig(tailwindConfigPath);
const cli = tailwindCli(log);
setupTypeScript(envPath);

module.exports = withCssInterop(config, {
	...cssToReactNativeRuntimeOptions,
	inlineRem: 14,
	selectorPrefix: typeof important === 'string' ? important : undefined,
	input,
	extensions: ['.css'],
	forceWriteFileSystem: true,
	parent: {
		name: 'mutabaka:nativewind',
		debug: 'mutabaka:nativewind',
	},
	getCSSForPlatform(platform, onChange) {
		return cli.getCSSForPlatform({
			platform,
			input,
			browserslist: 'last 1 version',
			browserslistEnv: 'native',
			onChange,
		});
	},
});
