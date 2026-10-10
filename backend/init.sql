-- POS Minimarket - skema database (idempotent)
-- Dijalankan otomatis saat pertama kali container postgres dibuat (docker-entrypoint-initdb.d),
-- atau manual: docker compose exec -T postgres psql -U postgres -d pos_minimarket -f /docker-entrypoint-initdb.d/01-init.sql

-- =========================================================
-- Auth & pengaturan
-- =========================================================
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    full_name VARCHAR(100) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(10) NOT NULL DEFAULT 'kasir' CHECK (role IN ('admin', 'kasir', 'gudang', 'operator')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    permissions JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Role 'gudang' & 'operator' + izin granular per user (JSON). Tabel users pada DB
-- yang sudah berjalan dibuat sebelum kolom/role ini ada, sehingga CREATE TABLE IF
-- NOT EXISTS di atas tidak mengubahnya — perlu ALTER idempotent.
-- Guard via pg_constraint agar hanya diubah bila definisinya belum memuat
-- 'operator' (DROP/ADD constraint memakai ACCESS EXCLUSIVE lock + validasi ulang
-- seluruh baris, jadi jangan dijalankan setiap kali init.sql diulang).
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'users_role_check'
          AND pg_get_constraintdef(oid) NOT LIKE '%operator%'
    ) THEN
        ALTER TABLE users DROP CONSTRAINT users_role_check;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'users_role_check'
    ) THEN
        ALTER TABLE users ADD CONSTRAINT users_role_check
            CHECK (role IN ('admin', 'kasir', 'gudang', 'operator'));
    END IF;
END $$;
-- NULL = pakai preset role; array eksplisit = izin custom per user.
ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions JSONB;
-- Multi-usaha: NULL = lintas usaha (owner/admin); staf diisi satu usaha.
ALTER TABLE users ADD COLUMN IF NOT EXISTS business VARCHAR(20);

