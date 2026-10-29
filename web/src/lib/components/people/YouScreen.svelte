<script lang="ts">
  /**
   * You [docs/design/groups.md §3, *Yours*]: what other people can see about you.
   *
   * The print that signs what you put out, who your card reaches, whether a relay took it, what is
   * signed under the key on this phone, and the endorsements you hold — listed, never counted. The
   * lit action is *Edit card*. No strength meter, no completeness bar, no nudge: having no card is a
   * way to be, and the screen says what it means rather than what is missing.
   */
  import { keyPrint as printOrNull } from '@navcom/core/card';
  import { Panel, Readout, Slot } from '$lib/components/panel';
  import type { Nav } from '$lib/com/screens';
  import { handleFor } from '$lib/people/cache.svelte';
  import { fetchCard } from '$lib/people/fetch';
  import { cardSent, contactPubkey, myCard } from '$lib/terminal/card';
  import { held } from '$lib/terminal/standing';
  import { get } from '$lib/terminal/storage';

  let { nav }: { nav: Nav } = $props();
  /** A key's print, or its first characters where it has none. */
  const keyPrint = (key: string): string => printOrNull(key) ?? key.slice(0, 8);

  const print = contactPubkey();
  const card = myCard();
  const sent = cardSent();
  const claims = (get<unknown[]>('wipeable', 'mission_claims') ?? []).length;
  const history = (get<unknown[]>('wipeable', 'mission_history') ?? []).length;
  const endorsements = held();

  const audience = !card
    ? { value: 'Not published', sub: 'nobody can find you by a card' }
    : card.visibility === 'public'
      ? { value: 'Anyone', sub: 'on navcom.app itself, too' }
      : card.visibility === 'board'
        ? { value: 'Anyone in your city', sub: `on ${card.region}’s board` }
        : { value: 'Only with your address', sub: 'your card is still published' };

  /** Your card as a stranger reads it: one ask for your own card, which the relay already saw you publish. */
  async function asOthersSeeIt() {
    if (!print) return;
    void fetchCard(print);
    nav.open({ kind: 'profile', h: handleFor(print) });
  }
</script>

<div data-screen="you">
  <Panel label="You" post="what others can see">
    <Slot k="Print">
      {#if print}
        <Readout value={keyPrint(print)} verbatim tone="neutral" sub={card ? 'signs your card' : 'signs your claims and reports; no card'} />
      {:else}
        <Readout value="None yet" tone="cold" sub="made when you publish a card or take part in a mission" />
      {/if}
    </Slot>
    {#if print && !card}
      <!-- The first honest fix: a contact key exists without a card once a mission was taken part in. -->
      <Slot k="Seen as">
        <span data-print-no-card><Readout value="A print only" tone="neutral" sub="your claims and reports are signed by a key with no card: others see its print and nothing else" /></span>
      </Slot>
    {/if}
    <Slot k="Card"><Readout value={audience.value} tone={card ? 'neutral' : 'cold'} sub={audience.sub} /></Slot>
    {#if card}
      <Slot k="Sent">
        <Readout
          value={sent === 'all' ? 'Every relay' : sent === 'some' ? 'Some relays' : sent === 'none' ? 'Not sent' : 'Not known'}
          tone={sent === 'all' ? 'good' : 'warn'}
          sub={sent === 'none' ? 'no relay answered' : sent === null ? 'no record of a relay taking it' : 'took your card'}
        />
      </Slot>
    {/if}
    <Slot k="Signed here">
      <!-- Only on this phone: what the key holds, read from tonight's tier. -->
      <Readout
        value={claims + history === 0 ? 'Nothing' : `${claims} held · ${history} taken part in`}
        tone="neutral"
        sub="on this phone only; a wipe forgets it"
      />
    </Slot>
    <Slot k="Endorsements">
      {#if endorsements.length > 0}
        <ul class="list">
          {#each endorsements as e (e.id)}<li>{e.endorser} <span class="print">{keyPrint(e.endorserKey)}</span> · {e.scope}</li>{/each}
        </ul>
        <Readout value="Shown to nobody" tone="neutral" sub="unless you hand one over" />
      {:else}
        <Readout value="None" tone="cold" sub="held on this phone" />
      {/if}
    </Slot>

    <div class="rail">
      <a class="lit" href="/terminal/card/" data-sveltekit-reload data-edit-card>{card ? 'Edit card' : 'Publish a card'}</a>
      {#if !card}
        <span class="said">Seen by whoever you choose: anyone, anyone in your city, or only people you give your address to.</span>
      {/if}
      {#if print && card}
        <button type="button" data-as-others onclick={asOthersSeeIt}>As others see it</button>
      {/if}
      <a href="/terminal/standing/" data-sveltekit-reload>Standing</a>
    </div>
  </Panel>
</div>

<style>
  .list {
    margin: 0;
    padding-inline-start: 1.1rem;
    font-size: 0.9rem;
    color: var(--t-ink);
  }
  .print {
    font-family: var(--font-mono);
    font-size: 0.72rem;
    color: var(--t-faint);
  }
  .rail {
    display: grid;
    gap: 0.5rem;
    margin-top: 0.6rem;
  }
  .rail button,
  .rail a {
    display: flex;
    align-items: center;
    min-height: 3rem;
    padding: 0 0.8rem;
    border: 1px solid var(--t-line);
    background: var(--t-sunk);
    color: var(--t-ink);
    font: inherit;
    text-decoration: none;
    cursor: pointer;
  }
  .rail .lit {
    border-color: var(--t-ink);
    font-weight: 600;
  }
  .said {
    font-size: 0.8rem;
    color: var(--t-faint);
  }
</style>
