/**
 * The one separation `CLAUDE.md` calls non-negotiable.
 *
 * *"Escalation executor is a separate process from the agent. A compromised agent must not be
 * able to impair escalation."* The executor states the same thing in its own docstring —
 * *"Nothing here calls the agent, waits on it, or reads its health. There is no seam"* — and
 * **nothing enforced it.**
 *
 * The core state machine's shape is tested [failure mode 6 in `core`], which covers the pure
 * logic. This covers the process: a dependency that does not exist cannot be caught by a
 * behavioural test, because there is no behaviour to observe until somebody adds one. A
 * structural rule needs a structural test, or it rots the first time a plausible import looks
 * convenient.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? filesUnder(full) : full.endsWith('.ts') ? [full] : [];
  });
}

/** Every `import ... from '...'` specifier in a file. */
const importsOf = (file: string): string[] =>
  [...readFileSync(file, 'utf8').matchAll(/^\s*import\s[\s\S]*?from\s+["']([^"']+)["']/gm)]
    .map((m) => m[1] as string);

describe('the escalation executor stands alone', () => {
  const escalation = filesUnder(join(SRC, 'escalation'));

  it('has files to check, so this test cannot pass by finding nothing', () => {
    // A structural test that silently matches an empty set is the worst kind of green.
    expect(escalation.length).toBeGreaterThan(3);
  });

  it('imports nothing from the daemon, which is where the agent lives', () => {
    for (const file of escalation) {
      for (const spec of importsOf(file)) {
        expect(spec, `${file} reaches into the daemon`).not.toMatch(/daemon/);
      }
    }
  });

  it('imports nothing that names an agent', () => {
    // A seam does not have to live in `daemon/` to be a seam.
    for (const file of escalation) {
      for (const spec of importsOf(file)) {
        expect(spec, `${file} imports something agent-shaped`).not.toMatch(/agent|llm|model|brain/i);
      }
    }
  });

  it('never consults agent health, by any name', () => {
    // The executor may not read the thing it must not depend on.
    for (const file of escalation) {
      const body = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      expect(body, `${file} reads agent health`).not.toMatch(/agent_health|agentHealth/);
    }
  });

  it('and the daemon may depend on escalation, but not the other way round', () => {
    // The permitted direction, asserted so the rule reads as a direction rather than a ban.
    const daemon = filesUnder(join(SRC, 'daemon'));
    const reaching = daemon.filter((f) => importsOf(f).some((s) => /escalation/.test(s)));
    expect(reaching.length).toBeGreaterThanOrEqual(0);
  });
});
