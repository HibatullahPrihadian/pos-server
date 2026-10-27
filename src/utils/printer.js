import { buildOrderReceiptData, buildReceiptData, encodeEscPos } from './receiptData';
import { printReceipt as printBrowserReceipt } from './printReceipt';

const nativePrinter = () => {
  if (window.posPrinter && typeof window.posPrinter.print === 'function') return window.posPrinter;
  try {
    const plugins = window.Capacitor?.Plugins;
    if (plugins?.ThermalPrinter) {
      return {
        print: ({ bytes }) => plugins.ThermalPrinter.print({ bytes }),
        listPrinters: () => plugins.ThermalPrinter.listPrinters(),
        getSelectedPrinter: () => plugins.ThermalPrinter.getSelectedPrinter(),
        selectPrinter: ({ id }) => plugins.ThermalPrinter.selectPrinter({ id }),
        clearSelectedPrinter: () => plugins.ThermalPrinter.clearSelectedPrinter(),
        testPrint: () => plugins.ThermalPrinter.testPrint(),
      };
    }
  } catch {
    return null;
  }
  return null;
};

async function sendDirect(printer, data) {
  const blob = encodeEscPos(data);
  const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
  try {
    await printer.print({ bytes, receipt: data });
    return 'direct';
  } catch (error) {
    let useFallback = false;
    try {
      useFallback = window.confirm(`Gagal mencetak langsung: ${error.message || 'printer tidak tersedia'}. Buka dialog cetak browser?`);
    } catch {
      useFallback = false;
    }
    if (!useFallback) throw error;
    return 'browser';
  }
}

export async function printSaleReceipt(sale, settings, change = 0, options = {}) {
  const printer = nativePrinter();
  if (printer && options.direct !== false) {
    const result = await sendDirect(printer, buildReceiptData(sale, settings, change));
    if (result === 'direct') return 'direct';
  }
  printBrowserReceipt();
  return 'browser';
}

export async function printOrderReceipt(order, settings, options = {}) {
  const printer = nativePrinter();
  if (printer && options.direct !== false) {
    const result = await sendDirect(printer, buildOrderReceiptData(order, settings));
    if (result === 'direct') return 'direct';
  }
  printBrowserReceipt();
  return 'browser';
}

export async function listPrinters() {
  const printer = nativePrinter();
  if (!printer?.listPrinters) throw new Error('Cetak langsung tidak tersedia. Gunakan browser atau aplikasi POS resmi.');
  const result = await printer.listPrinters();
  return result.printers || [];
}

export async function getSelectedPrinter() {
  const printer = nativePrinter();
  if (!printer?.getSelectedPrinter) return null;
  const result = await printer.getSelectedPrinter();
  return result.printer || null;
}

export async function selectPrinter(id) {
  const printer = nativePrinter();
  if (!printer?.selectPrinter) throw new Error('Pemilihan printer tidak tersedia pada perangkat ini.');
  return printer.selectPrinter({ id });
}

export async function clearSelectedPrinter() {
  const printer = nativePrinter();
  if (!printer?.clearSelectedPrinter) throw new Error('Penghapusan printer tidak tersedia pada perangkat ini.');
  return printer.clearSelectedPrinter();
}

export async function testPrinter() {
  const printer = nativePrinter();
  if (!printer?.testPrint) throw new Error('Tes printer tidak tersedia pada perangkat ini.');
  return printer.testPrint();
}

export function hasDirectPrinter() {
  return Boolean(nativePrinter());
}
