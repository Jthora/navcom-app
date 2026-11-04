import type { Page } from '@playwright/test';

/** Whatever on the page reaches past the screen's edge, outside anything that scrolls or clips it on purpose. */
export async function pastTheEdge(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const found: string[] = [];
    if (document.documentElement.scrollWidth > width + 1) found.push(`the page scrolls sideways: ${document.documentElement.scrollWidth}px on a ${width}px screen`);
    const contained = (el: Element) => {
      for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
        if (/auto|scroll|hidden|clip/.test(getComputedStyle(p).overflowX)) return true;
      }
      return false;
    };
    const name = (el: Element) => {
      const data = [...el.attributes].filter((a) => a.name.startsWith('data-')).map((a) => `[${a.name}]`).join('');
      return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${data}${el.className && typeof el.className === 'string' ? `.${el.className.trim().split(/\s+/).join('.')}` : ''}`;
    };
    for (const el of document.body.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.width <= 1 || r.height <= 1) continue;
      if (r.right <= width + 1 && r.left >= -1) continue;
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || style.clipPath !== 'none' || style.clip !== 'auto') continue;
      if (contained(el)) continue;
      found.push(`${name(el)} reaches ${Math.round(r.left)}–${Math.round(r.right)}px: «${(el.textContent ?? '').trim().slice(0, 50)}»`);
    }
    return [...new Set(found)].slice(0, 8);
  });
}


/**
 * Every field whose hint is wider than the field, so the end of it is cut off: a name field said "a
 * callsign, a nickname or your own" on a 360px phone, and nothing measured it [live walk, 2026-11-04].
 * Measured in the field's own font, against the room inside its padding.
 */
export async function cutHints(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const ctx = document.createElement('canvas').getContext('2d')!;
    const cut: string[] = [];
    for (const el of document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input[placeholder], textarea[placeholder]')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || el.tagName === 'TEXTAREA') continue;
      const s = getComputedStyle(el);
      ctx.font = `${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
      const room = el.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight);
      const needs = ctx.measureText(el.placeholder).width + parseFloat(s.letterSpacing || '0') * el.placeholder.length;
      if (needs > room + 1) cut.push(`#${el.id || el.name || '?'}: «${el.placeholder}» needs ${Math.round(needs)}px of ${Math.round(room)}`);
    }
    return cut;
  });
}
