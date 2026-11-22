import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(root, 'public');

// Unchanged Firebase hosting copy. Vercel skips the assets submodule (models
// load from https://assets.3dstreet.app/) and then drops hosting-ignored paths.
const firebaseCopies =
  'cp -R assets public && cp -R ui_assets public && cp index.html public && cp -R dist public';
const vercelCopies =
  'cp -R ui_assets public && cp index.html public && cp -R dist public';

if (process.env.VERCEL === '1') {
  execSync(vercelCopies, { cwd: root, stdio: 'inherit', shell: true });
  pruneVercelOutput(publicDir);
} else {
  execSync(firebaseCopies, { cwd: root, stdio: 'inherit', shell: true });
}

function readFirebaseJson(dir) {
  const firebaseJsonPath = path.join(dir, 'firebase.json');
  if (fs.existsSync(firebaseJsonPath)) {
    return fs.readFileSync(firebaseJsonPath, 'utf8');
  }
  // A second local run has already removed firebase.json from public/.
  return execSync('git show HEAD:public/firebase.json', {
    cwd: root,
    encoding: 'utf8'
  });
}

function pruneVercelOutput(dir) {
  const hosting = JSON.parse(readFirebaseJson(dir)).hosting;
  if (!hosting || !Array.isArray(hosting.ignore)) {
    console.error('prefirebase: public/firebase.json has no hosting.ignore');
    process.exit(1);
  }
  for (const pattern of hosting.ignore) applyIgnore(dir, pattern);
  fs.rmSync(path.join(dir, 'assets'), { recursive: true, force: true });
  if (!fs.existsSync(path.join(dir, 'index.html'))) {
    console.error('prefirebase: index.html missing after Vercel prune');
    process.exit(1);
  }
  console.log(
    'prefirebase: Vercel output dropped hosting-ignored paths and public/assets'
  );
}

function applyIgnore(dir, pattern) {
  if (pattern === '**/.*') {
    removeDotEntries(dir);
    return;
  }
  if (pattern === '**/node_modules/**') {
    removeNamedDirs(dir, 'node_modules');
    return;
  }
  if (pattern.endsWith('/**')) {
    const name = pattern.slice(0, -3);
    if (!name || name.includes('/') || name.includes('*')) unsupported(pattern);
    fs.rmSync(inside(dir, name), { recursive: true, force: true });
    return;
  }
  if (pattern.startsWith('*.') && !pattern.slice(2).includes('*')) {
    const suffix = pattern.slice(1);
    for (const name of fs.readdirSync(dir)) {
      if (name.startsWith('.') || !name.endsWith(suffix)) continue;
      const full = inside(dir, name);
      if (fs.statSync(full).isFile()) fs.rmSync(full);
    }
    return;
  }
  if (!pattern.includes('*') && !pattern.includes('/')) {
    fs.rmSync(inside(dir, pattern), { force: true });
    return;
  }
  unsupported(pattern);
}

function removeDotEntries(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) {
      fs.rmSync(inside(dir, entry.name), { recursive: true, force: true });
      continue;
    }
    if (entry.isSymbolicLink() || !entry.isDirectory()) continue;
    removeDotEntries(path.join(dir, entry.name));
  }
}

function removeNamedDirs(dir, name) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === name) {
      fs.rmSync(inside(dir, entry.name), { recursive: true, force: true });
      continue;
    }
    if (entry.isSymbolicLink() || !entry.isDirectory()) continue;
    removeNamedDirs(path.join(dir, entry.name), name);
  }
}

function inside(dir, name) {
  const resolved = path.resolve(dir, name);
  const rootResolved = path.resolve(dir);
  if (
    resolved !== rootResolved &&
    !resolved.startsWith(rootResolved + path.sep)
  ) {
    console.error('prefirebase: refused path outside public: ' + name);
    process.exit(1);
  }
  return resolved;
}

function unsupported(pattern) {
  console.error(
    'prefirebase: unsupported firebase hosting ignore pattern: ' + pattern
  );
  process.exit(1);
}
