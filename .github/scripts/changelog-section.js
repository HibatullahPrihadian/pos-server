#!/usr/bin/env node
/**
 * changelog-section.js
 *
 * Ambil isi entri CHANGELOG.md untuk satu versi, lalu cetak ke stdout.
 *
 * Pemakaian:
 *   node .github/scripts/changelog-section.js v1.0.0
 *
 * Keluar:
 *   stdout = isi entri `## [1.0.0]` (tanpa baris heading)
 *   exit 0 = entri ditemukan
 *   exit 1 = tag tidak diberikan, CHANGELOG.md tidak ada, atau entri versi
 *            tidak ditemukan (keluaran kosong agar workflow memakai
 *            --generate-notes)
 *
 * Catatan: package.json root memakai "type": "module", sehingga file .js di
 * dalam repository ini dapat dieksekusi sebagai ESM. Skrip ini ditulis gaya
 * CommonJS, tetapi pemanggilan modul di bawah dibuat aman untuk kedua mode.
 */

'use strict';

const VERSION_HEADING_PATTERN = /^##\s+\[([^\]]+)\]/;
const SECTION_BOUNDARY_PATTERN = /^##\s/;

/**
 * Normalisasi versi: buang prefix "v" dan spasi, samakan huruf besar/kecil.
 */
function normalizeVersion(value) {
  return String(value || '').trim().replace(/^v/i, '').toLowerCase();
}

/**
 * Cari rentang baris entri versi: dari heading `## [versi]` (inklusif) sampai
 * heading level-2 berikutnya (eksklusif). Karena semua heading versi memakai
 * `## [X.Y.Z]`, entri tidak pernah ikut memuat isi versi berikutnya maupun
 * bagian penutup seperti "Format entri".
 */
function findSection(lines, version) {
  let start = -1;

  for (let i = 0; i < lines.length; i += 1) {
    if (start === -1) {
      const match = VERSION_HEADING_PATTERN.exec(lines[i]);
      if (match && normalizeVersion(match[1]) === version) start = i;
      continue;
    }

    // Entri versi sudah ditemukan: berhenti di heading level-2 berikutnya.
    if (SECTION_BOUNDARY_PATTERN.test(lines[i])) return { start, end: i };
  }

  if (start === -1) return null;
  return { start, end: lines.length };
}

/**
 * Isi entri tanpa heading awal dan tanpa spasi kosong di tepi.
 */
function extractBody(lines, section) {
  return lines.slice(section.start + 1, section.end).join('\n').trim();
}

/**
 * Muat modul node. CommonJS memakai require, ESM memakai dynamic import.
 */
async function loadModule(name) {
  if (typeof require === 'function') {
    return require(name);
  }
  const mod = await import(name);
  return mod.default || mod;
}

/**
 * Folder tempat skrip ini berada (fallback ke lokasi file saat dipanggil).
 */
function getScriptDir(path) {
  if (typeof __dirname === 'string') return __dirname;
  return path.dirname(process.argv[1] || process.cwd());
}

/**
 * True bila skrip ini dijalankan langsung (bukan di-require oleh skrip lain).
 */
function isDirectRun(path) {
  if (typeof require === 'function' && typeof module !== 'undefined' && require.main === module) {
    return true;
  }
  const entry = process.argv[1];
  if (!entry) return false;
  return path.basename(entry) === 'changelog-section.js';
}

async function main() {
  const tag = process.argv[2];
  if (!tag) {
    process.stderr.write('Pakai: node changelog-section.js <tag> (contoh: v1.0.0)\n');
    process.exitCode = 1;
    return;
  }

  const version = normalizeVersion(tag);
  const fs = await loadModule('node:fs');
  const path = await loadModule('node:path');
  const changelogPath = path.resolve(getScriptDir(path), '..', '..', 'CHANGELOG.md');

  let content;
  try {
    content = fs.readFileSync(changelogPath, 'utf8');
  } catch (err) {
    process.stderr.write(`CHANGELOG.md tidak ditemukan: ${changelogPath}\n`);
    process.exitCode = 1;
    return;
  }

  const lines = content.split(/\r?\n/);
  const section = findSection(lines, version);
  if (!section) {
    process.stderr.write(`Entri CHANGELOG untuk versi ${version} tidak ditemukan\n`);
    process.exitCode = 1;
    return;
  }

  const body = extractBody(lines, section);
  if (!body) {
    process.stderr.write(`Entri CHANGELOG untuk versi ${version} kosong\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`${body}\n`);
}

// Ekspor helper (dipakai saat pengujian skrip).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { findSection, extractBody, normalizeVersion };
}

async function bootstrap() {
  const path = await loadModule('node:path');
  if (!isDirectRun(path)) return;
  await main();
}

bootstrap().catch((err) => {
  process.stderr.write(`changelog-section: ${err && err.message ? err.message : err}\n`);
  process.exitCode = 1;
});
