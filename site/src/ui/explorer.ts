import * as THREE from 'three';
import type { Atlas, Point } from '../data';
import { boneName } from '../data';
import { MERIDIANS, MERIDIAN, LAYERS, meridianName, type LayerId } from '../palette';
import { getLang, onLang, setLang, t, type Lang } from '../i18n';
import { SITE_URL } from '../config';
import { Viewer, VIEW_DIR, type View } from '../viewer/viewer';
import { SearchBox } from './search';

const $ = <T extends HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const fmt = (v: number) => v.toFixed(2);
const mobile = () => matchMedia('(max-width: 760px)').matches;
const coarse = () => matchMedia('(pointer: coarse)').matches;
const AUTO_SKIN = 0.32;

export function isDark() {
  const th = document.documentElement.dataset.theme;
  return th ? th === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
}
export function themeInk() { return isDark() ? '#ece7df' : '#2a2622'; }

async function copyText(s: string) {
  try { await navigator.clipboard.writeText(s); return true; } catch {
    const ta = document.createElement('textarea'); ta.value = s; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.append(ta); ta.select(); let ok = false; try { ok = document.execCommand('copy'); } catch { ok = false; } ta.remove(); return ok;
  }
}
function flash(btn: HTMLElement, label: string) {
  const old = btn.innerHTML; btn.textContent = label; btn.setAttribute('aria-live', 'polite');
  setTimeout(() => { btn.innerHTML = old; }, 1300);
}

// strings marked data-t / data-t-title / data-t-aria are refreshed on language change
function relabel(root: ParentNode) {
  const s = t() as unknown as Record<string, string>;
  root.querySelectorAll<HTMLElement>('[data-t]').forEach((e) => { e.textContent = s[e.dataset.t!]; });
  root.querySelectorAll<HTMLElement>('[data-t-title]').forEach((e) => { e.title = s[e.dataset.tTitle!]; });
  root.querySelectorAll<HTMLElement>('[data-t-aria]').forEach((e) => { e.setAttribute('aria-label', s[e.dataset.tAria!]); });
}

export class Explorer {
  private sel: Point | null = null;
  private hover = -1;
  private isolate: string | null = null;
  private hoverMer: string | null = null;
  private show = { points: true, lines: true, rulers: false };
  private autoSkin = false;
  private ui = $<HTMLElement>('#ui');
  private card!: HTMLElement;
  private panel!: HTMLElement;
  private tooltip = $<HTMLElement>('#tooltip');
  private labels = $<HTMLElement>('#labels');
  private search!: SearchBox;
  private lens = 0;
  private lensTarget = 0;
  private colors: THREE.Color[];

  constructor(private v: Viewer, private atlas: Atlas) {
    this.colors = atlas.points.map((p) => new THREE.Color(MERIDIAN.get(p.meridian)!.color));
    this.build();
    this.bindCanvas();
    this.bindPage();
    onLang(() => this.relang());
    this.relang();
    this.v.afterRender.add(() => this.afterRender());
  }

