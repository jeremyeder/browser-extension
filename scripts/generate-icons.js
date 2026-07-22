#!/usr/bin/env node
/**
 * Generate PNG icons from icon.svg at required sizes.
 * Requires: npm install -g sharp-cli  (or use any SVG→PNG converter)
 *
 * Usage: node scripts/generate-icons.js
 */
const { execSync } = require('child_process');
const path = require('path');

const SIZES = [16, 32, 48, 128];
const svgPath = path.resolve(__dirname, '..', 'assets', 'icons', 'icon.svg');
const iconsDir = path.resolve(__dirname, '..', 'assets', 'icons');

for (const size of SIZES) {
  const out = path.join(iconsDir, `icon${size}.png`);
  try {
    // sharp-cli: npx sharp -i icon.svg -o icon16.png resize 16
    execSync(`npx sharp -i "${svgPath}" -o "${out}" resize ${size}`, { stdio: 'inherit' });
    console.log(`Generated: icon${size}.png`);
  } catch {
    console.warn(`Could not generate icon${size}.png — install sharp-cli or use another SVG converter`);
  }
}
