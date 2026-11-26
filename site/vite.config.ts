import { defineConfig, type Plugin } from 'vite';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { REPO_URL, SITE_URL, VERSION, YEAR, TITLE, CONTACT_EMAIL, LAB_URL } from './src/config';

// Fills {{TOKENS}} in index.html and in templates/* (llms.txt, robots.txt, sitemap.xml) from src/config.ts and from
// the dataset itself, so URLs, sizes and the example record are never typed twice.
const root = resolve(__dirname, '..');
const manifest = JSON.parse(readFileSync(resolve(root, 'data/manifest.json'), 'utf8'));
const points = JSON.parse(readFileSync(resolve(root, 'data/points.json'), 'utf8')).points as { id: string; pos: number[]; nearest_bone: string; bone_distance_mm: number }[];
const size = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`);
const bytes = new Map<string, number>(manifest.files.map((f: { path: string; bytes: number }) => [f.path, f.bytes]));
const lu7 = points.find((p) => p.id === 'LU7_L')!;

const tokens: Record<string, string> = {
  REPO_URL, SITE_URL, VERSION, YEAR, TITLE, CONTACT_EMAIL, LAB_URL,
  LAB_URL_SHORT: LAB_URL.replace(/^https?:\/\//, '').replace(/\/$/, ''),
  LU7_POS: lu7.pos.join(', '), LU7_BONE: lu7.nearest_bone, LU7_DIST: String(lu7.bone_distance_mm),
  'SIZE:body': size([...bytes].filter(([p]) => p.startsWith('data/body/')).reduce((s, [, b]) => s + b, 0)),
  'SIZE:data/manifest.json': size(readFileSync(resolve(root, 'data/manifest.json')).length),
};
for (const [p, b] of bytes) tokens[`SIZE:${p}`] = size(b);

const authors = ['Yuyue Zhang', 'Timothy G Reese', 'Yang He', 'Michael Zhu'];
const lab = { '@type': 'Organization', name: 'Human Motion & Molecular Health Lab, Department of Statistics, Purdue University', url: LAB_URL };
const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Dataset',
  name: TITLE,
  alternateName: 'Acu361',
  description: 'Acu361 gives a precise location for each of the 361 WHO standard acupoints (670 points). Every location is the consensus of a panel of seven acupuncturists, who went through the points one by one, and is recorded as a millimetre coordinate on the skin of an open anatomical body with seven layers.',
  url: SITE_URL,
  sameAs: [REPO_URL, 'https://doi.org/10.5281/zenodo.24448101', 'https://huggingface.co/datasets/EWAN921/Acu361'],
  identifier: 'https://doi.org/10.5281/zenodo.24448101',
  version: VERSION,
  datePublished: '2026-11-22',
  inLanguage: 'en',
  isAccessibleForFree: true,
  license: 'https://creativecommons.org/licenses/by-sa/4.0/',
  keywords: ['acupuncture', 'acupoints', 'meridians', 'WHO standard acupuncture point locations', '3D anatomy', 'human body model', 'Z-Anatomy', 'BodyParts3D', 'B-cun', 'proportional bone measurement', 'dataset'],
  creator: authors.map((name, i) => ({ '@type': 'Person', name, affiliation: lab, ...(i === 0 ? { email: CONTACT_EMAIL } : {}) })),
  publisher: lab,
  maintainer: { '@type': 'Person', name: authors[0], email: CONTACT_EMAIL },
  measurementTechnique: 'Point-by-point consensus of a panel of seven acupuncturists, marked in a 3D annotation tool on the skin of a 3D anatomical body model',
  variableMeasured: [
    { '@type': 'PropertyValue', name: 'pos', description: 'x, y, z position of the point on the skin', unitText: 'mm' },
    { '@type': 'PropertyValue', name: 'bone_distance_mm', description: 'straight-line distance from the point to the nearest bone surface in the model (not a needling depth)', unitText: 'mm' },
    { '@type': 'PropertyValue', name: 'nearest_bone', description: 'name of the nearest bone object of the body model' },
  ],
  distribution: [
    { '@type': 'DataDownload', name: 'points.json', encodingFormat: 'application/json', contentUrl: `${SITE_URL}data/points.json` },
    { '@type': 'DataDownload', name: 'points.csv', encodingFormat: 'text/csv', contentUrl: `${SITE_URL}data/points.csv` },
    { '@type': 'DataDownload', name: 'meridians.json', encodingFormat: 'application/json', contentUrl: `${SITE_URL}data/meridians.json` },
    { '@type': 'DataDownload', name: 'rulers.json', encodingFormat: 'application/json', contentUrl: `${SITE_URL}data/rulers.json` },
    { '@type': 'DataDownload', name: 'Complete package (data, schemas, body GLB files)', encodingFormat: 'application/zip', contentUrl: `${REPO_URL}/archive/refs/heads/main.zip` },
  ],
  isBasedOn: [
    { '@type': 'CreativeWork', name: 'Z-Anatomy - The libre 3D atlas of anatomy', url: 'https://github.com/Z-Anatomy/Models-of-human-anatomy', license: 'https://creativecommons.org/licenses/by-sa/4.0/' },
    { '@type': 'Dataset', name: 'BodyParts3D', url: 'https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html', license: 'https://creativecommons.org/licenses/by-sa/2.1/jp/' },
    { '@type': 'Book', name: 'WHO Standard Acupuncture Point Locations in the Western Pacific Region', isbn: '978-92-9061-248-7', datePublished: '2008', publisher: { '@type': 'Organization', name: 'World Health Organization Regional Office for the Western Pacific' } },
  ],
  citation: `Zhang Y, Reese TG, He Y, Zhu M. ${TITLE}. Version ${VERSION}. ${YEAR}. ${REPO_URL}`,
};
tokens.JSON_LD = JSON.stringify(jsonLd, null, 1).replace(/</g, '\\u003c');

function fill(text: string, file: string) {
  return text.replace(/\{\{([A-Za-z0-9_:/.]+)\}\}/g, (m, k: string) => {
    if (!(k in tokens)) throw new Error(`${file}: unknown token ${m}`);
    return tokens[k];
  });
}

function acu361(): Plugin {
  const tdir = resolve(__dirname, 'templates');
  const templates = () => readdirSync(tdir).map((n) => ({ name: n, text: fill(readFileSync(resolve(tdir, n), 'utf8'), n) }));
  return {
    name: 'acu361-tokens',
    transformIndexHtml: { order: 'pre', handler: (html) => fill(html, 'index.html') },
    generateBundle() { for (const t of templates()) this.emitFile({ type: 'asset', fileName: t.name, source: t.text }); },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = (req.url || '').split('?')[0].replace(/^\//, '');
        const t = templates().find((x) => x.name === name);
        if (!t) return next();
        res.setHeader('Content-Type', name.endsWith('.xml') ? 'application/xml' : 'text/plain; charset=utf-8');
        res.end(t.text);
      });
    },
  };
}

export default defineConfig({
  base: process.env.SITE_BASE || './',
  plugins: [acu361()],
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    assetsInlineLimit: 0,
    // three.js alone is ~600 kB minified; it is one cached chunk
    chunkSizeWarningLimit: 900,
    minify: 'terser',
    terserOptions: { format: { comments: /^!|@license/ } },
    rollupOptions: { output: { manualChunks: { three: ['three'] } } },
  },
  server: { port: 5361 },
  preview: { port: 4361 },
});
