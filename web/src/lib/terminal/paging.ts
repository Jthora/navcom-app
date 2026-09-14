/**
 * Registering to be woken — the one exception to a silent terminal.
 *
 * **The field terminal sends no notifications.** No badges, no activity, no "somebody signed
 * on", no nudges to come back. The single exception is a `Distress` reaching somebody who
 * deliberately registered themselves as on-call, and that is not a feature of the field
 * terminal at all — it is a commitment made by a person who will not be in the field.
 *
 * ## Nothing here is discovered
 *
 * A subscription is useless without the public key of whoever will send to it, and that key
 * is pasted in by hand from the person running the executor. Then the subscription is read
 * back out and handed to them. Both halves travel the way everything else in this system
 * does: person to person, out of band, with nothing looked up.
 *
 * That is not ceremony. A registration flow that phoned home would mean this app knew who
 * was on call for which watch, which is a roster, which is a list of where operators are.
 */

/** Whether this browser can be woken at all. */
export function canBePaged(): boolean {
  return (
    typeof Notification !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in globalThis
  );
}

export class PagingError extends Error {}

/** base64url → bytes, for the sender's public key. */
function fromBase64Url(value: string): Uint8Array {
  const clean = value.trim().replace(/-/g, '+').replace(/_/g, '/');
  const padded = clean + '='.repeat((4 - (clean.length % 4)) % 4);
  try {
    const binary = atob(padded);
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    throw new PagingError('That does not look like a sender key.');
  }
}

const toBase64Url = (buffer: ArrayBuffer | null): string => {
  if (!buffer) return '';
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
};

/**
 * What the person running the executor needs from you.
 *
 * Deliberately the whole subscription rather than a shortened handle: there is nothing to
 * shorten it against, and a handle would imply a registry.
 */
export interface Registration {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/**
 * Asks to be woken, and returns what to hand over.
 *
 * Permission is requested **at the moment somebody asks for it**, never on load. A prompt
 * an operator did not ask for is the thing every app does and this one does not.
 */
export async function registerForPaging(senderKey: string): Promise<Registration> {
  if (!canBePaged()) {
    throw new PagingError('This browser cannot be woken. On iPhone, add NavCom to the Home Screen first.');
  }

  const applicationServerKey = fromBase64Url(senderKey);
  if (applicationServerKey.length !== 65) {
    throw new PagingError(`A sender key is 65 bytes; that one is ${applicationServerKey.length}.`);
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    // Refusing is a legitimate choice, and it means not being on-call rather than being
    // half on-call. Said plainly rather than nagged about.
    throw new PagingError('Not allowed to send notifications, so this device cannot be on-call.');
  }

  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    // Required by every browser: a push that shows nothing is not permitted, which happens
    // to match the rule here anyway — the only push this app sends is one worth waking for.
    userVisibleOnly: true,
    applicationServerKey: applicationServerKey as BufferSource
  });

  const p256dh = toBase64Url(subscription.getKey('p256dh'));
  const auth = toBase64Url(subscription.getKey('auth'));

  /*
   * A registration missing a key is refused rather than handed over.
   *
   * `getKey` can return null, and the encoder turns that into an empty string — so this
   * returned a Registration that looked complete, the operator handed it to whoever runs the
   * executor, and the node's reader checked the keys were strings without checking they were
   * anything. An empty key cannot encrypt a page, so the failure surfaced at 3am on the one
   * channel that exists to work then.
   */
  if (!p256dh || !auth) {
    await subscription.unsubscribe().catch(() => {});
    throw new PagingError(
      'This browser did not return the keys needed to encrypt a page, so it cannot be on-call. Try removing NavCom from the Home Screen and adding it again.'
    );
  }

  return { endpoint: subscription.endpoint, keys: { p256dh, auth } };
}

/** Stops this device being wakeable. Immediate, and tells nobody — like everything else here. */
export async function stopPaging(): Promise<void> {
  if (!canBePaged()) return;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  await subscription?.unsubscribe();
}

/** Whether this device is currently subscribed. */
export async function isRegistered(): Promise<boolean> {
  if (!canBePaged()) return false;
  const registration = await navigator.serviceWorker.ready;
  return (await registration.pushManager.getSubscription()) !== null;
}

/**
 * Removes this device's paging subscription, if it has one, for burn.
 *
 * Burn claimed to destroy everything on the device and left this standing, so a burned phone
 * could still be woken for on-call. Not `stopPaging`: that waits on `serviceWorker.ready`, which
 * never settles on a page with no registration, and a burn that hung there would leave somebody
 * watching a screen that had not finished. `getRegistration` answers either way.
 */
export async function forgetPaging(): Promise<void> {
  if (!canBePaged()) return;
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  await subscription?.unsubscribe();
}
