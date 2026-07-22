#!/usr/bin/env node
/**
 * Package the built extension into a .zip for Chrome Web Store submission.
 * Run after `npm run build`: node scripts/package.js
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const distDir = path.resolve(__dirname, '..', 'dist');
const outDir = path.resolve(__dirname, '..', 'releases');
const manifest = JSON.parse(fs.readFileSync(path.join(distDir, 'manifest.json'), 'utf8'));
const version = manifest.version;

fs.mkdirSync(outDir, { recursive: true });

const zipPath = path.join(outDir, `enterprise-assistant-${version}.zip`);
execSync(`cd "${distDir}" && zip -r "${zipPath}" .`, { stdio: 'inherit' });

console.log(`\nPackaged: ${zipPath}`);
