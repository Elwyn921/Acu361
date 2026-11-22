import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Atlas, Point } from '../data';
import { MERIDIAN, MERIDIANS } from '../palette';
import { Body } from './body';
import { PointCloud } from './points';
import { MeridianLines } from './lines';
import { RulerSet } from './rulers';

export const BODY_CENTER = new THREE.Vector3(0, 865, 0);
export const BODY_HEIGHT = 1709.5;

export interface Theme { dark: boolean; ink: string; skin: string }
export type View = 'front' | 'back' | 'left' | 'right' | 'home';
export const VIEW_DIR: Record<View, THREE.Vector3> = {
  front: new THREE.Vector3(0, 0, 1),
  back: new THREE.Vector3(0, 0, -1),
  left: new THREE.Vector3(1, 0, 0), // the body's left side faces +x
  right: new THREE.Vector3(-1, 0, 0),
  home: new THREE.Vector3(0.36, 0.08, 1).normalize(),
};
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class Viewer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  controls: OrbitControls | null = null;
  readonly body: Body;
  readonly points: PointCloud;
  readonly lines: MeridianLines;
  readonly rulers: RulerSet;
  readonly floor: THREE.Group;
  readonly backdrop: THREE.Mesh;
  readonly atlas: Atlas;
  readonly lights: THREE.Group;
  private key: THREE.DirectionalLight;
  private rim: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private pickScene = new THREE.Scene();
  private pickRT = new THREE.WebGLRenderTarget(1, 1);
  private depthOnly = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide });
  private needs = true;
  private raf = 0;
  private tween: { t0: number; dur: number; p0: THREE.Vector3; p1: THREE.Vector3; q0: THREE.Vector3; q1: THREE.Vector3 } | null = null;
  readonly afterRender = new Set<() => void>();
  readonly reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  private liftOn = false;
  private rawPos: Float32Array;
  private liftPos: Float32Array;
  readonly dimColor = new THREE.Color('#e6d8c6');
  width = 1; height = 1; dpr = 1;
  lensShift = 0; // horizontal shift of the image centre in CSS px (panels on one side)
  reserveY = 0; // CSS px taken by bars above and below the canvas content

  constructor(readonly canvas: HTMLCanvasElement, atlas: Atlas, opts: { preserve?: boolean; interactive?: boolean } = {}) {
    this.atlas = atlas;
    // opaque canvas: alpha-to-coverage edges must not let the page show through, so the backdrop is drawn here
    const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: !!opts.preserve, powerPreference: 'high-performance' });
    r.setClearColor(0xffffff, 1);
    r.toneMapping = THREE.NeutralToneMapping;
    r.toneMappingExposure = 1.0;
    r.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer = r;
    const pmrem = new THREE.PMREMGenerator(r);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.42;
    pmrem.dispose();

    this.camera = new THREE.PerspectiveCamera(24, 1, 20, 30000);
    this.scene.add(this.camera);
    // lights travel with the camera: the body is always lit from the viewer's upper left, as in an atlas plate
    this.lights = new THREE.Group();
    this.hemi = new THREE.HemisphereLight('#fffaf2', '#8c8478', 0.9);
    this.key = new THREE.DirectionalLight('#fff6ea', 1.9);
    this.key.position.set(-0.55, 0.75, 0.9);
    this.rim = new THREE.DirectionalLight('#eef3ff', 0.9);
    this.rim.position.set(0.8, 0.35, -0.9);
    const tgt = new THREE.Object3D(); tgt.position.set(0, 0, -1);
    this.key.target = tgt; this.rim.target = tgt;
    this.camera.add(this.key, this.rim, tgt);
    this.scene.add(this.hemi);

    this.backdrop = this.makeBackdrop();
    this.scene.add(this.backdrop);
    this.floor = this.makeFloor();
    this.scene.add(this.floor);

    this.body = new Body(atlas.body);
    this.scene.add(this.body.group);
    this.body.onChange = () => { this.updateLift(); this.requestRender(); };

    const n = atlas.points.length;
    this.rawPos = new Float32Array(n * 3); this.liftPos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    atlas.points.forEach((p, i) => {
      this.rawPos.set(p.pos, i * 3);
      this.liftPos.set(atlas.lift.points[p.id] || p.pos, i * 3);
      const c = new THREE.Color(MERIDIAN.get(p.meridian)!.color); col.set([c.r, c.g, c.b], i * 3);
    });
    this.points = new PointCloud(this.rawPos.slice(), col, { worldMm: 5.2, minPx: 6.5, maxPx: 15, lift: 3 });
    this.scene.add(this.points.mesh);
    this.pickScene.add(this.points.pickMesh);
    this.lines = new MeridianLines(atlas);
    this.scene.add(this.lines.group);
    this.rulers = new RulerSet(atlas, '#2a2622');
    this.scene.add(this.rulers.group);

    if (opts.interactive !== false) {
      const c = new OrbitControls(this.camera, canvas);
      c.enableDamping = true; c.dampingFactor = 0.09;
      c.rotateSpeed = 0.62; c.zoomSpeed = 1.1; c.panSpeed = 0.9;
      c.screenSpacePanning = true; c.zoomToCursor = true;
      c.minDistance = 160; c.maxDistance = 7000;
      c.minPolarAngle = 0.02; c.maxPolarAngle = Math.PI - 0.02;
      c.target.copy(BODY_CENTER);
      c.addEventListener('change', () => this.requestRender());
      c.addEventListener('start', () => { this.tween = null; });
      this.controls = c;
    }
    this.reducedMotion.addEventListener?.('change', () => this.requestRender());
  }

  // screen-space radial gradient (same as the page CSS) with a faint grain that also prevents banding
  private makeBackdrop(): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      depthTest: false, depthWrite: false,
      uniforms: { uC1: { value: new THREE.Color('#fbf8f2') }, uC2: { value: new THREE.Color('#e9e2d5') }, uRes: { value: new THREE.Vector2(1, 1) }, uGrain: { value: 1 } },
      vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `uniform vec3 uC1; uniform vec3 uC2; uniform vec2 uRes; uniform float uGrain;
        float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        void main(){
          vec2 uv = gl_FragCoord.xy / uRes; uv.y = 1.0 - uv.y;
          vec2 q = (uv - vec2(0.55, 0.42)) / vec2(1.2, 0.9);
          float t = clamp((length(q) - 0.28) / 0.72, 0.0, 1.0);
          gl_FragColor = vec4(mix(uC1, uC2, t), 1.0);
          #include <colorspace_fragment>
          gl_FragColor.rgb += (h(gl_FragCoord.xy) - 0.5) * 0.012 * uGrain;
        }`,
    }));
    m.frustumCulled = false; m.renderOrder = -100; m.name = 'backdrop';
    return m;
  }
  setBackdrop(c1: string, c2: string, grain = 1) {
    const u = (this.backdrop.material as THREE.ShaderMaterial).uniforms;
    u.uC1.value.set(c1); u.uC2.value.set(c2); u.uGrain.value = grain;
    this.renderer.setClearColor(c2, 1);
    this.requestRender();
  }

  private makeFloor(): THREE.Group {
    const g = new THREE.Group();
    // soft contact shadow
    const cv = document.createElement('canvas'); cv.width = cv.height = 256;
    const x = cv.getContext('2d')!;
    const grd = x.createRadialGradient(128, 128, 0, 128, 128, 128);
    grd.addColorStop(0, 'rgba(0,0,0,0.55)'); grd.addColorStop(0.35, 'rgba(0,0,0,0.28)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = grd; x.fillRect(0, 0, 256, 256);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(760, 520), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.55 }));
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = -0.5; shadow.renderOrder = -1; shadow.name = 'shadow';
    g.add(shadow);
    // measuring grid: 100 mm lines fading out with distance
    const grid = new THREE.Mesh(new THREE.PlaneGeometry(2600, 2600), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uColor: { value: new THREE.Color('#000000') }, uAlpha: { value: 0.1 } },
      vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform vec3 uColor; uniform float uAlpha; varying vec2 vP;
        float gl(float s){ vec2 c = abs(fract(vP / s - 0.5) - 0.5) / fwidth(vP / s); return 1.0 - min(min(c.x, c.y), 1.0); }
        void main(){ float r = length(vP); float fade = 1.0 - smoothstep(380.0, 1150.0, r);
          float a = (gl(100.0) * 0.9 + gl(500.0) * 0.6) * fade * uAlpha; if (a < 0.002) discard; gl_FragColor = vec4(uColor, a); }`,
    }));
    grid.rotation.x = -Math.PI / 2; grid.position.y = -1; grid.renderOrder = -2; grid.name = 'grid';
    g.add(grid);
    return g;
  }

  setTheme(th: Theme) {
    this.hemi.intensity = th.dark ? 0.5 : 0.72;
    this.hemi.groundColor.set(th.dark ? '#3a3632' : '#8c8478');
    this.key.intensity = th.dark ? 2.5 : 2.25;
    this.rim.intensity = th.dark ? 1.6 : 0.75;
    this.scene.environmentIntensity = th.dark ? 0.26 : 0.34;
    const grid = this.floor.getObjectByName('grid') as THREE.Mesh;
    const gm = grid.material as THREE.ShaderMaterial;
    gm.uniforms.uColor.value.set(th.dark ? '#ffffff' : '#3b3128'); gm.uniforms.uAlpha.value = th.dark ? 0.07 : 0.09;
    const sh = this.floor.getObjectByName('shadow') as THREE.Mesh;
    (sh.material as THREE.MeshBasicMaterial).opacity = th.dark ? 0.9 : 0.5;
    this.rulers.setInk(th.ink);
    this.requestRender();
  }

  resize(w: number, h: number, dpr = Math.min(window.devicePixelRatio || 1, 2)) {
    // a hidden or collapsed container reports 0 x 0; keep the camera maths finite
    w = Math.max(w, 1); h = Math.max(h, 1);
    this.width = w; this.height = h; this.dpr = dpr;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(h, 1);
    this.applyLens();
    this.lines.setResolution(w * dpr, h * dpr, dpr);
    this.rulers.setResolution(w * dpr, h * dpr, dpr);
    this.requestRender();
  }
  applyLens() {
    // shift the projection so that the body is centred in the free part of the canvas
    const cam = this.camera;
    cam.filmOffset = this.lensShift ? (-this.lensShift / this.width) * cam.getFilmWidth() : 0;
    cam.updateProjectionMatrix();
  }

  // distance that fits the body height (with margin) into the view
  fitDistance(margin = 1.1) {
    const vfov = THREE.MathUtils.degToRad(this.camera.fov);
    const free = Math.max(0.5, (this.height - this.reserveY) / this.height);
    const hNeed = BODY_HEIGHT * margin / free / 2 / Math.tan(vfov / 2);
    const wNeed = 760 * margin / 2 / (Math.tan(vfov / 2) * Math.max(this.camera.aspect * (1 - Math.abs(this.lensShift) * 2 / this.width), 0.2));
    return Math.max(hNeed, wNeed);
  }

  setView(v: View, animate = true) {
    const dir = VIEW_DIR[v].clone().normalize();
    const d = this.fitDistance();
    this.flyTo(BODY_CENTER.clone(), BODY_CENTER.clone().addScaledVector(dir, d), animate);
  }

  flyTo(target: THREE.Vector3, position: THREE.Vector3, animate = true) {
    if (!this.controls) { this.camera.position.copy(position); this.camera.lookAt(target); this.requestRender(); return; }
    if (!animate || this.reducedMotion.matches) {
      this.tween = null;
      this.controls.target.copy(target); this.camera.position.copy(position); this.controls.update(); this.requestRender(); return;
    }
    const dist = this.camera.position.distanceTo(position) + this.controls.target.distanceTo(target);
    this.tween = { t0: performance.now(), dur: THREE.MathUtils.clamp(500 + dist * 0.18, 650, 1300), p0: this.camera.position.clone(), p1: position.clone(), q0: this.controls.target.clone(), q1: target.clone() };
    this.requestRender();
  }

  // fly to a point: look at it along its skin normal, blended with the current direction
  focusPoint(p: Point, distance = 880, animate = true, raisePx = 0) {
    const i = this.atlas.points.indexOf(p);
    // at least ~320 mm across in narrow (portrait) views
    const hfov = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2) * this.camera.aspect);
    distance = Math.max(distance, 160 / Math.tan(hfov / 2));
    const pos = new THREE.Vector3().fromArray(this.liftOn ? this.liftPos : this.rawPos, i * 3);
    const n = this.body.normalAt(new THREE.Vector3(...p.pos)) || new THREE.Vector3(Math.sign(p.pos[0]) * 0.5, 0, p.pos[2] >= 0 ? 1 : -1).normalize();
    const cur = this.camera.position.clone().sub(this.controls?.target || BODY_CENTER).normalize();
    const dir = n.clone().multiplyScalar(0.8).add(cur.multiplyScalar(0.2));
    dir.y = THREE.MathUtils.clamp(dir.y, -0.35, 0.6);
    dir.normalize();
    if (raisePx) {
      // aim below the point so that it sits raisePx above the centre of the view
      const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir).normalize();
      const up = new THREE.Vector3().crossVectors(dir, right).normalize();
      const perPx = 2 * distance * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2) / this.height;
      pos.addScaledVector(up, -raisePx * perPx);
    }
    this.flyTo(pos, pos.clone().addScaledVector(dir, distance), animate);
  }

  pointPosition(i: number) { return new THREE.Vector3().fromArray(this.liftOn ? this.liftPos : this.rawPos, i * 3); }

  private updateLift() {
    const on = this.body.skinShown && !!this.body.garment;
    if (on === this.liftOn) return;
    this.liftOn = on;
    this.points.setPositions(on ? this.liftPos : this.rawPos);
    this.lines.setLifted(on);
  }
  get lifted() { return this.liftOn; }

  requestRender() {
    this.needs = true;
    if (!this.raf) this.raf = requestAnimationFrame(() => this.frame());
  }

  private frame() {
    this.raf = 0;
    let more = false;
    if (this.tween && this.controls) {
      const k = Math.min(1, (performance.now() - this.tween.t0) / this.tween.dur); const e = ease(k);
      this.controls.target.lerpVectors(this.tween.q0, this.tween.q1, e);
      // move along an arc around the target rather than through the body
      const a = this.tween.p0.clone().sub(this.tween.q0), b = this.tween.p1.clone().sub(this.tween.q1);
      const la = a.length(), lb = b.length();
      const dir = a.normalize().lerp(b.normalize(), e);
      if (dir.lengthSq() < 1e-6) dir.copy(b);
      this.camera.position.copy(this.controls.target).addScaledVector(dir.normalize(), la + (lb - la) * e);
      if (k >= 1) this.tween = null; else more = true;
    }
    if (this.controls) more = this.controls.update() || more;
    if (this.needs || more) this.render();
    this.needs = false;
    if (more) this.raf = requestAnimationFrame(() => this.frame());
  }

  autoLineWidth = true;
  private lastLw = 0;
  render() {
    if (this.autoLineWidth) {
      // thinner lines from far away, a little heavier close up
      const d = this.camera.position.distanceTo(this.controls?.target || BODY_CENTER);
      const lw = Math.round(THREE.MathUtils.clamp(THREE.MathUtils.mapLinear(d, 700, 3600, 2.1, 1.25), 1.25, 2.1) * 20) / 20;
      if (lw !== this.lastLw) { this.lastLw = lw; this.lines.setWidth(lw); }
    }
    this.points.setView(this.camera, { w: this.width * this.dpr, h: this.height * this.dpr });
    this.rulers.ends.setView(this.camera, { w: this.width * this.dpr, h: this.height * this.dpr });
    (this.backdrop.material as THREE.ShaderMaterial).uniforms.uRes.value.set(this.width * this.dpr, this.height * this.dpr);
    this.renderer.setRenderTarget(null);
    this.renderer.setViewport(0, 0, this.width, this.height);
    this.renderer.setScissorTest(false);
    this.renderer.render(this.scene, this.camera);
    for (const f of this.afterRender) f();
  }

  // GPU picking: id of the point drawn nearest to (x, y) within a square of `radius` CSS px, or -1
  pick(x: number, y: number, radius = 3): number {
    const dpr = this.dpr, W = Math.round(this.width * dpr), H = Math.round(this.height * dpr);
    const s = Math.max(1, Math.round(radius * 2 * dpr));
    const px = Math.round(x * dpr - s / 2), py = Math.round(y * dpr - s / 2);
    if (this.pickRT.width !== s) this.pickRT.setSize(s, s);
    const cam = this.camera;
    cam.setViewOffset(W, H, px, py, s, s);
    this.points.setView(cam, { w: W, h: H }, { w: s, h: s });
    const r = this.renderer;
    const prevClear = r.getClearAlpha();
    r.setRenderTarget(this.pickRT);
    r.setClearColor(0x000000, 0); r.clear();
    // occluders as depth only
    const occ = this.body.occluders();
    const vis = new Map<THREE.Object3D, boolean>();
    this.scene.children.forEach((c) => { vis.set(c, c.visible); });
    this.points.mesh.visible = false; this.lines.group.visible = false; this.rulers.group.visible = false; this.floor.visible = false; this.backdrop.visible = false;
    const hiddenLayers: THREE.Object3D[] = [];
    for (const L of this.body.layers.values()) if (L.group.visible && !occ.includes(L.group)) { L.group.visible = false; hiddenLayers.push(L.group); }
    this.scene.overrideMaterial = this.depthOnly;
    r.render(this.scene, cam);
    this.scene.overrideMaterial = null;
    for (const g of hiddenLayers) g.visible = true;
    vis.forEach((v, c) => { c.visible = v; });
    const ac = r.autoClear; r.autoClear = false;
    r.render(this.pickScene, cam);
    r.autoClear = ac;
    const buf = new Uint8Array(s * s * 4);
    r.readRenderTargetPixels(this.pickRT, 0, 0, s, s, buf);
    r.setRenderTarget(null); r.setClearColor(0x000000, prevClear);
    cam.clearViewOffset();
    this.applyLens();
    let best = -1, bd = Infinity;
    for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) {
      const o = (j * s + i) * 4; const id = buf[o] + buf[o + 1] * 256;
      if (!id) continue;
      const d = (i - s / 2) ** 2 + (j - s / 2) ** 2;
      if (d < bd) { bd = d; best = id - 1; }
    }
    this.requestRender();
    return best;
  }

  // CSS-pixel screen position of a world point (null if behind the camera)
  project(v: THREE.Vector3): { x: number; y: number } | null {
    const p = v.clone().project(this.camera);
    if (p.z > 1) return null;
    return { x: (p.x + 1) / 2 * this.width, y: (1 - p.y) / 2 * this.height };
  }

  meridianCodes() { return MERIDIANS.map((m) => m.code); }
}
