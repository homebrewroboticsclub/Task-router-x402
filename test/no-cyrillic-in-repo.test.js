/**
 * Public repo policy: no Cyrillic (or other non-ASCII script leakage) in committed sources.
 * Repository committed text must stay English (see CONTRIBUTING.md).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const CYRILLIC = /[\u0400-\u04FF]/;
const ROOT = path.join(__dirname, '..');

const SKIP_DIR_NAMES = new Set([
  'node_modules',
  '.git',
  'coverage',
  '.nyc_output',
  'private',
  'dist',
  'build',
]);

const SKIP_FILE_NAMES = new Set(['.env', '.env.local']);

const BINARY_EXT = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.zip',
  '.pdf',
  '.lock',
]);

const TEXT_EXT = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.html',
  '.htm',
  '.md',
  '.json',
  '.yml',
  '.yaml',
  '.example',
  '.sh',
  '.service',
  '.txt',
  '.css',
  '.graphql',
  '.dockerignore',
  '.gitignore',
]);

const ROOT_TEXT_FILES = new Set([
  'README.md',
  'CONTRIBUTING.md',
  'package.json',
  'package-lock.json',
  'docker-compose.yml',
  'Dockerfile',
  'Makefile',
  '.dockerignore',
  '.gitignore',
]);

function shouldScanFile(absPath, relPath) {
  const base = path.basename(absPath);
  if (SKIP_FILE_NAMES.has(base)) return false;
  const ext = path.extname(absPath).toLowerCase();
  if (BINARY_EXT.has(ext)) return false;
  if (TEXT_EXT.has(ext)) return true;
  if (ROOT_TEXT_FILES.has(path.relative(ROOT, absPath))) return true;
  if (base === 'Dockerfile' || base === 'Makefile') return true;
  return false;
}

function walk(dir, relBase, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const abs = path.join(dir, ent.name);
    const rel = path.join(relBase, ent.name);
    if (ent.isDirectory()) {
      if (SKIP_DIR_NAMES.has(ent.name)) continue;
      walk(abs, rel, out);
    } else if (ent.isFile() && shouldScanFile(abs, rel)) {
      out.push(abs);
    }
  }
}

test('no Cyrillic characters in tracked-style source tree', () => {
  const files = [];
  walk(ROOT, '', files);
  const hits = [];
  for (const abs of files) {
    let content;
    try {
      content = fs.readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    const rel = path.relative(ROOT, abs);
    content.split(/\r?\n/).forEach((line, idx) => {
      if (CYRILLIC.test(line)) {
        hits.push(`${rel}:${idx + 1}`);
      }
    });
  }
  assert.equal(
    hits.length,
    0,
    hits.length ? `Cyrillic found (move to English; see CONTRIBUTING.md):\n${hits.join('\n')}` : '',
  );
});
