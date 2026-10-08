import { formatCurrency, formatDateTime } from '../../utils/formatters';

export const PRINT_STATUS_LABELS = {
  queued: 'Antre',
  processing: 'Diproses',
  ready: 'Siap Diambil',
  picked_up: 'Sudah Diambil',
  cancelled: 'Dibatalkan',
};

export const PAYMENT_STATUS_LABELS = {
  unpaid: 'Belum Bayar',
  partial: 'Bayar Sebagian',
  paid: 'Lunas',
};

// Nota pesanan fotokopi (layout struk termal, pola sama dengan Receipt POS).
// ID sengaja sama dengan Receipt POS karena keduanya tak pernah mount bersamaan
// (halaman POS vs halaman fotokopi); printReceipt memakai elemen pertama.
const PrintReceipt = ({ order, settings }) => {
  if (!order) return null;
  const store = settings || {};
  const items = order.items || [];

  return (
    <div id="receipt-print-area">
      <div className="receipt-paper">
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontWeight: 'bold', fontSize: '12px' }}>
            {store.store_name || 'Fotokopi'}
          </div>
          {store.address && <div>{store.address}</div>}
          {store.phone && <div>Telp: {store.phone}</div>}
        </div>

        <div className="receipt-sep" />

        <div style={{ textAlign: 'center', fontWeight: 'bold' }}>NOTA PESANAN FOTOKOPI</div>

        <div className="receipt-sep" />

        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>No</span>
          <span>{order.code}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Antrian</span>
          <span>#{order.queue_no}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Tanggal</span>
          <span>{formatDateTime(order.created_at)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Pelanggan</span>
          <span>{order.customer_name || '-'}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Status</span>
          <span>{PRINT_STATUS_LABELS[order.status] || order.status}</span>
        </div>

        <div className="receipt-sep" />

        {items.map((item) => (
          <div key={item.id} style={{ marginBottom: '3px' }}>
            <div>{item.description || item.display_name || item.service_name || item.product_name || 'Item'}</div>
            {item.product_id ? (
              <div>
                Produk{item.unit_name ? ` · ${item.unit_name}` : ''}
              </div>
            ) : (
              <div>
                {item.pages} hal × {item.copies} rangkap
                {item.sides === 'double' ? ' (bolak-balik)' : ''}
                {item.paper_size ? ` · ${item.paper_size}` : ''}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>
                {item.qty} {item.product_id ? (item.unit_name || 'pcs') : 'lembar'}
                {' × '}{formatCurrency(item.unit_price)}
              </span>
              <span>{formatCurrency(item.line_total)}</span>
            </div>
          </div>
        ))}

        <div className="receipt-sep" />

        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Subtotal</span>
          <span>{formatCurrency(order.subtotal)}</span>
        </div>
        {Number(order.discount) > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Diskon</span>
            <span>-{formatCurrency(order.discount)}</span>
          </div>
        )}
        {Number(order.tax_total) > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>PPN</span>
            <span>{formatCurrency(order.tax_total)}</span>
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', fontSize: '12px' }}>
          <span>TOTAL</span>
          <span>{formatCurrency(order.grand_total)}</span>
        </div>

        <div className="receipt-sep" />

        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Bayar</span>
          <span>{PAYMENT_STATUS_LABELS[order.payment_status] || order.payment_status}</span>
        </div>
        {Number(order.paid_amount) > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Dibayar</span>
            <span>{formatCurrency(order.paid_amount)}</span>
          </div>
        )}
        {order.invoice_no && (
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Invoice</span>
            <span>{order.invoice_no}</span>
          </div>
        )}

        <div className="receipt-sep" />

        <div style={{ textAlign: 'center', whiteSpace: 'pre-line' }}>
          {store.receipt_footer || 'Terima kasih'}
        </div>
      </div>
    </div>
  );
};

export default PrintReceipt;
