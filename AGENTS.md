# AGENTS.md — Aturan Kerja untuk Sesi Agent AI

Repo ini adalah POS Minimarket (frontend React + Vite di root, backend Express
CommonJS di `backend/`). Baca file ini sebelum mulai mengerjakan apa pun.

## Aturan Release Wajib

- Setiap kali fitur **sudah di-merge ke `main`**, Anda **WAJIB** menjalankan
  `npm run release`. Perintah itu melakukan bump versi otomatis dari
  conventional commit, memperbarui `VERSION` + `package.json` (root &
  `backend/`) + `CHANGELOG.md`, membuat commit `chore(release): vX.Y.Z`, membuat
  tag `vX.Y.Z`, lalu push commit dan tag.
- Setelah perintah selesai, **verifikasi** GitHub Release muncul di halaman
  **Releases** repo `HibatullahPrihadian/pos-server`. Bila workflow "Release"
  gagal atau release belum muncul, perbaiki (jalankan ulang workflow / perbaiki
  skrip) — jangan dianggap selesai sebelum release terlihat.
- Ragu dengan versinya? Jalankan `npm run release:dry` (atau
  `npm run release -- --dry-run`) lebih dulu: simulasi tanpa mengubah file,
  commit, tag, atau push.
- **Offender: jangan pernah membuat tag manual.** Tag hanya boleh dibuat oleh
  `npm run release`. Jangan `git tag`, `git push --tags`, atau membuat release
  lewat `gh release create` (kecuali *fallback manual* yang diminta user saat
  workflow benar-benar gagal).
- Release GitHub dibuat oleh GitHub Actions (`.github/workflows/release.yml`)
  saat tag `v*` di-push — bukan oleh `gh` lokal.

## Format Commit

Pola commit (sudah dipakai repo, wajib konsisten):

```
feat|fix|perf|refactor|chore(scope): deskripsi
```

Contoh:

- `feat(pos): tambah shortcut F7`
- `fix(report): perbaiki filter tanggal`

Aturan naik versi (otomatis, dibaca dari tipe commit):

| Tipe commit | Naik versi | Contoh |
|---|---|---|
| `feat` | **minor** | 1.0.0 → 1.1.0 |
| `fix`, `perf` | **patch** | 1.0.0 → 1.0.1 |
| `!` setelah tipe, atau `BREAKING CHANGE:` di body | **major** | 1.0.0 → 2.0.0 |

## Sebelum Push

Wajib dan harus lulus:

```bash
npm run lint      # ESLint (frontend + backend)
npm run build     # build produksi frontend (Vite)
```

Skrip di `.github/scripts/` tidak ikut di-lint oleh `npm run lint` (ESLint
mengabaikan folder berawalan titik secara default). Periksa manual bila
diubah:

```bash
npx eslint .github/scripts/changelog-section.js --no-ignore --max-warnings 0
```

## Struktur Repo

```
pos-server/
├── src/                  # Frontend React + Vite (ESM, JSX)
├── vite.config.js        # Vite + vite-plugin-pwa (manifest PWA)
├── backend/
│   ├── server.js         # Bootstrap Express, mount router
│   ├── routes/           # Endpoint per modul
│   ├── utils/            # Helper (money, barcode, permissions, ...)
│   ├── init.sql          # Skema database
│   └── seed.sql          # Data contoh
├── docker-compose.yml    # postgres + backend + frontend (nginx)
├── Dockerfile            # Image frontend (build -> nginx)
├── backend/Dockerfile    # Image backend
├── VERSION               # Sumber kebenaran versi (tanpa prefix "v")
├── CHANGELOG.md          # Riwayat versi (Keep a Changelog)
└── .github/workflows/release.yml
```

Frontend = React + Vite (ESM, di `src/`). Backend = Express **CommonJS**
(`require`, bukan `import`).

## Dokumentasi

| File | Isi |
|---|---|
| `README.md` | Fitur, cara jalan, aturan bisnis, API, shortcut, release |
| `Feature.md` | Ringkasan fitur untuk pengguna |
| `CHANGELOG.md` | Riwayat versi + panduan format entri |
| `VERSION` | Versi aplikasi saat ini (sumber kebenaran) |
| `.kilo/plans/` | Rencana kerja fitur (baca sebelum mengerjakan fitur besar) |

## Catatan Environment

- Perintah `git` yang **memodifikasi** repository (`add`, `commit`, `tag`,
  `push`, `merge`) **diblokir** pada tool bash. Jalankan lewat npm script —
  skrip release menjalankan `git` secara internal, jadi `npm run release` tetap
  bisa dipakai.
- `node` harus dijalankan **via `npm run`** (atau `npx`), bukan memanggil
  `node ...` langsung sebagai perintah utama.
- `gh` CLI terpasang, tetapi token lokal kemungkinan **tidak terautentikasi**.
  GitHub Release dibuat oleh **GitHub Actions**, bukan `gh` lokal. Fallback
  manual (`gh release create vX.Y.Z --generate-notes`) hanya bila workflow
  gagal dan user memintanya.
- Jangan `npm install` package baru tanpa alasan kuat; gunakan dependensi yang
  sudah ada.

## Gaya Kode

- **Komentar & dokumentasi dalam Bahasa Indonesia.**
- Backend: **CommonJS** (wajib `require`/`module.exports`).
  Frontend: **ESM** (`import`/`export`).
- Indentasi **2 spasi**; statement JavaScript diakhiri **titik koma**.
- **Tanpa dependency baru** tanpa alasan kuat — cari dulu apakah utilitas yang
  dibutuhkan sudah ada di `backend/utils/` atau `src/utils/`.
- Ikuti pola file yang sudah ada di sekitam sebelum menulis kode baru.