CREATE TABLE IF NOT EXISTS store_settings (
    id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    store_name VARCHAR(150) NOT NULL DEFAULT 'Minimarket Saya',
    address TEXT NOT NULL DEFAULT '',
    phone VARCHAR(50) NOT NULL DEFAULT '',
    npwp VARCHAR(50) NOT NULL DEFAULT '',
    tax_rate NUMERIC(5, 2) NOT NULL DEFAULT 11.00,
    tax_included BOOLEAN NOT NULL DEFAULT TRUE,
    invoice_prefix VARCHAR(20) NOT NULL DEFAULT 'INV',
    receipt_footer TEXT NOT NULL DEFAULT 'Terima kasih telah berbelanja',
    qris_image_path TEXT,
    point_earn_per_amount INTEGER NOT NULL DEFAULT 10000,
    point_value_rupiah INTEGER NOT NULL DEFAULT 100,
    point_min_redeem INTEGER NOT NULL DEFAULT 10,
    low_stock_default INTEGER NOT NULL DEFAULT 5,
    allow_negative_stock BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO store_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Pengaturan per usaha. store_settings tetap dipakai sebagai default minimarket
-- (kompatibel penuh dengan kode lama); usaha lain punya baris sendiri di sini.
CREATE TABLE IF NOT EXISTS business_settings (
    business VARCHAR(20) PRIMARY KEY,
    store_name VARCHAR(150) NOT NULL DEFAULT 'Usaha Saya',
    address TEXT NOT NULL DEFAULT '',
    phone VARCHAR(50) NOT NULL DEFAULT '',
    npwp VARCHAR(50) NOT NULL DEFAULT '',
    tax_rate NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
    tax_included BOOLEAN NOT NULL DEFAULT TRUE,
    invoice_prefix VARCHAR(20) NOT NULL DEFAULT 'INV',
    receipt_footer TEXT NOT NULL DEFAULT 'Terima kasih',
    qris_image_path TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO business_settings (business, store_name) VALUES ('fotokopi', 'Fotokopi Saya')
ON CONFLICT (business) DO NOTHING;

CREATE TABLE IF NOT EXISTS audit_logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    action VARCHAR(50) NOT NULL,
    entity VARCHAR(50) NOT NULL,
    entity_id INTEGER,
    detail JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Counter nomor dokumen harian: INV-YYYYMMDD-NNNN, RET-..., PO-..., OPN-...
CREATE TABLE IF NOT EXISTS invoice_counters (
    prefix VARCHAR(20) NOT NULL,
    day DATE NOT NULL,
    last_number INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (prefix, day)
);

-- =========================================================
-- Master data
-- =========================================================
CREATE TABLE IF NOT EXISTS categories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Kategori kini unik per usaha, bukan global: nama yang sama boleh ada di
-- minimarket dan fotokopi. UNIQUE global lama dibuang di sini; indeks unik
-- (business, name) dibuat setelah kolom `business` terpasang (lihat blok
-- multi-usaha di bawah). Tanpa ini, impor produk usaha lain akan menempel ke
-- kategori usaha yang sudah ada.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'categories_name_key') THEN
        ALTER TABLE categories DROP CONSTRAINT categories_name_key;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS suppliers (
    id SERIAL PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    phone VARCHAR(50),
    address TEXT,
    note TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Pelanggan grosir/B2B (terpisah dari members). Dipakai untuk penjualan kredit:
-- termin default (hari) & limit kredit (0 = tanpa batas).
CREATE TABLE IF NOT EXISTS customers (
    id SERIAL PRIMARY KEY,
    code VARCHAR(30) UNIQUE NOT NULL,        -- CUST-0001
    name VARCHAR(150) NOT NULL,              -- nama perusahaan/toko pelanggan
    contact_name VARCHAR(150),
    phone VARCHAR(50),
    email VARCHAR(120),
    address TEXT,
    npwp VARCHAR(50),
    payment_term_days INTEGER NOT NULL DEFAULT 0,  -- 0 = tunai; 30 = Net 30
    credit_limit BIGINT NOT NULL DEFAULT 0,        -- 0 = tanpa batas
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS products (
    id SERIAL PRIMARY KEY,
    sku VARCHAR(50) UNIQUE NOT NULL,
    barcode VARCHAR(50) UNIQUE,
    name VARCHAR(200) NOT NULL,
    category_id INTEGER REFERENCES categories(id),
    supplier_id INTEGER REFERENCES suppliers(id),
    base_unit VARCHAR(20) NOT NULL DEFAULT 'pcs',
    cost_price BIGINT NOT NULL DEFAULT 0,
    sell_price BIGINT NOT NULL DEFAULT 0,
    member_price BIGINT,
    min_stock INTEGER NOT NULL DEFAULT 0,
    stock_qty INTEGER NOT NULL DEFAULT 0,
    image_path TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS product_units (
    id SERIAL PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    unit_name VARCHAR(20) NOT NULL,
    conversion_factor INTEGER NOT NULL CHECK (conversion_factor > 0),
    sell_price BIGINT NOT NULL,
    member_price BIGINT,
    barcode VARCHAR(50) UNIQUE,
    UNIQUE (product_id, unit_name)
);

-- Barcode tambahan per produk. `products.barcode` tetap barcode utama
-- (backward-compatible). `unit_id` diisi bila barcode mewakili satuan tertentu.
CREATE TABLE IF NOT EXISTS product_barcodes (
    id SERIAL PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    barcode VARCHAR(50) UNIQUE NOT NULL,
    unit_id INTEGER REFERENCES product_units(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Harga partai bertingkat. min_qty dihitung dalam satuan `unit_id`
-- (NULL = satuan dasar). Tier hanya menurunkan harga normal.
CREATE TABLE IF NOT EXISTS price_tiers (
    id SERIAL PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    unit_id INTEGER REFERENCES product_units(id) ON DELETE CASCADE,
    min_qty INTEGER NOT NULL CHECK (min_qty > 1),
    price BIGINT NOT NULL CHECK (price >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (product_id, unit_id, min_qty)
);

-- Diskon promo berbasis periode (jam/hari/tanggal).
-- scope='product' -> product_id wajib; scope='category' -> category_id wajib.
-- discount_type='batch_price' -> discount_value adalah harga total untuk min_qty unit.
CREATE TABLE IF NOT EXISTS promotions (
    id SERIAL PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    scope VARCHAR(10) NOT NULL CHECK (scope IN ('product', 'category')),
    product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
    category_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,
    unit_id INTEGER REFERENCES product_units(id) ON DELETE CASCADE,
    discount_type VARCHAR(15) NOT NULL CHECK (discount_type IN ('percent', 'amount', 'batch_price')),
    discount_value BIGINT NOT NULL CHECK (discount_value >= 0),
    min_qty INTEGER NOT NULL DEFAULT 1 CHECK (min_qty > 0),
    start_time TIME,
    end_time TIME,
    days_of_week SMALLINT[],
    start_date DATE,
    end_date DATE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT promotions_scope_target CHECK (
        (scope = 'product' AND product_id IS NOT NULL AND category_id IS NULL)
        OR (scope = 'category' AND category_id IS NOT NULL AND product_id IS NULL)
    ),
    CONSTRAINT promotions_time_range CHECK (
        start_time IS NULL OR end_time IS NULL OR start_time <> end_time
    )
);

-- Migrasi data barcode lama ke tabel multibarcode (idempotent).
-- Unit diinsert lebih dulu agar barcode yang dipakai bersama produk & satuan tetap
-- terpetakan ke satuan (lebih spesifik); lookup tetap fallback ke products.barcode.
-- Peringatkan (bukan gagal) bila ada bentrok antar sumber agar tidak hilang diam-diam.
DO $$
DECLARE
    conflict_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO conflict_count
    FROM products p
    JOIN product_units pu ON pu.barcode = p.barcode
    WHERE p.barcode IS NOT NULL;

    IF conflict_count > 0 THEN
        RAISE NOTICE 'Peringatan: % barcode dipakai bersama oleh produk dan satuan. Satuan diprioritaskan di product_barcodes.', conflict_count;
    END IF;
END $$;

INSERT INTO product_barcodes (product_id, barcode, unit_id)
SELECT product_id, barcode, id FROM product_units WHERE barcode IS NOT NULL
ON CONFLICT (barcode) DO NOTHING;

INSERT INTO product_barcodes (product_id, barcode, unit_id)
SELECT id, barcode, NULL FROM products WHERE barcode IS NOT NULL
ON CONFLICT (barcode) DO NOTHING;

-- =========================================================
-- Stok
-- =========================================================
CREATE TABLE IF NOT EXISTS stock_movements (
    id SERIAL PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id),
    qty_change INTEGER NOT NULL,
    balance_after INTEGER NOT NULL,
    type VARCHAR(20) NOT NULL CHECK (type IN ('initial', 'purchase', 'sale', 'return', 'void', 'adjustment', 'opname')),
    ref_type VARCHAR(30),
    ref_id INTEGER,
    unit_cost BIGINT,
    note TEXT,
    user_id INTEGER REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stock_opnames (
    id SERIAL PRIMARY KEY,
    code VARCHAR(40) UNIQUE NOT NULL,
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    status VARCHAR(10) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'posted')),
    user_id INTEGER REFERENCES users(id),
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    posted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS stock_opname_items (
    id SERIAL PRIMARY KEY,
    opname_id INTEGER NOT NULL REFERENCES stock_opnames(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id),
    system_qty INTEGER NOT NULL,
    counted_qty INTEGER NOT NULL,
    diff INTEGER NOT NULL,
    UNIQUE (opname_id, product_id)
);

-- =========================================================
-- Pembelian
-- =========================================================
CREATE TABLE IF NOT EXISTS purchases (
    id SERIAL PRIMARY KEY,
    code VARCHAR(40) UNIQUE NOT NULL,
    supplier_id INTEGER REFERENCES suppliers(id),
    invoice_no VARCHAR(80),
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ordered', 'partial', 'received', 'cancelled')),
    payment_status VARCHAR(10) NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'paid')),
    total BIGINT NOT NULL DEFAULT 0,
    paid_amount BIGINT NOT NULL DEFAULT 0,
    note TEXT,
    user_id INTEGER REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    received_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS purchase_items (
    id SERIAL PRIMARY KEY,
    purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id),
    unit_id INTEGER REFERENCES product_units(id),
    qty INTEGER NOT NULL CHECK (qty > 0),
    base_qty INTEGER NOT NULL CHECK (base_qty > 0),
    unit_cost BIGINT NOT NULL DEFAULT 0,
    line_total BIGINT NOT NULL DEFAULT 0,
    received_qty INTEGER NOT NULL DEFAULT 0
);

-- =========================================================
-- Member & poin
-- =========================================================
CREATE TABLE IF NOT EXISTS members (
    id SERIAL PRIMARY KEY,
    code VARCHAR(30) UNIQUE NOT NULL,
    name VARCHAR(150) NOT NULL,
    phone VARCHAR(50) UNIQUE,
    email VARCHAR(120),
    points INTEGER NOT NULL DEFAULT 0,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS member_point_logs (
    id SERIAL PRIMARY KEY,
    member_id INTEGER NOT NULL REFERENCES members(id),
    change INTEGER NOT NULL,
    balance_after INTEGER NOT NULL,
    type VARCHAR(10) NOT NULL CHECK (type IN ('earn', 'redeem', 'adjust')),
    ref_type VARCHAR(30),
    ref_id INTEGER,
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =========================================================
-- Shift & penjualan
-- =========================================================
CREATE TABLE IF NOT EXISTS shifts (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    opening_cash BIGINT NOT NULL DEFAULT 0,
    closed_at TIMESTAMPTZ,
    expected_cash BIGINT,
    counted_cash BIGINT,
    difference BIGINT,
    note TEXT
);

CREATE TABLE IF NOT EXISTS sales (
    id SERIAL PRIMARY KEY,
    invoice_no VARCHAR(40) UNIQUE NOT NULL,
    shift_id INTEGER REFERENCES shifts(id),
    cashier_id INTEGER NOT NULL REFERENCES users(id),
    member_id INTEGER REFERENCES members(id),
    subtotal BIGINT NOT NULL DEFAULT 0,
    item_discount BIGINT NOT NULL DEFAULT 0,
    txn_discount BIGINT NOT NULL DEFAULT 0,
    points_value BIGINT NOT NULL DEFAULT 0,
    tax_total BIGINT NOT NULL DEFAULT 0,
    grand_total BIGINT NOT NULL DEFAULT 0,
    points_earned INTEGER NOT NULL DEFAULT 0,
    points_redeemed INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(10) NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'void')),
    void_reason TEXT,
    void_by INTEGER REFERENCES users(id),
    void_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sale_items (
    id SERIAL PRIMARY KEY,
    sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id),
    unit_id INTEGER REFERENCES product_units(id),
    unit_name VARCHAR(20),
    qty INTEGER NOT NULL CHECK (qty > 0),
    base_qty INTEGER NOT NULL CHECK (base_qty > 0),
    unit_price BIGINT NOT NULL,
    discount BIGINT NOT NULL DEFAULT 0,
    cost_price BIGINT NOT NULL DEFAULT 0,
    line_total BIGINT NOT NULL,
    returned_qty INTEGER NOT NULL DEFAULT 0
);

-- Jejak asal harga efektif (nullable). Ditambah lewat ALTER agar DB lama ikut ter-update,
-- karena CREATE TABLE IF NOT EXISTS tidak menambahkan kolom ke tabel yang sudah ada.
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS promo_id INTEGER REFERENCES promotions(id);
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS tier_id INTEGER REFERENCES price_tiers(id);

CREATE TABLE IF NOT EXISTS sale_payments (
    id SERIAL PRIMARY KEY,
    sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    method VARCHAR(10) NOT NULL CHECK (method IN ('cash', 'qris', 'debit', 'transfer')),
    amount BIGINT NOT NULL,
    reference VARCHAR(120),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =========================================================
-- Penjualan kredit grosir (B2B) & piutang
-- =========================================================
-- Penjualan grosir kredit disimpan di `sales` (is_credit=TRUE) agar stok, HPP,
-- laba, dan batch FEFO tetap konsisten lewat jalur sales yang sudah teruji.
-- status tetap 'completed'; siklus hidup piutang dikelola lewat payment_status.
ALTER TABLE sales ADD COLUMN IF NOT EXISTS customer_id INTEGER REFERENCES customers(id);
ALTER TABLE sales ADD COLUMN IF NOT EXISTS is_credit BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS due_date DATE;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS paid_amount BIGINT NOT NULL DEFAULT 0;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS payment_status VARCHAR(10) NOT NULL DEFAULT 'paid';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'sales_payment_status_check'
    ) THEN
        ALTER TABLE sales ADD CONSTRAINT sales_payment_status_check
            CHECK (payment_status IN ('unpaid', 'partial', 'paid'));
    END IF;
END $$;

-- Pembayaran cicilan invoice kredit. TERPISAH dari sale_payments (yang untuk kas
-- shift) agar pembayaran piutang tidak menambah expected_cash shift kasir.
CREATE TABLE IF NOT EXISTS invoice_payments (
    id SERIAL PRIMARY KEY,
    sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    amount BIGINT NOT NULL CHECK (amount > 0),
    method VARCHAR(10) NOT NULL CHECK (method IN ('cash', 'qris', 'debit', 'transfer')),
    reference VARCHAR(100),
    paid_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    user_id INTEGER REFERENCES users(id),
    note TEXT
);

CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales (customer_id);
CREATE INDEX IF NOT EXISTS idx_sales_due_date ON sales (is_credit, due_date);
CREATE INDEX IF NOT EXISTS idx_invoice_payments_sale ON invoice_payments (sale_id);

CREATE TABLE IF NOT EXISTS returns (
    id SERIAL PRIMARY KEY,
    code VARCHAR(40) UNIQUE NOT NULL,
    sale_id INTEGER NOT NULL REFERENCES sales(id),
    shift_id INTEGER REFERENCES shifts(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    total BIGINT NOT NULL DEFAULT 0,
    refund_method VARCHAR(10) NOT NULL DEFAULT 'cash' CHECK (refund_method IN ('cash', 'transfer')),
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS return_items (
    id SERIAL PRIMARY KEY,
    return_id INTEGER NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
    sale_item_id INTEGER NOT NULL REFERENCES sale_items(id),
    product_id INTEGER NOT NULL REFERENCES products(id),
    qty INTEGER NOT NULL CHECK (qty > 0),
    unit_price BIGINT NOT NULL,
    refund_amount BIGINT NOT NULL
);

-- =========================================================
-- P2: Bundling (paket produk)
-- =========================================================
-- Paket dijual dengan harga tetap yang ditetapkan admin. Komponen paket
-- mengurangi stok masing-masing produk saat checkout. Tidak masuk tier/promo
-- item; promo level transaksi tetap berlaku karena dihitung dari subtotal.
CREATE TABLE IF NOT EXISTS bundles (
    id SERIAL PRIMARY KEY,
    sku VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(200) NOT NULL,
    barcode VARCHAR(50) UNIQUE,
    price BIGINT NOT NULL CHECK (price >= 0),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bundle_items (
    id SERIAL PRIMARY KEY,
    bundle_id INTEGER NOT NULL REFERENCES bundles(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id),
    qty INTEGER NOT NULL CHECK (qty > 0),
    UNIQUE (bundle_id, product_id)
);

-- Baris paket disimpan di sale_items dengan bundle_id terisi & product_id NULL.
-- Relaksasi product_id + CHECK: baris harus berupa produk ATAU paket (A2-i).
ALTER TABLE sale_items ALTER COLUMN product_id DROP NOT NULL;
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS bundle_id INTEGER REFERENCES bundles(id);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'sale_items_product_or_bundle'
    ) THEN
        ALTER TABLE sale_items
            ADD CONSTRAINT sale_items_product_or_bundle
            CHECK (product_id IS NOT NULL OR bundle_id IS NOT NULL);
    END IF;
END $$;

-- return_items mengikuti aturan yang sama: baris retur paket menyimpan bundle_id
-- tanpa product_id (refund dicatat satu baris, stok dikembalikan per komponen).
ALTER TABLE return_items ALTER COLUMN product_id DROP NOT NULL;
ALTER TABLE return_items ADD COLUMN IF NOT EXISTS bundle_id INTEGER REFERENCES bundles(id);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'return_items_product_or_bundle'
    ) THEN
        ALTER TABLE return_items
            ADD CONSTRAINT return_items_product_or_bundle
            CHECK (product_id IS NOT NULL OR bundle_id IS NOT NULL);
    END IF;
END $$;

-- =========================================================
-- P2: Konsinyasi (barang titipan)
-- =========================================================
CREATE TABLE IF NOT EXISTS consignors (
    id SERIAL PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    business VARCHAR(20) NOT NULL DEFAULT 'minimarket',
    phone VARCHAR(50),
    address TEXT,
    note TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE consignors ADD COLUMN IF NOT EXISTS business VARCHAR(20) NOT NULL DEFAULT 'minimarket';

ALTER TABLE products ADD COLUMN IF NOT EXISTS is_consignment BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE products ADD COLUMN IF NOT EXISTS consignor_id INTEGER REFERENCES consignors(id);

-- Pembayaran ke penitip. Hutang berjalan = SUM(harga setor barang konsinyasi
-- terjual) - SUM(payouts.amount). Tidak memakai ledger penuh (pola purchase payment).
CREATE TABLE IF NOT EXISTS consignment_payouts (
    id SERIAL PRIMARY KEY,
    consignor_id INTEGER NOT NULL REFERENCES consignors(id),
    business VARCHAR(20) NOT NULL DEFAULT 'minimarket',
    amount BIGINT NOT NULL CHECK (amount > 0),
    period_from DATE,
    period_to DATE,
    note TEXT,
    user_id INTEGER REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE consignment_payouts ADD COLUMN IF NOT EXISTS business VARCHAR(20) NOT NULL DEFAULT 'minimarket';

-- =========================================================
-- P2: Absensi karyawan
-- =========================================================
CREATE TABLE IF NOT EXISTS attendance (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    work_date DATE NOT NULL DEFAULT CURRENT_DATE,
    check_in TIMESTAMPTZ,
    check_out TIMESTAMPTZ,
    shift_id INTEGER REFERENCES shifts(id),
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, work_date)
);

-- =========================================================
-- P3: Pelacakan kadaluarsa per-batch (FEFO)
-- =========================================================
-- Batch stok per produk. Satu penerimaan dapat membuat satu/lebih batch.
-- Batch tanpa expiry_date (NULL) dialokasikan paling akhir (legacy/migrasi).
CREATE TABLE IF NOT EXISTS stock_batches (
    id SERIAL PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    batch_code VARCHAR(60),
    expiry_date DATE,
    qty_received INTEGER NOT NULL CHECK (qty_received >= 0),
    qty_remaining INTEGER NOT NULL,
    unit_cost BIGINT NOT NULL DEFAULT 0,
    source VARCHAR(20) NOT NULL DEFAULT 'purchase'
        CHECK (source IN ('purchase', 'adjustment', 'opname', 'legacy', 'initial', 'shortfall')),
    purchase_item_id INTEGER REFERENCES purchase_items(id),
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    note TEXT
);

-- Jejak alokasi batch per baris penjualan agar retur/void mengembalikan ke batch asal.
CREATE TABLE IF NOT EXISTS sale_item_batches (
    id SERIAL PRIMARY KEY,
    sale_item_id INTEGER NOT NULL REFERENCES sale_items(id) ON DELETE CASCADE,
    batch_id INTEGER NOT NULL REFERENCES stock_batches(id),
    qty INTEGER NOT NULL CHECK (qty > 0),
    cost_price BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ambang peringatan kadaluarsa (hari). Default 180 (~6 bulan).
ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS expiry_warning_days INTEGER NOT NULL DEFAULT 180;

-- Pastikan CHECK source menyertakan 'shortfall' (untuk DB yang dibuat sebelum
-- nilai ini ditambahkan). CREATE TABLE IF NOT EXISTS tidak mengubah tabel lama.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'stock_batches_source_check'
          AND pg_get_constraintdef(oid) NOT LIKE '%shortfall%'
    ) THEN
        ALTER TABLE stock_batches DROP CONSTRAINT stock_batches_source_check;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'stock_batches_source_check'
    ) THEN
        ALTER TABLE stock_batches ADD CONSTRAINT stock_batches_source_check
            CHECK (source IN ('purchase', 'adjustment', 'opname', 'legacy', 'initial', 'shortfall'));
    END IF;
END $$;

-- Backfill batch legacy untuk stok yang sudah ada (idempotent: hanya produk tanpa batch).
-- Hanya stok positif: produk dengan stok negatif (allow_negative_stock) tidak boleh
-- masuk karena qty_received CHECK (>= 0) akan menggagalkan migrasi.
INSERT INTO stock_batches (product_id, qty_received, qty_remaining, unit_cost, source, note)
SELECT p.id, p.stock_qty, p.stock_qty, p.cost_price, 'legacy', 'Migrasi stok lama'
FROM products p
WHERE p.stock_qty > 0
  AND NOT EXISTS (SELECT 1 FROM stock_batches b WHERE b.product_id = p.id);

-- =========================================================
-- P4: Beban operasional (Laba Rugi)
-- =========================================================
-- Pembelian stok TIDAK dicatat di sini: membeli stok mengubah kas -> persediaan
-- (aset), bukan beban. HPP sudah dikurangkan otomatis saat barang terjual.
-- Beban operasional yang benar: gaji, sewa, listrik/air/internet, kemasan, dst.
CREATE TABLE IF NOT EXISTS expense_categories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) UNIQUE NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Kategori beban per usaha. Data lama = minimarket. Keunikan name dibuat per
-- usaha lewat indeks unik (name global UNIQUE lama tetap ada di DB berjalan,
-- jadi kategori baru harus bernama unik lintas usaha kecuali migrasi lanjutan).
ALTER TABLE expense_categories ADD COLUMN IF NOT EXISTS business VARCHAR(20) NOT NULL DEFAULT 'minimarket';
CREATE UNIQUE INDEX IF NOT EXISTS uniq_expense_categories_business_name
    ON expense_categories (business, name);

-- Nomor dokumen EXP-YYYYMMDD-NNNN via nextDocNumber(client, 'EXP').
-- `amount` adalah nilai beban yang diakui (basis akrual); `paid_amount` hanya
-- untuk pelacakan kas. Laba rugi memakai `amount`, bukan `paid_amount`.
CREATE TABLE IF NOT EXISTS expenses (
    id SERIAL PRIMARY KEY,
    code VARCHAR(40) UNIQUE NOT NULL,
    expense_category_id INTEGER REFERENCES expense_categories(id),
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    amount BIGINT NOT NULL CHECK (amount > 0),
    payment_status VARCHAR(10) NOT NULL DEFAULT 'paid'
        CHECK (payment_status IN ('unpaid', 'paid')),
    paid_amount BIGINT NOT NULL DEFAULT 0,
    method VARCHAR(20),
    note TEXT,
    user_id INTEGER REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed kategori beban awal untuk minimarket (idempotent) + satu set untuk fotokopi.
INSERT INTO expense_categories (name) VALUES
    ('Gaji'),
    ('Sewa'),
    ('Listrik & Air'),
    ('Internet & Telepon'),
    ('Kemasan'),
    ('Transport'),
    ('Lain-lain')
ON CONFLICT (name) DO NOTHING;

INSERT INTO expense_categories (name, business) VALUES
    ('Fotokopi - Gaji', 'fotokopi'),
    ('Fotokopi - Sewa', 'fotokopi'),
    ('Fotokopi - Listrik & Air', 'fotokopi'),
    ('Fotokopi - Tinta & Kertas', 'fotokopi'),
    ('Fotokopi - Transport', 'fotokopi'),
    ('Fotokopi - Lain-lain', 'fotokopi')
ON CONFLICT (name) DO NOTHING;

-- =========================================================
-- P6: Multi-usaha & modul fotokopi (jasa cetak)
-- =========================================================
-- Master jasa fotokopi. Harga per halaman ATAU per lembar; paket (bundle)
-- berlaku bila qty mencapai bundle_qty.
CREATE TABLE IF NOT EXISTS print_services (
    id SERIAL PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    business VARCHAR(20) NOT NULL DEFAULT 'fotokopi',
    category VARCHAR(50),
    paper_size VARCHAR(20),
    color_mode VARCHAR(10),
    price_per_page BIGINT NOT NULL DEFAULT 0,
    price_per_sheet BIGINT NOT NULL DEFAULT 0,
    min_qty INTEGER NOT NULL DEFAULT 1,
    bundle_price BIGINT,
    bundle_qty INTEGER,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Master jasa dibagi per usaha (semua jasa lama = fotokopi).
ALTER TABLE print_services ADD COLUMN IF NOT EXISTS business VARCHAR(20) NOT NULL DEFAULT 'fotokopi';

-- Seed master jasa fotokopi (idempotent, pola WHERE NOT EXISTS seperti seed.sql).
-- DB baru dapat otomatis via docker-entrypoint; DB lama tinggal rerun init.sql sekali.
-- Baris seed = data biasa: bisa dihapus/dinonaktifkan via Master Jasa.
INSERT INTO print_services (name, business, category, paper_size, color_mode, price_per_page, price_per_sheet, min_qty, is_active)
SELECT 'Fotokopi A4 Hitam Putih', 'fotokopi', 'fotokopi', 'A4', 'bw', 0, 500, 1, TRUE
WHERE NOT EXISTS (SELECT 1 FROM print_services WHERE name = 'Fotokopi A4 Hitam Putih' AND business = 'fotokopi');

INSERT INTO print_services (name, business, category, paper_size, color_mode, price_per_page, price_per_sheet, min_qty, is_active)
SELECT 'Fotokopi F4 Hitam Putih', 'fotokopi', 'fotokopi', 'F4', 'bw', 0, 600, 1, TRUE
WHERE NOT EXISTS (SELECT 1 FROM print_services WHERE name = 'Fotokopi F4 Hitam Putih' AND business = 'fotokopi');

INSERT INTO print_services (name, business, category, paper_size, color_mode, price_per_page, price_per_sheet, min_qty, is_active)
SELECT 'Print A4 Hitam Putih', 'fotokopi', 'print', 'A4', 'bw', 0, 1000, 1, TRUE
WHERE NOT EXISTS (SELECT 1 FROM print_services WHERE name = 'Print A4 Hitam Putih' AND business = 'fotokopi');

INSERT INTO print_services (name, business, category, paper_size, color_mode, price_per_page, price_per_sheet, min_qty, is_active)
SELECT 'Print A4 Warna', 'fotokopi', 'print', 'A4', 'color', 2500, 0, 1, TRUE
WHERE NOT EXISTS (SELECT 1 FROM print_services WHERE name = 'Print A4 Warna' AND business = 'fotokopi');

INSERT INTO print_services (name, business, category, paper_size, color_mode, price_per_page, price_per_sheet, min_qty, is_active)
SELECT 'Scan Dokumen', 'fotokopi', 'scan', CAST(NULL AS VARCHAR(20)), CAST(NULL AS VARCHAR(10)), 0, 2000, 1, TRUE
WHERE NOT EXISTS (SELECT 1 FROM print_services WHERE name = 'Scan Dokumen' AND business = 'fotokopi');

INSERT INTO print_services (name, business, category, paper_size, color_mode, price_per_page, price_per_sheet, min_qty, is_active)
SELECT 'Laminating A4', 'fotokopi', 'laminating', 'A4', CAST(NULL AS VARCHAR(10)), 0, 10000, 1, TRUE
WHERE NOT EXISTS (SELECT 1 FROM print_services WHERE name = 'Laminating A4' AND business = 'fotokopi');

INSERT INTO print_services (name, business, category, paper_size, color_mode, price_per_page, price_per_sheet, min_qty, is_active)
SELECT 'Jilid Spiral A4', 'fotokopi', 'jilid', 'A4', CAST(NULL AS VARCHAR(10)), 0, 15000, 1, TRUE
WHERE NOT EXISTS (SELECT 1 FROM print_services WHERE name = 'Jilid Spiral A4' AND business = 'fotokopi');

-- Pesanan fotokopi + antrian harian. Total disimpan agar nota & laporan stabil.
CREATE TABLE IF NOT EXISTS print_orders (
    id SERIAL PRIMARY KEY,
    code VARCHAR(40) UNIQUE NOT NULL,
    business VARCHAR(20) NOT NULL DEFAULT 'fotokopi',
    queue_no INTEGER,
    customer_id INTEGER REFERENCES customers(id),
    customer_name VARCHAR(150),
    status VARCHAR(15) NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'processing', 'ready', 'picked_up', 'cancelled')),
    notes TEXT,
    subtotal BIGINT NOT NULL DEFAULT 0,
    discount BIGINT NOT NULL DEFAULT 0,
    tax_total BIGINT NOT NULL DEFAULT 0,
    grand_total BIGINT NOT NULL DEFAULT 0,
    paid_amount BIGINT NOT NULL DEFAULT 0,
    payment_status VARCHAR(10) NOT NULL DEFAULT 'unpaid'
        CHECK (payment_status IN ('unpaid', 'partial', 'paid')),
    sale_id INTEGER REFERENCES sales(id),
    shift_id INTEGER REFERENCES shifts(id),
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS print_order_items (
    id SERIAL PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES print_orders(id) ON DELETE CASCADE,
    service_id INTEGER REFERENCES print_services(id),
    description VARCHAR(200),
    pages INTEGER NOT NULL DEFAULT 1,
    copies INTEGER NOT NULL DEFAULT 1,
    sides VARCHAR(10) NOT NULL DEFAULT 'single' CHECK (sides IN ('single', 'double')),
    paper_size VARCHAR(20),
    color_mode VARCHAR(10),
    unit_price BIGINT NOT NULL DEFAULT 0,
    qty INTEGER NOT NULL DEFAULT 1,
    line_total BIGINT NOT NULL DEFAULT 0
);

-- Baris pesanan bisa berupa jasa (service_id) ATAU produk retail/ATK (product_id).
-- Kolom produk ditambah lewat ALTER agar DB lama (yang sudah punya print_order_items)
-- ikut ter-update; CREATE TABLE IF NOT EXISTS tidak menambah kolom ke tabel eksisting.
-- qty = jumlah dalam satuan jual; base_qty = konversi ke satuan dasar untuk stok.
ALTER TABLE print_order_items ADD COLUMN IF NOT EXISTS product_id INTEGER REFERENCES products(id);
ALTER TABLE print_order_items ADD COLUMN IF NOT EXISTS unit_id INTEGER REFERENCES product_units(id);
ALTER TABLE print_order_items ADD COLUMN IF NOT EXISTS unit_name VARCHAR(20);
ALTER TABLE print_order_items ADD COLUMN IF NOT EXISTS base_qty INTEGER NOT NULL DEFAULT 0;
ALTER TABLE print_order_items ADD COLUMN IF NOT EXISTS cost_price BIGINT NOT NULL DEFAULT 0;
ALTER TABLE print_order_items ADD COLUMN IF NOT EXISTS base_cost_price BIGINT NOT NULL DEFAULT 0;
ALTER TABLE print_order_items ADD COLUMN IF NOT EXISTS discount BIGINT NOT NULL DEFAULT 0;

-- Setiap baris harus punya sumber harga: jasa (service_id) atau produk (product_id).
-- Dibungkus DO $$ ... $$ agar idempotent (ADD CONSTRAINT gagal bila dijalankan ulang).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'print_order_items_kind_check'
    ) THEN
        ALTER TABLE print_order_items
            ADD CONSTRAINT print_order_items_kind_check
            CHECK (service_id IS NOT NULL OR product_id IS NOT NULL);
    END IF;
END $$;

-- Baris penjualan jasa: product_id NULL, service_id terisi (pola sama seperti
-- paket/bundle_id). CHECK lama diganti agar mencakup service_id.
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS service_id INTEGER REFERENCES print_services(id);

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'sale_items_product_or_bundle'
          AND pg_get_constraintdef(oid) NOT LIKE '%service_id%'
    ) THEN
        ALTER TABLE sale_items DROP CONSTRAINT sale_items_product_or_bundle;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'sale_items_product_or_bundle'
    ) THEN
        ALTER TABLE sale_items
            ADD CONSTRAINT sale_items_product_or_bundle
            CHECK (product_id IS NOT NULL OR bundle_id IS NOT NULL OR service_id IS NOT NULL);
    END IF;
END $$;

-- Baris retur jasa: return_items mengikuti pola sale_items. product_id boleh NULL
-- + kolom service_id, agar retur/void penjualan jasa (fotokopi) tidak 500.
ALTER TABLE return_items ALTER COLUMN product_id DROP NOT NULL;
ALTER TABLE return_items ADD COLUMN IF NOT EXISTS service_id INTEGER REFERENCES print_services(id);

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'return_items_product_or_bundle'
          AND pg_get_constraintdef(oid) NOT LIKE '%service_id%'
    ) THEN
        ALTER TABLE return_items DROP CONSTRAINT return_items_product_or_bundle;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'return_items_product_or_bundle'
    ) THEN
        ALTER TABLE return_items
            ADD CONSTRAINT return_items_product_or_bundle
            CHECK (product_id IS NOT NULL OR bundle_id IS NOT NULL OR service_id IS NOT NULL);
    END IF;
