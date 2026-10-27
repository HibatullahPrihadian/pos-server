package id.kenari.pos;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothSocket;
import android.os.Build;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.OutputStream;
import java.util.UUID;

@CapacitorPlugin(
    name = "ThermalPrinter",
    permissions = {
        @Permission(alias = "bluetooth", strings = { Manifest.permission.BLUETOOTH_CONNECT })
    }
)
public class ThermalPrinterPlugin extends Plugin {
    private static final UUID SPP_UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");
    private static final String PREFS = "pos_printer";
    private static final String PREF_ADDRESS = "address";
    private String selectedAddress;
    private byte[] pendingBytes;

    @Override
    public void load() {
        selectedAddress = getContext().getSharedPreferences(PREFS, android.content.Context.MODE_PRIVATE)
            .getString(PREF_ADDRESS, null);
    }

    @PluginMethod
    public void listPrinters(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && getPermissionState("bluetooth") != PermissionState.GRANTED) {
            requestPermissionForAlias("bluetooth", call, "bluetoothPermissionCallback");
            return;
        }
        resolvePrinters(call);
    }

    @PluginMethod
    public void selectPrinter(PluginCall call) {
        String address = call.getString("id");
        if (address == null || !address.matches("(?i)[0-9a-f]{2}(:[0-9a-f]{2}){5}")) {
            call.reject("Alamat printer Bluetooth tidak valid.");
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && getPermissionState("bluetooth") != PermissionState.GRANTED) {
            call.reject("Cari perangkat terlebih dahulu untuk memberikan izin Bluetooth.");
            return;
        }
        BluetoothAdapter adapter = getBluetoothAdapter();
        if (adapter == null || adapter.getRemoteDevice(address) == null) {
            call.reject("Printer Bluetooth tidak tersedia.");
            return;
        }
        selectedAddress = address;
        getContext().getSharedPreferences(PREFS, android.content.Context.MODE_PRIVATE)
            .edit().putString(PREF_ADDRESS, address).apply();
        call.resolve();
    }

    @PluginMethod
    public void getSelectedPrinter(PluginCall call) {
        JSObject result = new JSObject();
        if (selectedAddress != null) {
            BluetoothAdapter adapter = getBluetoothAdapter();
            BluetoothDevice device = adapter == null ? null : adapter.getRemoteDevice(selectedAddress);
            JSObject selected = new JSObject();
            selected.put("id", selectedAddress);
            selected.put("name", device == null || device.getName() == null ? selectedAddress : device.getName());
            result.put("printer", selected);
        } else {
            result.put("printer", (Object) null);
        }
        call.resolve(result);
    }

    @PluginMethod
    public void clearSelectedPrinter(PluginCall call) {
        selectedAddress = null;
        getContext().getSharedPreferences(PREFS, android.content.Context.MODE_PRIVATE)
            .edit().remove(PREF_ADDRESS).apply();
        call.resolve();
    }

    @PluginMethod
    public void print(PluginCall call) {
        JSArray input = call.getArray("bytes");
        if (input == null || input.length() == 0 || input.length() > 256000) {
            call.reject("Data cetak tidak valid.");
            return;
        }
        try {
            byte[] bytes = new byte[input.length()];
            for (int i = 0; i < input.length(); i++) {
                int value = input.getInt(i);
                if (value < 0 || value > 255) throw new IllegalArgumentException("Byte di luar rentang.");
                bytes[i] = (byte) value;
            }
            writeBytes(call, bytes);
        } catch (Exception error) {
            call.reject("Data cetak tidak valid.", error);
        }
    }

    @PluginMethod
    public void testPrint(PluginCall call) {
        writeBytes(call, new byte[] { 0x1b, 0x40, 'T', 'e', 's', ' ', 'c', 'e', 't', 'a', 'k', '\n', 'P', 'O', 'S', '\n', 0x1b, 0x64, 0x03 });
    }

    @PermissionCallback
    public void bluetoothPermissionCallback(PluginCall call) {
        if (getPermissionState("bluetooth") != PermissionState.GRANTED) {
            call.reject("Izin Bluetooth diperlukan untuk mencetak.");
            return;
        }
        if (pendingBytes != null) {
            byte[] bytes = pendingBytes;
            pendingBytes = null;
            writeBytes(call, bytes);
        } else {
            resolvePrinters(call);
        }
    }

    private void resolvePrinters(PluginCall call) {
        BluetoothAdapter adapter = getBluetoothAdapter();
        if (adapter == null || !adapter.isEnabled()) {
            call.reject("Bluetooth tidak tersedia atau belum diaktifkan.");
            return;
        }
        JSArray printers = new JSArray();
        for (BluetoothDevice device : adapter.getBondedDevices()) {
            JSObject printer = new JSObject();
            printer.put("id", device.getAddress());
            printer.put("name", device.getName() == null ? device.getAddress() : device.getName());
            printers.put(printer);
        }
        JSObject result = new JSObject();
        result.put("printers", printers);
        call.resolve(result);
    }

    private void writeBytes(PluginCall call, byte[] bytes) {
        if (selectedAddress == null) {
            call.reject("Pilih printer Bluetooth terlebih dahulu.");
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && getPermissionState("bluetooth") != PermissionState.GRANTED) {
            pendingBytes = bytes;
            requestPermissionForAlias("bluetooth", call, "bluetoothPermissionCallback");
            return;
        }
        new Thread(() -> {
            BluetoothSocket socket = null;
            try {
                BluetoothAdapter adapter = getBluetoothAdapter();
                BluetoothDevice device = adapter.getRemoteDevice(selectedAddress);
                socket = device.createRfcommSocketToServiceRecord(SPP_UUID);
                socket.connect();
                OutputStream stream = socket.getOutputStream();
                stream.write(bytes);
                stream.flush();
                call.resolve();
            } catch (Exception error) {
                call.reject("Gagal mengirim struk ke printer Bluetooth.", error);
            } finally {
                if (socket != null) {
                    try { socket.close(); } catch (Exception ignored) { }
                }
            }
        }).start();
    }

    private BluetoothAdapter getBluetoothAdapter() {
        BluetoothManager manager = (BluetoothManager) getContext().getSystemService(android.content.Context.BLUETOOTH_SERVICE);
        return manager == null ? null : manager.getAdapter();
    }
}
