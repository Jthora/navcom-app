/**
 * Registering a device to be woken.
 *
 * The one channel that exists to work at 3am, so what matters here is that it refuses to
 * report success it cannot deliver.
 */

import { describe, expect, it, vi, afterEach } from 'vitest';
import { PagingError, registerForPaging } from './paging';

/** A browser that can be woken, with whatever subscription keys the test asks for. */
function installBrowser(keys: { p256dh: ArrayBuffer | null; auth: ArrayBuffer | null }) {
  const unsubscribe = vi.fn(async () => true);
  const g = globalThis as Record<string, unknown>;
  g.Notification = { requestPermission: async () => 'granted' };
  g.PushManager = class {};
  // `navigator` is a getter in this environment, so it is replaced rather than assigned.
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
    serviceWorker: {
      ready: Promise.resolve({
        pushManager: {
          subscribe: async () => ({
            endpoint: 'https://push.example/abc',
            getKey: (name: string) => (name === 'p256dh' ? keys.p256dh : keys.auth),
            unsubscribe
          })
        }
      })
    }
  } });
  return { unsubscribe };
}

/** 65 bytes, the size every browser requires of an application server key. */
const senderKey = btoa(String.fromCharCode(...new Uint8Array(65).fill(4)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

afterEach(() => vi.restoreAllMocks());

describe('a browser that returns no encryption key', () => {
  it('refuses rather than handing over a registration that cannot be encrypted', async () => {
    // `getKey` can return null, and the encoder turned that into an empty string — so this
    // returned something that looked complete, and the node accepted it.
    installBrowser({ p256dh: null, auth: new Uint8Array([1, 2, 3]).buffer });
    await expect(registerForPaging(senderKey)).rejects.toBeInstanceOf(PagingError);
    await expect(registerForPaging(senderKey)).rejects.toThrow(/cannot be on-call/i);
  });

  it('does not leave a useless subscription behind on the device', async () => {
    const { unsubscribe } = installBrowser({ p256dh: null, auth: null });
    await registerForPaging(senderKey).catch(() => {});
    expect(unsubscribe).toHaveBeenCalled();
  });

  it('hands over a real registration when the browser gives both keys', async () => {
    installBrowser({
      p256dh: new Uint8Array([1, 2, 3]).buffer,
      auth: new Uint8Array([4, 5, 6]).buffer
    });
    const registration = await registerForPaging(senderKey);
    expect(registration.endpoint).toBe('https://push.example/abc');
    expect(registration.keys.p256dh).not.toBe('');
    expect(registration.keys.auth).not.toBe('');
  });
});

describe('burn forgets paging', () => {
  /** A browser that can be woken, with whatever registration the test gives it. */
  function installRegistration(registration: unknown, ready: Promise<unknown> = new Promise(() => {})) {
    const g = globalThis as Record<string, unknown>;
    g.Notification = { requestPermission: async () => 'granted' };
    g.PushManager = class {};
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
      serviceWorker: { ready, getRegistration: async () => registration }
    } });
  }

  it('unsubscribes a device that is on call, so a burned phone cannot be woken', async () => {
    // Burn said it destroyed everything on the device and left this standing.
    const unsubscribe = vi.fn(async () => true);
    installRegistration({ pushManager: { getSubscription: async () => ({ unsubscribe }) } });
    const { forgetPaging } = await import('./paging');
    await forgetPaging();
    expect(unsubscribe).toHaveBeenCalled();
  });

  it('finishes on a page with no service worker, rather than waiting forever', async () => {
    // `serviceWorker.ready` never settles without a registration -- installed here as a promise
    // that never resolves. A burn that awaited it would leave somebody watching a screen that had
    // not finished destroying anything.
    installRegistration(undefined);
    const { forgetPaging } = await import('./paging');
    await expect(forgetPaging()).resolves.toBeUndefined();
  });
});
