#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const packageName = `${pkg.name}-v${pkg.version}`;
const distDir = path.join(rootDir, 'dist');
const stageDir = path.join(distDir, packageName);

console.log(`\n📦 Packaging ${pkg.name} v${pkg.version} for distribution...\n`);

// Ensure clean dist directory
if (fs.existsSync(distDir)) {
  const oldFiles = fs.readdirSync(distDir);
  for (const file of oldFiles) {
    if (file.startsWith(packageName) || file === '.staging') {
      fs.rmSync(path.join(distDir, file), { recursive: true, force: true });
    }
  }
} else {
  fs.mkdirSync(distDir, { recursive: true });
}

if (fs.existsSync(stageDir)) {
  fs.rmSync(stageDir, { recursive: true, force: true });
}
fs.mkdirSync(stageDir, { recursive: true });

// Exclusion filter
const excludeList = [
  'node_modules',
  '.git',
  '.env',
  'dist',
  'release',
  'logs',
  '.pm2',
  '.DS_Store',
  'coverage',
  '.cache',
  '.npm',
  '.eslintcache'
];

function shouldExclude(relPath) {
  const normalized = relPath.replace(/\\/g, '/');

  // Exclude KRED specifically
  if (normalized === 'game_modules/KRED' || normalized.startsWith('game_modules/KRED/')) {
    return true;
  }
  if (normalized.split('/').includes('KRED')) {
    return true;
  }

  // General excludes
  for (const item of excludeList) {
    if (normalized === item || normalized.startsWith(`${item}/`)) {
      return true;
    }
    const parts = normalized.split('/');
    if (parts.includes(item)) {
      return true;
    }
  }

  // Exclude log files / runtime pids
  if (normalized.endsWith('.log') || normalized.endsWith('.pid')) {
    return true;
  }

  return false;
}

function copyRecursive(src, dest, rel = '') {
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const entryRel = rel ? `${rel}/${entry.name}` : entry.name;
    if (shouldExclude(entryRel)) {
      continue;
    }

    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      copyRecursive(srcPath, destPath, entryRel);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// Copy source files to stageDir
console.log(`Copying distribution files to staging directory...`);
copyRecursive(rootDir, stageDir);

// Verify .env.example exists in stage
if (!fs.existsSync(path.join(stageDir, '.env.example')) && fs.existsSync(path.join(rootDir, '.env.example'))) {
  fs.copyFileSync(path.join(rootDir, '.env.example'), path.join(stageDir, '.env.example'));
}

const tarFile = path.join(distDir, `${packageName}.tar.gz`);
const zipFile = path.join(distDir, `${packageName}.zip`);

// Create tar.gz
try {
  console.log(`Creating ${packageName}.tar.gz...`);
  execSync(`tar -czf "${tarFile}" -C "${distDir}" "${packageName}"`, { stdio: 'inherit' });
  const tarStat = fs.statSync(tarFile);
  console.log(`✓ Created: ${tarFile} (${(tarStat.size / 1024).toFixed(2)} KB)`);
} catch (err) {
  console.error(`Error creating tar archive:`, err.message);
}

// Create zip if zip utility exists
try {
  console.log(`Creating ${packageName}.zip...`);
  execSync(`cd "${distDir}" && zip -r -q "${zipFile}" "${packageName}"`, { stdio: 'inherit' });
  const zipStat = fs.statSync(zipFile);
  console.log(`✓ Created: ${zipFile} (${(zipStat.size / 1024).toFixed(2)} KB)`);
} catch (err) {
  console.warn(`Note: 'zip' command not available or failed (${err.message}).`);
}

// Clean up stage folder
fs.rmSync(stageDir, { recursive: true, force: true });

console.log(`\n✨ Distribution package created successfully in ${distDir}/\n`);
