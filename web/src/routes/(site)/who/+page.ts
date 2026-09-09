/**
 * The one page on the public site that opts back into client-side rendering.
 *
 * The root layout sets `csr = false` so the directory works with scripting disabled, and says
 * pages opt back in individually if they genuinely need it. This one does: the roster is read
 * from relays as somebody looks at it, because prerendering it would make the build depend on
 * a stranger's relay answering — and a relay that timed out mid-build would bake a page saying
 * *nobody is here*, which is a false statement about people rather than a missing side-effect.
 *
 * Found by the bundle budget rather than by a failing test: without this the page shipped
 * **0.0 kB of JavaScript**, rendered its shell, and never loaded a single card. It looked
 * finished and did nothing.
 */
export const csr = true;
