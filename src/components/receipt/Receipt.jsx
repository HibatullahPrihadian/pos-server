import { formatCurrency, formatDateTime } from '../../utils/formatters';
import { PAYMENT_LABELS } from '../../utils/labels';

// Layout struk untuk printer thermal 58/80mm. `sale` diharapkan membawa
// items[], payments[], cashier_name, dan (opsional) change.
const Receipt = ({ sale, settings, change = 0, title = 'STRUK PEMBELIAN', paperWidth = '80' }) => {
  if (!sale) return null;

  const store = settings || {};
  const items = sale.items || [];
  const payments = sale.payments || [];

  return (
    <div id="receipt-print-area">
      <div className={`receipt-paper ${paperWidth === '58' ? 'receipt-58' : ''}`}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontWeight: 'bold', fontSize: '12px' }}>{store.store_name || 'Minimarket'}</div>
          {store.address && <div>{store.address}</div>}
          {store.phone && <div>Telp: {store.phone}</div>}
          {store.npwp && <div>NPWP: {store.npwp}</div>}
        </div>

        <div className="receipt-sep" />

        <div style={{ textAlign: 'center', fontWeight: 'bold' }}>{title}</div>

        <div className="receipt-sep" />

        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>No</span>
          <span>{sale.invoice_no || sale.code}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Tanggal</span>
          <span>{formatDateTime(sale.created_at)}</span>
        </div>
        {sale.cashier_name && (
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Kasir</span>
            <span>{sale.cashier_name}</span>
          </div>
        )}
        {sale.member_name && (
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Member</span>
            <span>{sale.member_name}</span>
          </div>
        )}

        <div className="receipt-sep" />

        {items.map((item) => (
          <div key={item.id} style={{ marginBottom: '3px' }}>
            <div>
              {item.display_name || item.product_name || item.bundle_name || '-'}
              {item.bundle_id ? ' (PAKET)' : ''}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>
                {item.qty} {item.unit_name || ''} x {formatCurrency(item.unit_price)}
              </span>
              <span>{formatCurrency(item.line_total)}</span>
            </div>
            {Number(item.discount) > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>  Diskon</span>
                <span>-{formatCurrency(item.discount)}</span>
              </div>
            )}
          </div>
        ))}

        <div className="receipt-sep" />

        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Subtotal</span>
          <span>{formatCurrency(sale.subtotal)}</span>
        </div>
        {Number(sale.item_discount) > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Diskon Item</span>
            <span>-{formatCurrency(sale.item_discount)}</span>
          </div>
        )}
        {Number(sale.txn_discount) > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Diskon Transaksi</span>
            <span>-{formatCurrency(sale.txn_discount)}</span>
          </div>
        )}
        {Number(sale.points_value) > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Tukar Poin ({sale.points_redeemed})</span>
            <span>-{formatCurrency(sale.points_value)}</span>
          </div>
        )}
        {Number(sale.tax_total) > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>PPN (incl.)</span>
            <span>{formatCurrency(sale.tax_total)}</span>
          </div>
        )}

        <div className="receipt-sep" />

        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', fontSize: '12px' }}>
          <span>TOTAL</span>
          <span>{formatCurrency(sale.grand_total)}</span>
        </div>

        <div className="receipt-sep" />

        {payments.map((payment) => (
          <div key={payment.id} style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>{PAYMENT_LABELS[payment.method] || payment.method}</span>
            <span>{formatCurrency(payment.amount)}</span>
          </div>
        ))}
        {change > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold' }}>
            <span>Kembali</span>
            <span>{formatCurrency(change)}</span>
          </div>
        )}

        {(Number(sale.points_earned) > 0 || Number(sale.points_redeemed) > 0) && (
          <>
            <div className="receipt-sep" />
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Poin didapat</span>
              <span>{sale.points_earned || 0}</span>
            </div>
            {Number(sale.points_redeemed) > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Poin ditukar</span>
                <span>{sale.points_redeemed}</span>
              </div>
            )}
          </>
        )}

        <div className="receipt-sep" />

        <div style={{ textAlign: 'center', whiteSpace: 'pre-line' }}>
          {store.receipt_footer || 'Terima kasih telah berbelanja'}
        </div>
      </div>
    </div>
  );
};

export default Receipt;
