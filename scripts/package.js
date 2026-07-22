/**
 * Packages the built extension into a zip file for distribution.
 * Usage: node scripts/package.js (after npm run build)
 */
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const pkg = require('../package.json');
const distDir = path.join(__dirname, '..', 'dist');
const releasesDir = path.join(__dirname, '..', 'releases');
const zipName = `enterprise-assistant-${pkg.version}.zip`;
const zipPath = path.join(releasesDir, zipName);

if (!fs.existsSync(distDir)) {
  console.error('dist/ not found — run "npm run build" first');
  process.exit(1);
}

if (!fs.existsSync(releasesDir)) {
  fs.mkdirSync(releasesDir, { recursive: true });
}

try {
  execSync(`cd "${distDir}" && zip -r "${zipPath}" .`, { stdio: 'inherit' });
  const { size } = fs.statSync(zipPath);
  console.log(`\nPackaged: releases/${zipName} (${Math.round(size / 1024)} KB)`);
} catch (err) {
  console.error('Packaging failed:', err.message);
  process.exit(1);
}