  // ------------------------------------------------------------------ DOM
  private build() {
    const counts = new Map<string, number>();
    for (const p of this.atlas.points) counts.set(p.meridian, (counts.get(p.meridian) || 0) + 1);
    const layerRows = LAYERS.map((l) => `<li><label class="toggle" data-layer="${l.id}"><span class="sw" style="background:${l.color}"></span>` +
      `<span data-t="layer_${l.id}"></span><span class="st"></span><input type="checkbox" ${l.id === 'skin' ? 'checked' : ''}><span class="knob"></span>` +
      `<span class="bar" hidden><span></span></span></label>${l.id === 'skin' ? `<div class="slider"><span data-t="skinOpacity"></span><output>100%</output><input type="range" min="0" max="100" value="100" step="1" data-t-aria="skinOpacity"></div>` : ''}</li>`).join('');
    const merRows = MERIDIANS.map((m) => `<li><button type="button" data-mer="${m.code}" aria-pressed="false"><span class="dot" style="background:${m.color}"></span>` +
      `<span class="mc">${m.code}</span><span class="mn" data-mname="${m.code}"></span><span class="mk">${counts.get(m.code) || 0}</span></button></li>`).join('');
    this.ui.innerHTML = `
      <aside class="panel" id="panel" aria-label="Controls">
        <div class="panel-head"><b data-t="controls"></b><button type="button" class="icon-btn" data-close-panel data-t-aria="close"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
        <section class="psec"><h3><span data-t="meridians"></span><button type="button" data-showall hidden data-t="showAll"></button></h3><ul class="mlist">${merRows}</ul></section>
        <section class="psec"><h3><span data-t="layers"></span></h3><ul class="toggles">${layerRows}</ul></section>
        <section class="psec"><h3><span data-t="overlays"></span></h3><ul class="toggles">
          <li><label class="toggle" data-ov="points"><span class="sw" style="background:conic-gradient(${MERIDIANS.map((m, i) => `${m.color} ${i * 25.7}deg ${(i + 1) * 25.7}deg`).join(',')});border-radius:50%"></span><span data-t="points"></span><span class="st"></span><input type="checkbox" checked><span class="knob"></span></label></li>
          <li><label class="toggle" data-ov="lines"><span class="sw" style="background:linear-gradient(90deg,#d9648a,#3d8fd6,#1e9aa0);height:3px;border-radius:2px;box-shadow:none"></span><span data-t="lines"></span><span class="st"></span><input type="checkbox" checked><span class="knob"></span></label></li>
          <li><label class="toggle" data-ov="rulers"><span class="sw" style="background:repeating-linear-gradient(90deg,var(--ink) 0 3px,transparent 3px 5px);height:2px;box-shadow:none;border-radius:0"></span><span data-t="rulers"></span><span class="st"></span><input type="checkbox"><span class="knob"></span></label></li>
        </ul></section>
      </aside>
      <section class="card" id="card" aria-live="polite" hidden></section>
      <nav class="views" aria-label="Views">
        ${(['front', 'back', 'left', 'right'] as View[]).map((k) => `<button type="button" data-view="${k}" ${k === 'left' ? 'data-t-title="leftTitle"' : k === 'right' ? 'data-t-title="rightTitle"' : ''}><span class="lbl" data-t="${k}"></span><span class="short" aria-hidden="true">${k[0].toUpperCase()}</span></button>`).join('')}
        <span class="sep" aria-hidden="true"></span>
        <button type="button" data-view="home" data-t-title="reset" data-t-aria="reset"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4.5v3.8h3.8"/></svg></button>
      </nav>
      <button type="button" class="fab" aria-controls="panel" aria-expanded="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h10"/></svg><span data-t="controls"></span></button>
      <p class="hint"><span data-hint></span></p>
      <svg class="axes" viewBox="-28 -28 56 56" aria-hidden="true"></svg>
      <p class="credit"><a href="#license">Body: Z-Anatomy · CC BY-SA 4.0</a></p>`;
    this.panel = $('#panel', this.ui);
    this.card = $('#card', this.ui);

    this.search = new SearchBox(this.atlas, (c) => {
      const keepSide = this.sel && this.sel.code === c.code ? this.sel.side : null;
      const id = c.ids.find((x) => keepSide && x.endsWith(`_${keepSide}`)) || c.ids.find((x) => x.endsWith('_L')) || c.ids[0];
      this.select(this.atlas.byId.get(id)!, true);
    });
    $('#search-slot').append(this.search.el);

    // meridian list
    const mlist = $('.mlist', this.panel);
    mlist.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button[data-mer]') as HTMLElement | null; if (!b) return;
      const m = b.dataset.mer!;
      this.isolate = this.isolate === m ? null : m;
      if (this.isolate && this.sel && this.sel.meridian !== this.isolate) this.select(null);
      this.refresh();
    });
    mlist.addEventListener('pointerover', (e) => {
      const b = (e.target as HTMLElement).closest('button[data-mer]') as HTMLElement | null;
      const m = b?.dataset.mer || null; if (m !== this.hoverMer) { this.hoverMer = m; this.refresh(); }
    });
    mlist.addEventListener('pointerleave', () => { this.hoverMer = null; this.refresh(); });
    mlist.addEventListener('focusin', (e) => { const b = (e.target as HTMLElement).closest('button[data-mer]') as HTMLElement | null; this.hoverMer = b?.dataset.mer || null; this.refresh(); });
    mlist.addEventListener('focusout', () => { this.hoverMer = null; this.refresh(); });
    $('[data-showall]', this.panel).addEventListener('click', () => { this.isolate = null; this.refresh(); });

    // layers
    this.panel.querySelectorAll<HTMLElement>('[data-layer]').forEach((lab) => {
      const id = lab.dataset.layer as LayerId;
      const box = $<HTMLInputElement>('input', lab);
      box.addEventListener('change', () => this.setLayer(id, box.checked));
    });
    const range = $<HTMLInputElement>('.slider input', this.panel);
    range.addEventListener('input', () => { this.autoSkin = false; this.setSkinOpacity(+range.value / 100); });
    this.v.body.onProgress = (id, f, state) => {
      const lab = $(`[data-layer="${id}"]`, this.panel); if (!lab) return;
      const bar = $('.bar', lab), st = $('.st', lab);
      bar.hidden = state !== 'loading';
      ($('span', bar) as HTMLElement).style.width = `${Math.round(f * 100)}%`;
      st.textContent = state === 'loading' ? t().layerBusy(Math.round(f * 100)) : state === 'error' ? t().failed : '';
      if (state === 'error') ($('input', lab) as HTMLInputElement).checked = false;
      lab.setAttribute('aria-busy', String(state === 'loading'));
    };
    // overlays
    this.panel.querySelectorAll<HTMLElement>('[data-ov]').forEach((lab) => {
      const k = lab.dataset.ov as 'points' | 'lines' | 'rulers';
      const box = $<HTMLInputElement>('input', lab);
      box.addEventListener('change', () => { this.show[k] = box.checked; this.refresh(); });
    });

    // views
    this.ui.querySelectorAll<HTMLElement>('[data-view]').forEach((b) => b.addEventListener('click', () => {
      this.v.setView(b.dataset.view as View);
    }));
    // mobile panel
    const fab = $<HTMLButtonElement>('.fab', this.ui);
    const scrim = document.createElement('div'); scrim.className = 'scrim'; scrim.hidden = true; this.ui.append(scrim);
    const setPanel = (open: boolean) => { this.panel.classList.toggle('open', open); fab.setAttribute('aria-expanded', String(open)); scrim.hidden = !open; };
    fab.addEventListener('click', () => setPanel(!this.panel.classList.contains('open')));
    scrim.addEventListener('click', () => setPanel(false));
    $('[data-close-panel]', this.panel).addEventListener('click', () => setPanel(false));
    this.card.addEventListener('click', (e) => this.cardClick(e));
  }

  private relang() {
    const lang: Lang = getLang();
    relabel(this.ui);
    this.panel.querySelectorAll<HTMLElement>('[data-mname]').forEach((e) => { e.textContent = meridianName(e.dataset.mname!, lang); });
    $('[data-hint]', this.ui).textContent = coarse() ? t().hintTouch : t().hint;
    this.search.relabel();
    document.querySelectorAll<HTMLButtonElement>('[data-set-lang]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.setLang === lang)));
    const tb = $('#theme-btn'); tb.title = t().theme; tb.setAttribute('aria-label', t().theme);
    if (this.sel) this.renderCard();
    this.buildRulerLabels();
  }

  // ------------------------------------------------------------------ state -> scene
  refresh() {
    const pts = this.atlas.points, P = this.v.points, dim = this.v.dimColor;
    const c = new THREE.Color();
    for (let i = 0; i < pts.length; i++) {
      const m = pts[i].meridian;
      const hidden = !this.show.points || (this.isolate !== null && m !== this.isolate);
      const dimmed = this.hoverMer !== null && m !== this.hoverMer && !hidden;
      const isSel = this.sel === pts[i];
      c.copy(this.colors[i]); if (dimmed && !isSel) c.lerp(dim, 0.72);
      P.setColor(i, c);
      P.setFlag(i, isSel ? 1 : 0);
      P.setSize(i, hidden && !isSel ? 0 : isSel ? 1 : i === this.hover ? 1.4 : dimmed ? 0.72 : 1);
    }
    for (const m of MERIDIANS) {
      const hidden = !this.show.lines || (this.isolate !== null && m.code !== this.isolate);
      const s = hidden ? 0 : this.hoverMer === m.code ? 2 : this.hoverMer ? 0.5 : 1;
      this.v.lines.setState(m.code, s, dim);
    }
    this.v.rulers.group.visible = this.show.rulers;
    this.labels.hidden = !this.show.rulers;
    const mlist = $('.mlist', this.panel);
    mlist.classList.toggle('isolating', !!this.isolate);
    mlist.querySelectorAll<HTMLElement>('button[data-mer]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mer === this.isolate)));
    ($('[data-showall]', this.panel) as HTMLElement).hidden = !this.isolate;
    this.v.requestRender();
  }

  setLayer(id: LayerId, on: boolean) {
    const range = $<HTMLInputElement>('.slider input', this.panel);
    this.v.body.want(id, on);
    const inner = LAYERS.filter((l) => l.id !== 'skin' && this.v.body.isWanted(l.id)).length;
    if (id !== 'skin' && on && this.v.body.isWanted('skin') && this.v.body.skinOpacity > 0.99) {
      this.autoSkin = true; this.setSkinOpacity(AUTO_SKIN); range.value = String(AUTO_SKIN * 100);
    } else if (id !== 'skin' && !on && inner === 0 && this.autoSkin) {
      this.autoSkin = false; this.setSkinOpacity(1); range.value = '100';
    }
    (this.panel.querySelector('.slider') as HTMLElement).style.opacity = this.v.body.isWanted('skin') ? '1' : '0.4';
    range.disabled = !this.v.body.isWanted('skin');
  }
  private setSkinOpacity(a: number) {
    this.v.body.setSkinOpacity(a);
    const out = this.panel.querySelector('.slider output'); if (out) out.textContent = `${Math.round(a * 100)}%`;
  }

  // ------------------------------------------------------------------ selection
  select(p: Point | null, fly = false, animate = true) {
    this.sel = p;
    if (p && this.isolate && p.meridian !== this.isolate) this.isolate = null;
    this.refresh();
    this.card.hidden = !p;
    document.getElementById('explore')!.classList.toggle('card-open', !!p);
    this.updateLens();
    if (p) {
      this.renderCard();
      history.replaceState(null, '', `${location.pathname}${location.search}#${p.id}`);
      if (fly) this.v.focusPoint(p, undefined, animate, mobile() ? this.card.offsetHeight / 2 : 0);
      this.ping(p);
    } else if (/^#[A-Z]{2}\d+_[LRM]$/.test(location.hash)) {
      history.replaceState(null, '', `${location.pathname}${location.search}`);
    }
  }
  private ping(p: Point) {
    // short expanding ring at the selected point
    if (this.v.reducedMotion.matches) return;
    const i = this.atlas.points.indexOf(p); const t0 = performance.now();
    const step = () => {
      const k = (performance.now() - t0) / 420; if (this.sel !== p) return;
      this.v.points.setSize(i, k < 1 ? 1 + 0.5 * Math.sin(k * Math.PI) : 1);
      this.v.requestRender();
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  private neighbours(p: Point) {
    const same = this.atlas.points.filter((q) => q.meridian === p.meridian && (q.side === p.side));
    same.sort((a, b) => a.index - b.index);
    const i = same.indexOf(p);
    return { prev: same[i - 1] || null, next: same[i + 1] || null };
  }

  private renderCard() {
    const p = this.sel; if (!p) return;
    const s = t(), lang = getLang();
    const m = MERIDIAN.get(p.meridian)!;
    const bone = boneName(p.nearest_bone);
    const boneSide = bone.side ? ` (${bone.side === 'L' ? s.side_L : s.side_R})` : '';
    const { prev, next } = this.neighbours(p);
    const mirror = p.side === 'M' ? null : this.atlas.byId.get(`${p.code}_${p.side === 'L' ? 'R' : 'L'}`);
    const lifted = this.v.lifted && !!this.atlas.lift.points[p.id];
    this.card.innerHTML = `
      <div class="card-top">
        <div class="card-code"><b>${p.code}</b><span class="badge">${esc(p.side === 'M' ? s.side_M : p.side === 'L' ? s.side_L : s.side_R)}</span></div>
        <button type="button" class="icon-btn" data-act="close" aria-label="${esc(s.close)}" title="${esc(s.close)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
      </div>
      <h2 class="card-name">${esc(p.name_pinyin)}<span class="zh" lang="zh-Hans">${esc(p.name_zh)}</span></h2>
      <div class="card-mer"><span class="dot" style="background:${m.color}"></span>${esc(meridianName(p.meridian, lang))}<span class="mk">· ${p.meridian}${p.index}</span></div>
      <div class="readout" role="group" aria-label="${esc(s.position)} (mm)">
        <div class="ro-head"><span>${esc(s.position)} <small>mm</small></span><button type="button" class="mini" data-act="copy-pos">${esc(s.copy)}</button></div>
        <div class="ro-grid"><div><span>x</span><b>${fmt(p.pos[0])}</b></div><div><span>y</span><b>${fmt(p.pos[1])}</b></div><div><span>z</span><b>${fmt(p.pos[2])}</b></div></div>
      </div>
      <dl>
        <dt>${esc(s.side)}</dt><dd>${p.side === 'M' ? esc(s.side_M) : esc(p.side === 'L' ? s.side_L : s.side_R)}${mirror ? ` <button type="button" class="mini" data-act="mirror">${esc(s.mirror)} →</button>` : ''}</dd>
        <dt>${esc(s.nearestBone)}</dt><dd title="${esc(p.nearest_bone)}">${esc(bone.name)}${esc(boneSide)}</dd>
        <dt>${esc(s.boneDistance)}</dt><dd><span class="tnum">${p.bone_distance_mm.toFixed(1)} mm</span><span class="sub">${esc(s.boneNote)}</span></dd>
      </dl>
      ${lifted ? `<p class="card-note"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8v.01"/></svg>${esc(s.lifted)}</p>` : ''}
      <div class="card-actions">
        <div class="card-nav">
          <button type="button" class="nav-btn" data-act="prev" ${prev ? '' : 'disabled'} aria-label="${esc(s.prev)}${prev ? ` ${prev.code}` : ''}" title="${esc(s.prev)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 6l-6 6 6 6"/></svg>${prev ? prev.code : ''}</button>
          <button type="button" class="nav-btn" data-act="next" ${next ? '' : 'disabled'} aria-label="${esc(s.next)}${next ? ` ${next.code}` : ''}" title="${esc(s.next)}">${next ? next.code : ''}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 6l6 6-6 6"/></svg></button>
        </div>
        <button type="button" class="mini" data-act="link">${esc(s.copyLink)}</button>
      </div>`;
  }
  private cardClick(e: MouseEvent) {
    const b = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null; if (!b || !this.sel) return;
    const p = this.sel;
    switch (b.dataset.act) {
      case 'close': this.select(null); break;
      case 'copy-pos': copyText(`${fmt(p.pos[0])}, ${fmt(p.pos[1])}, ${fmt(p.pos[2])}`).then((ok) => ok && flash(b, t().copied)); break;
      case 'link': copyText(`${SITE_URL}#${p.id}`).then((ok) => ok && flash(b, t().copied)); break;
      case 'mirror': { const q = this.atlas.byId.get(`${p.code}_${p.side === 'L' ? 'R' : 'L'}`); if (q) this.select(q, true); break; }
      case 'prev': case 'next': { const n = this.neighbours(p)[b.dataset.act as 'prev' | 'next']; if (n) this.select(n, true); break; }
    }
  }

  // ------------------------------------------------------------------ canvas interaction
  private bindCanvas() {
    const cv = this.v.canvas;
    let down: { x: number; y: number; t: number; type: string } | null = null;
    let pending: { x: number; y: number } | null = null;
    cv.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now(), type: e.pointerType }; cv.classList.add('dragging'); this.setHover(-1); });
    window.addEventListener('pointerup', (e) => {
      cv.classList.remove('dragging');
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y), dt = performance.now() - down.t;
      const type = down.type; down = null;
      if (e.target !== cv || moved > 6 || dt > 600) return;
      const r = cv.getBoundingClientRect();
      const id = this.v.pick(e.clientX - r.left, e.clientY - r.top, type === 'touch' ? 16 : 7);
      if (id >= 0) this.select(this.atlas.points[id], true);
      else if (this.sel && type !== 'touch') this.select(null);
    });
    cv.addEventListener('pointermove', (e) => {
      if (down || e.pointerType === 'touch') return;
      const r = cv.getBoundingClientRect();
      const first = !pending;
      pending = { x: e.clientX - r.left, y: e.clientY - r.top };
      if (first) requestAnimationFrame(() => {
        if (!pending) return; const q = pending; pending = null;
        this.setHover(this.v.pick(q.x, q.y, 4));
      });
    });
    cv.addEventListener('pointerleave', () => { pending = null; this.setHover(-1); });
    cv.addEventListener('keydown', (e) => {
      const map: Record<string, View> = { f: 'front', b: 'back', l: 'left', r: 'right', h: 'home' };
      if (map[e.key]) { this.v.setView(map[e.key]); e.preventDefault(); }
    });
    new ResizeObserver(() => this.resize()).observe(document.getElementById('stage')!);
  }

  resize() {
    const st = document.getElementById('stage')!;
    this.v.reserveY = mobile() ? 120 : 140;
    this.v.resize(st.clientWidth, st.clientHeight);
    this.updateLens(true);
  }
  private updateLens(now = false) {
    if (mobile()) this.lensTarget = 0;
    else {
      const left = this.panel.offsetWidth + 16;
      const right = this.sel ? this.card.offsetWidth + 16 : 0;
      this.lensTarget = (left - right) / 2;
    }
    if (now || this.v.reducedMotion.matches) { this.lens = this.lensTarget; this.v.lensShift = this.lens; this.v.applyLens(); this.v.requestRender(); return; }
    const t0 = performance.now(), from = this.lens;
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / 380); const e = 1 - Math.pow(1 - k, 3);
      this.lens = from + (this.lensTarget - from) * e; this.v.lensShift = this.lens; this.v.applyLens(); this.v.requestRender();
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  private setHover(i: number) {
    if (i === this.hover) return;
    const old = this.hover; this.hover = i;
    const P = this.v.points;
    if (old >= 0 && this.atlas.points[old] !== this.sel) P.setSize(old, this.show.points && (!this.isolate || this.atlas.points[old].meridian === this.isolate) ? (this.hoverMer && this.atlas.points[old].meridian !== this.hoverMer ? 0.72 : 1) : 0);
    if (i >= 0 && this.atlas.points[i] !== this.sel) P.setSize(i, 1.4);
    this.v.canvas.classList.toggle('over-point', i >= 0);
    if (i < 0) { this.tooltip.hidden = true; } else {
      const p = this.atlas.points[i]; const m = MERIDIAN.get(p.meridian)!;
      const side = p.side === 'M' ? '' : ` <span class="zh">${p.side === 'L' ? t().side_L : t().side_R}</span>`;
      this.tooltip.innerHTML = `<span class="sw" style="background:${m.color}"></span><b>${p.code}</b>${esc(p.name_pinyin)} <span class="zh" lang="zh-Hans">${esc(p.name_zh)}</span>${side}`;
      this.tooltip.hidden = false;
      this.placeTooltip();
    }
    this.v.requestRender();
  }
  private placeTooltip() {
    if (this.hover < 0) return;
    const s = this.v.project(this.v.pointPosition(this.hover));
    if (!s) { this.tooltip.hidden = true; return; }
    this.tooltip.style.transform = `translate(${Math.round(s.x)}px, ${Math.round(s.y)}px) translate(-50%, calc(-100% - 12px))`;
  }

  // ------------------------------------------------------------------ per-frame overlays
  private buildRulerLabels() {
    this.labels.innerHTML = '';
    const lang = getLang();
    for (const L of this.v.rulers.labels) {
      const el = document.createElement('span'); el.className = 'rlabel';
      el.textContent = lang === 'zh' ? `${L.ruler.cun} ${t().cun}` : `${L.ruler.cun} cun`;
      el.title = lang === 'zh' ? L.ruler.label_zh : L.ruler.label_en;
      this.labels.append(el); L.el = el;
    }
    this.v.requestRender();
  }
  private afterRender() {
    this.placeTooltip();
    if (this.show.rulers) {
      const camDir = new THREE.Vector3(); this.v.camera.getWorldDirection(camDir);
      for (const L of this.v.rulers.labels) {
        const s = this.v.project(L.mid); if (!L.el) continue;
        if (!s) { L.el.style.display = 'none'; continue; }
        L.el.style.display = '';
        L.el.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px) translate(-50%, -50%)`;
        L.el.classList.toggle('far', L.out.dot(camDir) > 0.25);
      }
    }
    // axes gizmo
    const ax = this.ui.querySelector('.axes'); if (!ax) return;
    const q = this.v.camera.quaternion.clone().invert();
    const parts: string[] = [];
    const axes: [THREE.Vector3, string][] = [[new THREE.Vector3(1, 0, 0), 'x'], [new THREE.Vector3(0, 1, 0), 'y'], [new THREE.Vector3(0, 0, 1), 'z']];
    for (const [a, n] of axes) {
      const d = a.clone().applyQuaternion(q); const x = d.x * 17, y = -d.y * 17;
      parts.push(`<path d="M0 0L${x.toFixed(1)} ${y.toFixed(1)}" opacity="${(0.55 + 0.45 * (d.z + 1) / 2).toFixed(2)}"/><text x="${(d.x * 24).toFixed(1)}" y="${(-d.y * 24 + 3).toFixed(1)}" text-anchor="middle">${n}</text>`);
    }
    ax.innerHTML = `<circle r="1.6" class="i-fill"/>${parts.join('')}`;
  }

  // ------------------------------------------------------------------ deep links, keyboard, page widgets
  applyHash(animate: boolean) {
    const h = decodeURIComponent(location.hash.slice(1));
    if (!h) return;
    let p = this.atlas.byId.get(h);
    if (!p) { const c = this.atlas.codes.find((x) => x.code.toLowerCase() === h.toLowerCase()); if (c) p = this.atlas.byId.get(c.ids.find((x) => x.endsWith('_L')) || c.ids[0]); }
    if (p && p !== this.sel) {
      document.getElementById('explore')!.scrollIntoView({ behavior: 'auto' });
      this.select(p, true, animate);
    }
  }
  private bindPage() {
    window.addEventListener('hashchange', () => this.applyHash(true));
    window.addEventListener('keydown', (e) => {
      const tag = (e.target as HTMLElement).tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable;
      if ((e.key === '/' && !typing) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')) {
        e.preventDefault(); this.search.input.focus(); this.search.input.select();
        return;
      }
      if (typing) return;
      if (e.key === 'Escape' && this.sel) { this.select(null); return; }
      if (this.sel && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && (document.activeElement === document.body || document.activeElement === this.v.canvas)) {
        const n = this.neighbours(this.sel)[e.key === 'ArrowLeft' ? 'prev' : 'next'];
        if (n) { e.preventDefault(); this.select(n, true); }
      }
    });
    const mq = matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener?.('change', () => this.applyTheme());
  }
  applyTheme() {
    const dark = isDark();
    this.v.setTheme({ dark, ink: themeInk(), skin: '#e6d8c6' });
    const cs = getComputedStyle(document.documentElement);
    this.v.setBackdrop(cs.getPropertyValue('--stage-1').trim() || '#fbf8f2', cs.getPropertyValue('--stage-2').trim() || '#e9e2d5', dark ? 0.6 : 1);
  }
  static viewDirs() { return VIEW_DIR; }
}

// page-wide controls that work with or without the 3D explorer
export function bindChrome(onTheme: () => void) {
  document.querySelectorAll<HTMLButtonElement>('[data-set-lang]').forEach((b) => b.addEventListener('click', () => setLang(b.dataset.setLang as Lang)));
  onLang((l) => document.querySelectorAll<HTMLButtonElement>('[data-set-lang]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.setLang === l))));
  document.querySelectorAll<HTMLButtonElement>('[data-set-lang]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.setLang === getLang())));
  $('#theme-btn').addEventListener('click', () => {
    const next = isDark() ? 'light' : 'dark';
    const sys = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    if (next === sys) { delete document.documentElement.dataset.theme; try { localStorage.removeItem('acu361.theme'); } catch { /* storage unavailable */ } }
    else { document.documentElement.dataset.theme = next; try { localStorage.setItem('acu361.theme', next); } catch { /* storage unavailable */ } }
    onTheme();
  });
  const top = $('#topbar');
  const onScroll = () => top.classList.toggle('solid', window.scrollY > 24);
  window.addEventListener('scroll', onScroll, { passive: true }); onScroll();
  // copy buttons and code tabs in the page
  document.querySelectorAll<HTMLButtonElement>('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
    const src = document.getElementById(b.dataset.copy!); if (!src) return;
    if (await copyText(src.textContent || '')) flash(b, t().copied);
  }));
  const tabs = [...document.querySelectorAll<HTMLButtonElement>('.tabs [role="tab"]')];
  const activate = (tab: HTMLButtonElement) => {
    for (const x of tabs) {
      const on = x === tab; x.setAttribute('aria-selected', String(on)); x.tabIndex = on ? 0 : -1;
      document.getElementById(x.getAttribute('aria-controls')!)!.hidden = !on;
    }
  };
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => activate(tab));
    tab.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length]; activate(n); n.focus(); e.preventDefault();
    });
  });
}
