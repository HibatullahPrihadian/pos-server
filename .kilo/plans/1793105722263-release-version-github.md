# Release Versioning Otomatis per Merge ke `main` (mulai v1.0.0)

## Tujuan
Setiap fitur/kode yang sudah merge ke `main` langsung menghasilkan **release version di GitHub** (tag + GitHub Release), mulai dari **v1.0.0**, dengan nomor versi yang konsisten di seluruh repo (frontend, backend, PWA, CHANGELOG) dan terlihat oleh pengguna.

## Keputusan yang sudah diambil (dipastikan ke user)
| Topik | Keputusan |
|---|---|
| Granularitas | Release dibuat saat **merge ke `main`** (bukan per commit di branch) |
| Sumber versi | **File `VERSION` di root** + skrip `npm run release`; package.json frontend & backend disinkronkan |
| Eksekusi | **Bump versi lokal (commit) + GitHub Actions yang dipicu push tag** → GitHub Release otomatis |
| Baseline | Tag **v1.0.0** pada HEAD saat ini (commit `ce3d28d`) sebagai release pertama |
| Aturan naik versi | **Conventional commit**: `feat`→minor, `fix`/`perf`/`refactor`/`chore`/dll→patch, `!`/`BREAKING CHANGE`→major |
| Trigger | **Agent (Kilo) otomatis** menjalankan release setelah merge ke `main`; dicatat di `AGENTS.md` |
| Docker image | **Di luar scope** sekarang (workflow hanya membuat Release, tidak build/push GHCR) |
| Tampilan versi | `/api/version`, halaman Settings, sidebar/layout, manifest PWA |

## Arsitektur
```
Fitur di branch → merge ke main → npm run release (lokal)
     ├─ VERSION + package.json (root & backend) + CHANGELOG.md diperbarui
     ├─ commit "chore(release): vX.Y.Z"
     ├─ tag annotated "vX.Y.Z" → push commit + tag
     └─ GitHub Actions (on: push tags: v*) → GitHub Release + release notes
```
Nilai versi selalu **ikut dalam commit**, jadi SHA mana pun bisa knows its version; tag selalu menunjuk commit yang versinya cocok.

## File yang dibuat / diubah
**Baru**
- `VERSION` — sumber kebenaran, isi `1.0.0`
- `scripts/release.mjs` — skrip bump + tag + push (ESM, sesuai `"type": "module"` root)
- `CHANGELOG.md` — riwayat versi (format Keep a Changelog, bahasa Indonesia)
- `.github/workflows/release.yml` — buat GitHub Release saat tag di-push
- `AGENTS.md` — aturan sesi agent: setelah merge ke `main` → jalankan `npm run release`

**Diubah**
- `package.json` (root): script `release`, `version` → `1.0.0`
- `backend/package.json`: `version` → `1.0.0` (dibaca runtime backend)
- `vite.config.js`: baca `VERSION` → `define: { __APP_VERSION__ }` + `manifest.version/short_version`
- `backend/server.js`: tambah `GET /api/version` (publik, tanpa JWT)
- `src/pages/Settings.jsx`: section "Tentang Aplikasi" (versi, build date, commit)
- `src/components/layout/Sidebar.jsx`: label versi kecil di footer sidebar
- `README.md`: bagian "Release & Versi" + alur kerja

## Detail Implementasi

### 1. `VERSION`
```
1.0.0
```
Tanpa prefix `v`, tanpa trailing newline多余的; dibaca oleh `vite.config.js` (fs.readFileSync) dan `scripts/release.mjs`.

### 2. `scripts/release.mjs` (ESM, tanpa dependency baru)
CLI: `npm run release [-- --bump auto|patch|minor|major] [--dry-run] [--no-push] [--notes "..."]`

Langkah:
1. Precondition: branch `main`, working tree bersih, `git fetch origin` lalu `main` == `origin/main` (tolak bila belum sync; opsional `--allow-unpushed`).
2. Tentukan tag terakhir: `git describe --tags --abbrev=0` (baseline: `v1.0.0`).
3. Kumpulkan commit: `git log --format=%H%x1f%s%x1f%b <tag>..HEAD`.
   - Abaikan commit `chore(release):*` agar tidak memengaruhi bump.
