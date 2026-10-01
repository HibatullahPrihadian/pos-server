-- POS Minimarket - data contoh (idempotent)
--
-- CATATAN KEAMANAN: akun admin/kasir TIDAK dibuat di sini. Akun awal dibuat
-- oleh backend saat pertama kali dijalankan (lihat utils/bootstrap.js) memakai
-- ADMIN_PASSWORD / KASIR_PASSWORD dari environment, sehingga tidak ada password
-- default yang ikut ter-commit.

-- =========================================================
-- Pengaturan toko
-- =========================================================
UPDATE store_settings SET
    store_name = 'Minimarket Sumber Rejeki',
    address = 'Jl. Merdeka No. 10, Jakarta',
    phone = '021-1234567',
    receipt_footer = 'Terima kasih telah berbelanja. Barang yang sudah dibeli tidak dapat ditukar.'
WHERE id = 1
  AND store_name = 'Minimarket Saya';

-- =========================================================
-- Kategori
-- =========================================================
INSERT INTO categories (name) VALUES
    ('Makanan'),
    ('Minuman'),
    ('Sembako'),
    ('Perawatan Diri'),
    ('Rumah Tangga')
ON CONFLICT (name) DO NOTHING;

-- =========================================================
-- Supplier
-- =========================================================
INSERT INTO suppliers (name, phone, address, note)
SELECT 'PT Sumber Pangan', '021-5550001', 'Jakarta', 'Supplier makanan & minuman'
WHERE NOT EXISTS (SELECT 1 FROM suppliers WHERE name = 'PT Sumber Pangan');

INSERT INTO suppliers (name, phone, address, note)
SELECT 'CV Sembako Jaya', '021-5550002', 'Bekasi', 'Supplier sembako'
WHERE NOT EXISTS (SELECT 1 FROM suppliers WHERE name = 'CV Sembako Jaya');

-- =========================================================
-- Produk (stock_qty dalam satuan dasar)
-- =========================================================
INSERT INTO products (sku, barcode, name, category_id, supplier_id, base_unit, cost_price, sell_price, member_price, min_stock, stock_qty)
SELECT 'SKU-001', '8991002100011', 'Indomie Goreng', c.id, s.id, 'pcs', 2500, 3500, 3300, 24, 120
FROM categories c, suppliers s
WHERE c.name = 'Makanan' AND s.name = 'PT Sumber Pangan'
  AND NOT EXISTS (SELECT 1 FROM products WHERE sku = 'SKU-001');

INSERT INTO products (sku, barcode, name, category_id, supplier_id, base_unit, cost_price, sell_price, member_price, min_stock, stock_qty)
SELECT 'SKU-002', '8991002100028', 'Aqua 600ml', c.id, s.id, 'pcs', 2000, 3000, NULL, 48, 200
FROM categories c, suppliers s
WHERE c.name = 'Minuman' AND s.name = 'PT Sumber Pangan'
  AND NOT EXISTS (SELECT 1 FROM products WHERE sku = 'SKU-002');

INSERT INTO products (sku, barcode, name, category_id, supplier_id, base_unit, cost_price, sell_price, member_price, min_stock, stock_qty)
SELECT 'SKU-003', '8991002100035', 'Teh Pucuk 350ml', c.id, s.id, 'pcs', 2500, 4000, NULL, 24, 96
FROM categories c, suppliers s
WHERE c.name = 'Minuman' AND s.name = 'PT Sumber Pangan'
  AND NOT EXISTS (SELECT 1 FROM products WHERE sku = 'SKU-003');

INSERT INTO products (sku, barcode, name, category_id, supplier_id, base_unit, cost_price, sell_price, member_price, min_stock, stock_qty)
SELECT 'SKU-004', '8991002100042', 'Beras Premium 5kg', c.id, s.id, 'sak', 62000, 70000, 68000, 5, 20
FROM categories c, suppliers s
WHERE c.name = 'Sembako' AND s.name = 'CV Sembako Jaya'
  AND NOT EXISTS (SELECT 1 FROM products WHERE sku = 'SKU-004');

INSERT INTO products (sku, barcode, name, category_id, supplier_id, base_unit, cost_price, sell_price, member_price, min_stock, stock_qty)
SELECT 'SKU-005', '8991002100059', 'Gula Pasir 1kg', c.id, s.id, 'pcs', 14000, 16000, NULL, 10, 40
FROM categories c, suppliers s
WHERE c.name = 'Sembako' AND s.name = 'CV Sembako Jaya'
  AND NOT EXISTS (SELECT 1 FROM products WHERE sku = 'SKU-005');

INSERT INTO products (sku, barcode, name, category_id, supplier_id, base_unit, cost_price, sell_price, member_price, min_stock, stock_qty)
SELECT 'SKU-006', '8991002100066', 'Minyak Goreng 2L', c.id, s.id, 'pouch', 32000, 36000, NULL, 8, 30
FROM categories c, suppliers s
WHERE c.name = 'Sembako' AND s.name = 'CV Sembako Jaya'
  AND NOT EXISTS (SELECT 1 FROM products WHERE sku = 'SKU-006');

