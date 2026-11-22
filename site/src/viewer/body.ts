import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { url, type BodyIndex } from '../data';
import { LAYERS, LAYER, GARMENT_COLOR, type LayerId } from '../palette';

// Display choices of the site (the files in data/ are not changed):
//  - a lab-made garment covers the pelvis; skin triangles of the external genitalia under it are not drawn;
//  - external genital organs and their vessels in the inner layers are not drawn.
const HIDDEN = new Set([
  'Corpus cavernosum of penis', 'Corpus spongiosum of penis', 'Glans penis', 'Testis.l', 'Testis.r', 'Epididymis.l', 'Epididymis.r',
  'Deep artery of penis.l', 'Deep artery of penis.r', 'Dorsal artery of penis.l', 'Dorsal artery of penis.r',
  'Deep dorsal vein of penis', 'Superficial dorsal veins of penis', 'Urethra', 'Ductus deferens.l', 'Ductus deferens.r',
  'External pudendal veins.l', 'External pudendal veins.r', 'Superficial external pudendal artery.l', 'Superficial external pudendal artery.r',
  'Right testicular artery.r', 'Left testicular artery', 'Right testicular vein', 'Left testicular vein',
  'Genital branch of genitofemoral nerve.l', 'Genital branch of genitofemoral nerve.r',
]);
// GLTFLoader sanitizes node names (spaces -> "_", ".:/[]" removed); compare in that form
const HIDDEN_NODES = new Set([...HIDDEN].map((n) => THREE.PropertyBinding.sanitizeNodeName(n)));
const COVERED = { x: [-35, 35], y: [720, 840], z: [-3, 115] }; // under the garment

export type LayerState = 'idle' | 'loading' | 'ready' | 'error';
interface Layer { id: LayerId; group: THREE.Group; state: LayerState; progress: number; wanted: boolean; promise?: Promise<void> }

let loader: GLTFLoader | null = null;
function gltfLoader() {
  if (!loader) { loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder); }
  return loader;
}

async function fetchWithProgress(path: string, expected: number, onProgress: (f: number) => void): Promise<ArrayBuffer> {
  const r = await fetch(url(path));
  if (!r.ok || !r.body) throw new Error(`${path}: HTTP ${r.status}`);
  const total = Number(r.headers.get('content-length')) || expected;
  const reader = r.body.getReader(); const chunks: Uint8Array[] = []; let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); got += value.length; onProgress(Math.min(0.99, got / Math.max(total, got)));
  }
  const out = new Uint8Array(got); let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  onProgress(1);
  return out.buffer;
}

