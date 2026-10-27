const { app, BrowserWindow, ipcMain } = require('electron');
const { SerialPort } = require('serialport');
const fs = require('node:fs');
const path = require('node:path');

const configuredUrl = process.env.POS_SERVER_URL || 'https://pos.example.com';
const allowedOrigin = new URL(configuredUrl).origin;
let selectedPath = null;
let windowRef;

const statePath = () => path.join(app.getPath('userData'), 'printer.json');

function loadSelection() {
  try {
    return JSON.parse(fs.readFileSync(statePath(), 'utf8')).path || null;
  } catch {
    return null;
  }
}

function saveSelection(value) {
  try {
    if (value) fs.writeFileSync(statePath(), JSON.stringify({ path: value }));
    else fs.rmSync(statePath(), { force: true });
  } catch {
    // Persistensi bersifat opsional; kegagalan tulis tidak boleh menghalangi cetak.
  }
}

function createWindow() {
  windowRef = new BrowserWindow({
    width: 1280,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  windowRef.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const blockForeignNavigation = (event, url) => {
    try {
      if (new URL(url).origin !== allowedOrigin) event.preventDefault();
    } catch {
      event.preventDefault();
    }
  };
  windowRef.webContents.on('will-navigate', blockForeignNavigation);
  windowRef.webContents.on('will-redirect', blockForeignNavigation);
  windowRef.loadURL(configuredUrl);
}

ipcMain.handle('printer:list', async () => (await SerialPort.list()).map((port) => ({
  id: port.path,
  name: `${port.path}${port.friendlyName ? ` - ${port.friendlyName}` : ''}`,
})));

function assertAllowedOrigin(event) {
  const frame = event.senderFrame;
  if (!frame || new URL(frame.url).origin !== allowedOrigin) {
    throw new Error('Origin aplikasi tidak diizinkan.');
  }
}

ipcMain.handle('printer:select', async (event, { id }) => {
  assertAllowedOrigin(event);
  const ports = await SerialPort.list();
  if (!ports.some((port) => port.path === id)) throw new Error('Port printer tidak ditemukan.');
  selectedPath = id;
  saveSelection(id);
  return { selected: true };
});

ipcMain.handle('printer:selected', async (event) => {
  assertAllowedOrigin(event);
  if (!selectedPath) return { printer: null };
  const port = (await SerialPort.list()).find((item) => item.path === selectedPath);
  return { printer: port ? { id: port.path, name: port.friendlyName || port.path } : null };
});

ipcMain.handle('printer:clear', (event) => {
  assertAllowedOrigin(event);
  selectedPath = null;
  saveSelection(null);
  return { selected: false };
});

ipcMain.handle('printer:print', async (event, { bytes }) => {
  assertAllowedOrigin(event);
  if (!selectedPath) throw new Error('Pilih port printer terlebih dahulu.');
  if (!Array.isArray(bytes) || bytes.length > 256000 || bytes.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) {
    throw new Error('Data cetak tidak valid.');
  }

  await new Promise((resolve, reject) => {
    const port = new SerialPort({ path: selectedPath, baudRate: 9600, autoOpen: false });
    port.open((openError) => {
      if (openError) return reject(openError);
      port.write(Buffer.from(bytes), (writeError) => {
        if (writeError) return port.close(() => reject(writeError));
        port.drain((drainError) => port.close((closeError) => {
          if (drainError || closeError) reject(drainError || closeError);
          else resolve();
        }));
      });
    });
  });
  return { printed: true };
});

ipcMain.handle('printer:test', async (event) => {
  assertAllowedOrigin(event);
  if (!selectedPath) throw new Error('Pilih port printer terlebih dahulu.');
  const testBytes = [0x1b, 0x40, ...Buffer.from('Tes cetak POS\nPrinter terhubung\n'), 0x1b, 0x64, 0x03];
  await new Promise((resolve, reject) => {
    const port = new SerialPort({ path: selectedPath, baudRate: 9600, autoOpen: false });
    port.open((openError) => {
      if (openError) return reject(openError);
      port.write(Buffer.from(testBytes), (writeError) => {
        if (writeError) return port.close(() => reject(writeError));
        port.drain((drainError) => port.close((closeError) => {
          if (drainError || closeError) reject(drainError || closeError);
          else resolve();
        }));
      });
    });
  });
  return { printed: true };
});

app.whenReady().then(() => {
  selectedPath = loadSelection();
  createWindow();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