INSERT INTO products (sku, barcode, name, category_id, supplier_id, base_unit, cost_price, sell_price, member_price, min_stock, stock_qty)
SELECT 'SKU-007', '8991002100073', 'Sabun Lifebuoy 85g', c.id, s.id, 'pcs', 3500, 5000, NULL, 12, 48
FROM categories c, suppliers s
WHERE c.name = 'Perawatan Diri' AND s.name = 'PT Sumber Pangan'
  AND NOT EXISTS (SELECT 1 FROM products WHERE sku = 'SKU-007');

INSERT INTO products (sku, barcode, name, category_id, supplier_id, base_unit, cost_price, sell_price, member_price, min_stock, stock_qty)
SELECT 'SKU-008', '8991002100080', 'Shampo Sachet', c.id, s.id, 'pcs', 800, 1500, NULL, 40, 150
FROM categories c, suppliers s
WHERE c.name = 'Perawatan Diri' AND s.name = 'PT Sumber Pangan'
  AND NOT EXISTS (SELECT 1 FROM products WHERE sku = 'SKU-008');

INSERT INTO products (sku, barcode, name, category_id, supplier_id, base_unit, cost_price, sell_price, member_price, min_stock, stock_qty)
SELECT 'SKU-009', '8991002100097', 'Sunlight 400ml', c.id, s.id, 'pcs', 9000, 12000, NULL, 10, 36
FROM categories c, suppliers s
WHERE c.name = 'Rumah Tangga' AND s.name = 'PT Sumber Pangan'
  AND NOT EXISTS (SELECT 1 FROM products WHERE sku = 'SKU-009');

INSERT INTO products (sku, barcode, name, category_id, supplier_id, base_unit, cost_price, sell_price, member_price, min_stock, stock_qty)
SELECT 'SKU-010', '8991002100103', 'Kopi Kapal Api Sachet', c.id, s.id, 'pcs', 1200, 2000, NULL, 50, 200
FROM categories c, suppliers s
WHERE c.name = 'Minuman' AND s.name = 'PT Sumber Pangan'
  AND NOT EXISTS (SELECT 1 FROM products WHERE sku = 'SKU-010');

-- =========================================================
-- Satuan tambahan (multi-satuan)
-- =========================================================
INSERT INTO product_units (product_id, unit_name, conversion_factor, sell_price, member_price, barcode)
SELECT p.id, 'dus', 40, 132000, 128000, '8991002100011-DUS'
FROM products p
WHERE p.sku = 'SKU-001'
  AND NOT EXISTS (SELECT 1 FROM product_units pu WHERE pu.product_id = p.id AND pu.unit_name = 'dus');

INSERT INTO product_units (product_id, unit_name, conversion_factor, sell_price, member_price, barcode)
SELECT p.id, 'dus', 24, 68000, NULL, '8991002100028-DUS'
FROM products p
WHERE p.sku = 'SKU-002'
  AND NOT EXISTS (SELECT 1 FROM product_units pu WHERE pu.product_id = p.id AND pu.unit_name = 'dus');

INSERT INTO product_units (product_id, unit_name, conversion_factor, sell_price, member_price, barcode)
SELECT p.id, 'karton', 10, 690000, 675000, '8991002100042-KRT'
FROM products p
WHERE p.sku = 'SKU-004'
  AND NOT EXISTS (SELECT 1 FROM product_units pu WHERE pu.product_id = p.id AND pu.unit_name = 'karton');

-- =========================================================
-- Stok awal (kartu stok) - satu baris 'initial' per produk seed
-- =========================================================
INSERT INTO stock_movements (product_id, qty_change, balance_after, type, ref_type, ref_id, unit_cost, note)
SELECT p.id, p.stock_qty, p.stock_qty, 'initial', 'seed', NULL, p.cost_price, 'Stok awal seed'
FROM products p
WHERE p.sku IN ('SKU-001', 'SKU-002', 'SKU-003', 'SKU-004', 'SKU-005',
                'SKU-006', 'SKU-007', 'SKU-008', 'SKU-009', 'SKU-010')
  AND p.stock_qty > 0
  AND NOT EXISTS (
    SELECT 1 FROM stock_movements sm WHERE sm.product_id = p.id AND sm.ref_type = 'seed'
  );

-- =========================================================
-- Member
-- =========================================================
INSERT INTO members (code, name, phone, email, points)
SELECT 'MBR-0001', 'Budi Santoso', '081234567890', 'budi@example.com', 25
WHERE NOT EXISTS (SELECT 1 FROM members WHERE code = 'MBR-0001');

INSERT INTO members (code, name, phone, email, points)
SELECT 'MBR-0002', 'Siti Aminah', '081298765432', NULL, 0
WHERE NOT EXISTS (SELECT 1 FROM members WHERE code = 'MBR-0002');