4. Tentukan bump dari conventional commit:
   - major: subject memuat `!` setelah tipe, atau body memuat `BREAKING CHANGE:`
   - minor: tipe `feat`
   - patch: tipe `fix|perf|refactor|test|docs|chore|build|ci|style` atau commit tak dikenal
   - `--bump` eksplisit mengoverride hasil auto.
5. Hitung versi baru (semver sederhana, tanpa dependency): `1.0.0` → patch `1.0.1`, minor `1.1.0`, major `2.0.0`.
6. Tulis ulang: `VERSION`, `version` di `package.json` root, `version` di `backend/package.json` (semua via JSON parse/stringify agar format tetap rapi).
7. Tambah entri `CHANGELOG.md`: heading `## [1.1.0] - 2026-10-27`, grup `Added / Fixed / Changed / Performance` dari tipe conventional commit, plus link compare `.../compare/v1.0.0...v1.1.0`.
8. `git add VERSION CHANGELOG.md package.json backend/package.json` → commit `chore(release): v1.1.0` → tag annotated `v1.1.0` dengan pesan `v1.1.0`.
9. Push: `git push origin main` lalu `git push origin v1.1.0` (skip bila `--no-push`).
10. Cetak ringkasan + tautan Actions. GitHub Release dibuat oleh workflow (bukan skrip), sehingga skrip tidak bergantung token `gh`.

Guard: script menolak jalan bila `VERSION` tidak cocok dengan `package.json`/`backend/package.json` (except saat-sync), dan menolak bump bila tidak ada commit baru sejak tag (kecuali `--force`).

### 3. `.github/workflows/release.yml`
```yaml
name: Release
on:
  push:
    tags: ['v*']
permissions:
  contents: write
jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - name: Extract changelog section
        run: node .github/scripts/changelog-section.js "$GITHUB_REF_NAME" > release-notes.md
      - name: Create GitHub Release
        env: { GH_TOKEN: ${{ secrets.GITHUB_TOKEN }} }
        run: |
          if [ -s release-notes.md ]; then
            gh release create "$GITHUB_REF_NAME" --title "$GITHUB_REF_NAME" --notes-file release-notes.md
          else
            gh release create "$GITHUB_REF_NAME" --title "$GITHUB_REF_NAME" --generate-notes
          fi
```
Helper `.github/scripts/changelog-section.js` membaca `CHANGELOG.md` dan mengambil bagian untuk tag terkait (fallback: `--generate-notes`).

### 4. Backend `GET /api/version`
Di `backend/server.js`, taruh **sebelum** middleware JWT (`backend/server.js:43` `PUBLIC_API_PATHS`), agar bisa diakses tanpa token (dipakai halaman login/PWA):
```js
const { version: BACKEND_VERSION } = require('./package.json');
app.get('/api/version', (_req, res) => {
  res.json({
    version: BACKEND_VERSION,
    commit: process.env.RELEASE_COMMIT || null,
    builtAt: process.env.RELEASE_BUILT_AT || null,
  });
});
```
`RELEASE_COMMIT`/`RELEASE_BUILT_AT` opsional (di-set via env docker bila tersedia) — tidak wajib.

### 5. Frontend
- `vite.config.js`: `const APP_VERSION = readFileSync(new URL('./VERSION', import.meta.url), 'utf8').trim();` → `define: { __APP_VERSION__: JSON.stringify(APP_VERSION) }`; tambahkan `version: APP_VERSION` dan `short_version: APP_VERSION` pada manifest PWA.
- `src/api/client.js`: tidak berubah (pakai `api.get('/api/version')`).
- Hook kecil `src/hooks/useAppVersion.js`: ambil `/api/version`, fallback ke `__APP_VERSION__` bila API offline; cache di `sessionStorage`.
- `src/pages/Settings.jsx`: card "Tentang Aplikasi" → versi, build date, commit short SHA.
- `src/components/layout/Sidebar.jsx`: footer sidebar, teks kecil `v1.0.0` (dari hook, fallback `__APP_VERSION__`).
- Build produksi tetap kompatibel: `__APP_VERSION__` di-inject Vite, tidak perlu file `.env`.

