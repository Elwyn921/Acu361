#!/usr/bin/env node
// Builds the site's generated assets from the repository alone:
//   ../data/body/<layer>.glb  -> public/body/<layer>.glb   gltfpack (meshopt, EXT_meshopt_compression, 16-bit positions,
//   display/garment.glb       -> public/body/garment.glb   named nodes and extras kept)
//   ../data/*.json, points.csv -> public/data/              verbatim copies (the explorer reads these files)
//   public/body/lift.json      points and meridian samples under the display garment, moved onto its outer surface
//   public/body/index.json     sizes, flags and the accuracy check of the compressed skin
// Checks: node names survive compression; every compressed vertex is within 0.1 mm of the original; every one of the
// 670 points is within 0.1 mm of the compressed skin surface. Any failure stops the build.
//
//   node scripts/prepare.mjs               rebuild everything
//   node scripts/prepare.mjs --if-missing  skip when the outputs exist and the inputs are unchanged
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGlb, TriGrid, merge } from './glb.mjs';

const run = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(here, '..');
const REPO = path.resolve(SITE, '..');
const DATA = path.join(REPO, 'data');
const OUT_BODY = path.join(SITE, 'public/body');
const OUT_DATA = path.join(SITE, 'public/data');
const GLTFPACK = path.join(SITE, 'node_modules/gltfpack/cli.js');
const FLAGS = ['-cc', '-ce', 'ext', '-vp', '16', '-kn', '-ke'];
const LAYERS = ['skin', 'muscle', 'bone', 'ligament', 'organ', 'vessel', 'nerve'];
const DATA_FILES = ['points.json', 'points.csv', 'meridians.json', 'rulers.json', 'manifest.json'];
const MAX_ERR_MM = 0.1;
const VERSION = 'prepare/3';
const rel = (p) => path.relative(REPO, p).split(path.sep).join('/');

const inputs = [
  ...LAYERS.map((l) => ({ id: l, src: path.join(DATA, 'body', `${l}.glb`) })),
  { id: 'garment', src: path.join(SITE, 'display/garment.glb') },
];
const sha = (b) => createHash('sha256').update(b).digest('hex');
const kb = (b) => `${(b / 1024).toFixed(0)} KB`;

async function stamp() {
  const h = createHash('sha256').update(VERSION + FLAGS.join(' '));
  for (const f of [...inputs.map((i) => i.src), ...DATA_FILES.map((f) => path.join(DATA, f))]) h.update(await fs.readFile(f));
  h.update(await fs.readFile(fileURLToPath(import.meta.url)));
  return h.digest('hex');
}

async function pool(items, n, fn) {
  const res = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; res[i] = await fn(items[i], i); }
  }));
  return res;
}

class PointGrid {
  constructor(V, cell = 0.5) {
    this.V = V; this.c = cell; this.m = new Map();
    for (let i = 0; i < V.length / 3; i++) {
      const k = this.key(V[i * 3], V[i * 3 + 1], V[i * 3 + 2]); let a = this.m.get(k); if (!a) this.m.set(k, (a = [])); a.push(i);
    }
  }
  key(x, y, z) { return `${Math.floor(x / this.c)},${Math.floor(y / this.c)},${Math.floor(z / this.c)}`; }
  nearest(x, y, z) {
    const c = this.c, i0 = Math.floor(x / c), j0 = Math.floor(y / c), k0 = Math.floor(z / c); let best = Infinity;
    for (let i = i0 - 1; i <= i0 + 1; i++) for (let j = j0 - 1; j <= j0 + 1; j++) for (let k = k0 - 1; k <= k0 + 1; k++) {
      const a = this.m.get(`${i},${j},${k}`); if (!a) continue;
      for (const v of a) { const d = Math.hypot(this.V[v * 3] - x, this.V[v * 3 + 1] - y, this.V[v * 3 + 2] - z); if (d < best) best = d; }
    }
    return best;
  }
}

// compressed vs original: same node names, every original vertex has a compressed vertex within MAX_ERR_MM
function compareMeshes(orig, comp, id) {
  const a = new Map(orig.meshes.map((m) => [m.name, m])); const b = new Map(comp.meshes.map((m) => [m.name, m]));
  const missing = [...a.keys()].filter((k) => !b.has(k));
  if (missing.length || a.size !== b.size) throw new Error(`${id}: node names changed (${missing.slice(0, 5).join(', ')})`);
  // gltfpack drops degenerate triangles and unused vertices: compare the vertices of non-degenerate triangles
  let max = 0;
  for (const [name, m] of a) {
    const g = new PointGrid(b.get(name).V); const V = m.V, F = m.F; const used = new Uint8Array(V.length / 3);
    for (let t = 0; t < F.length; t += 3) {
      const i = F[t] * 3, j = F[t + 1] * 3, k = F[t + 2] * 3;
      const ux = V[j] - V[i], uy = V[j + 1] - V[i + 1], uz = V[j + 2] - V[i + 2], vx = V[k] - V[i], vy = V[k + 1] - V[i + 1], vz = V[k + 2] - V[i + 2];
      if (Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) > 1e-9) used[F[t]] = used[F[t + 1]] = used[F[t + 2]] = 1;
    }
    for (let v = 0; v < used.length; v++) {
      if (!used[v]) continue;
      const d = g.nearest(V[v * 3], V[v * 3 + 1], V[v * 3 + 2]); if (d > max) max = d;
    }
  }
  if (!(max < MAX_ERR_MM)) throw new Error(`${id}: vertex error ${max} mm >= ${MAX_ERR_MM} mm`);
  return max;
}

