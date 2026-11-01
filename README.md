# Yusup VPS NAT — Website Cloudflare

Versi website dari SC Auto Order VPS NAT (alur order diadaptasi dari SC by @iwawv1 — credit tetap dipertahankan).
Jalan di Cloudflare Workers + D1 (database), tanpa server/VPS.

## Fitur
- Tampilan terang (gaya amprem.fadelsm.ai.id), menu owner berupa tombol panjang ke bawah
- Login / daftar wajib (password minimal 4 karakter)
- Loading 3D: Menyiapkan dashboard → Menyiapkan user → Melihat total trx → Siap......
- Order: pilih jumlah → tekan Order → QR owner muncul otomatis → user wajib kirim bukti bayar → owner setujui → data VPS NAT otomatis masuk ke Pesanan + notifikasi
- Stok direservasi saat order (tidak bisa dobel jual), order tanpa bukti hangus 30 menit
- Chat publik antar user
- Notifikasi + broadcast dari owner
- Owner saja: setting QR, setujui/tolak order, tambah/hapus stok VPS NAT, ban/unban user, kirim notif ke 1 user / semua, kode promo, harga & spesifikasi, mode maintenance

## Create VPS NAT otomatis (Railway) — khusus owner
Owner → tab **Create VPS NAT** → tempel token Railway → isi nama VPS → tekan tombol.
Proses tampil sebagai timeline dengan jam, durasi tiap langkah, dan status berhasil/gagal:
validasi token → buat project → buat service + deploy → buat alamat SSH (TCP proxy) → tunggu server aktif → simpan ke stok.
- Token tidak disimpan; hanya dipakai selama proses berjalan.
- Default image `linuxserver/openssh-server` (SSH di port 2222, login user + password acak). Bisa diganti di "Pengaturan lanjutan".
- Pakai token akun (railway.com/account/tokens). Token workspace/team: isi Workspace ID.
- Cek aturan penggunaan (ToS) Railway untuk layanan SSH sebelum dijual.

## Akun owner
Dibuat otomatis saat website pertama dibuka (dari `[vars]` di wrangler.toml):
username `Yusupboy`, password `memeksiapaitu`. Username ini tidak bisa didaftarkan orang lain.
Disarankan setelah deploy: `npx wrangler secret put OWNER_PASS` lalu hapus OWNER_PASS dari wrangler.toml
(password owner hanya dibaca saat akun pertama dibuat; ganti password setelahnya = hapus baris user di D1 lalu buka ulang website).

## Deploy (sekali saja)
1. Install Node 18+, lalu di folder ini: `npm i -g wrangler` dan `wrangler login`
2. Buat database: `wrangler d1 create yusup-vps-nat`
   → salin `database_id` yang muncul ke `wrangler.toml` (ganti ISI_DATABASE_ID_...)
3. Deploy: `wrangler deploy`
   (tabel dibuat otomatis saat website pertama dibuka, tidak perlu migrasi manual)
4. Sambungkan domain: Cloudflare Dashboard → Workers & Pages → yusup-vps-nat → Settings → Domains & Routes → Add → Custom domain (domain harus sudah ada di akun Cloudflare kamu)

## Setelah login sebagai owner
1. Owner → Pengaturan → upload QR pembayaran (wajib, kalau belum user tidak bisa order)
2. Owner → Stok → tempel data VPS. Format: label (IP / Port / Username / Password) atau satu baris `ip|port|user|password`. Beberapa VPS berlabel dipisah baris `---`
3. Atur harga, spesifikasi, nama website di Pengaturan

## Catatan
- Pembayaran manual lewat QR + bukti (sama seperti QRIS manual di script lama). Integrasi AustinPay otomatis belum dibuat.
- Pengecekan VPS hidup/SSH saat add stok dari script lama tidak ikut (Workers tidak bisa SSH).
- Pre-order dan struk gambar dari script lama tidak ikut; stok kosong = tombol order nonaktif.
- Data user/order script Telegram lama tidak dimigrasi.