END $$;

-- =========================================================
-- Multi-usaha: kolom business pada tabel bersama
-- =========================================================
-- Satu aplikasi, dua usaha (minimarket & fotokopi). Data lama wajib dianggap
-- minimarket, sehingga DEFAULT 'minimarket' + filter dengan default yang sama
-- membuat perilaku lama identik. Tabel dipilih lewat nama agar migrasi tetap
-- idempoten dan singkat.
-- PENTING: blok ini diletakkan SETELAH semua tabel bersama dibuat. Bila
-- dipindah ke atas, ALTER TABLE pada tabel yang belum ada membuat migrasi gagal
-- di DB/volume baru dan kolom `business` tidak pernah terpasang. Penjaga
-- to_regclass dipertahankan agar tetap aman bila urutan berubah.
DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'products', 'categories', 'suppliers', 'customers', 'members',
        'promotions', 'bundles', 'expenses', 'expense_categories',
        'stock_movements', 'stock_opnames', 'purchases', 'shifts', 'sales'
    ] LOOP
        IF to_regclass('public.' || t) IS NOT NULL THEN
            EXECUTE format(
                'ALTER TABLE %I ADD COLUMN IF NOT EXISTS business VARCHAR(20) NOT NULL DEFAULT ''minimarket''',
                t
            );
        END IF;
    END LOOP;
