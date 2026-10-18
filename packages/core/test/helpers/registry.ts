import type { MissionPublisher, MissionPublishers, PublisherKey } from '../../src/index.js';

/** A key trusted to sign from long before any test until long after it, unless told otherwise. */
export const trusted = (pubkey: string, over: Partial<PublisherKey> = {}): PublisherKey => ({
  pubkey,
  generation: 1,
  notBefore: '2020-01-01T00:00:00Z',
  notAfter: '2100-01-01T00:00:00Z',
  ...over
});

/** A registry of one publisher with one trusted key: what a test posts under. */
export function oneKey(pubkey: string, name: string, agent: boolean, over: Partial<MissionPublisher> = {}): MissionPublishers {
  return [{ id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name, agent, keys: [trusted(pubkey)], next: null, ...over }];
}