### 6. Baseline v1.0.0 (dilakukan setelah semua file di atas siap)
1. `VERSION` = `1.0.0`, `package.json` root = `1.0.0`, `backend/package.json` = `1.0.0`.
2. `CHANGELOG.md` entri pertama `## [1.0.0] - 2026-10-27` berisi ringkasan fitur yang sudah ada (POS minimarket + mode fotokopi, konsinyasi, invoice grosir kredit, member/poin, stok FEFO, absensi/shift, laporan & laba rugi, struk 58mm, PWA) — sumber: `README.md` + `Feature.md`.
3. Commit `chore(release): v1.0.0` → tag annotated `v1.0.0` → push commit + tag → workflow membuat GitHub Release "v1.0.0".

### 7. `AGENTS.md` (aturan untuk sesi agent berikutnya)
Isi ringkas:
- Setelah fitur di-merge ke `main`, WAJIB jalankan `npm run release` (bump otomatis dari conventional commit), lalu verifikasi `gh release list` / halaman Releases.
- Format commit: `feat|fix|perf|refactor|chore(scope): deskripsi` (pola yang sudah dipakai repo).
- Jangan membuat tag manual; tag hanya lewat skrip.

## Ritual harian (setelah plan diimplementasikan)
1. Kerjakan fitur di branch, commit dengan conventional commit.
2. Merge ke `main` (push).
3. Jalankan `npm run release` (dry-run dulu bila ragu: `-- --dry-run`).
4. Cek GitHub Actions run "Release" sukses dan release muncul di halaman Releases repo.

## Failure Mode & Penanganan
| Masalah | Penanganan |
|---|---|
| Working tree kotor / branch bukan `main` | Skrip berhenti dengan pesan jelas, tidak ada perubahan file |
| `main` belum sinkron dengan `origin/main` | Ditolak (opsional `--allow-unpushed` untuk случаев上一次 release di-mid) |
| Tag sudah ada | Ditolak; hapus tag manual bila salah (`git tag -d` + `git push --delete origin`) |
| Workflow gagal / token `GITHUB_TOKEN` kurang izin | Fallback manual: `gh release create vX.Y.Z --generate-notes` (butuh `gh auth login` ulang karena token lokal saat ini invalid) |
| Push tag ditolak | Periksa SSH key/branch protection; tag push tidak boleh butuh review |
| Versi backend ≠ frontend | `npm run release -- --bump patch` untuk resinkronisasi; endpoint `/api/version` mengembalikan versi backend sebagai sumber kebenaran |
| Release terduplikasi | Hapus release + tag di GitHub, lalu jalankan ulang skrip |

## Validasi (wajib dijalankan setelah implementasi)
1. `npm run lint` — tanpa error/warning baru.
2. `npm run build` — build sukses; cek `dist/manifest.webmanifest` memuat versi.
3. `node --check backend/server.js` dan `node backend/server.js` → `curl localhost:5000/api/version` (tanpa token) mengembalikan `{"version":"1.0.0"}`.
4. `npm run release -- --dry-run` pada branch uji → tidak ada file berubah, output versi & daftar commit.
5. Uji end-to-end baseline: commit `chore(release): v1.0.0` + tag + push → cek GitHub Actions "Release" sukses → release "v1.0.0" ada di repo.
6. Uji bump otomatis: buat branch uji dengan commit `feat(x): ...` dan `fix(y): ...` → dry-run naik minor; `docs(z):` saja → patch.
7. Cek Settings & sidebar menampilkan versi yang sama dengan `/api/version`.

## Risiko
- Push langsung ke `main` + tag: pastikan `main` tidak dilindungi branch protection yang menolak push tag.
- `gh` lokal tidak terautentikasi (token invalid) — tidak menghambat alur utama karena release dibuat Actions; hanya relevan untuk fallback manual.
- Image Docker belum membawa label versi (di luar scope); versi runtime backend diambil dari `backend/package.json` yang sudah ikut ter-deploy.

## Out of Scope
- Publish image Docker / GHCR.
- Changelog otomatis dari PR body.
- Backfill tag untuk commit lama sebelum `v1.0.0` (commit lama tidak diberi versi; `v1.0.0` menjadi baseline).
- Semantic versioning untuk dependensi npm.
