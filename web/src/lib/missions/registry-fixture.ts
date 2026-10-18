/**
 * Registries for tests: a publisher whose key a test holds, in the shape the release pins
 * [core: missions/package.ts]. Imported only by tests; nothing in the app reads it.
 */
import type { MissionPublisher, MissionPublishers, PublisherKey } from '@navcom/core';

/** A key trusted to sign from long before any test until long after it, unless told otherwise. */
export const trustedKey = (pubkey: string, over: Partial<PublisherKey> = {}): PublisherKey => ({
  pubkey,
  generation: 1,
  notBefore: '2020-01-01T00:00:00Z',
  notAfter: '2100-01-01T00:00:00Z',
  ...over
});

/** One publisher with one trusted key. */
export function oneKey(pubkey: string, name: string, agent: boolean, over: Partial<MissionPublisher> = {}): MissionPublishers {
  return [{ id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name, agent, keys: [trustedKey(pubkey)], next: null, ...over }];
}
