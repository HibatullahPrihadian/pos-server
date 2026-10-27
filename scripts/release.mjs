#!/usr/bin/env node
/**
 * release.mjs — mesin release otomatis untuk POS Minimarket.
 *
 * Alur: bump versi → tulis file versi → update CHANGELOG → commit → tag → push.
 * Script ini memakai Node built-in saja (tanpa dependency baru).
 *
 * Contoh pemakaian:
 *   npm run release:dry
 *   npm run release -- --bump minor
 *   npm run release -- --set 1.0.0
 *   npm run release -- --commit-message "feat(release): sistem versioning otomatis"
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------- konstanta ----------

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_URL = 'https://github.com/HibatullahPrihadian/pos-server';
const DEFAULT_BRANCH = 'main';
const RELEASE_COMMIT_PREFIX = 'chore(release):';

// File versi yang boleh ikut di-stage pada mode --strict.
const VERSION_FILES = [
  'VERSION',
  'CHANGELOG.md',
  'package.json',
  'backend/package.json',
  'package-lock.json',
  'backend/package-lock.json',
];

// File JSON yang field "version"-nya disinkronkan ke versi rilis.
const VERSION_JSON_FILES = [
  'package.json',
  'backend/package.json',
  'package-lock.json',
  'backend/package-lock.json',
];

// Path yang tidak boleh ikut di-stage pada mode default (dicek dengan "mengandung").
const IGNORE_PATTERNS = [
  'node_modules',
  '/dist/',
  '.env',
  '.DS_Store',
  'uploads',
  'certs',
  '.kilo/worktrees',
  '.log',
];

// Tipe conventional commit yang menghasilkan bump patch.
const PATCH_TYPES = ['fix', 'perf', 'refactor', 'test', 'docs', 'chore', 'build', 'ci', 'style'];

// Urutan grup + label Indonesia pada entri CHANGELOG.
const CHANGELOG_GROUP_ORDER = ['Ditambahkan', 'Diperbaiki', 'Performa', 'Diubah'];

// ---------- utilitas warna ----------

const useColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const COLOR = {
  reset: useColor ? '\u001b[0m' : '',
  bold: useColor ? '\u001b[1m' : '',
  red: useColor ? '\u001b[31m' : '',
  green: useColor ? '\u001b[32m' : '',
  yellow: useColor ? '\u001b[33m' : '',
  blue: useColor ? '\u001b[34m' : '',
  cyan: useColor ? '\u001b[36m' : '',
  gray: useColor ? '\u001b[90m' : '',
};

function paint(text, color) {
  return `${color}${text}${COLOR.reset}`;
}

function row(key, value, width = 16) {
  return `  ${`${key}:`.padEnd(width)}${value}`;
}

// Escape kutip & karakter khusus shell agar pesan commit aman ditampilkan
// sebagai perintah yang utuh (commit sungguhan memakai execFileSync, tanpa shell).
function escapeShellText(value) {
  return String(value).replace(/([\\"$`])/g, '\\$1');
}

// ---------- helper git ----------

// Output git sengaja TIDAK di-trim: "git status --porcelain" memakai spasi sebagai
// pemisah kolom status, dan trim() akan memotong kolom pertama.
function git(args) {
  const result = execFileSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 32 * 1024 * 1024,
  });
  return typeof result === 'string' ? result : String(result);
}

// Jalankan perintah git yang boleh gagal (mis. "git describe" saat belum ada tag).
function gitSafe(args) {
  try {
    return git(args).trim();
  } catch {
    return null;
  }
}

// Jalankan perintah git yang mengubah repo; gagal → berhenti dengan pesan jelas.
function gitMust(args, message, hint = '') {
  try {
    return git(args);
  } catch (error) {
    const detail = String((error && error.stderr) || (error && error.message) || '').trim();
    fail(message, detail || hint);
  }
  return '';
}

function fail(message, detail = '') {
  console.error(`${paint('ERROR', COLOR.red)} ${message}`);
  if (detail) {
    console.error(`       ${detail}`);
  }
  process.exit(1);
}

function warn(message) {
  console.error(`${paint('PERINGATAN', COLOR.yellow)} ${message}`);
}

// ---------- parsing argumen ----------

function parseArgs(argv) {
  const options = {
    bump: 'auto',
    set: null,
    commitMessage: null,
    dryRun: false,
    push: true,
    notes: [],
    strict: false,
    allowBranch: false,
    allowUnpushed: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const takeValue = () => {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        fail(`Opsi ${arg} membutuhkan nilai.`);
      }
      i += 1;
      return value;
    };

    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--no-push') {
      options.push = false;
    } else if (arg === '--strict') {
      options.strict = true;
    } else if (arg === '--allow-branch') {
      options.allowBranch = true;
    } else if (arg === '--allow-unpushed') {
      options.allowUnpushed = true;
    } else if (arg === '--bump' || arg.startsWith('--bump=')) {
      const value = arg.startsWith('--bump=') ? arg.slice('--bump='.length) : takeValue();
      if (!['auto', 'patch', 'minor', 'major'].includes(value)) {
        fail(`Nilai --bump tidak valid: ${value}. Pilihan: auto, patch, minor, major.`);
      }
      options.bump = value;
    } else if (arg === '--set' || arg.startsWith('--set=')) {
      const value = arg.startsWith('--set=') ? arg.slice('--set='.length) : takeValue();
      if (!/^\d+\.\d+\.\d+$/.test(value)) {
        fail(`Nilai --set harus berformat X.Y.Z, bukan: ${value}.`);
      }
      options.set = value;
    } else if (arg === '--notes' || arg.startsWith('--notes=')) {
      const value = arg.startsWith('--notes=') ? arg.slice('--notes='.length) : takeValue();
      options.notes.push(value);
    } else if (arg === '--commit-message' || arg.startsWith('--commit-message=')) {
      // Pesan commit release; isi persis seperti diberikan user.
      const value = arg.startsWith('--commit-message=')
        ? arg.slice('--commit-message='.length)
        : takeValue();
      if (value.trim().length === 0) {
        fail('Opsi --commit-message membutuhkan nilai.');
      }
      options.commitMessage = value;
    } else {
      fail(`Opsi tidak dikenal: ${arg}. Jalankan dengan --help untuk melihat daftar opsi.`);
    }
  }

  return options;
}

function printHelp() {
  console.log(`
${paint('RELEASE', COLOR.green)} — mesin release POS Minimarket

Penggunaan:
  node scripts/release.mjs [options]
  npm run release -- [options]

Opsi:
  --bump auto|patch|minor|major  Naiknya versi (default: auto dari conventional commit)
  --set <X.Y.Z>                   Tetapkan versi eksplisit (melewati logika bump)
  --dry-run                       Tampilkan rencana saja: tidak menulis file, tidak menjalankan git
  --no-push                       Commit + tag lokal, tidak push ke origin
  --notes "<teks>"                Catatan rilis tambahan pada entri CHANGELOG
  --commit-message "<pesan>"      Pesan commit release (default: chore(release): vX.Y.Z)
  --strict                        Stage hanya file versi (VERSION, CHANGELOG.md, package.json, dll)
  --allow-branch                  Izinkan branch selain ${DEFAULT_BRANCH}
  --allow-unpushed                Izinkan HEAD berbeda dari origin/${DEFAULT_BRANCH}
  --help                          Tampilkan bantuan ini

Contoh:
  npm run release:dry
  npm run release -- --bump minor
  npm run release -- --set 1.0.0
  npm run release -- --commit-message "feat(release): sistem versioning otomatis"
`);
}

// ---------- semver ----------

function parseSemver(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(value).trim());
  if (!match) {
    return null;
  }
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

function bumpVersion(base, level) {
  const parsed = parseSemver(base);
  if (!parsed) {
    fail(`Versi dasar tidak valid: "${base}". Harus berformat X.Y.Z.`);
  }
  if (level === 'major') {
    return `${parsed.major + 1}.0.0`;
  }
  if (level === 'minor') {
    return `${parsed.major}.${parsed.minor + 1}.0`;
  }
  return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
}

// ---------- commit & conventional commit ----------

function collectCommits(lastTag) {
  // Tanpa tag: seluruh commit yang bisa dijangkau HEAD.
  const range = lastTag ? `${lastTag}..HEAD` : 'HEAD';
  // %x1f = pemisah field, %x1e = pemisah record (body commit bisa berisi baris baru).
  const raw = gitSafe(['log', '--format=%H%x1f%s%x1f%b%x1e', range]);
  if (!raw) {
    return [];
  }
  return raw
    .split('\x1e')
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0)
    .map((chunk) => {
      const parts = chunk.split('\x1f');
      return {
        hash: (parts[0] || '').trim(),
        subject: parts[1] || '',
        body: parts.slice(2).join('\x1f').trim(),
      };
    })
    .filter((commit) => commit.hash.length > 0);
}

function isReleaseCommit(commit) {
  return (commit.subject || '').startsWith(RELEASE_COMMIT_PREFIX);
}

function classifyCommit(commit) {
  const subject = commit.subject || '';
  const body = commit.body || '';
  const match = /^([a-zA-Z]+)(?:\([^)]*\))?(!)?\s*:/.exec(subject);
  const type = match ? match[1].toLowerCase() : 'unknown';
  const breaking = Boolean(match && match[2] === '!') || /BREAKING[ -]CHANGE:/i.test(body);
  if (breaking) {
    return { type, level: 'major' };
  }
  if (type === 'feat') {
    return { type, level: 'minor' };
  }
  if (PATCH_TYPES.includes(type)) {
    return { type, level: 'patch' };
  }
  // Tipe tidak dikenal (merge, revert, manual, dll) tetap dihitung patch.
  return { type, level: 'patch' };
}

function resolveAutoBump(commits) {
  let level = 'patch';
  for (const commit of commits) {
    if (isReleaseCommit(commit)) {
      continue;
    }
    const info = classifyCommit(commit);
    if (info.level === 'major') {
      return 'major';
    }
    if (info.level === 'minor') {
      level = 'minor';
    }
  }
  return level;
}

// ---------- file versi ----------

function readVersionFile() {
  const file = path.join(ROOT, 'VERSION');
  if (!fs.existsSync(file)) {
    return null;
  }
  return fs.readFileSync(file, 'utf8').trim();
}

function writeVersionFile(version) {
  fs.writeFileSync(path.join(ROOT, 'VERSION'), `${version}\n`);
}

// Tulis ulang field "version" pada file JSON, pertahankan urutan key lain.
function updateJsonVersion(relativePath, version) {
  const file = path.join(ROOT, relativePath);
  if (!fs.existsSync(file)) {
    return false;
  }
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (data.version === version) {
    return false;
  }
  data.version = version;
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
  return true;
}

// Baca field "version" tanpa mengubah file.
function readJsonVersion(relativePath) {
  const file = path.join(ROOT, relativePath);
  if (!fs.existsSync(file)) {
    return null;
  }
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  return typeof data.version === 'string' ? data.version : null;
}

function buildChangelogEntry({ version, date, commits, notes, compareBase }) {
  const groups = new Map(CHANGELOG_GROUP_ORDER.map((label) => [label, []]));
  for (const commit of commits) {
    if (isReleaseCommit(commit)) {
      continue;
    }
    const { type } = classifyCommit(commit);
    let label = 'Diubah';
    if (type === 'feat') {
      label = 'Ditambahkan';
    } else if (type === 'fix') {
      label = 'Diperbaiki';
    } else if (type === 'perf') {
      label = 'Performa';
    }
    groups.get(label).push(commit);
  }

  const lines = [`## [${version}] - ${date}`, ''];
  for (const label of CHANGELOG_GROUP_ORDER) {
    const items = groups.get(label) || [];
    if (items.length === 0) {
      continue;
    }
    lines.push(`### ${label}`);
    for (const commit of items) {
      lines.push(`- ${commit.subject} (${commit.hash.slice(0, 7)})`);
    }
    lines.push('');
  }

  if (notes.length > 0) {
    lines.push('### Catatan');
    for (const note of notes) {
      for (const part of note.split('\n')) {
        lines.push(`- ${part}`);
      }
    }
    lines.push('');
  }

  lines.push(`[Bandingkan ${compareBase}...v${version}](${REPO_URL}/compare/${compareBase}...v${version})`);
  lines.push('');
  return lines.join('\n');
}

// Entri untuk versi ini sudah ada di CHANGELOG.md?
function hasChangelogEntry(version) {
  const file = path.join(ROOT, 'CHANGELOG.md');
  if (!fs.existsSync(file)) {
    return false;
  }
  const content = fs.readFileSync(file, 'utf8');
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^##\\s*\\[${escaped}\\]`, 'm').test(content);
}

// Sisip entri baru di atas entri pertama; jangan duplikat bila versinya sudah ada.
function updateChangelog(entry, version) {
  if (hasChangelogEntry(version)) {
    return false;
  }
  const file = path.join(ROOT, 'CHANGELOG.md');
  const content = fs.existsSync(file)
    ? fs.readFileSync(file, 'utf8')
    : '# Changelog\n\n';
  const lines = content.split('\n');
  // Entri versi baru disisipkan di atas entri versi pertama (fallback: heading pertama).
  let index = lines.findIndex((line) => /^##\s*\[/.test(line));
  if (index < 0) {
    index = lines.findIndex((line) => /^##\s/.test(line));
  }
  const before = index >= 0 ? lines.slice(0, index) : lines;
  const after = index >= 0 ? lines.slice(index) : [];
  const entryLines = entry.replace(/\n+$/, '').split('\n');
  const merged = [...before, ...entryLines, '', ...after].join('\n');
  fs.writeFileSync(file, merged.endsWith('\n') ? merged : `${merged}\n`);
  return true;
}

// File versi yang akan berubah pada rilis ini (dipakai untuk simulasi dry-run).
function plannedVersionFiles(newVersion) {
  const files = ['VERSION'];
  for (const relativePath of VERSION_JSON_FILES) {
    const current = readJsonVersion(relativePath);
    if (current !== null && current !== newVersion) {
      files.push(relativePath);
    }
  }
  if (!hasChangelogEntry(newVersion)) {
    files.push('CHANGELOG.md');
  }
  return files;
}

// ---------- staging ----------

function unquotePath(value) {
  if (value.startsWith('"') && value.endsWith('"') && value.length > 1) {
    return value
      .slice(1, -1)
      .replace(/\\([0-7]{1,3})/g, (_, code) => String.fromCharCode(parseInt(code, 8)))
      .replace(/\\(.)/g, '$1');
  }
  return value;
}

function parseStatusPaths(statusOutput) {
  const paths = [];
  for (const line of statusOutput.split('\n')) {
    if (!line.trim()) {
      continue;
    }
    // Format porcelain: 2 kolom status + 1 spasi + path.
    let value = line.slice(3).trim();
    if (value.includes(' -> ')) {
      value = value.split(' -> ').pop().trim();
    }
    paths.push(unquotePath(value));
  }
  return paths;
}

function isIgnoredPath(value) {
  return IGNORE_PATTERNS.some((pattern) => value.includes(pattern));
}

// Daftar file yang akan di-stage. Mode default: semua perubahan dari
// "git status --porcelain" kecuali path yang diabaikan, digabung dengan file versi
// yang dipastikan berubah oleh rilis ini.
function resolveStagedFiles(options, extraFiles = []) {
  if (options.strict) {
    return VERSION_FILES.filter((relativePath) => fs.existsSync(path.join(ROOT, relativePath)));
  }
  const statusOutput = git(['status', '--porcelain', '--untracked-files=all']);
  const paths = parseStatusPaths(statusOutput).filter((value) => !isIgnoredPath(value));
  for (const extra of extraFiles) {
    if (!paths.includes(extra) && !isIgnoredPath(extra)) {
      paths.push(extra);
    }
  }
  return paths;
}

// ---------- output ----------

function printDryRun(plan) {
  console.log('');
  console.log(`${paint('RELEASE', COLOR.green)} ${paint('(dry-run)', COLOR.yellow)} — tidak ada file yang diubah, tidak ada perintah git mutatif dijalankan.`);
  console.log(row('Versi lama', plan.currentVersion));
  console.log(row('Versi baru', plan.newVersion));
  console.log(row('Tag', plan.tag));
  console.log(row('Pesan commit', plan.commitMessage));
  console.log(row('Bump', plan.bumpLabel));
  console.log(row('Branch', plan.branch));
  console.log(row('Tag terakhir', plan.lastTag || '(belum ada tag)'));
  console.log(row('Link compare', plan.compareUrl));
  console.log('');
  console.log(paint('  Commit dalam range:', COLOR.bold));
  if (plan.commits.length === 0) {
    console.log('    (tidak ada commit baru sejak tag terakhir)');
  }
  for (const commit of plan.commits) {
    console.log(`    - ${commit.hash.slice(0, 7)} ${commit.subject}`);
  }
  console.log('');
  console.log(paint('  File yang akan di-stage:', COLOR.bold));
  if (plan.stagedFiles.length === 0) {
    console.log('    (tidak ada file)');
  }
  for (const file of plan.stagedFiles) {
    console.log(`    - ${file}`);
  }
  console.log('');
  console.log(paint('  Preview entri CHANGELOG:', COLOR.bold));
  for (const line of plan.changelogPreview.split('\n')) {
    console.log(line ? `    ${line}` : '');
  }
  console.log(paint('  Perintah yang akan dijalankan:', COLOR.bold));
  console.log(`    git add -- ${plan.stagedFiles.join(' ')}`);
  console.log(`    git commit -m "${escapeShellText(plan.commitMessage)}"`);
  console.log(`    git tag -a ${plan.tag} -m "${plan.tag}"`);
  if (plan.push) {
    console.log(`    git push origin ${plan.branch}`);
    console.log(`    git push origin ${plan.tag}`);
  } else {
    console.log('    (push dilewati karena --no-push)');
  }
  console.log('');
}

function printReleaseSummary(result) {
  console.log('');
  console.log(`${paint('RELEASE', COLOR.green)} ${paint(result.newVersion, COLOR.bold)} berhasil dipublikasikan.`);
  console.log(row('Versi baru', result.newVersion));
  console.log(row('Tag', result.tag));
  console.log(row('Pesan commit', result.commitMessage));
  console.log(row('Commit', result.commitHash));
  console.log(row('Branch', result.branch));
  console.log('');
  console.log(paint('  File yang di-stage:', COLOR.bold));
  for (const file of result.stagedFiles) {
    console.log(`    - ${file}`);
  }
  console.log('');
  console.log(paint('  Tautan:', COLOR.bold));
  console.log(`    Actions : ${REPO_URL}/actions`);
  console.log(`    Release : ${REPO_URL}/releases/tag/${result.tag}`);
  console.log('');
}

// ---------- alur utama ----------

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  // 1. Precondition: branch harus main (kecuali --allow-branch).
  const branch = gitSafe(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (!branch) {
    fail('Tidak dapat membaca branch git saat ini.');
  }
  if (branch !== DEFAULT_BRANCH && !options.allowBranch) {
    fail(
      `Branch saat ini "${branch}", bukan "${DEFAULT_BRANCH}".`,
      'Pindah ke branch main atau gunakan --allow-branch bila memang yakin.',
    );
  }

  // 2. Precondition: ada perubahan working tree ATAU commit baru sejak tag terakhir.
  const statusOutput = git(['status', '--porcelain', '--untracked-files=all']);
  const hasChanges = statusOutput.trim().length > 0;
  const lastTag = gitSafe(['describe', '--tags', '--abbrev=0']);
  const commits = collectCommits(lastTag);
  if (!hasChanges && commits.length === 0) {
    fail('Tidak ada perubahan untuk dirilis.', 'Buat perubahan atau commit baru, lalu jalankan ulang.');
  }

  // 3. Precondition: sinkron dengan origin (hanya mode nyata; dry-run tidak fetch).
  const head = gitSafe(['rev-parse', 'HEAD']);
  const remoteHead = gitSafe(['rev-parse', `origin/${DEFAULT_BRANCH}`]);
  if (options.dryRun) {
    if (remoteHead && head !== remoteHead) {
      warn(`HEAD lokal berbeda dari origin/${DEFAULT_BRANCH} (dry-run tidak melakukan fetch).`);
    }
  } else {
    const fetched = fetchOriginMain();
    if (!fetched.ok) {
      if (!options.allowUnpushed) {
        fail(
          `Gagal fetch origin/${DEFAULT_BRANCH}.`,
          `${fetched.message} — gunakan --allow-unpushed untuk memaksa lanjut.`,
        );
      }
      warn(`Gagal fetch origin/${DEFAULT_BRANCH}: ${fetched.message}`);
    }
    const remoteHeadAfter = gitSafe(['rev-parse', `origin/${DEFAULT_BRANCH}`]);
    if (remoteHeadAfter && head !== remoteHeadAfter && !options.allowUnpushed) {
      fail(
        `HEAD lokal berbeda dari origin/${DEFAULT_BRANCH}.`,
        `Jalankan: git pull --ff-only origin ${DEFAULT_BRANCH} (atau gunakan --allow-unpushed).`,
      );
    }
  }

  // 4. Hitung versi baru.
  const currentVersion = lastTag ? lastTag.replace(/^v/, '') : (readVersionFile() || '0.0.0');
  let newVersion;
  let bumpLabel;
  if (options.set) {
    newVersion = options.set;
    bumpLabel = 'set (eksplisit)';
  } else {
    const level = options.bump === 'auto' ? resolveAutoBump(commits) : options.bump;
    newVersion = bumpVersion(currentVersion, level);
    bumpLabel = level;
  }
  const tag = `v${newVersion}`;

  // Pesan commit: pakai pesan kustom user, atau default "chore(release): v<versi baru>".
  const commitMessage = options.commitMessage || `${RELEASE_COMMIT_PREFIX} ${tag}`;

  // 5. Precondition: tag baru belum boleh ada.
  const existingTag = git(['tag', '-l', tag]).trim();
  if (existingTag) {
    fail(`Tag ${tag} sudah ada.`, 'Hapus tag lama bila salah, atau gunakan versi yang lain.');
  }

  // Basis link compare: tag terakhir, atau versi lama bila berbeda, atau HEAD.
  let compareBase;
  if (lastTag) {
    compareBase = lastTag.startsWith('v') ? lastTag : `v${lastTag}`;
  } else if (currentVersion !== newVersion && parseSemver(currentVersion)) {
    compareBase = `v${currentVersion}`;
  } else {
    compareBase = 'HEAD';
  }
  const compareUrl = `${REPO_URL}/compare/${compareBase}...${tag}`;

  const changelogPreview = buildChangelogEntry({
    version: newVersion,
    date: new Date().toISOString().slice(0, 10),
    commits,
    notes: options.notes,
    compareBase,
  });

  // 6. Mode dry-run: hanya hitung & tampilkan, tanpa menulis file / menjalankan git mutatif.
  if (options.dryRun) {
    printDryRun({
      currentVersion,
      newVersion,
      bumpLabel,
      tag,
      branch,
      lastTag,
      commits,
      stagedFiles: resolveStagedFiles(options, plannedVersionFiles(newVersion)),
      changelogPreview,
      compareUrl,
      commitMessage,
      push: options.push,
    });
    return;
  }

  // 7. Tulis file versi + CHANGELOG (dilakukan sebelum menghitung daftar stage
  //    supaya perubahan versi ikut ter-stage).
  writeVersionFile(newVersion);
  VERSION_JSON_FILES.forEach((relativePath) => updateJsonVersion(relativePath, newVersion));
  updateChangelog(changelogPreview, newVersion);

  // 8. Hitung & stage file.
  const stagedFiles = resolveStagedFiles(options);
  if (stagedFiles.length > 0) {
    gitMust(['add', '--', ...stagedFiles], 'Gagal stage file versi.', 'Periksa status git dan ulangi.');
  }
  const stagedActual = (gitSafe(['diff', '--cached', '--name-only']) || '')
    .split('\n')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  if (stagedActual.length === 0) {
    fail(
      'Tidak ada perubahan untuk dikomit; tag tidak dibuat.',
      'Tidak ada file versi yang berubah — gunakan --set dengan versi berbeda atau ubah CHANGELOG.md.',
    );
  }

  // 9. Commit + tag.
  gitMust(
    ['commit', '-m', commitMessage],
    'Gagal membuat commit release.',
    'Pastikan konfigurasi git user.name/user.email sudah terisi.',
  );
  const commitHash = gitSafe(['rev-parse', '--short', 'HEAD']) || '';
  gitMust(['tag', '-a', tag, '-m', tag], `Gagal membuat tag ${tag}.`);

  // 10. Push commit lalu tag.
  if (options.push) {
    gitMust(['push', 'origin', branch], 'Gagal push commit ke origin.', `Periksa hak akses remote ${REPO_URL}.`);
    try {
      git(['push', 'origin', tag]);
    } catch (error) {
      const detail = String((error && error.stderr) || (error && error.message) || '').trim();
      console.error(`${paint('ERROR', COLOR.red)} Gagal push tag ${tag} ke origin.`);
      if (detail) {
        console.error(`       ${detail}`);
      }
      console.error('');
      console.error('Commit release sudah ter-push, tag belum. Jalankan manual:');
      console.error(`  git push origin ${tag}`);
      console.error(`  atau: git tag -a ${tag} -m "${tag}" && git push origin ${tag}`);
      process.exit(1);
    }
  } else {
    warn(`Push dilewati (--no-push). Jalankan manual bila perlu: git push origin ${branch} && git push origin ${tag}`);
  }

  printReleaseSummary({
    newVersion,
    tag,
    commitHash,
    branch,
    stagedFiles: stagedActual,
    commitMessage,
  });
}

function fetchOriginMain() {
  try {
    execFileSync('git', ['fetch', 'origin', DEFAULT_BRANCH], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, message: '' };
  } catch (error) {
    return {
      ok: false,
      message: String((error && error.stderr) || (error && error.message) || '').trim(),
    };
  }
}

main();
