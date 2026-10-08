// Semua uang disimpan sebagai BIGINT rupiah (integer, tanpa desimal).
// Semua pembulatan terpusat di file ini.

const toInt = (value) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? n : 0;
};

const toPositiveInt = (value) => {
  const n = toInt(value);
  return n > 0 ? n : 0;
};

// Harga jual sudah INCLUDE PPN. PPN dihitung terbalik dari total bruto.
// taxTotal = round(gross - gross / (1 + rate/100)); dpp = gross - taxTotal.
const extractTax = (grossTotal, taxRate) => {
  const gross = toInt(grossTotal);
  const rate = Number(taxRate);
  if (!Number.isFinite(rate) || rate <= 0) {
    return { taxTotal: 0, dpp: gross };
  }
  const taxTotal = Math.round(gross - gross / (1 + rate / 100));
  return { taxTotal, dpp: gross - taxTotal };
};

// HPP moving average saat penerimaan barang. Stok minus diabaikan (dianggap 0)
// agar satu penjualan minus tidak menggelembungkan HPP penerimaan berikut.
const movingAverageCost = (stockQty, oldCost, receivedQty, unitCost) => {
  const currentQty = Math.max(0, toInt(stockQty));
  const incomingQty = toInt(receivedQty);
  const totalQty = currentQty + incomingQty;
  if (totalQty <= 0) return toInt(unitCost);
  return Math.round((currentQty * toInt(oldCost) + incomingQty * toInt(unitCost)) / totalQty);
};

// Poin didapat = floor((grand_total - nilai_poin_ditukar) / earn_per_amount)
const pointsEarned = (netTotal, earnPerAmount) => {
  const per = toInt(earnPerAmount);
  if (per <= 0) return 0;
  const net = toInt(netTotal);
  return net > 0 ? Math.floor(net / per) : 0;
};

module.exports = { toInt, toPositiveInt, extractTax, movingAverageCost, pointsEarned };