export class Body {
  readonly group = new THREE.Group();
  readonly layers = new Map<LayerId, Layer>();
  readonly materials = new Map<LayerId, THREE.MeshStandardMaterial>();
  readonly garmentMaterial: THREE.MeshStandardMaterial;
  garment: THREE.Group | null = null;
  skinMesh: THREE.Mesh | null = null;
  skinOpacity = 1;
  // world-space skin vertices and normals (for the camera direction when flying to a point)
  skinV: Float32Array | null = null;
  skinN: Float32Array | null = null;
  private prepass: THREE.Mesh[] = [];
  private depthMat = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide });
  onChange: () => void = () => {};
  onProgress: (id: LayerId, f: number, state: LayerState) => void = () => {};

  constructor(private index: BodyIndex) {
    for (const l of LAYERS) {
      const m = l.id === 'skin'
        ? new THREE.MeshPhysicalMaterial({ color: l.color, roughness: l.roughness, metalness: 0, sheen: 0.5, sheenRoughness: 0.7, sheenColor: new THREE.Color('#fff4e6'), side: THREE.DoubleSide })
        : new THREE.MeshStandardMaterial({ color: l.color, roughness: l.roughness, metalness: 0, side: THREE.DoubleSide });
      this.materials.set(l.id, m);
      const group = new THREE.Group(); group.name = l.id; group.visible = false;
      this.group.add(group);
      this.layers.set(l.id, { id: l.id, group, state: 'idle', progress: 0, wanted: false });
    }
    this.garmentMaterial = new THREE.MeshPhysicalMaterial({ color: GARMENT_COLOR, roughness: 0.92, metalness: 0, sheen: 0.6, sheenRoughness: 0.5, sheenColor: new THREE.Color('#ffffff'), side: THREE.DoubleSide });
  }

  setLayerColor(id: LayerId, c: string) { this.materials.get(id)?.color.set(c); }

  async load(id: LayerId): Promise<void> {
    const L = this.layers.get(id)!;
    if (L.state === 'ready') return;
    if (L.promise) return L.promise;
    L.state = 'loading'; this.onProgress(id, 0, 'loading');
    L.promise = (async () => {
      try {
        const info = this.index.layers[id];
        const buf = await fetchWithProgress(info.file, info.bytes, (f) => { L.progress = f; this.onProgress(id, f, 'loading'); });
        const gltf = await gltfLoader().parseAsync(buf, '');
        const root = gltf.scene;
        root.updateMatrixWorld(true);
        const mat = this.materials.get(id)!;
        const meshes: THREE.Mesh[] = [];
        root.traverse((o) => {
          if (HIDDEN_NODES.has(o.name)) o.visible = false;
          const m = o as THREE.Mesh;
          if (m.isMesh) { m.material = mat; m.renderOrder = id === 'skin' ? 1 : 0; meshes.push(m); }
        });
        if (id === 'skin' && meshes[0]) this.prepareSkin(meshes[0]);
        L.group.add(root);
        L.state = 'ready'; this.onProgress(id, 1, 'ready');
        if (id === 'skin') await this.loadGarment();
        this.applyVisibility();
      } catch (e) {
        L.state = 'error'; L.promise = undefined; this.onProgress(id, 0, 'error');
        throw e;
      }
    })();
    return L.promise;
  }

  private async loadGarment() {
    const info = this.index.layers.garment;
    const buf = await fetchWithProgress(info.file, info.bytes, () => {});
    const gltf = await gltfLoader().parseAsync(buf, '');
    gltf.scene.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.material = this.garmentMaterial; m.renderOrder = 1; } });
    this.garment = gltf.scene;
    this.group.add(gltf.scene);
    this.makePrepass();
  }

  // drop the skin triangles under the garment that belong to the external genitalia; keep world positions / normals
  private prepareSkin(mesh: THREE.Mesh) {
    this.skinMesh = mesh;
    const g = mesh.geometry; const P = g.getAttribute('position'); const N = g.getAttribute('normal');
    const M = mesh.matrixWorld; const nm = new THREE.Matrix3().getNormalMatrix(M);
    const V = new Float32Array(P.count * 3), NN = new Float32Array(P.count * 3);
    const v = new THREE.Vector3(), n = new THREE.Vector3();
    const inside = new Uint8Array(P.count);
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i).applyMatrix4(M); V.set([v.x, v.y, v.z], i * 3);
      if (N) { n.fromBufferAttribute(N, i).applyMatrix3(nm).normalize(); NN.set([n.x, n.y, n.z], i * 3); }
      inside[i] = +(v.x > COVERED.x[0] && v.x < COVERED.x[1] && v.y > COVERED.y[0] && v.y < COVERED.y[1] && v.z > COVERED.z[0] && v.z < COVERED.z[1]);
    }
    this.skinV = V; this.skinN = NN;
    const idx = g.getIndex();
    if (idx) {
      const keep: number[] = [];
      for (let t = 0; t < idx.count; t += 3) {
        const a = idx.getX(t), b = idx.getX(t + 1), c = idx.getX(t + 2);
        if (!inside[a] && !inside[b] && !inside[c]) keep.push(a, b, c);
      }
      g.setIndex(keep);
    }
  }

  // depth prepass copies so that a translucent skin / garment blends only its nearest surface
  private makePrepass() {
    for (const p of this.prepass) p.removeFromParent();
    this.prepass = [];
    const add = (m: THREE.Mesh) => {
      const c = new THREE.Mesh(m.geometry, this.depthMat);
      c.renderOrder = 0.5; c.matrixAutoUpdate = false; c.matrix.copy(m.matrixWorld); c.visible = false;
      this.group.add(c); this.prepass.push(c);
    };
    if (this.skinMesh) add(this.skinMesh);
    this.garment?.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.updateMatrixWorld(true); add(o as THREE.Mesh); } });
  }

  want(id: LayerId, on: boolean) {
    const L = this.layers.get(id)!; L.wanted = on;
    if (on && L.state !== 'ready') this.load(id).catch(() => {});
    this.applyVisibility();
  }
  isWanted(id: LayerId) { return this.layers.get(id)!.wanted; }

  setSkinOpacity(a: number) { this.skinOpacity = a; this.applyVisibility(); }

  get skinShown() { const s = this.layers.get('skin')!; return s.wanted && s.state === 'ready' && this.skinOpacity > 0.02; }

  applyVisibility() {
    for (const L of this.layers.values()) L.group.visible = L.wanted && L.state === 'ready' && (L.id !== 'skin' || this.skinOpacity > 0.02);
    const shown = this.skinShown;
    const a = this.skinOpacity, translucent = a < 0.999;
    for (const m of [this.materials.get('skin')!, this.garmentMaterial]) {
      m.transparent = translucent; m.opacity = a; m.depthWrite = !translucent; m.depthFunc = translucent ? THREE.LessEqualDepth : THREE.LessEqualDepth;
      m.needsUpdate = true;
    }
    if (this.garment) this.garment.visible = shown;
    for (const p of this.prepass) p.visible = shown && translucent;
    this.onChange();
  }

  // nearest skin vertex normal (world)
  normalAt(p: THREE.Vector3): THREE.Vector3 | null {
    const V = this.skinV, N = this.skinN; if (!V || !N) return null;
    let best = Infinity, bi = -1;
    for (let i = 0; i < V.length; i += 3) {
      const dx = V[i] - p.x, dy = V[i + 1] - p.y, dz = V[i + 2] - p.z; const d = dx * dx + dy * dy + dz * dz;
      if (d < best) { best = d; bi = i; }
    }
    if (bi < 0 || best > 900) return null;
    return new THREE.Vector3(N[bi], N[bi + 1], N[bi + 2]).normalize();
  }

  // the layers whose surfaces can hide a point (for picking)
  occluders(): THREE.Object3D[] {
    if (this.skinShown) return [this.layers.get('skin')!.group, ...(this.garment ? [this.garment] : [])];
    return [...this.layers.values()].filter((l) => l.group.visible).map((l) => l.group);
  }
  static layerOf(id: string) { return LAYER.get(id as LayerId); }
}
