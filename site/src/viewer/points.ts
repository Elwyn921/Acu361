import * as THREE from 'three';

// Acupoints as camera-facing enamel discs. Size follows the world size of a ~5 mm disc, clamped to a pixel range, so
// points stay legible from the full body down to a hand. Drawn opaque with alpha-to-coverage (order independent);
// a second material writes point ids for GPU picking.

const VERT = /* glsl */ `
attribute vec3 iPos;
attribute vec3 iColor;
attribute float iSize;
attribute float iFlag;
attribute float iId;
uniform float uWorld;
uniform float uMinPx;
uniform float uMaxPx;
uniform float uProjScale;
uniform vec2 uPxToNdc;
uniform float uLift;
uniform float uPick;
varying vec2 vUv;
varying vec3 vColor;
varying float vFlag;
varying float vPx;
varying float vId;
void main() {
  vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
  bool ortho = projectionMatrix[2][3] == 0.0;
  vec3 toCam = ortho ? vec3(0.0, 0.0, 1.0) : normalize(-mv.xyz);
  mv.xyz += toCam * uLift;
  vec4 clip = projectionMatrix * mv;
  float w = ortho ? 1.0 : -mv.z;
  float px = clamp(uWorld * uProjScale / w, uMinPx, uMaxPx) * iSize;
  if (iFlag > 0.5 && iFlag < 1.5) px *= 1.9;
  if (uPick > 0.5) px = max(px * 1.4, uMinPx * 2.4) * step(0.001, iSize);
  vPx = px;
  vUv = position.xy * 2.0;
  vColor = iColor;
  vFlag = iFlag;
  vId = iId;
  clip.xy += position.xy * px * uPxToNdc * clip.w;
  gl_Position = clip;
}`;

const FRAG = /* glsl */ `
uniform vec3 uRim;
uniform vec3 uInk;
uniform vec3 uRing;
uniform float uStyle;
varying vec2 vUv;
varying vec3 vColor;
varying float vFlag;
varying float vPx;
varying float vId;
float band(float d, float a, float b, float aa) { return smoothstep(a - aa, a, d) * (1.0 - smoothstep(b - aa, b, d)); }
void main() {
  float d = length(vUv);
  float aa = 2.4 / max(vPx, 1.0);
  float r = d;
  float alpha;
  vec3 col;
  if (uStyle > 0.5) {
    // hollow ring (ruler ends)
    alpha = 1.0 - smoothstep(1.0 - aa, 1.0, d);
    col = mix(uRim, vColor, smoothstep(0.52 - aa, 0.52, d));
    col = mix(col, uInk, smoothstep(0.92 - aa, 0.98, d) * 0.6);
  } else {
    bool sel = vFlag > 0.5 && vFlag < 1.5;
    float dotPx = sel ? vPx * 0.56 : vPx;
    if (sel) r = d / 0.56;
    float raa = 2.4 / max(dotPx, 1.0);
    float edge = 1.0 - smoothstep(1.0 - raa, 1.0, r);
    // the light rim is ~14% of the diameter, at least 1 px: small discs stay mostly colour
    float rim = 1.0 - clamp(dotPx * 0.14, 0.9, 2.4) * 2.0 / max(dotPx, 1.0);
    vec3 core = vColor * (1.08 - 0.30 * r * r);
    float hl = 1.0 - smoothstep(0.0, 0.42, length(vUv / (sel ? 0.56 : 1.0) - vec2(-0.26, 0.30)));
    core = mix(core, vec3(1.0), hl * 0.3);
    col = mix(core, uRim, smoothstep(rim - raa * 0.6, rim, r));
    col = mix(col, uInk, smoothstep(1.0 - 1.6 * raa, 1.0 - 0.3 * raa, r) * 0.5);
    alpha = edge;
    if (sel) {
      float ring = band(d, 0.80, 0.97, aa);
      float halo = band(d, 0.56, 0.80, aa);
      col = mix(col, uRim, halo * 0.85);
      col = mix(col, uRing, ring);
      alpha = max(edge, max(ring, halo * 0.85));
    }
  }
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(col, alpha);
  #include <colorspace_fragment>
}`;

