import { ShoppingBag, Phone, MapPin, Receipt } from 'lucide-react';
import { formatCurrency, formatDate, formatDateTime, angkaTerbilang } from '../../utils/formatters';
import { PAYMENT_LABELS } from '../../utils/labels';

// Invoice A4 untuk penjualan grosir kredit. `invoice` diharapkan membawa
// items[], payments[], customer_* dan ringkasan total dari GET /api/invoices/:id.
// `print` = true -> elemen ber-id `invoice-print-area` (hanya tampil saat print).
// `print` = false -> lembar pratinjau layar (tanpa id agar tidak dobel saat print).
const STATUS_LABELS = {
  paid: 'LUNAS',
  partial: 'BAYAR SEBAGIAN',
  unpaid: 'BELUM BAYAR',
};

const STATUS_CLASS = {
  paid: 'invoice-badge invoice-badge-paid',
  partial: 'invoice-badge invoice-badge-partial',
  unpaid: 'invoice-badge invoice-badge-unpaid',
};

const InvoicePrint = ({ invoice, settings, print = false }) => {
  if (!invoice) return null;

  const store = settings || {};
  const items = invoice.items || [];
  const payments = invoice.payments || [];
  const outstanding = Number(invoice.outstanding ?? (Number(invoice.grand_total) - Number(invoice.paid_amount)));
  const status = STATUS_LABELS[invoice.payment_status] ? invoice.payment_status : 'unpaid';

  return (
    <div
      id={print ? 'invoice-print-area' : undefined}
      className={`invoice-sheet${print ? ' invoice-sheet-print' : ''}`}
    >
      <div className="invoice-accent-bar">
        <span className="invoice-accent-1" />
        <span className="invoice-accent-2" />
        <span className="invoice-accent-3" />
      </div>

      <div className="invoice-head">
        <div className="invoice-store">
          <div className="invoice-brand">
            <div className="invoice-brand-logo">
              <ShoppingBag size={22} />
            </div>
            <div>
              <div className="invoice-store-name">{store.store_name || 'Minimarket'}</div>
              <div className="invoice-store-tagline">Invoice Grosir &amp; Piutang</div>
            </div>
          </div>
          <div className="invoice-store-meta">
            {store.address && (
              <div className="invoice-store-line"><MapPin size={12} /> <span>{store.address}</span></div>
            )}
            {store.phone && (
              <div className="invoice-store-line"><Phone size={12} /> <span>Telp: {store.phone}</span></div>
            )}
            {store.npwp && (
              <div className="invoice-store-line"><Receipt size={12} /> <span>NPWP: {store.npwp}</span></div>
            )}
          </div>
        </div>

        <div className="invoice-title">
          <div className="invoice-title-badge">INVOICE</div>
          <div className="invoice-no">{invoice.invoice_no}</div>
          <div className="invoice-muted invoice-date">Terbit: {formatDateTime(invoice.created_at)}</div>
          <div className="invoice-muted invoice-date">
            Jatuh Tempo: {invoice.due_date ? formatDate(invoice.due_date) : '-'}
          </div>
          <div className={STATUS_CLASS[status]}>{STATUS_LABELS[status]}</div>
          {invoice.is_overdue && <div className="invoice-overdue">LEWAT JATUH TEMPO</div>}
        </div>
      </div>

      <div className="invoice-parties">
        <div>
          <div className="invoice-label">Ditujukan Kepada</div>
          <div className="invoice-strong">{invoice.customer_name || 'Pelanggan Umum'}</div>
          {invoice.customer_code && <div className="invoice-muted">Kode: {invoice.customer_code}</div>}
          {invoice.customer_address && <div className="invoice-muted">{invoice.customer_address}</div>}
          {invoice.customer_phone && <div className="invoice-muted">Telp: {invoice.customer_phone}</div>}
          {invoice.customer_npwp && <div className="invoice-muted">NPWP: {invoice.customer_npwp}</div>}
        </div>
        <div className="invoice-parties-right">
          <div className="invoice-label">Kasir</div>
          <div className="invoice-strong">{invoice.cashier_name || '-'}</div>
          {payments.length > 0 && (
            <div className="invoice-muted">{payments.length} pembayaran tercatat</div>
          )}
        </div>
      </div>

      <table className="invoice-table">
        <thead>
          <tr>
            <th className="invoice-col-no">#</th>
            <th>Deskripsi</th>
            <th className="invoice-num">Qty</th>
            <th className="invoice-num">Harga</th>
            <th className="invoice-num">Diskon</th>
            <th className="invoice-num">Jumlah</th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            <tr>
              <td colSpan={6} className="invoice-empty">Tidak ada item</td>
            </tr>
          ) : (
            items.map((item, index) => (
              <tr key={item.id}>
                <td>{index + 1}</td>
                <td>
                  <div className="invoice-item-name">
                    {item.display_name || item.product_name || item.bundle_name || '-'}
                    {item.bundle_id ? <span className="invoice-tag">PAKET</span> : null}
                  </div>
                  {item.sku && <div className="invoice-muted">{item.sku}</div>}
                </td>
                <td className="invoice-num">{item.qty} {item.unit_name || ''}</td>
                <td className="invoice-num">{formatCurrency(item.unit_price)}</td>
                <td className="invoice-num">{Number(item.discount) > 0 ? `-${formatCurrency(item.discount)}` : '-'}</td>
                <td className="invoice-num invoice-strong">{formatCurrency(item.line_total)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <div className="invoice-recap">
        <div className="invoice-recap-left">
          <div className="invoice-terbilang">
            <span className="invoice-label">Terbilang</span>
            <div className="invoice-terbilang-text">{angkaTerbilang(invoice.grand_total)}</div>
          </div>
          {store.receipt_footer && (
            <div className="invoice-note">
              <span className="invoice-label">Catatan</span>
              <div>{store.receipt_footer}</div>
            </div>
          )}
        </div>

        <div className="invoice-totals">
          <div className="invoice-total-row"><span>Subtotal</span><span>{formatCurrency(invoice.subtotal)}</span></div>
          {Number(invoice.item_discount) > 0 && (
            <div className="invoice-total-row"><span>Diskon Item</span><span>-{formatCurrency(invoice.item_discount)}</span></div>
          )}
          {Number(invoice.txn_discount) > 0 && (
            <div className="invoice-total-row"><span>Diskon Transaksi</span><span>-{formatCurrency(invoice.txn_discount)}</span></div>
          )}
          {Number(invoice.points_value) > 0 && (
            <div className="invoice-total-row"><span>Tukar Poin</span><span>-{formatCurrency(invoice.points_value)}</span></div>
          )}
          {Number(invoice.tax_total) > 0 && (
            <div className="invoice-total-row"><span>PPN (incl.)</span><span>{formatCurrency(invoice.tax_total)}</span></div>
          )}
          <div className="invoice-total-row invoice-grand"><span>TOTAL</span><span>{formatCurrency(invoice.grand_total)}</span></div>
          {Number(invoice.paid_amount) > 0 && (
            <div className="invoice-total-row invoice-paid"><span>Dibayar</span><span>{formatCurrency(invoice.paid_amount)}</span></div>
          )}
          <div className="invoice-total-row invoice-outstanding"><span>Sisa Tagihan</span><span>{formatCurrency(outstanding)}</span></div>
        </div>
      </div>

      {payments.length > 0 && (
        <div className="invoice-payments">
          <div className="invoice-label">Riwayat Pembayaran</div>
          <table className="invoice-payment-table">
            <tbody>
              {payments.map((p) => (
                <tr key={p.id}>
                  <td>{formatDateTime(p.paid_at)}</td>
                  <td>{PAYMENT_LABELS[p.method] || p.method}</td>
                  <td className="invoice-muted">{p.user_name || '-'}</td>
                  <td className="invoice-num">{formatCurrency(p.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="invoice-sign">
        <div className="invoice-sign-col">
          <div className="invoice-muted">Penerima,</div>
          <div className="invoice-sign-space" />
          <div className="invoice-sign-line">(............................)</div>
        </div>
        <div className="invoice-sign-col">
          <div className="invoice-muted">Hormat kami, {store.store_name || 'Minimarket'}</div>
          <div className="invoice-sign-space" />
          <div className="invoice-sign-line">(............................)</div>
        </div>
      </div>

      <div className="invoice-footer">
        {store.receipt_footer || 'Terima kasih atas kepercayaan Anda'}
      </div>
    </div>
  );
};

export default InvoicePrint;
