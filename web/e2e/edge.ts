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

