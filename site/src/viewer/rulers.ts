import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { Atlas, Ruler, Vec3 } from '../data';
import { PointCloud } from './points';

// The 31 instances of the 27 proportional bone measurements: dashed segments between the two ends, drawn twice
// (crisp where visible, faint where the body hides them), with ring markers at the ends and a cun label each.
export interface RulerLabel { ruler: Ruler; a: THREE.Vector3; b: THREE.Vector3; mid: THREE.Vector3; out: THREE.Vector3; el?: HTMLElement }

export class RulerSet {
  readonly group = new THREE.Group();
  readonly labels: RulerLabel[] = [];
  readonly ends: PointCloud;
  private mats: LineMaterial[] = [];

  constructor(atlas: Atlas, ink: string) {
    const pos: number[] = [];
    const endPos: number[] = [];
    const center = new THREE.Vector3(0, 0, 0);
    for (const r of atlas.rulers.rulers) {
      for (const inst of r.instances) {
        pos.push(...inst.a, ...inst.b);
        endPos.push(...inst.a, ...inst.b);
        const a = new THREE.Vector3(...(inst.a as Vec3)), b = new THREE.Vector3(...(inst.b as Vec3));
        const mid = a.clone().add(b).multiplyScalar(0.5);
        center.set(0, mid.y, 0);
        const out = mid.clone().sub(center); out.y = 0;
        if (out.lengthSq() < 1) out.set(0, 0, 1);
        this.labels.push({ ruler: r, a, b, mid, out: out.normalize() });
      }
    }
    const mk = (opacity: number, depthTest: boolean) => {
      const geo = new LineSegmentsGeometry(); geo.setPositions(pos);
      const mat = new LineMaterial({ color: new THREE.Color(ink), linewidth: 1.4, worldUnits: false, dashed: true, dashSize: 7, gapSize: 4.5, transparent: opacity < 1, opacity, depthTest, depthWrite: false });
      const l = new LineSegments2(geo, mat); l.computeLineDistances(); l.renderOrder = depthTest ? 4 : 5; l.frustumCulled = false;
      this.mats.push(mat); this.group.add(l);
    };
    mk(1, true);
    mk(0.28, false);
    const col = new THREE.Color(ink);
    const cols = new Float32Array(endPos.length); for (let i = 0; i < cols.length; i += 3) cols.set([col.r, col.g, col.b], i);
    this.ends = new PointCloud(new Float32Array(endPos), cols, { worldMm: 4.5, minPx: 7, maxPx: 14, lift: 2, style: 1 });
    this.ends.mesh.renderOrder = 4;
    this.group.add(this.ends.mesh);
    this.group.visible = false;
  }
  setInk(c: string) {
    for (const m of this.mats) m.color.set(c);
    const col = new THREE.Color(c);
    for (let i = 0; i < this.ends.count; i++) this.ends.setColor(i, col);
  }
  setResolution(w: number, h: number, dpr: number) { for (const m of this.mats) { m.resolution.set(w, h); m.linewidth = 1.4 * dpr; } }
}