const PICK_FRAG = /* glsl */ `
varying vec2 vUv;
varying float vId;
void main() {
  if (length(vUv) > 1.0) discard;
  float id = vId + 1.0;
  gl_FragColor = vec4(mod(id, 256.0) / 255.0, floor(id / 256.0) / 255.0, 0.0, 1.0);
}`;

export interface PointStyle { worldMm: number; minPx: number; maxPx: number; lift: number; style?: number }

export class PointCloud {
  readonly mesh: THREE.Mesh;
  readonly pickMesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  readonly pickMaterial: THREE.ShaderMaterial;
  readonly count: number;
  private geo: THREE.InstancedBufferGeometry;
  private pos: THREE.InstancedBufferAttribute;
  private col: THREE.InstancedBufferAttribute;
  private size: THREE.InstancedBufferAttribute;
  private flag: THREE.InstancedBufferAttribute;

  constructor(positions: Float32Array, colors: Float32Array, style: PointStyle) {
    this.count = positions.length / 3;
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.pos = new THREE.InstancedBufferAttribute(positions, 3);
    this.col = new THREE.InstancedBufferAttribute(colors, 3);
    this.size = new THREE.InstancedBufferAttribute(new Float32Array(this.count).fill(1), 1);
    this.flag = new THREE.InstancedBufferAttribute(new Float32Array(this.count), 1);
    const ids = new Float32Array(this.count); for (let i = 0; i < this.count; i++) ids[i] = i;
    geo.setAttribute('iPos', this.pos); geo.setAttribute('iColor', this.col); geo.setAttribute('iSize', this.size);
    geo.setAttribute('iFlag', this.flag); geo.setAttribute('iId', new THREE.InstancedBufferAttribute(ids, 1));
    geo.instanceCount = this.count;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 860, 0), 1200);
    this.geo = geo;
    const uniforms = {
      uWorld: { value: style.worldMm }, uMinPx: { value: style.minPx }, uMaxPx: { value: style.maxPx },
      uProjScale: { value: 1 }, uPxToNdc: { value: new THREE.Vector2(0.001, 0.001) }, uLift: { value: style.lift }, uPick: { value: 0 },
      uRim: { value: new THREE.Color('#fbf8f2') }, uInk: { value: new THREE.Color('#2a2622') }, uRing: { value: new THREE.Color('#1d1b19') },
      uStyle: { value: style.style || 0 },
    };
    this.material = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms, alphaToCoverage: true });
    this.pickMaterial = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: PICK_FRAG,
      uniforms: { ...uniforms, uPick: { value: 1 } },
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.pickMesh = new THREE.Mesh(geo, this.pickMaterial);
    this.pickMesh.frustumCulled = false;
  }

  // per-frame: pixel conversions for the camera and the viewport being drawn
  setView(camera: THREE.Camera, viewportPx: { w: number; h: number }, ndcPx?: { w: number; h: number }) {
    const P = (camera as THREE.PerspectiveCamera).projectionMatrix.elements;
    // un-offset projection scale: for a view offset (picking) the caller passes the full viewport
    let p11 = P[5];
    const cam = camera as THREE.PerspectiveCamera | THREE.OrthographicCamera;
    if (cam.view?.enabled) p11 = p11 * cam.view.height / cam.view.fullHeight;
    const u = this.material.uniforms;
    u.uProjScale.value = p11 * viewportPx.h * 0.5;
    const n = ndcPx || viewportPx;
    u.uPxToNdc.value.set(2 / n.w, 2 / n.h);
  }
  setPositions(p: Float32Array) { (this.pos.array as Float32Array).set(p); this.pos.needsUpdate = true; }
  setColor(i: number, c: THREE.Color) { this.col.setXYZ(i, c.r, c.g, c.b); this.col.needsUpdate = true; }
  setSize(i: number, s: number) { this.size.setX(i, s); this.size.needsUpdate = true; }
  setFlag(i: number, f: number) { this.flag.setX(i, f); this.flag.needsUpdate = true; }
  setStyle(s: Partial<PointStyle>) {
    const u = this.material.uniforms;
    if (s.worldMm !== undefined) u.uWorld.value = s.worldMm;
    if (s.minPx !== undefined) u.uMinPx.value = s.minPx;
    if (s.maxPx !== undefined) u.uMaxPx.value = s.maxPx;
    if (s.lift !== undefined) u.uLift.value = s.lift;
  }
  get attributes() { return this.geo.attributes; }
}
