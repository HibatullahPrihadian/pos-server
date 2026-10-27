import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const appDirectory = join(process.cwd(), 'android', 'app');
const packagePath = join(appDirectory, 'build.gradle');
const manifestPath = join(appDirectory, 'src', 'main', 'AndroidManifest.xml');

const gradle = await readFile(packagePath, 'utf8');
const applicationId = gradle.match(/applicationId\s+["']([^"']+)["']/)?.[1];
if (!applicationId) throw new Error('applicationId tidak ditemukan di android/app/build.gradle.');

const packageDirectory = join(appDirectory, 'src', 'main', 'java', ...applicationId.split('.'));
const targetActivityPath = join(packageDirectory, 'MainActivity.java');
const targetPluginPath = join(packageDirectory, 'ThermalPrinterPlugin.java');
const activity = `package ${applicationId};\n\nimport android.os.Bundle;\nimport com.getcapacitor.BridgeActivity;\n\npublic class MainActivity extends BridgeActivity {\n    @Override\n    public void onCreate(Bundle savedInstanceState) {\n        registerPlugin(ThermalPrinterPlugin.class);\n        super.onCreate(savedInstanceState);\n    }\n}\n`;
const plugin = (await readFile(join(process.cwd(), 'src-native', 'android', 'ThermalPrinterPlugin.java'), 'utf8'))
  .replace('package id.kenari.pos;', `package ${applicationId};`);
const manifest = `<?xml version="1.0" encoding="utf-8"?>\n<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n    <uses-permission android:name="android.permission.BLUETOOTH" android:maxSdkVersion="30" />\n    <uses-permission android:name="android.permission.BLUETOOTH_ADMIN" android:maxSdkVersion="30" />\n    <uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />\n    <uses-feature android:name="android.hardware.bluetooth" android:required="true" />\n    <application android:usesCleartextTraffic="false">\n        <activity android:name=".MainActivity" android:exported="true">\n            <intent-filter>\n                <action android:name="android.intent.action.MAIN" />\n                <category android:name="android.intent.category.LAUNCHER" />\n            </intent-filter>\n        </activity>\n    </application>\n</manifest>\n`;

await mkdir(packageDirectory, { recursive: true });
await writeFile(targetActivityPath, activity);
await writeFile(targetPluginPath, plugin);
await writeFile(manifestPath, manifest);
console.log(`Registered Bluetooth printer plugin for ${applicationId}.`);
