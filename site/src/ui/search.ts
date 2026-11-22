import type { Atlas } from '../data';
import { MERIDIAN, MERIDIANS } from '../palette';
import { getLang, t } from '../i18n';

type Code = Atlas['codes'][number];
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[\s\-_'’·.]/g, '');

export function searchCodes(atlas: Atlas, q: string, limit = 40): Code[] {
  const raw = q.trim(); if (!raw) return [];
  const f = fold(raw);
  const codeQ = f.replace(/^([a-z]+)0+(\d)/, '$1$2');
  const scored: [number, Code][] = [];
  for (const c of atlas.codes) {
    const code = c.code.toLowerCase(), py = fold(c.pinyin);
    let s = -1;
    if (code === codeQ) s = 100;
    else if (/^[a-z]+$/.test(codeQ) && c.meridian.toLowerCase() === codeQ) s = 90 - c.index / 100;
    else if (code.startsWith(codeQ) && /\d/.test(codeQ)) s = 85 - c.index / 100;
    else if (py === f) s = 80;
    else if (py.startsWith(f)) s = 70;
    else if (c.zh === raw) s = 78;
    else if (c.zh.includes(raw)) s = 66;
    else if (f.length >= 3 && py.includes(f)) s = 55;
    else {
      const m = MERIDIAN.get(c.meridian)!;
      if (f.length >= 3 && (fold(m.en).startsWith(f) || m.zh.includes(raw))) s = 40 - c.index / 100;
    }
    if (s >= 0) scored.push([s, c]);
  }
  scored.sort((a, b) => b[0] - a[0] || MERIDIANS.findIndex((m) => m.code === a[1].meridian) - MERIDIANS.findIndex((m) => m.code === b[1].meridian) || a[1].index - b[1].index);
  return scored.slice(0, limit).map((x) => x[1]);
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
function hl(text: string, q: string) {
  const raw = q.trim(); if (!raw) return esc(text);
  const i = text.toLowerCase().indexOf(raw.toLowerCase());
  if (i < 0) return esc(text);
  return `${esc(text.slice(0, i))}<mark>${esc(text.slice(i, i + raw.length))}</mark>${esc(text.slice(i + raw.length))}`;
}

export class SearchBox {
  readonly el: HTMLElement;
  readonly input: HTMLInputElement;
  private list: HTMLUListElement;
  private items: Code[] = [];
  private active = -1;

  constructor(private atlas: Atlas, private onPick: (code: Code) => void) {
    this.el = document.createElement('div');
    this.el.className = 'search';
    this.el.innerHTML = `<label class="search-box"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5l5 5"/></svg>
      <span class="visually-hidden" data-t="search"></span>
      <input type="search" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="search-results" autocomplete="off" spellcheck="false" enterkeyhint="search">
      <kbd aria-hidden="true">/</kbd></label>
      <ul class="results" id="search-results" role="listbox" hidden></ul>`;
    this.input = this.el.querySelector('input')!;
    this.list = this.el.querySelector('ul')!;
    this.input.addEventListener('input', () => this.update());
    this.input.addEventListener('focus', () => { if (this.input.value) this.update(); });
    this.input.addEventListener('keydown', (e) => this.key(e));
    this.input.addEventListener('blur', () => setTimeout(() => this.close(), 120));
    this.list.addEventListener('mousedown', (e) => e.preventDefault());
    this.list.addEventListener('click', (e) => {
      const li = (e.target as HTMLElement).closest('li[data-i]') as HTMLElement | null;
      if (li) this.choose(+li.dataset.i!);
    });
    this.relabel();
  }
  relabel() {
    this.input.placeholder = t().searchPlaceholder;
    this.input.setAttribute('aria-label', t().search);
    if (!this.list.hidden) this.update();
  }
  private update() {
    const q = this.input.value;
    this.items = searchCodes(this.atlas, q);
    this.active = this.items.length ? 0 : -1;
    if (!q.trim()) { this.close(); return; }
    const zh = getLang() === 'zh';
    this.list.innerHTML = this.items.length
      ? this.items.map((c, i) => {
        const m = MERIDIAN.get(c.meridian)!;
        return `<li role="option" id="sr-${i}" data-i="${i}" aria-selected="${i === this.active}"><span class="dot" style="background:${m.color}"></span>` +
          `<span class="code">${hl(c.code, q)}</span><span class="nm">${hl(c.pinyin, q)}<i lang="zh-Hans">${hl(c.zh, q)}</i></span><span class="mer">${zh ? m.zh : m.code}</span></li>`;
      }).join('')
      : `<li class="empty" role="option" aria-disabled="true">${esc(t().noResults)}</li>`;
    this.list.hidden = false;
    this.input.setAttribute('aria-expanded', 'true');
    this.syncActive();
  }
  private syncActive() {
    this.list.querySelectorAll('li[data-i]').forEach((li, i) => li.setAttribute('aria-selected', String(i === this.active)));
    if (this.active >= 0) {
      this.input.setAttribute('aria-activedescendant', `sr-${this.active}`);
      this.list.querySelector(`#sr-${this.active}`)?.scrollIntoView({ block: 'nearest' });
    } else this.input.removeAttribute('aria-activedescendant');
  }
  private key(e: KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (this.list.hidden) this.update();
      if (!this.items.length) return;
      e.preventDefault();
      this.active = (this.active + (e.key === 'ArrowDown' ? 1 : -1) + this.items.length) % this.items.length;
      this.syncActive();
    } else if (e.key === 'Enter') {
      if (this.active >= 0) { e.preventDefault(); this.choose(this.active); }
    } else if (e.key === 'Escape') {
      if (this.input.value) { this.input.value = ''; this.close(); } else this.input.blur();
      e.stopPropagation();
    }
  }
  private choose(i: number) {
    const c = this.items[i]; if (!c) return;
    this.close();
    this.input.value = '';
    this.input.blur();
    this.onPick(c);
  }
  close() { this.list.hidden = true; this.input.setAttribute('aria-expanded', 'false'); this.input.removeAttribute('aria-activedescendant'); }
}
