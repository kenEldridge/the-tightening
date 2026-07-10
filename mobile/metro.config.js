const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// theory-core is a file:-linked package one level up; watch it so edits hot-reload.
config.watchFolders = [path.resolve(__dirname, '..', 'packages', 'theory-core')];

module.exports = config;
