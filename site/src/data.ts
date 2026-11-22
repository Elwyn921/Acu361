// The explorer reads the published files (copied verbatim into data/ by scripts/prepare.mjs) plus the display-only
// garment offsets (body/lift.json).
export type Vec3 = [number, number, number];
export type Side = 'L' | 'R' | 'M';

export interface Point {
  id: string; code: string; side: Side; meridian: string; index: number;
  name_pinyin: string; name_zh: string; pos: Vec3; nearest_bone: string; bone_distance_mm: number;
}
export interface Segment { id: string; codes: string[]; points: Vec3[] }
export interface Meridians { meridians: Record<string, { name_en: string; lines: Record<string, Segment[]> }> }
export interface Ruler {
  id: string; label_en: string; label_zh: string; region: string; region_zh: string; cun: number;
  note_en: string; note_zh: string; instances: { side: Side; a: Vec3; b: Vec3; length_mm: number }[];
}
export interface Rulers { rulers: Ruler[]; landmarks: Record<string, { pos: Vec3; definition: string }> }
export interface Lift { points: Record<string, Vec3>; lines: Record<string, Record<string, Record<string, [number, number, number, number][]>>> }
export interface BodyIndex { layers: Record<string, { file: string; bytes: number; nodes: number }> }

export interface Atlas {
  points: Point[];
  byId: Map<string, Point>;
  codes: { code: string; meridian: string; index: number; pinyin: string; zh: string; ids: string[] }[];
  meridians: Meridians;
  rulers: Rulers;
  lift: Lift;
  body: BodyIndex;
}

const base = import.meta.env.BASE_URL;
export const url = (p: string) => `${base}${p}`;

async function json<T>(p: string): Promise<T> {
  const r = await fetch(url(p));
  if (!r.ok) throw new Error(`${p}: HTTP ${r.status}`);
  return r.json() as Promise<T>;
}

export async function loadAtlas(): Promise<Atlas> {
  const [pts, meridians, rulers, lift, body] = await Promise.all([
    json<{ points: Point[] }>('data/points.json'), json<Meridians>('data/meridians.json'), json<Rulers>('data/rulers.json'),
    json<Lift>('body/lift.json'), json<BodyIndex>('body/index.json'),
  ]);
  const points = pts.points;
  const byId = new Map(points.map((p) => [p.id, p]));
  const codeMap = new Map<string, Atlas['codes'][number]>();
  for (const p of points) {
    let c = codeMap.get(p.code);
    if (!c) codeMap.set(p.code, (c = { code: p.code, meridian: p.meridian, index: p.index, pinyin: p.name_pinyin, zh: p.name_zh, ids: [] }));
    c.ids.push(p.id);
  }
  return { points, byId, codes: [...codeMap.values()], meridians, rulers, lift, body };
}

// "Second rib.l" -> { name: "Second rib", side: "L" }
export function boneName(n: string): { name: string; side: Side | null } {
  const m = n.match(/^(.*)\.(l|r)$/);
  return m ? { name: m[1].trim(), side: m[2] === 'l' ? 'L' : 'R' } : { name: n.trim(), side: null };
}
