import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { Atlas } from '../data';
import { MERIDIANS } from '../palette';

interface Item { line: LineSegments2; mat: LineMaterial; raw: Float32Array; lifted: Float32Array; base: THREE.Color; state: number }

// One screen-space line object per meridian (both sides, all segments). Two position sets: on the skin, and with
// the samples under the display garment moved onto its surface.
export class MeridianLines {
  readonly group = new THREE.Group();
  readonly items = new Map<string, Item>();
  private width = 1.6;
  private dpr = 1;

  constructor(atlas: Atlas) {
    for (const m of MERIDIANS) {
      const mer = atlas.meridians.meridians[m.code]; if (!mer) continue;
      const raw: number[] = [], lifted: number[] = [];
      for (const [side, segs] of Object.entries(mer.lines)) {
        segs.forEach((seg, si) => {
          const lift = new Map((atlas.lift.lines[m.code]?.[side]?.[si] || []).map((r) => [r[0], [r[1], r[2], r[3]]]));
          const P = seg.points;
          for (let k = 0; k + 1 < P.length; k++) {
            raw.push(...P[k], ...P[k + 1]);
            lifted.push(...(lift.get(k) || P[k]), ...(lift.get(k + 1) || P[k + 1]));
          }
        });
      }
      const geo = new LineSegmentsGeometry();
      geo.setPositions(raw);
      const base = new THREE.Color(m.color);
      // no alpha-to-coverage: overlapping round caps of consecutive segments would leave light seams
      const mat = new LineMaterial({ color: base.clone(), linewidth: this.width, worldUnits: false });
      mat.polygonOffset = true; mat.polygonOffsetFactor = -2; mat.polygonOffsetUnits = -6;
      const line = new LineSegments2(geo, mat);
      line.renderOrder = 2;
      line.frustumCulled = false;
      this.group.add(line);
      this.items.set(m.code, { line, mat, raw: new Float32Array(raw), lifted: new Float32Array(lifted), base, state: 1 });
    }
  }
  setLifted(on: boolean) {
    for (const it of this.items.values()) (it.line.geometry as LineSegmentsGeometry).setPositions(on ? it.lifted : it.raw);
  }
  setResolution(w: number, h: number, dpr: number) {
    this.dpr = dpr;
    for (const it of this.items.values()) { it.mat.resolution.set(w, h); this.applyWidth(it); }
  }
  setWidth(px: number) { this.width = px; for (const it of this.items.values()) this.applyWidth(it); }
  private applyWidth(it: Item) {
    const k = it.state === 2 ? 1.7 : it.state === 0.5 ? 0.75 : 1;
    it.mat.linewidth = this.width * k * this.dpr;
  }
  // 1 normal, 0.5 dimmed, 2 emphasised, 0 hidden
  setState(code: string, s: number, dimColor: THREE.Color) {
    const it = this.items.get(code); if (!it) return;
    it.state = s;
    it.line.visible = s > 0;
    it.mat.color.copy(it.base);
    if (s === 0.5) it.mat.color.lerp(dimColor, 0.75);
    this.applyWidth(it);
  }
}
