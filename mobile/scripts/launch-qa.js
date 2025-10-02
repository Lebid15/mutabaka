#!/usr/bin/env node
/* eslint-disable no-console */
const { spawn } = require('child_process');
const path = require('path');

const platform = process.argv[2];

if (!platform || !['android', 'ios'].includes(platform)) {
  console.error('\nUsage: node scripts/launch-qa.js <android|ios>');
  process.exit(1);
}

const projectRoot = path.resolve(__dirname, '..');

function spawnCommand(command, args, options = {}) {
  return spawn(command, args, {
    cwd: projectRoot,
    stdio: 'inherit',
    shell: true,
    ...options,
  });
}

console.log(`\n[@QA] Starting Expo dev client for ${platform}…`);
const expoArgs = ['expo', 'start', `--${platform}`, '--dev-client', '--scheme', 'qa'];
const expoProcess = spawnCommand('npx', expoArgs);

expoProcess.on('error', (error) => {
  console.error('Failed to launch Expo:', error);
  process.exit(1);
});

expoProcess.on('exit', (code) => {
  console.log(`Expo process exited with code ${code ?? 0}`);
  process.exit(code ?? 0);
});

const DEEP_LINK_DELAY_MS = 18000;

setTimeout(() => {
  console.log('[@QA] Opening qa://devices deep link…');
  const openArgs = ['uri-scheme', 'open', 'qa://devices', `--${platform}`];
  const opener = spawnCommand('npx', openArgs, { stdio: 'inherit' });
  opener.on('error', (error) => {
    console.error('Failed to open deep link:', error);
  });
}, DEEP_LINK_DELAY_MS);