END $$;

-- Kategori unik per usaha (setelah kolom `business` terpasang). Lihat catatan di
-- dekat definisi tabel categories.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_categories_business_name
    ON categories (business, name);

-- =========================================================
-- Indeks
-- =========================================================
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products (barcode);
CREATE INDEX IF NOT EXISTS idx_products_sku ON products (sku);
CREATE INDEX IF NOT EXISTS idx_products_name ON products (name);
CREATE INDEX IF NOT EXISTS idx_products_category ON products (category_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items (sale_id);
CREATE INDEX IF NOT EXISTS idx_sales_created_at ON sales (created_at);
CREATE INDEX IF NOT EXISTS idx_sales_shift ON sales (shift_id);
CREATE INDEX IF NOT EXISTS idx_sales_cashier ON sales (cashier_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_product_created ON stock_movements (product_id, created_at);
CREATE INDEX IF NOT EXISTS idx_stock_movements_ref ON stock_movements (ref_type, ref_id);
CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase ON purchase_items (purchase_id);
CREATE INDEX IF NOT EXISTS idx_member_point_logs_member ON member_point_logs (member_id, created_at);
CREATE INDEX IF NOT EXISTS idx_shifts_user_open ON shifts (user_id, closed_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs (created_at);
CREATE INDEX IF NOT EXISTS idx_product_barcodes_barcode ON product_barcodes (barcode);
CREATE INDEX IF NOT EXISTS idx_product_barcodes_product ON product_barcodes (product_id);
-- Selaras dengan predikat resolveTierPrice: product_id + unit_id + min_qty <= qty, urut harga.
CREATE INDEX IF NOT EXISTS idx_price_tiers_lookup ON price_tiers (product_id, unit_id, min_qty);
-- Selaras dengan findPromotionsForProducts/findActivePromotions.
CREATE INDEX IF NOT EXISTS idx_promotions_active ON promotions (is_active);
CREATE INDEX IF NOT EXISTS idx_promotions_product ON promotions (is_active, product_id, min_qty);
CREATE INDEX IF NOT EXISTS idx_promotions_category ON promotions (is_active, category_id, min_qty);
-- P2: bundling
CREATE INDEX IF NOT EXISTS idx_bundle_items_bundle ON bundle_items (bundle_id);
CREATE INDEX IF NOT EXISTS idx_bundles_barcode ON bundles (barcode);
CREATE INDEX IF NOT EXISTS idx_sale_items_bundle ON sale_items (bundle_id);
-- P2: konsinyasi
CREATE INDEX IF NOT EXISTS idx_products_consignor ON products (consignor_id);
CREATE INDEX IF NOT EXISTS idx_consignment_payouts_consignor ON consignment_payouts (consignor_id, created_at);
-- P2: absensi
CREATE INDEX IF NOT EXISTS idx_attendance_user_date ON attendance (user_id, work_date);
-- P3: batch kadaluarsa (FEFO)
CREATE INDEX IF NOT EXISTS idx_stock_batches_product_fefo
    ON stock_batches (product_id, expiry_date NULLS LAST, received_at);
CREATE INDEX IF NOT EXISTS idx_stock_batches_expiry ON stock_batches (expiry_date);
CREATE INDEX IF NOT EXISTS idx_sale_item_batches_item ON sale_item_batches (sale_item_id);
CREATE INDEX IF NOT EXISTS idx_sale_item_batches_batch ON sale_item_batches (batch_id);
-- P4: beban operasional
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses (date);
CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses (expense_category_id, date);
-- P4: dukungan report laba rugi (retur, pembelian, payout)
CREATE INDEX IF NOT EXISTS idx_returns_created_at ON returns (created_at);
CREATE INDEX IF NOT EXISTS idx_return_items_return ON return_items (return_id);
CREATE INDEX IF NOT EXISTS idx_purchases_date ON purchases (date);
CREATE INDEX IF NOT EXISTS idx_consignment_payouts_created ON consignment_payouts (created_at);
-- Multi-usaha: filter business & antrian fotokopi
CREATE INDEX IF NOT EXISTS idx_sales_business_created ON sales (business, created_at);
CREATE INDEX IF NOT EXISTS idx_shifts_business ON shifts (business);
CREATE INDEX IF NOT EXISTS idx_print_orders_status ON print_orders (status, created_at);
CREATE INDEX IF NOT EXISTS idx_print_orders_queue ON print_orders (queue_no);
CREATE INDEX IF NOT EXISTS idx_print_order_items_order ON print_order_items (order_id);
-- Fase 3 (performa): indeks filter per usaha pada tabel yang dipakai bersama.
CREATE INDEX IF NOT EXISTS idx_products_business_active_name ON products (business, is_active, name);
CREATE INDEX IF NOT EXISTS idx_products_business_category ON products (business, category_id);
CREATE INDEX IF NOT EXISTS idx_categories_business ON categories (business);
CREATE INDEX IF NOT EXISTS idx_suppliers_business ON suppliers (business);
CREATE INDEX IF NOT EXISTS idx_customers_business ON customers (business);
CREATE INDEX IF NOT EXISTS idx_members_business ON members (business);
CREATE INDEX IF NOT EXISTS idx_promotions_business_active ON promotions (business, is_active);
CREATE INDEX IF NOT EXISTS idx_bundles_business_active ON bundles (business, is_active);
CREATE INDEX IF NOT EXISTS idx_expenses_business_date ON expenses (business, date);
CREATE INDEX IF NOT EXISTS idx_expenses_category_business ON expenses (business, expense_category_id, date);
CREATE INDEX IF NOT EXISTS idx_purchases_business_date ON purchases (business, date);
CREATE INDEX IF NOT EXISTS idx_stock_movements_business_created ON stock_movements (business, created_at);
CREATE INDEX IF NOT EXISTS idx_stock_opnames_business ON stock_opnames (business);
-- Antrian fotokopi aktif (skip business tak dipakai karena tabel khusus fotokopi).
CREATE INDEX IF NOT EXISTS idx_print_orders_queue_active
    ON print_orders (business, status, queue_no DESC NULLS LAST, id DESC);

-- =========================================================
-- Hold / resume order (parkir keranjang POS)
-- =========================================================
-- Keranjang ditahan sementara TANPA mengunci stok (prekeden: draft print_orders).
-- Simpan referensi item (id + qty + discount), bukan harga beku: saat resume,
-- cart dihidrasi ulang lalu quote + checkout server menghitung harga efektif.
-- Status 'resumed' dipakai bila resume dipanggil lewat API; checkout biasa
-- setelah hydrate juga menandai hold diambil.
CREATE TABLE IF NOT EXISTS order_holds (
    id SERIAL PRIMARY KEY,
    business VARCHAR(20) NOT NULL DEFAULT 'minimarket',
    hold_code VARCHAR(40) UNIQUE NOT NULL,
    shift_id INTEGER REFERENCES shifts(id),
    cashier_id INTEGER NOT NULL REFERENCES users(id),
    hold_name VARCHAR(100),
    member_id INTEGER REFERENCES members(id),
    txn_discount BIGINT NOT NULL DEFAULT 0,
    redeem_points INTEGER NOT NULL DEFAULT 0,
    items JSONB NOT NULL,
    estimated_total BIGINT NOT NULL DEFAULT 0,
    note TEXT,
    status VARCHAR(10) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'resumed', 'cancelled')),
    resumed_sale_id INTEGER REFERENCES sales(id),
    cancelled_by INTEGER REFERENCES users(id),
    cancelled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_holds_business_status ON order_holds (business, status, created_at);
CREATE INDEX IF NOT EXISTS idx_order_holds_cashier ON order_holds (cashier_id, created_at);

-- =========================================================
-- Cache insight AI laporan bulanan (kenari.id)
-- =========================================================
-- Satu narasi per (usaha, periode); tombol Regenerate memaksa refresh=1.
CREATE TABLE IF NOT EXISTS report_insights (
    id SERIAL PRIMARY KEY,
    business VARCHAR(20) NOT NULL,
    from_date DATE NOT NULL,
    to_date DATE NOT NULL,
    content TEXT NOT NULL,
    model VARCHAR(80),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (business, from_date, to_date)
);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale_product ON sale_items (sale_id, product_id);
