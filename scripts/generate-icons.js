/**
 * Generates PNG icons from an SVG source using sharp.
 * Usage: node scripts/generate-icons.js
 * Requires: npm install -g sharp-cli
 */
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const SIZES = [16, 32, 48, 128];
const outDir = path.join(__dirname, '..', 'assets', 'icons');

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

// Inline SVG for a simple "EA" icon
const svgSource = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="20" fill="#0066cc"/>
  <text x="64" y="88" font-family="system-ui,sans-serif" font-size="64" font-weight="700"
        text-anchor="middle" fill="white">EA</text>
</svg>`;

const svgPath = path.join(outDir, 'source.svg');
fs.writeFileSync(svgPath, svgSource);

for (const size of SIZES) {
  const outPath = path.join(outDir, `icon${size}.png`);
  try {
    execSync(`sharp -i "${svgPath}" -o "${outPath}" resize ${size} ${size}`, { stdio: 'inherit' });
    console.log(`Generated icon${size}.png`);
  } catch {
    console.error(`Failed to generate icon${size}.png — is sharp-cli installed?`);
    console.error('  npm install -g sharp-cli');
  }
}

fs.unlinkSync(svgPath);
