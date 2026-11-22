// Figure mode (?figure=teaser|layers|og): fixed layouts rendered with the explorer's own scene and colours, for
// scripts/make_figures.mjs. One canvas; every panel is a scissored orthographic view.
import * as THREE from 'three';
import { loadAtlas } from './data';
import { Viewer, BODY_CENTER, BODY_HEIGHT } from './viewer/viewer';
import { MERIDIANS, meridianName, type LayerId } from './palette';
import { TITLE } from './config';

interface Panel { el: HTMLElement; dir: THREE.Vector3; layers: LayerId[]; lines: boolean }

const html = (tag: string, cls: string, style: string, text = '') => {
  const e = document.createElement(tag); e.className = cls; e.setAttribute('style', style); e.innerHTML = text; return e;
};

export async function runFigure(name: string) {
  const W = 1200, H = name === 'og' ? 630 : name === 'layers' ? 640 : 660;
  const bg = name === 'og' ? '#f3eee5' : '#ffffff';
  const fig = html('div', 'fig', `width:${W}px;height:${H}px;--fig-bg:${bg}`);
  const canvas = document.createElement('canvas'); canvas.className = 'fig-gl';
  fig.append(canvas);
  document.body.append(fig);
  const atlas = await loadAtlas();
  const v = new Viewer(canvas, atlas, { preserve: true, interactive: false });
  v.requestRender = () => {}; // panels are drawn once, below
  v.setTheme({ dark: false, ink: '#2a2622', skin: '#e6d8c6' });
  v.backdrop.visible = false;
  (v.floor.getObjectByName('grid') as THREE.Object3D).visible = false;
  v.autoLineWidth = false;
  const dpr = window.devicePixelRatio || 1;
  v.renderer.setPixelRatio(dpr);
  v.renderer.setSize(W, H, false);
  v.lines.setWidth(name === 'og' ? 1.5 : 1.15);
  v.points.setStyle({ minPx: (name === 'og' ? 5.5 : 4.2) * dpr, maxPx: 16 * dpr });

  const panels: Panel[] = [];
  const box = (x: number, y: number, w: number, h: number) => { const e = html('div', 'panelbox', `left:${x}px;top:${y}px;width:${w}px;height:${h}px`); fig.append(e); return e; };
  const cap = (x: number, y: number, w: number, t: string, sub = '') => fig.append(html('div', 'cap', `left:${x}px;top:${y}px;width:${w}px`, `${t}${sub ? `<small>${sub}</small>` : ''}`));
  const front = new THREE.Vector3(0, 0, 1), back = new THREE.Vector3(0, 0, -1), left = new THREE.Vector3(1, 0, 0);
  const three4 = new THREE.Vector3(0.42, 0.04, 1).normalize();

  if (name === 'teaser') {
    const pw = 330, top = 18, ph = 590;
    ([['Anterior', front], ['Left lateral', left], ['Posterior', back]] as [string, THREE.Vector3][]).forEach(([t, d], i) => {
      panels.push({ el: box(14 + i * pw, top, pw, ph), dir: d, layers: ['skin'], lines: true });
      cap(14 + i * pw, top + ph + 8, pw, t);
    });
    fig.append(html('div', 'cap', 'left:1022px;top:96px;text-align:left;font-size:13px;color:#81796e', 'Meridians'));
    const lg = html('div', 'legend', 'left:1022px;top:124px;grid-template-columns:1fr;');
    lg.innerHTML = MERIDIANS.map((m) => `<div><i style="background:${m.color}"></i><b>${m.code}</b>${meridianName(m.code, 'en').replace(' Meridian', '')}</div>`).join('');
    fig.append(lg);
  } else if (name === 'layers') {
    const pw = 294, top = 14, ph = 566;
    const specs: [string, string, LayerId[], boolean][] = [
      ['Skin', '670 points, 14 meridian lines', ['skin'], true],
      ['Muscles', '670 points', ['muscle'], false],
      ['Organs, vessels, nerves', '670 points', ['bone', 'organ', 'vessel', 'nerve'], false],
      ['Bones, ligaments', '670 points', ['bone', 'ligament'], false],
    ];
    specs.forEach(([t, sub, layers, lines], i) => {
      panels.push({ el: box(12 + i * pw, top, pw, ph), dir: three4, layers, lines });
      cap(12 + i * pw, top + ph + 8, pw, t, sub);
    });
  } else if (name === 'og') {
    panels.push({ el: box(700, 12, 480, 606), dir: new THREE.Vector3(0.3, 0.03, 1).normalize(), layers: ['skin'], lines: true });
    fig.append(html('div', 'ftitle', 'left:64px;top:96px;width:600px;font-size:78px;line-height:1;font-weight:600;letter-spacing:-0.01em', 'Acu361'));
    fig.append(html('div', 'ftitle', 'left:64px;top:194px;width:600px;font-size:33px;line-height:1.24;color:#3d3832', TITLE.replace(/^Acu361: /, '')));
    fig.append(html('div', 'cap', 'left:64px;top:372px;width:600px;text-align:left;font-size:20px;line-height:1.6;color:#4a443c;letter-spacing:0',
      '361 point codes · 670 points · 14 meridians<br>7 anatomical layers · coordinates in mm'));
    const sw = html('div', 'legend', 'left:64px;top:470px;display:flex;gap:7px');
    sw.innerHTML = MERIDIANS.map((m) => `<i style="background:${m.color};width:14px;height:14px"></i>`).join('');
    fig.append(sw);
    fig.append(html('div', 'cap', 'left:64px;top:528px;width:600px;text-align:left;font-size:15px;color:#81796e;letter-spacing:0',
      'Human Motion &amp; Molecular Health Lab · Purdue University · CC BY-SA 4.0'));
  } else {
    document.body.textContent = `unknown figure ${name}`; return;
  }

  const need = new Set<LayerId>(panels.flatMap((p) => p.layers));
  need.add('skin');
  await Promise.all([...need].map((id) => v.body.load(id)));

  const r = v.renderer;
  r.setScissorTest(true);
  r.setClearColor(bg, 1); r.clear();
  const fr = fig.getBoundingClientRect();
  const lights = v.camera.children.slice();
  for (const p of panels) {
    const b = p.el.getBoundingClientRect();
    const x = b.left - fr.left, y = b.top - fr.top, w = b.width, h = b.height;
    for (const L of v.body.layers.values()) v.body.want(L.id, p.layers.includes(L.id));
    for (const m of MERIDIANS) v.lines.setState(m.code, p.lines ? 1 : 0, v.dimColor);
    const half = (BODY_HEIGHT * 1.035) / 2, aspect = w / h;
    const cam = new THREE.OrthographicCamera(-half * aspect, half * aspect, half, -half, 10, 10000);
    const c = new THREE.Vector3(0, BODY_CENTER.y - 10, 0);
    cam.position.copy(c).addScaledVector(p.dir, 4000); cam.lookAt(c);
    v.scene.add(cam);
    for (const l of lights) cam.add(l); // the lights travel with the viewing camera
    cam.updateMatrixWorld(true); cam.updateProjectionMatrix();
    v.points.setView(cam, { w: w * dpr, h: h * dpr });
    v.lines.setResolution(w * dpr, h * dpr, dpr);
    const yb = H - y - h;
    r.setViewport(x, yb, w, h); r.setScissor(x, yb, w, h);
    r.render(v.scene, cam);
    for (const l of lights) v.camera.add(l);
    v.scene.remove(cam);
  }
  r.setScissorTest(false);
  (window as unknown as { acu361fig: unknown }).acu361fig = { ready: true };
}
