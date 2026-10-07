import { BarChart3, MapPin, Phone, Receipt, Sparkles } from 'lucide-react';
import {
  formatCurrency, formatDate, formatDateTime, angkaTerbilang,
} from '../../utils/formatters';
import { PAYMENT_LABELS } from '../../utils/labels';

// Lembar A4 laporan bulanan (gaya Invoice Grosir): pratinjau layar + salinan
// portal ber-id `report-print-area` untuk window.print() -> "Save as PDF".
// `business`: 'minimarket' | 'fotokopi' (menentukan section laporan).
// `insight`: { content, cached, reason } | null (null = sedang dimuat).
const MonthlyReportPrint = ({ business, report, settings, insight, print = false, onRegenerate }) => {
  if (!report) return null;

  const store = settings || {};
  const isPrint = business === 'fotokopi';
  const businessLabel = isPrint ? 'Fotokopi' : 'Minimarket';

  const daily = [...(report.daily || [])].sort((a, b) => (a.date < b.date ? -1 : 1));
  const dailyDiscount = daily.reduce(
    (sum, r) => sum + (isPrint ? Number(r.discount || 0) : Number(r.item_discount || 0) + Number(r.txn_discount || 0) + Number(r.points_value || 0)),
    0
  );
  const sumField = (field) => daily.reduce((sum, r) => sum + Number(r[field] || 0), 0);

  const insightParagraphs = insight?.content
    ? String(insight.content).split(/\n+/).map((s) => s.trim()).filter(Boolean)
    : [];
  const insightLoading = !insight;

  const totals = report.totals || {};
  const grandTotal = Number(totals.grand_total || 0);

  return (
    <div
      id={print ? 'report-print-area' : undefined}
      className={`report-sheet${print ? ' report-sheet-print' : ''}`}
    >
      <div className="report-accent-bar">
        <span className="invoice-accent-1" />
        <span className="invoice-accent-2" />
        <span className="invoice-accent-3" />
      </div>

      <div className="report-head">
        <div>
          <div className="report-brand">
            <div className="report-brand-logo"><BarChart3 size={22} /></div>
            <div>
              <div className="report-store-name">{store.store_name || businessLabel}</div>
              <div className="report-store-tagline">Laporan Penjualan {businessLabel}</div>
            </div>
          </div>
          <div className="report-store-meta">
            {store.address && (
              <div className="report-store-line"><MapPin size={12} /> <span>{store.address}</span></div>
            )}
            {store.phone && (
              <div className="report-store-line"><Phone size={12} /> <span>Telp: {store.phone}</span></div>
            )}
            {store.npwp && (
              <div className="report-store-line"><Receipt size={12} /> <span>NPWP: {store.npwp}</span></div>
            )}
          </div>
        </div>

        <div className="report-title">
          <div className="report-title-badge">LAPORAN BULANAN</div>
          <div className="report-period">{formatDate(report.from)} – {formatDate(report.to)}</div>
          <div className="report-muted">Usaha: {businessLabel}</div>
          <div className="report-muted">Dicetak: {formatDateTime(report.generated_at)}</div>
        </div>
      </div>

      <div className="report-kpi-strip">
        {(report.kpis || []).map((kpi) => (
          <div key={kpi.label} className="report-kpi">
            <div className="report-kpi-label">{kpi.label}</div>
            <div className={`report-kpi-value${kpi.tone ? ` report-${kpi.tone}` : ''}`}>{kpi.value}</div>
          </div>
        ))}
      </div>

      <div className="report-insight">
        <div className="report-insight-head">
          <span className="report-insight-title"><Sparkles size={12} /> Insight AI</span>
          <span className="flex items-center gap-2">
            {insight?.cached && <span className="report-insight-chip">cache</span>}
            {!print && onRegenerate && (
              <button
                type="button"
                onClick={onRegenerate}
                className="text-xs font-semibold text-blue-700 hover:underline"
              >
                Regenerate
              </button>
            )}
          </span>
        </div>
        {insightLoading ? (
          <div className="report-insight-loading">
            Menyiapkan insight AI (bisa memakan waktu hingga 1 menit)...
          </div>
        ) : insightParagraphs.length > 0 ? (
          <div className="report-insight-body">
            {insightParagraphs.map((line) => <p key={line}>{line}</p>)}
          </div>
        ) : (
          <div className="report-insight-note">Insight AI tidak tersedia saat ini.</div>
        )}
      </div>

      <div className="report-section">
        <div className="report-section-title">Penjualan Harian</div>
        <table className="report-table">
          <thead>
            <tr>
              <th>Tanggal</th>
              <th className="report-num">{isPrint ? 'Pesanan' : 'Transaksi'}</th>
              <th className="report-num">Subtotal</th>
              <th className="report-num">Diskon</th>
              <th className="report-num">PPN</th>
              <th className="report-num">Total</th>
              {!isPrint && <th className="report-num">Retur</th>}
            </tr>
          </thead>
          <tbody>
            {daily.length === 0 ? (
              <tr>
                <td colSpan={isPrint ? 6 : 7} className="report-empty">
                  Tidak ada data penjualan pada periode ini
                </td>
              </tr>
            ) : (
              daily.map((row) => {
                const discount = isPrint
                  ? Number(row.discount || 0)
                  : Number(row.item_discount || 0) + Number(row.txn_discount || 0) + Number(row.points_value || 0);
                return (
                  <tr key={row.date}>
                    <td>{formatDate(row.date)}</td>
                    <td className="report-num">{isPrint ? row.order_count : row.txn_count}</td>
                    <td className="report-num">{formatCurrency(row.subtotal)}</td>
                    <td className="report-num">{discount > 0 ? formatCurrency(discount) : '-'}</td>
                    <td className="report-num">{formatCurrency(row.tax_total)}</td>
                    <td className="report-num report-strong">{formatCurrency(row.grand_total)}</td>
                    {!isPrint && (
                      <td className="report-num">{row.refund_total ? formatCurrency(row.refund_total) : '-'}</td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
          <tfoot>
            <tr>
              <td className="report-strong">Total</td>
              <td className="report-num report-strong">{sumField(isPrint ? 'order_count' : 'txn_count')}</td>
              <td className="report-num report-strong">{formatCurrency(sumField('subtotal'))}</td>
              <td className="report-num report-strong">{formatCurrency(dailyDiscount)}</td>
              <td className="report-num report-strong">{formatCurrency(sumField('tax_total'))}</td>
              <td className="report-num report-strong">{formatCurrency(grandTotal)}</td>
              {!isPrint && (
                <td className="report-num report-strong">{formatCurrency(sumField('refund_total'))}</td>
              )}
            </tr>
          </tfoot>
        </table>
      </div>

      {isPrint ? (
        <div className="report-section">
          <div className="report-section-title">Ringkasan Per Jasa</div>
          <table className="report-table">
            <thead>
              <tr>
                <th>Jasa</th>
                <th>Kategori</th>
                <th className="report-num">Lembar</th>
                <th className="report-num">Transaksi Item</th>
                <th className="report-num">Pendapatan</th>
              </tr>
            </thead>
            <tbody>
              {(report.services || []).length === 0 ? (
                <tr><td colSpan={5} className="report-empty">Belum ada data jasa</td></tr>
              ) : (
                (report.services || []).map((svc) => (
                  <tr key={svc.service_id}>
                    <td className="report-strong">{svc.service_name}</td>
                    <td className="report-muted-cell">{svc.category || '-'}</td>
                    <td className="report-num">{svc.sheets}</td>
                    <td className="report-num">{svc.item_count}</td>
                    <td className="report-num report-strong">{formatCurrency(svc.revenue)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <div className="report-section report-grid-2">
            <div>
              <div className="report-section-title">Ringkasan Laba Rugi</div>
              {(() => {
                const pl = report.profitLoss || {};
                const returnNet = Number(pl.return_refund || 0) - Number(pl.return_cogs || 0);
                return (
                  <>
                    <div className="report-total-row"><span>Penjualan</span><span>{formatCurrency(pl.revenue)}</span></div>
                    <div className="report-total-row"><span>HPP</span><span>{formatCurrency(pl.cogs)}</span></div>
                    <div className="report-total-row"><span>Laba Kotor</span><span>{formatCurrency(pl.gross_profit)}</span></div>
                    <div className="report-total-row"><span>Retur (neto HPP)</span><span>{returnNet > 0 ? `-${formatCurrency(returnNet)}` : formatCurrency(0)}</span></div>
                    <div className="report-total-row"><span>Beban Operasional</span><span>{formatCurrency(pl.operating_expense)}</span></div>
                    <div className="report-total-row report-grand">
                      <span>Laba Bersih</span>
                      <span className={Number(pl.net_profit) < 0 ? 'report-neg-text' : undefined}>{formatCurrency(pl.net_profit)}</span>
                    </div>
                  </>
                );
              })()}

              {(report.expenseByCategory || []).length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <div className="report-section-title">Beban per Kategori</div>
                  <table className="report-table">
                    <tbody>
                      {(report.expenseByCategory || []).map((row) => (
                        <tr key={row.category}>
                          <td>{row.category}</td>
                          <td className="report-num report-strong">{formatCurrency(row.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div>
              <div className="report-section-title">Ringkasan Per Metode Bayar</div>
              <table className="report-table">
                <thead>
                  <tr>
                    <th>Metode</th>
                    <th className="report-num">Transaksi</th>
                    <th className="report-num">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {(report.payments || []).length === 0 ? (
                    <tr><td colSpan={3} className="report-empty">Belum ada data pembayaran</td></tr>
                  ) : (
                    (report.payments || []).map((row) => (
                      <tr key={row.method}>
                        <td>{PAYMENT_LABELS[row.method] || row.method}</td>
                        <td className="report-num">{row.txn_count}</td>
                        <td className="report-num report-strong">{formatCurrency(row.total)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="report-section">
            <div className="report-section-title">Produk Terlaris</div>
            <table className="report-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Produk</th>
                  <th className="report-num">Terjual</th>
                  <th className="report-num">Pendapatan</th>
                  <th className="report-num">Laba Kotor</th>
                </tr>
              </thead>
              <tbody>
                {(report.topProducts || []).length === 0 ? (
                  <tr><td colSpan={5} className="report-empty">Belum ada data produk</td></tr>
                ) : (
                  (report.topProducts || []).map((row, index) => (
                    <tr key={row.product_id ?? index}>
                      <td>{index + 1}</td>
                      <td>
                        <div className="report-strong">{row.product_name}</div>
                        <div className="report-muted-cell">{row.sku}</div>
                      </td>
                      <td className="report-num">{row.qty_sold} {row.base_unit}</td>
                      <td className="report-num">{formatCurrency(row.revenue)}</td>
                      <td className="report-num report-strong">{formatCurrency(row.gross_profit)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="report-recap">
        <div className="report-recap-left">
          <div className="report-terbilang">
            <span className="report-label">Terbilang</span>
            <div className="report-terbilang-text">{angkaTerbilang(grandTotal)}</div>
          </div>
          {store.receipt_footer && (
            <div className="report-note">
              <span className="report-label">Catatan</span>
              <div>{store.receipt_footer}</div>
            </div>
          )}
        </div>

        <div className="report-totals">
          {isPrint ? (
            <>
              <div className="report-total-row"><span>Pesanan Lunas</span><span>{totals.order_count ?? 0}</span></div>
              <div className="report-total-row"><span>Diskon</span><span>{formatCurrency(dailyDiscount)}</span></div>
              <div className="report-total-row"><span>PPN (incl.)</span><span>{formatCurrency(totals.tax_total)}</span></div>
              <div className="report-total-row report-grand"><span>TOTAL PENDAPATAN</span><span>{formatCurrency(grandTotal)}</span></div>
            </>
          ) : (
            <>
              <div className="report-total-row"><span>Transaksi</span><span>{totals.txn_count ?? 0}</span></div>
              <div className="report-total-row"><span>Diskon</span><span>{formatCurrency(dailyDiscount)}</span></div>
              <div className="report-total-row"><span>PPN (incl.)</span><span>{formatCurrency(totals.tax_total)}</span></div>
              <div className="report-total-row"><span>Retur</span><span>{formatCurrency(totals.refund_total)}</span></div>
              <div className="report-total-row report-grand"><span>TOTAL PENJUALAN</span><span>{formatCurrency(grandTotal)}</span></div>
            </>
          )}
        </div>
      </div>

      <div className="report-sign">
        <div className="report-sign-col">
          <div className="report-muted">Penerima,</div>
          <div className="report-sign-space" />
          <div className="report-sign-line">(............................)</div>
        </div>
        <div className="report-sign-col">
          <div className="report-muted">Hormat kami, {store.store_name || businessLabel}</div>
          <div className="report-sign-space" />
          <div className="report-sign-line">(............................)</div>
        </div>
      </div>

      <div className="report-footer">
        {store.receipt_footer || 'Terima kasih atas kepercayaan Anda'}
      </div>
    </div>
  );
};

export default MonthlyReportPrint;
