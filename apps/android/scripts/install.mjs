#!/usr/bin/env node
/**
 * Puts the debug build on a device over USB and opens it: sideloaded, no store, no listing.
 *
 *   npm run install-apk                  the only device attached, or the one ANDROID_SERIAL names
 *   ANDROID_SERIAL=R9AR7003A2J npm run install-apk
 *
 * The device must have USB debugging on and this computer allowed. `-r` keeps what the app already
 * holds on the device across an update: a persona made in it survives a reinstall.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const APK = fileURLToPath(new URL('../android/app/build/outputs/apk/debug/app-debug.apk', import.meta.url));
if (!existsSync(APK)) {
  console.error('[install] no debug build: run `npm run apk` first.');
  process.exit(1);
}
const adb = (...args) => execFileSync('adb', args, { encoding: 'utf8' }).trim();
const attached = adb('devices')
  .split('\n')
  .slice(1)
  .map((line) => line.split(/\s+/))
  .filter(([, state]) => state === 'device')
  .map(([serial]) => serial);
const serial = process.env.ANDROID_SERIAL ?? (attached.length === 1 ? attached[0] : null);
if (!serial || !attached.includes(serial)) {
  console.error(`[install] attached: ${attached.join(', ') || 'none'}. Name one with ANDROID_SERIAL.`);
  process.exit(1);
}
console.log(`[install] ${serial}: ${adb('-s', serial, 'shell', 'getprop', 'ro.product.model')}`);
console.log(adb('-s', serial, 'install', '-r', APK));
// Started a moment after the update settles: started at once, the system could kill it as the old
// install's empty process.
await new Promise((r) => setTimeout(r, 2_000));
adb('-s', serial, 'shell', 'am', 'start', '-n', 'app.navcom/.MainActivity');
console.log('[install] opened NavCom');
