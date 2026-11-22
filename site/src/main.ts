import './style.css';
import { initLang } from './i18n';
import { loadAtlas, url } from './data';
import { Viewer } from './viewer/viewer';
import { Explorer, bindChrome } from './ui/explorer';

function webglOK() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGL2RenderingContext && c.getContext('webgl2'));
  } catch { return false; }
}

function showFallback() {
  const f = document.getElementById('fallback')!;
  const img = document.getElementById('fallback-img') as HTMLImageElement;
  img.src = url('img/teaser.png');
  f.hidden = false;
  document.getElementById('loading')?.classList.add('done');
  document.getElementById('gl')!.style.display = 'none';
}

async function explorer() {
  let explorerRef: Explorer | null = null;
  bindChrome(() => explorerRef?.applyTheme());
  if (!webglOK()) { showFallback(); return; }
  const fill = document.getElementById('loading-fill')!;
  let atlas;
  try { atlas = await loadAtlas(); } catch (e) { console.error(e); showFallback(); return; }
  fill.style.width = '20%';
  let v: Viewer;
  try { v = new Viewer(document.getElementById('gl') as HTMLCanvasElement, atlas); } catch (e) { console.error(e); showFallback(); return; }
  const ex = new Explorer(v, atlas);
  explorerRef = ex;
  ex.applyTheme();
  ex.resize();
  v.setView('home', false);
  ex.refresh();
  const prev = v.body.onProgress;
  v.body.onProgress = (id, f, st) => { prev(id, f, st); if (id === 'skin') fill.style.width = `${20 + f * 75}%`; };
  v.body.want('skin', true);
  try { await v.body.load('skin'); } catch (e) { console.error(e); }
  fill.style.width = '100%';
  document.getElementById('loading')!.classList.add('done');
  v.requestRender();
  ex.applyHash(!new URLSearchParams(location.search).has('still'));
  (window as unknown as { acu361: unknown }).acu361 = { viewer: v, explorer: ex, ready: true };
}

initLang();
const fig = new URLSearchParams(location.search).get('figure');
if (fig) import('./figure').then((m) => m.runFigure(fig));
else explorer();
