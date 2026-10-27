import { formatCurrency, formatDateTime } from './formatters';
import { PAYMENT_LABELS } from './labels';
import { PAYMENT_STATUS_LABELS, PRINT_STATUS_LABELS } from '../components/print/PrintReceipt';

const clean = (value) => String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim();
const toPrinterText = (value) => {
  const text = clean(value);
  try {
    return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]/g, '?');
  } catch {
    return text.replace(/[^\x20-\x7e]/g, '?');
  }
};

export function buildReceiptData(sale, settings, change = 0) {
  if (!sale) throw new Error('Data transaksi tidak tersedia.');
  const store = settings || {};
  const lines = [];
  const center = (text) => lines.push({ text: toPrinterText(text), align: 'center', bold: true });
  const row = (label, value, options = {}) => lines.push({
    label: toPrinterText(label),
    value: toPrinterText(value),
    bold: Boolean(options.bold),
  });
  const separator = () => lines.push({ separator: true });

  center(store.store_name || 'Minimarket');
  if (store.address) center(store.address);
  if (store.phone) center(`Telp: ${store.phone}`);
  if (store.npwp) center(`NPWP: ${store.npwp}`);
  separator();
  center('STRUK PEMBELIAN');
  separator();
  row('No', sale.invoice_no || sale.code || '-');
  row('Tanggal', formatDateTime(sale.created_at));
  if (sale.cashier_name) row('Kasir', sale.cashier_name);
  if (sale.member_name) row('Member', sale.member_name);
  separator();

  (sale.items || []).forEach((item) => {
    lines.push({ text: toPrinterText(`${item.display_name || item.product_name || item.bundle_name || '-'}${item.bundle_id ? ' (PAKET)' : ''}`) });
    row(`${item.qty} ${item.unit_name || ''} x ${formatCurrency(item.unit_price)}`, formatCurrency(item.line_total));
    if (Number(item.discount) > 0) row('Diskon', `-${formatCurrency(item.discount)}`);
  });
  separator();
  row('Subtotal', formatCurrency(sale.subtotal));
  if (Number(sale.item_discount) > 0) row('Diskon Item', `-${formatCurrency(sale.item_discount)}`);
  if (Number(sale.txn_discount) > 0) row('Diskon Transaksi', `-${formatCurrency(sale.txn_discount)}`);
  if (Number(sale.points_value) > 0) row(`Tukar Poin (${sale.points_redeemed})`, `-${formatCurrency(sale.points_value)}`);
  if (Number(sale.tax_total) > 0) row(`PPN ${store.tax_included !== false ? '(incl.)' : '(excl.)'}`, formatCurrency(sale.tax_total));
  separator();
  row('TOTAL', formatCurrency(sale.grand_total), { bold: true });
  separator();
  (sale.payments || []).forEach((payment) => row(
    PAYMENT_LABELS[payment.method] || payment.method,
    formatCurrency(payment.amount),
  ));
  if (change > 0) row('Kembali', formatCurrency(change), { bold: true });
  if (Number(sale.points_earned) > 0) row('Poin didapat', sale.points_earned);
  if (Number(sale.points_redeemed) > 0) row('Poin ditukar', sale.points_redeemed);
  separator();
  center(store.receipt_footer || 'Terima kasih telah berbelanja');

  return { width: 32, lines };
}

export function buildOrderReceiptData(order, settings) {
  if (!order) throw new Error('Data pesanan tidak tersedia.');
  const store = settings || {};
  const lines = [];
  const center = (text) => lines.push({ text: toPrinterText(text), align: 'center', bold: true });
  const row = (label, value, options = {}) => lines.push({
    label: toPrinterText(label),
    value: toPrinterText(value),
    bold: Boolean(options.bold),
  });
  const separator = () => lines.push({ separator: true });

  center(store.store_name || 'Fotokopi');
  if (store.address) center(store.address);
  if (store.phone) center(`Telp: ${store.phone}`);
  separator();
  center('NOTA PESANAN FOTOKOPI');
  separator();
  row('No', order.code || '-');
  row('Antrian', `#${order.queue_no ?? '-'}`);
  row('Tanggal', formatDateTime(order.created_at));
  row('Pelanggan', order.customer_name || '-');
  row('Status', PRINT_STATUS_LABELS[order.status] || order.status || '-');
  separator();

  (order.items || []).forEach((item) => {
    const name = item.description || item.display_name || item.service_name || item.product_name || 'Item';
    lines.push({ text: toPrinterText(name) });
    if (item.product_id) {
      lines.push({ text: toPrinterText(`Produk${item.unit_name ? ` · ${item.unit_name}` : ''}`) });
    } else {
      const detail = `${item.pages ?? 0} hal x ${item.copies ?? 0} rangkap${item.sides === 'double' ? ' (bolak-balik)' : ''}${item.paper_size ? ` · ${item.paper_size}` : ''}`;
      lines.push({ text: toPrinterText(detail) });
    }
    const unit = item.product_id ? (item.unit_name || 'pcs') : 'lembar';
    row(`${item.qty} ${unit} x ${formatCurrency(item.unit_price)}`, formatCurrency(item.line_total));
  });
  separator();
  row('Subtotal', formatCurrency(order.subtotal));
  if (Number(order.discount) > 0) row('Diskon', `-${formatCurrency(order.discount)}`);
  if (Number(order.tax_total) > 0) row('PPN', formatCurrency(order.tax_total));
  row('TOTAL', formatCurrency(order.grand_total), { bold: true });
  separator();
  row('Bayar', PAYMENT_STATUS_LABELS[order.payment_status] || order.payment_status || '-');
  if (Number(order.paid_amount) > 0) row('Dibayar', formatCurrency(order.paid_amount));
  if (order.invoice_no) row('Invoice', order.invoice_no);
  separator();
  center(store.receipt_footer || 'Terima kasih');

  return { width: 32, lines };
}

export function encodeEscPos(receipt) {
  const encoder = new TextEncoder();
  const chunks = [Uint8Array.from([0x1b, 0x40])];
  const push = (...bytes) => chunks.push(Uint8Array.from(bytes));
  const text = (value) => chunks.push(encoder.encode(`${value}\n`));

  receipt.lines.forEach((line) => {
    if (line.separator) {
      text('-'.repeat(receipt.width));
      return;
    }
    if (line.align === 'center') push(0x1b, 0x61, 0x01);
    else push(0x1b, 0x61, 0x00);
    push(0x1b, 0x45, line.bold ? 0x01 : 0x00);
    if (line.label !== undefined) {
      const label = line.label.slice(0, receipt.width);
      const value = line.value;
      const available = Math.max(1, receipt.width - label.length - value.length);
      const combined = `${label}${' '.repeat(available)}${value}`;
      text(combined.length > receipt.width ? `${label} ${value}` : combined);
    } else {
      text(line.text);
    }
  });
  push(0x1b, 0x61, 0x00, 0x1b, 0x64, 0x03);
  return new Blob(chunks, { type: 'application/octet-stream' });
}
