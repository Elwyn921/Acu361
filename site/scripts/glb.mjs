// Minimal glTF 2.0 binary reader for the build scripts: JSON + BIN chunks, EXT_meshopt_compression buffer views,
// quantized / normalized accessors and node transforms. Returns world-space float positions and triangle indices.
import { MeshoptDecoder } from 'meshoptimizer';

export async function readGlb(buf) {
  await MeshoptDecoder.ready;
  const u8 = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB file');
  const jsonLen = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(u8.subarray(20, 20 + jsonLen)));
  const binStart = 20 + jsonLen;
  const binLen = binStart < u8.length ? dv.getUint32(binStart, true) : 0;
  const bin = u8.subarray(binStart + 8, binStart + 8 + binLen);
  const views = new Map();

  function view(i) {
    if (views.has(i)) return views.get(i);
    const bv = json.bufferViews[i];
    const ext = bv.extensions?.EXT_meshopt_compression || bv.extensions?.KHR_meshopt_compression;
    let out;
    if (ext) {
      const src = bin.subarray(ext.byteOffset || 0, (ext.byteOffset || 0) + ext.byteLength);
      out = new Uint8Array(ext.count * ext.byteStride);
      MeshoptDecoder.decodeGltfBuffer(out, ext.count, ext.byteStride, src, ext.mode, ext.filter || 'NONE');
    } else {
      out = bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
    }
    const rec = { bytes: out, stride: bv.byteStride || 0 };
    views.set(i, rec);
    return rec;
  }

  const SIZE = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
  const NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
  function accessor(i) {
    const a = json.accessors[i];
    const { bytes, stride } = view(a.bufferView);
    const nc = NC[a.type]; const cs = SIZE[a.componentType];
    const st = stride || nc * cs;
    const d = new DataView(bytes.buffer, bytes.byteOffset + (a.byteOffset || 0));
    const out = new Float64Array(a.count * nc);
    const rd = {
      5120: (o) => d.getInt8(o), 5121: (o) => d.getUint8(o), 5122: (o) => d.getInt16(o, true),
      5123: (o) => d.getUint16(o, true), 5125: (o) => d.getUint32(o, true), 5126: (o) => d.getFloat32(o, true),
    }[a.componentType];
    const norm = a.normalized ? { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 }[a.componentType] : 0;
    for (let k = 0; k < a.count; k++) {
      for (let c = 0; c < nc; c++) {
        let v = rd(k * st + c * cs);
        if (norm) v = a.componentType === 5120 || a.componentType === 5122 ? Math.max(v / norm, -1) : v / norm;
        out[k * nc + c] = v;
      }
    }
    return out;
  }

  // world matrices (column-major 4x4)
  const mul = (a, b) => {
    const o = new Array(16).fill(0);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
    return o;
  };
  const local = (n) => {
    if (n.matrix) return n.matrix.slice();
    const [tx, ty, tz] = n.translation || [0, 0, 0];
    const [x, y, z, w] = n.rotation || [0, 0, 0, 1];
    const [sx, sy, sz] = n.scale || [1, 1, 1];
    return [
      (1 - 2 * (y * y + z * z)) * sx, (2 * (x * y + z * w)) * sx, (2 * (x * z - y * w)) * sx, 0,
      (2 * (x * y - z * w)) * sy, (1 - 2 * (x * x + z * z)) * sy, (2 * (y * z + x * w)) * sy, 0,
      (2 * (x * z + y * w)) * sz, (2 * (y * z - x * w)) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
      tx, ty, tz, 1,
    ];
  };
  const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  // gltfpack moves a mesh to an unnamed child of its named node: a mesh takes the name and extras of the nearest named node
  const world = new Map(), owner = new Map();
  const walk = (i, parent, named) => {
    const n = json.nodes[i]; const m = mul(parent, local(n)); world.set(i, m);
    const own = n.name !== undefined ? n : named; owner.set(i, own);
    for (const c of n.children || []) walk(c, m, own);
  };
  const roots = json.scenes?.[json.scene || 0]?.nodes || json.nodes.map((_, i) => i);
  for (const r of roots) walk(r, I, null);

  const meshes = [];
  json.nodes.forEach((n, i) => {
    if (n.mesh === undefined) return;
    const m = world.get(i) || I;
    for (const pr of json.meshes[n.mesh].primitives) {
      const P = accessor(pr.attributes.POSITION);
      const V = new Float64Array(P.length);
      for (let k = 0; k < P.length; k += 3) {
        const x = P[k], y = P[k + 1], z = P[k + 2];
        V[k] = m[0] * x + m[4] * y + m[8] * z + m[12];
        V[k + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
        V[k + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
      }
      const F = pr.indices !== undefined ? Uint32Array.from(accessor(pr.indices)) : Uint32Array.from({ length: V.length / 3 }, (_, k) => k);
      const own = owner.get(i) || n;
      meshes.push({ name: own.name, extras: own.extras, V, F });
    }
  });
  return { json, meshes };
}

// Uniform grid over triangles for closest-point and short ray queries.
export class TriGrid {
  constructor(V, F, cell = 8) {
    this.V = V; this.F = F; this.cell = cell; this.map = new Map();
    for (let t = 0; t < F.length / 3; t++) {
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (let j = 0; j < 3; j++) for (let c = 0; c < 3; c++) {
        const v = V[F[t * 3 + j] * 3 + c]; if (v < lo[c]) lo[c] = v; if (v > hi[c]) hi[c] = v;
      }
      this.#each(lo, hi, (k) => { let a = this.map.get(k); if (!a) this.map.set(k, (a = [])); a.push(t); });
    }
  }
  #each(lo, hi, fn) {
    const c = this.cell;
    for (let i = Math.floor(lo[0] / c); i <= Math.floor(hi[0] / c); i++)
      for (let j = Math.floor(lo[1] / c); j <= Math.floor(hi[1] / c); j++)
        for (let k = Math.floor(lo[2] / c); k <= Math.floor(hi[2] / c); k++) fn(`${i},${j},${k}`);
  }
  candidates(lo, hi) {
    const s = new Set();
    this.#each(lo, hi, (k) => { const a = this.map.get(k); if (a) for (const t of a) s.add(t); });
    return s;
  }
  tri(t) {
    const { V, F } = this; const a = F[t * 3] * 3, b = F[t * 3 + 1] * 3, c = F[t * 3 + 2] * 3;
    return [[V[a], V[a + 1], V[a + 2]], [V[b], V[b + 1], V[b + 2]], [V[c], V[c + 1], V[c + 2]]];
  }
  // closest point within radius r (mm); returns { d, t, q } or null
  closest(p, r = 3) {
    let best = null;
    for (const t of this.candidates([p[0] - r, p[1] - r, p[2] - r], [p[0] + r, p[1] + r, p[2] + r])) {
      const q = closestOnTri(p, ...this.tri(t)); const d = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
      if (Number.isFinite(d) && (!best || d < best.d)) best = { d, t, q };
    }
    return best;
  }
  normal(t) {
    const [a, b, c] = this.tri(t);
    const u = sub(b, a), v = sub(c, a);
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const l = Math.hypot(...n) || 1; return [n[0] / l, n[1] / l, n[2] / l];
  }
  // all hits of the segment o + s*d, s in [0, len]
  hits(o, d, len) {
    const e = [o[0] + d[0] * len, o[1] + d[1] * len, o[2] + d[2] * len];
    const lo = [Math.min(o[0], e[0]), Math.min(o[1], e[1]), Math.min(o[2], e[2])];
    const hi = [Math.max(o[0], e[0]), Math.max(o[1], e[1]), Math.max(o[2], e[2])];
    const out = [];
    for (const t of this.candidates(lo, hi)) {
      const s = rayTri(o, d, ...this.tri(t)); if (s !== null && s >= 0 && s <= len) out.push(s);
    }
    return out;
  }
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

function rayTri(o, d, a, b, c) {
  const e1 = sub(b, a), e2 = sub(c, a), p = cross(d, e2), det = dot(e1, p);
  if (Math.abs(det) < 1e-12) return null;
  const inv = 1 / det, tv = sub(o, a), u = dot(tv, p) * inv;
  if (u < 0 || u > 1) return null;
  const q = cross(tv, e1), v = dot(d, q) * inv;
  if (v < 0 || u + v > 1) return null;
  return dot(e2, q) * inv;
}

// Ericson, Real-Time Collision Detection 5.1.5
export function closestOnTri(p, a, b, c) {
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return a;
  const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return [a[0] + v * ab[0], a[1] + v * ab[1], a[2] + v * ab[2]]; }
  const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return [a[0] + w * ac[0], a[1] + w * ac[1], a[2] + w * ac[2]]; }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6)); return [b[0] + w * (c[0] - b[0]), b[1] + w * (c[1] - b[1]), b[2] + w * (c[2] - b[2])];
  }
  const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
  return [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w];
}

export function merge(meshes) {
  let nv = 0, nf = 0; for (const m of meshes) { nv += m.V.length; nf += m.F.length; }
  const V = new Float64Array(nv), F = new Uint32Array(nf); let ov = 0, of = 0;
  for (const m of meshes) { V.set(m.V, ov); for (let k = 0; k < m.F.length; k++) F[of + k] = m.F[k] + ov / 3; ov += m.V.length; of += m.F.length; }
  return { V, F };
}