// gltfpack drops asset.copyright: put the attribution of the source file back (JSON chunk only, geometry untouched)
async function keepCopyright(src, out) {
  const json = (b) => JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString('utf8'));
  const s = json(await fs.readFile(src)); const b = await fs.readFile(out); const j = json(b);
  if (!s.asset?.copyright) return;
  j.asset.copyright = s.asset.copyright;
  let js = Buffer.from(JSON.stringify(j), 'utf8'); js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
  const rest = b.subarray(20 + b.readUInt32LE(12));
  const head = Buffer.alloc(20); head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4);
  head.writeUInt32LE(20 + js.length + rest.length, 8); head.writeUInt32LE(js.length, 12); head.writeUInt32LE(0x4e4f534a, 16);
  await fs.writeFile(out, Buffer.concat([head, js, rest]));
}

async function main() {
  const t0 = Date.now();
  const ifMissing = process.argv.includes('--if-missing');
  const st = await stamp();
  const stampFile = path.join(OUT_BODY, '.stamp');
  if (ifMissing) {
    const old = await fs.readFile(stampFile, 'utf8').catch(() => '');
    const have = await Promise.all([...inputs.map((i) => path.join(OUT_BODY, `${i.id}.glb`)), path.join(OUT_BODY, 'index.json'),
      path.join(OUT_BODY, 'lift.json'), ...DATA_FILES.map((f) => path.join(OUT_DATA, f))].map((f) => fs.stat(f).then(() => true, () => false)));
    if (old.trim() === st && have.every(Boolean)) { console.log('prepare: assets up to date'); return; }
  }
  const { stdout: ver } = await run(process.execPath, [GLTFPACK, '-v']).catch((e) => ({ stdout: String(e.stdout || '') }));
  const gltfpackVersion = (ver.match(/gltfpack\s+([\d.]+)/) || [])[1] || 'unknown';
  console.log(`prepare: gltfpack ${gltfpackVersion} ${FLAGS.join(' ')}`);
  await fs.rm(OUT_BODY, { recursive: true, force: true });
  await fs.rm(OUT_DATA, { recursive: true, force: true });
  await fs.mkdir(OUT_BODY, { recursive: true });
  await fs.mkdir(OUT_DATA, { recursive: true });

  // 1. compress
  const jobs = Math.max(2, Math.min(4, os.cpus().length - 1));
  await pool(inputs, jobs, async (inp) => {
    const out = path.join(OUT_BODY, `${inp.id}.glb`);
    await run(process.execPath, [GLTFPACK, '-i', inp.src, '-o', out, ...FLAGS], { maxBuffer: 1 << 24 });
    await keepCopyright(inp.src, out);
  });

  // 2. verify
  const layers = {};
  let skinOrig = null, skinComp = null;
  for (const inp of inputs) {
    const ob = await fs.readFile(inp.src); const cb = await fs.readFile(path.join(OUT_BODY, `${inp.id}.glb`));
    const o = await readGlb(ob); const c = await readGlb(cb);
    const err = compareMeshes(o, c, inp.id);
    let tris = 0, verts = 0; for (const m of o.meshes) { tris += m.F.length / 3; verts += m.V.length / 3; }
    layers[inp.id] = { file: `body/${inp.id}.glb`, bytes: cb.length, source_bytes: ob.length, nodes: o.meshes.length, vertices: verts,
      triangles: tris, max_vertex_error_mm: +err.toFixed(4) };
    if (inp.id === 'skin') { skinOrig = o; skinComp = c; }
    console.log(`  ${inp.id.padEnd(8)} ${kb(ob.length).padStart(9)} -> ${kb(cb.length).padStart(8)}  ${String(o.meshes.length).padStart(4)} nodes  max vertex error ${err.toFixed(4)} mm`);
  }

  const points = JSON.parse(await fs.readFile(path.join(DATA, 'points.json'), 'utf8')).points;
  const so = merge(skinOrig.meshes), sc = merge(skinComp.meshes);
  const gridO = new TriGrid(so.V, so.F, 8), gridC = new TriGrid(sc.V, sc.F, 8);
  let maxO = 0, maxC = 0, sumC = 0;
  for (const p of points) {
    const a = gridO.closest(p.pos, 4), b = gridC.closest(p.pos, 4);
    if (!a || !b) throw new Error(`${p.id}: no skin within 4 mm`);
    maxO = Math.max(maxO, a.d); maxC = Math.max(maxC, b.d); sumC += b.d;
  }
  if (!(maxC < MAX_ERR_MM)) throw new Error(`point to compressed skin ${maxC} mm >= ${MAX_ERR_MM} mm`);
  console.log(`  points -> skin surface: original max ${maxO.toFixed(4)} mm; compressed max ${maxC.toFixed(4)} mm, mean ${(sumC / points.length).toFixed(4)} mm (${points.length} points)`);

  // 3. points and meridian samples under the display garment -> outer garment surface (display only)
  const garment = merge((await readGlb(await fs.readFile(path.join(SITE, 'display/garment.glb')))).meshes);
  const gGrid = new TriGrid(garment.V, garment.F, 8);
  const gb = { lo: [Infinity, Infinity, Infinity], hi: [-Infinity, -Infinity, -Infinity] };
  for (let i = 0; i < garment.V.length; i += 3) for (let c = 0; c < 3; c++) {
    gb.lo[c] = Math.min(gb.lo[c], garment.V[i + c]); gb.hi[c] = Math.max(gb.hi[c], garment.V[i + c]);
  }
  const inBox = (p, m) => p.every((v, c) => v >= gb.lo[c] - m && v <= gb.hi[c] + m);
  const REACH = 30, OUT = 0.9;
  function lift(p) {
    if (!inBox(p, 2)) return null;
    const near = gridO.closest(p, 4); if (!near) return null;
    const n = gridO.normal(near.t);
    const o = [p[0] - n[0] * 0.5, p[1] - n[1] * 0.5, p[2] - n[2] * 0.5];
    let d = n, hs = gGrid.hits(o, n, REACH);
    // in the crotch the skin normal runs sideways along the crease (CV1): cast downward onto the garment instead
    if (!hs.length && Math.abs(p[0]) < 40 && p[1] < 800) { d = [0, -1, 0]; hs = gGrid.hits(p, d, REACH); o[0] = p[0]; o[1] = p[1]; o[2] = p[2]; }
    if (!hs.length) return null;
    const s = Math.max(...hs) + OUT;
    return [o[0] + d[0] * s, o[1] + d[1] * s, o[2] + d[2] * s].map((v) => +v.toFixed(2));
  }
  const liftedPoints = {};
  for (const p of points) { const q = lift(p.pos); if (q) liftedPoints[p.id] = q; }
  const meridians = JSON.parse(await fs.readFile(path.join(DATA, 'meridians.json'), 'utf8')).meridians;
  const liftedLines = {}; let nSamples = 0;
  for (const [m, mer] of Object.entries(meridians)) {
    for (const [side, segs] of Object.entries(mer.lines)) {
      segs.forEach((seg, si) => {
        const rows = [];
        seg.points.forEach((q, k) => { const r = lift(q); if (r) rows.push([k, ...r]); });
        if (rows.length) { ((liftedLines[m] ||= {})[side] ||= {})[si] = rows; nSamples += rows.length; }
      });
    }
  }
  const moved = Object.entries(liftedPoints).map(([id, q]) => {
    const p = points.find((x) => x.id === id).pos; return Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
  });
  console.log(`  garment: ${Object.keys(liftedPoints).length} points and ${nSamples} line samples shown on its surface (max offset ${Math.max(...moved).toFixed(1)} mm)`);
  await fs.writeFile(path.join(OUT_BODY, 'lift.json'), JSON.stringify({
    description: 'Display only: points and meridian samples covered by the display garment, moved outward along the skin normal onto the outer garment surface. Coordinates in data/ are unchanged.',
    points: liftedPoints, lines: liftedLines,
  }));

  // 4. data copies
  for (const f of DATA_FILES) await fs.copyFile(path.join(DATA, f), path.join(OUT_DATA, f));

  await fs.writeFile(path.join(OUT_BODY, 'index.json'), JSON.stringify({
    gltfpack: gltfpackVersion, flags: FLAGS.join(' '), layers,
    check: { points: points.length, point_to_skin_max_mm: +maxC.toFixed(4), point_to_skin_mean_mm: +(sumC / points.length).toFixed(4) },
  }, null, 1));
  await fs.writeFile(stampFile, st);
  const total = Object.values(layers).reduce((s, l) => s + l.bytes, 0);
  console.log(`prepare: ${rel(OUT_BODY)} ${kb(total)} in total, done in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

main().catch((e) => { console.error(`prepare failed: ${e.message}`); process.exit(1); });
