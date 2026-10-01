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
    role VARCHAR(10) NOT NULL DEFAULT 'kasir' CHECK (role IN ('admin', 'kasir')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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
    name VARCHAR(100) UNIQUE NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS suppliers (
    id SERIAL PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    phone VARCHAR(50),
    address TEXT,
    note TEXT,
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
