#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Human Motion & Molecular Health Lab, Purdue University
"""Validate the Acu361 data package.  Python 3.8+ standard library only.

    python3 scripts/validate.py [--root DIR] [--skip-bone]

Every check prints PASS or FAIL with the numbers behind it.  The exit code is 1 if any check fails.

Checks
  manifest    sizes and SHA-256 of every file listed in data/manifest.json; no unlisted file in data/
  schema      data/*.json against schema/*.schema.json (built-in validator for the keywords used there)
  points      361 codes, 670 points, 309 bilateral + 52 midline codes, points per meridian as in WHO 2008, unique ids
  symmetry    left-right mirror residual (x -> -x) of the 309 pairs; |x| of the 52 midline points
  skin        distance from every point to the skin surface of body/skin.glb (uniform-grid search)
  bone        nearest_bone names exist in body/bone.glb; nearest bone and bone_distance_mm recomputed (--skip-bone: names only)
  glb         binary structure of the 7 GLB files, counts against the manifest, node names, extras keys
  meridians   every code of every segment exists, knots sit on their points, every point is on a line, distance to skin
  rulers      every endpoint resolves to a point or landmark and matches the instance coordinates, lengths
  terms       none of the internal terms (stored below as SHA-256 only), absolute user paths, IP addresses or e-mail
              addresses other than the contact address occur in any text file or GLB JSON chunk
"""
import argparse, hashlib, json, math, os, re, struct, sys, time
from array import array
from collections import Counter

WHO_ORDER = ['LU', 'LI', 'ST', 'SP', 'HT', 'SI', 'BL', 'KI', 'PC', 'TE', 'GB', 'LR', 'GV', 'CV']
WHO_COUNTS = dict(LU=11, LI=20, ST=45, SP=21, HT=9, SI=19, BL=67, KI=27, PC=9, TE=23, GB=44, LR=14, GV=28, CV=24)
MIDLINE = {'GV', 'CV'}
LAYERS = ['skin', 'bone', 'ligament', 'muscle', 'organ', 'vessel', 'nerve']
EXTRAS_KEYS = {'group_en', 'how'}
DAMAGED_NAMES = {'????????', '?x.l', '?x.r'}      # node names damaged upstream, kept as they are
CONTACT = {'zhan6013@purdue.edu'}

TOL_MIRROR_MM = 0.05     # right point vs mirrored left point
TOL_MIDLINE_MM = 2.0     # |x| of midline points
TOL_SKIN_MM = 0.1        # point to skin surface
TOL_BONE_MM = 0.051      # bone_distance_mm is rounded to 0.1 mm
TOL_KNOT_MM = 3.5        # a knot sample is the point lifted ~1.2 mm off the skin
TOL_LINE_SKIN_MM = 5.0   # meridian samples to skin
TOL_JUMP_MM = 15.0       # spacing of consecutive meridian samples
TOL_POS_MM = 0.005       # ruler endpoint vs point / landmark position

FORBIDDEN = [  # (category, mode, n, sha256 of the term)
    ('internal field', 'i', 12, 'fdcd941709619b0559e990a3ed8166330fd643f70aa9139643c9c0458591b0ea'),
    ('internal field', 'i', 12, '79b7bdc9ee7e2bba7d6a07199ccc16290986a3aeeb9b32c90db7fe190ec9c70f'),
    ('internal field', 'i', 10, '07b593946fcde02e14bc3080361e8edb8bb0ed2234373f204317a804d312ac7a'),
    ('internal field', 'i', 8, '5282c40ec46d791d69f3f0ddce5a52085d8fa69b9fa7dcf2697f3d903158dcdc'),
    ('internal field', 'i', 19, 'f4bb388d4fd237713c9cab2ad69b475e6b86255675d7f031abe113a167a4a79c'),
    ('internal field', 'i', 15, '7839a20e1fe710d202e96b8bd053efb88f84222da2da6cfb92a7b52d25b6800f'),
    ('internal field', 'w', 2, '6dee04b73e8d3336654bca37a2d58c001f0bfc572f4bf0d46c38fc08002d4da7'),
    ('internal field', 'w', 2, 'dfa50c5595397c61c39d437beb400a427d91773974409c8cb1d9c8e88be93e8b'),
    ('app name', 'i', 7, 'b5d61560c0866422a4f1300fd657650d13d861c3d52024de60e408fff0f600f5'),
    ('app name', 'c', 2, '0791d8c8e792b900b79867695f55d791fb0fda5986254e55932d0a1f8e29ac58'),
    ('app name', 'P', 2, '47630d191193ea75c1423ec55b68167bb4b644a214161cd24fc59d0a0612d84d'),
    ('app name', 'i', 11, 'dc91e5ab9ea44478d686dd0be9801cc763e0934300cd800fa1b5c8932fe15bdf'),
    ('text field', 'i', 8, '434ab32ee103724cc7e2ba2b7e863a9b30545bed377e54aca78b21918aa8a683'),
    ('text field', 'i', 7, 'ff708d09b71b0ea787e22921ce809d7f6a0b3332330b9f75f4560896622ac415'),
    ('text field', 'i', 15, '563d13b9c36d8bc53a7a614bc5894f8b5d80759a2504050e745206a02af4fef7'),
    ('text field', 'i', 11, '623eed8932122fca0fa46aa4b315064f9f5d1214ef72955c79700a7088e91ffc'),
    ('text field', 'i', 10, '3364d75c448ab9b821959b3895d51e2f69e6c91b5627df42ed98257940246f8d'),
    ('text field', 'i', 10, '079de09741ab92a6647beb766bcd8d24c2d4c03c1364356a48847a04f71a8748'),
    ('text field', 'i', 14, '5541978db21630622cbb5e04d1ceb15e4d88d5b98277311971963b78e08facde'),
    ('text field', 'i', 14, '2d4c84435476d29a203b2efb109c7554b7b52c3fbf625dcb0197c63821061ac5'),
    ('text field', 'i', 9, '17a16899b968f6f8a34157cca3a6b802f2569bda35cbcdf96234cb1cc981fbcb'),
    ('text field', 'i', 9, '522051c1c9114867df78e9d51ec26d7ef0e8a513512f6741c88dad5fbd78acce'),
    ('text field', 'i', 9, '8b00f5595f2f46653459a631aefc5c59140e5a091dc94f19b82bc07c547d3faf'),
    ('text field', 'i', 9, '9d670239b9af0f48fdf23f84094e3245075fa891420d685700a945fa25664f60'),
    ('text field', 'i', 10, 'a1116d63fdbc703757603d019cf07ab8a2056376173bb3a7b9a18ef6cf09add7'),
    ('text field', 'i', 10, 'bde8de8b8f77f4f27141b7d2829fd78b6f47c77cc0378c7945284f10d4b526bb'),
    ('text field', 'i', 15, '56b3e20b8804286f74545c0ff5f84f6dcd98e89271883f69f25d89a306ed6290'),
    ('text field', 'i', 11, 'db0bdc6353958bdef508e5055927aa65c20ae8b51ca693340fabdf9241b02a3e'),
    ('text field', 'i', 17, '52816b8a65d4475fbdcf7b3bac03c1f0c8a356614f31d8a65f408acd2cd3a5df'),
    ('internal note', 'p', 4, 'e5d0e8a74c958287a92a481abd5e530ffc995c0b6c24465645795f378d2b3168'),
    ('internal note', 'p', 2, '99a6ab6e8d9e4f311460d0bbb7d47b0e4b89793eb7605d5621938a69c0454692'),
    ('internal note', 'c', 2, '5491701e1c3a8cfd9553d76c787e62fcb3987bc98a4f41adf17ce1d9fda79df8'),
    ('internal note', 'c', 2, 'f56c6c82203b33f632fb357d7fbea6dca86d5863f35a3b5a6f72ecfaacc0c396'),
    ('internal note', 'c', 2, 'c9a31a3f670b7f9973f2004ed383fc8c50a20c8d595556b8d8c266630234d8ee'),
    ('internal note', 'i', 19, 'a528568b2619a3f05fdc8e708bf1c7dcf5f95c03fc415b7872ba1b547535cb5f'),
    ('internal note', 'i', 8, '5eab565ecf5fd249455ab7a981629975165e302de34816b4e5bd330ff7b8830c'),
    ('internal name', 'i', 9, 'd85b40105dd0b9cdbe46a1ee1b96abdf1474ae96fb86bd28ca701f44f017ac3b'),
    ('internal name', 'i', 19, '461dea92a3f3123a36b38d5dcbe5f8a80ffd0b1e3648866c2707c46651e17cde'),
    ('internal name', 'i', 9, '194705a00a9db700a52589530729f0c4224be18e6b69e53d421070c6357cabd0'),
    ('internal path', 'i', 11, '12e7a69929c6089972cfd0943c4e010e346f7dfedb8b1753ef66a306cf84b970'),
    ('internal path', 'i', 12, '8b6da8640dfd3c903f09a7e3f722e97689c045e2c0fb20447d738dfea5676b01'),
    ('internal path', 'i', 9, '591bfe88c880df9685d3e298cac2271681a78e017441426ae3d5bd6c73cd3db7'),
    ('internal path', 'i', 13, 'e4f9eab47d48111d774baf341b7b699eb245c174a845f08cb417e131b82e8078'),
    ('internal host', 'i', 7, 'f72abefe5037ae3671c0a2531773e4d19ff73c631ca3de211979569a406a2e76'),
]

RESULTS = []


def report(name, ok, msg):
    RESULTS.append((name, ok))
    print(f'[{"PASS" if ok else "FAIL"}] {name}: {msg}', flush=True)


# ------------------------------------------------------------------------------------------------ JSON Schema (subset)
ANNOTATIONS = {'$schema', '$id', 'title', 'description', '$comment', '$defs', 'examples', 'default'}
TYPES = {
    'object': lambda v: isinstance(v, dict),
    'array': lambda v: isinstance(v, list),
    'string': lambda v: isinstance(v, str),
    'number': lambda v: isinstance(v, (int, float)) and not isinstance(v, bool),
    'integer': lambda v: (isinstance(v, int) and not isinstance(v, bool)) or (isinstance(v, float) and v.is_integer()),
    'boolean': lambda v: isinstance(v, bool),
    'null': lambda v: v is None,
}


def schema_errors(v, s, root, path='', out=None):
    """validate v against schema s (draft 2020-12 keywords used in schema/); returns a list of 'path: message'"""
    out = [] if out is None else out
    if s is True or s == {}: return out
    if s is False: out.append(f'{path or "/"}: not allowed'); return out
    for k in s:
        if k not in ANNOTATIONS and k not in KEYWORDS: out.append(f'{path or "/"}: unsupported schema keyword {k}')
    if '$ref' in s:
        ref = s['$ref']; assert ref.startswith('#/'), ref
        target = root
        for part in ref[2:].split('/'): target = target[part]
        schema_errors(v, target, root, path, out)
    if 'type' in s:
        ts = s['type'] if isinstance(s['type'], list) else [s['type']]
        if not any(TYPES[t](v) for t in ts): out.append(f'{path or "/"}: expected {"/".join(ts)}, got {type(v).__name__}'); return out
    if 'const' in s and v != s['const']: out.append(f'{path or "/"}: expected {s["const"]!r}, got {v!r}')
    if 'enum' in s and v not in s['enum']: out.append(f'{path or "/"}: {v!r} not in {s["enum"]}')
    if isinstance(v, str):
        if 'minLength' in s and len(v) < s['minLength']: out.append(f'{path}: shorter than {s["minLength"]}')
        if 'pattern' in s and not re.search(s['pattern'], v): out.append(f'{path}: {v!r} does not match {s["pattern"]}')
    if TYPES['number'](v):
        if 'minimum' in s and v < s['minimum']: out.append(f'{path}: {v} < {s["minimum"]}')
        if 'maximum' in s and v > s['maximum']: out.append(f'{path}: {v} > {s["maximum"]}')
        if 'exclusiveMinimum' in s and v <= s['exclusiveMinimum']: out.append(f'{path}: {v} <= {s["exclusiveMinimum"]}')
    if isinstance(v, list):
        if 'minItems' in s and len(v) < s['minItems']: out.append(f'{path}: fewer than {s["minItems"]} items')
        if 'maxItems' in s and len(v) > s['maxItems']: out.append(f'{path}: more than {s["maxItems"]} items')
        if 'items' in s:
            for i, e in enumerate(v): schema_errors(e, s['items'], root, f'{path}/{i}', out)
    if isinstance(v, dict):
        for k in s.get('required', []):
            if k not in v: out.append(f'{path or "/"}: missing required key {k!r}')
        if 'minProperties' in s and len(v) < s['minProperties']: out.append(f'{path or "/"}: fewer than {s["minProperties"]} keys')
        props = s.get('properties', {}); pats = s.get('patternProperties', {})
        for k, e in v.items():
            seen = False
            if k in props: schema_errors(e, props[k], root, f'{path}/{k}', out); seen = True
            for pat, ps in pats.items():
                if re.search(pat, k): schema_errors(e, ps, root, f'{path}/{k}', out); seen = True
            if not seen and 'additionalProperties' in s:
                schema_errors(e, s['additionalProperties'], root, f'{path}/{k}', out) if s['additionalProperties'] is not False \
                    else out.append(f'{path or "/"}: unexpected key {k!r}')
    if 'oneOf' in s:
        n = sum(1 for sub in s['oneOf'] if not schema_errors(v, sub, root, path))
        if n != 1: out.append(f'{path or "/"}: matches {n} of the oneOf alternatives (expected 1)')
    if 'anyOf' in s and not any(not schema_errors(v, sub, root, path) for sub in s['anyOf']):
        out.append(f'{path or "/"}: matches none of the anyOf alternatives')
    return out


KEYWORDS = {'$ref', 'type', 'const', 'enum', 'minLength', 'pattern', 'minimum', 'maximum', 'exclusiveMinimum', 'minItems',
            'maxItems', 'items', 'required', 'minProperties', 'properties', 'patternProperties', 'additionalProperties',
            'oneOf', 'anyOf'}


# ------------------------------------------------------------------------------------------------ GLB
class GLB:
    def __init__(self, path):
        raw = open(path, 'rb').read()
        self.problems = []
        magic, ver, length = struct.unpack_from('<III', raw, 0)
        if magic != 0x46546C67 or ver != 2 or length != len(raw): self.problems.append('bad header')
        jlen, jtype = struct.unpack_from('<II', raw, 12)
        if jtype != 0x4E4F534A or jlen % 4: self.problems.append('bad JSON chunk')
        self.json_text = raw[20:20 + jlen].decode('utf-8')
        self.J = json.loads(self.json_text)
        off = 20 + jlen
        blen, btype = struct.unpack_from('<II', raw, off)
        if btype != 0x004E4942 or off + 8 + blen != len(raw): self.problems.append('bad BIN chunk')
        self.bin = memoryview(raw)[off + 8:off + 8 + blen]

    def _view(self, acc_i, code, comps):
        J = self.J; a = J['accessors'][acc_i]; bv = J['bufferViews'][a['bufferView']]
        start = bv.get('byteOffset', 0) + a.get('byteOffset', 0); n = a['count'] * comps
        arr = array(code)
        arr.frombytes(bytes(self.bin[start:start + n * arr.itemsize]))
        if sys.byteorder == 'big': arr.byteswap()
        return arr

    def positions(self, mesh_i):
        return self._view(self.J['meshes'][mesh_i]['primitives'][0]['attributes']['POSITION'], 'f', 3)

    def indices(self, mesh_i):
        return self._view(self.J['meshes'][mesh_i]['primitives'][0]['indices'], 'I' if array('I').itemsize == 4 else 'L', 1)


def check_glb_structure(g):
    """problems of one GLB as a list of strings; also returns (vertices, triangles)"""
    J = g.J; p = list(g.problems); nv = nt = 0
    if J.get('asset', {}).get('version') != '2.0': p.append('asset.version is not 2.0')
    for k in ('materials', 'textures', 'images', 'samplers', 'skins', 'animations', 'cameras'):
        if J.get(k): p.append(f'unexpected {k}')
    if len(J.get('buffers', [])) != 1 or J['buffers'][0].get('byteLength') != len(g.bin) or 'uri' in J['buffers'][0]:
        p.append('buffers[0] does not describe the BIN chunk')
    for i, bv in enumerate(J['bufferViews']):
        if bv.get('buffer', 0) != 0 or bv.get('byteOffset', 0) + bv['byteLength'] > len(g.bin): p.append(f'bufferView {i} out of range')
    size = {5126: 4, 5125: 4}; ncomp = {'VEC3': 3, 'SCALAR': 1}
    for i, a in enumerate(J['accessors']):
        bv = J['bufferViews'][a['bufferView']]
        if a['count'] * size.get(a['componentType'], 0) * ncomp.get(a['type'], 0) + a.get('byteOffset', 0) > bv['byteLength']:
            p.append(f'accessor {i} larger than its bufferView')
    meshes_used = []
    for i, nd in enumerate(J['nodes']):
        if any(k in nd for k in ('matrix', 'translation', 'rotation', 'scale', 'children')): p.append(f'node {i} has a transform or children')
        if 'mesh' not in nd: p.append(f'node {i} has no mesh'); continue
        meshes_used.append(nd['mesh'])
        m = J['meshes'][nd['mesh']]
        if m.get('name') != nd['name']: p.append(f'mesh name differs from node name at node {i}')
        ex = nd.get('extras', {})
        if not set(ex) <= EXTRAS_KEYS or not all(isinstance(x, str) for x in ex.values()): p.append(f'node {i}: extras keys {sorted(ex)}')
    if sorted(meshes_used) != list(range(len(J['meshes']))): p.append('meshes are not used exactly once each')
    if J['scenes'][J.get('scene', 0)]['nodes'] != list(range(len(J['nodes']))): p.append('scene does not list every node once')
    for mi, m in enumerate(J['meshes']):
        if len(m['primitives']) != 1: p.append(f'mesh {mi}: {len(m["primitives"])} primitives'); continue
        pr = m['primitives'][0]
        if pr.get('mode', 4) != 4 or set(pr['attributes']) != {'POSITION', 'NORMAL'}: p.append(f'mesh {mi}: mode / attributes'); continue
        pa = J['accessors'][pr['attributes']['POSITION']]; na = J['accessors'][pr['attributes']['NORMAL']]; ia = J['accessors'][pr['indices']]
        if (pa['componentType'], pa['type'], na['componentType'], na['type'], ia['componentType'], ia['type']) != (5126, 'VEC3', 5126, 'VEC3', 5125, 'SCALAR'):
            p.append(f'mesh {mi}: accessor types'); continue
        if na['count'] != pa['count'] or ia['count'] % 3: p.append(f'mesh {mi}: counts'); continue
        P = g.positions(mi); I = g.indices(mi)
        if max(I) >= pa['count']: p.append(f'mesh {mi}: index out of range')
        mn = [min(P[k::3]) for k in range(3)]; mx = [max(P[k::3]) for k in range(3)]
        if pa.get('min') != mn or pa.get('max') != mx: p.append(f'mesh {mi}: POSITION min/max differ from the data')
        nv += pa['count']; nt += ia['count'] // 3
    return p, nv, nt


# ------------------------------------------------------------------------------------------------ point-triangle distance
def tri_d2(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz):
    """squared distance from p to triangle abc (closest-point regions, Ericson 2005, sec. 5.1.5)"""
    abx, aby, abz = bx - ax, by - ay, bz - az
    acx, acy, acz = cx - ax, cy - ay, cz - az
    apx, apy, apz = px - ax, py - ay, pz - az
    d1 = abx * apx + aby * apy + abz * apz; d2 = acx * apx + acy * apy + acz * apz
    if d1 <= 0 and d2 <= 0: return apx * apx + apy * apy + apz * apz
    bpx, bpy, bpz = px - bx, py - by, pz - bz
    d3 = abx * bpx + aby * bpy + abz * bpz; d4 = acx * bpx + acy * bpy + acz * bpz
    if d3 >= 0 and d4 <= d3: return bpx * bpx + bpy * bpy + bpz * bpz
    vc = d1 * d4 - d3 * d2
    if vc <= 0 and d1 >= 0 and d3 <= 0:
        v = d1 / (d1 - d3) if d1 != d3 else 0.0; qx, qy, qz = ax + v * abx, ay + v * aby, az + v * abz
        return (px - qx) ** 2 + (py - qy) ** 2 + (pz - qz) ** 2
    cpx, cpy, cpz = px - cx, py - cy, pz - cz
    d5 = abx * cpx + aby * cpy + abz * cpz; d6 = acx * cpx + acy * cpy + acz * cpz
    if d6 >= 0 and d5 <= d6: return cpx * cpx + cpy * cpy + cpz * cpz
    vb = d5 * d2 - d1 * d6
    if vb <= 0 and d2 >= 0 and d6 <= 0:
        w = d2 / (d2 - d6) if d2 != d6 else 0.0; qx, qy, qz = ax + w * acx, ay + w * acy, az + w * acz
        return (px - qx) ** 2 + (py - qy) ** 2 + (pz - qz) ** 2
    va = d3 * d6 - d5 * d4
    if va <= 0 and d4 - d3 >= 0 and d5 - d6 >= 0:
        e = (d4 - d3) + (d5 - d6); w = (d4 - d3) / e if e else 0.0; qx, qy, qz = bx + w * (cx - bx), by + w * (cy - by), bz + w * (cz - bz)
        return (px - qx) ** 2 + (py - qy) ** 2 + (pz - qz) ** 2
    den = va + vb + vc
    if den == 0:  # degenerate triangle: nearest of its three vertices (edges are covered by the branches above)
        return min(apx * apx + apy * apy + apz * apz, bpx * bpx + bpy * bpy + bpz * bpz, cpx * cpx + cpy * cpy + cpz * cpz)
    v = vb / den; w = vc / den
    qx, qy, qz = ax + abx * v + acx * w, ay + aby * v + acy * w, az + abz * v + acz * w
    return (px - qx) ** 2 + (py - qy) ** 2 + (pz - qz) ** 2


class TriGrid:
    """uniform grid over triangles for nearest-surface queries"""
    def __init__(self, V, F, owner, cell):
        self.V, self.F, self.owner, self.c = V, F, owner, cell
        inv = 1.0 / cell; fl = math.floor; cells = {}
        lo = [math.inf] * 3; hi = [-math.inf] * 3
        for t in range(len(F) // 3):
            i0, i1, i2 = 3 * F[3 * t], 3 * F[3 * t + 1], 3 * F[3 * t + 2]
            xs = (V[i0], V[i1], V[i2]); ys = (V[i0 + 1], V[i1 + 1], V[i2 + 1]); zs = (V[i0 + 2], V[i1 + 2], V[i2 + 2])
            a0, a1 = fl(min(xs) * inv), fl(max(xs) * inv); b0, b1 = fl(min(ys) * inv), fl(max(ys) * inv); c0, c1 = fl(min(zs) * inv), fl(max(zs) * inv)
            for i in range(a0, a1 + 1):
                for j in range(b0, b1 + 1):
                    for k in range(c0, c1 + 1):
                        cells.setdefault((i, j, k), []).append(t)
            lo = [min(lo[0], a0), min(lo[1], b0), min(lo[2], c0)]; hi = [max(hi[0], a1), max(hi[1], b1), max(hi[2], c1)]
        self.cells, self.lo, self.hi = cells, lo, hi

    def nearest(self, p, only_owner=None):
        """(distance, triangle) of the closest triangle (optionally only triangles of one owner)"""
        V, F, c, cells, owner = self.V, self.F, self.c, self.cells, self.owner
        px, py, pz = p; inv = 1.0 / c
        ci, cj, ck = math.floor(px * inv), math.floor(py * inv), math.floor(pz * inv)
        rmax = max(abs(ci - self.lo[0]), abs(ci - self.hi[0]), abs(cj - self.lo[1]), abs(cj - self.hi[1]),
                   abs(ck - self.lo[2]), abs(ck - self.hi[2])) + 1
        best, bt, seen, r = math.inf, -1, set(), 0
        while r <= rmax:
            if r >= 1 and (r - 1) * c > math.sqrt(best): break
            rng = range(-r, r + 1)
            for di in rng:
                for dj in rng:
                    dks = rng if (abs(di) == r or abs(dj) == r) else ((-r, r) if r else (0,))
                    for dk in dks:
                        key = (ci + di, cj + dj, ck + dk); lst = cells.get(key)
                        if lst is None: continue
                        i, j, k = key
                        gx = max(i * c - px, 0.0, px - (i + 1) * c); gy = max(j * c - py, 0.0, py - (j + 1) * c); gz = max(k * c - pz, 0.0, pz - (k + 1) * c)
                        if gx * gx + gy * gy + gz * gz >= best: continue
                        for t in lst:
                            if t in seen: continue
                            seen.add(t)
                            if only_owner is not None and owner[t] != only_owner: continue
                            i0, i1, i2 = 3 * F[3 * t], 3 * F[3 * t + 1], 3 * F[3 * t + 2]
                            d2 = tri_d2(px, py, pz, V[i0], V[i0 + 1], V[i0 + 2], V[i1], V[i1 + 1], V[i1 + 2], V[i2], V[i2 + 1], V[i2 + 2])
                            if d2 < best: best, bt = d2, t
            r += 1
        return math.sqrt(best), bt


def layer_mesh(g):
    """all triangles of a GLB in one vertex / index array, with the node index of every triangle"""
    V = array('f'); F = array('l'); owner = array('l'); off = 0; names = []
    for ni, nd in enumerate(g.J['nodes']):
        P = g.positions(nd['mesh']); I = g.indices(nd['mesh'])
        V.extend(P); F.extend(i + off for i in I); owner.extend([ni] * (len(I) // 3)); off += len(P) // 3; names.append(nd['name'])
    return V, F, owner, names


# ------------------------------------------------------------------------------------------------ term scan
def term_hits(text):
    """forbidden terms found in text: list of (category, mode, n)"""
    sha = lambda s: hashlib.sha256(s.encode('utf-8')).hexdigest()
    by = {}
    for cat, mode, n, h in FORBIDDEN: by.setdefault(mode, {}).setdefault(n, {})[h] = cat
    hits = []
    if 'i' in by:
        runs = {r.lower() for r in re.findall(r'[A-Za-z0-9_.@-]+', text) if re.search('[A-Za-z]', r)}
        for n, tab in by['i'].items():
            subs = {r[k:k + n] for r in runs if len(r) >= n for k in range(len(r) - n + 1)}
            hits += [(tab[sha(s)], 'i', n) for s in subs if sha(s) in tab]
    if 'w' in by:
        words = set(re.findall(r'[A-Za-z0-9_]+', text))
        for n, tab in by['w'].items():
            hits += [(tab[sha(wd)], 'w', n) for wd in words if len(wd) == n and sha(wd) in tab]
    if 'c' in by:
        runs = set(re.findall('[⺀-鿿豈-﫿]+', text))
        for n, tab in by['c'].items():
            subs = {r[k:k + n] for r in runs if len(r) >= n for k in range(len(r) - n + 1)}
            hits += [(tab[sha(s)], 'c', n) for s in subs if sha(s) in tab]
    for mode in ('p', 'P'):
        if mode not in by: continue
        words = re.findall('[A-Za-z]+', text)
        if mode == 'p': words = [w.lower() for w in words]
        for n, tab in by[mode].items():
            grams = {' '.join(words[k:k + n]) for k in range(len(words) - n + 1)}
            hits += [(tab[sha(s)], mode, n) for s in grams if sha(s) in tab]
    return hits


SLASH = '/'
PATH_RE = re.compile('|'.join(re.escape(s) for s in (SLASH + 'Users' + SLASH, SLASH + 'home' + SLASH, SLASH + 'private' + SLASH + 'tmp',
                                                       ':' + '\\' + 'Users' + '\\', 'file:' + SLASH * 2)))
IP_RE = re.compile(r'(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])')
MAIL_RE = re.compile(r'[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+')


def scan_problems(text):
    p = [f'{cat} (term #{n}{mode})' for cat, mode, n in term_hits(text)]
    p += [f'absolute path {m!r}' for m in set(PATH_RE.findall(text))]
    p += [f'IP address {m}' for m in set(IP_RE.findall(text))]
    p += [f'e-mail address {m}' for m in set(MAIL_RE.findall(text)) if m not in CONTACT]
    return p


# ------------------------------------------------------------------------------------------------ main
def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--root', default=os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    ap.add_argument('--skip-bone', action='store_true', help='check nearest_bone names only (skips the full recomputation)')
    a = ap.parse_args()
    root = a.root; D = lambda *p: os.path.join(root, *p)
    t0 = time.time()
    print(f'Acu361 validate  (root {os.path.basename(os.path.abspath(root))}, Python {sys.version.split()[0]})')

    # manifest ---------------------------------------------------------------------------------------------------
    man = json.load(open(D('data', 'manifest.json'), encoding='utf-8'))
    bad = []
    listed = set()
    for f in man['files']:
        listed.add(f['path']); fp = D(*f['path'].split('/'))
        if not os.path.isfile(fp): bad.append(f'{f["path"]} missing'); continue
        if os.path.getsize(fp) != f['bytes']: bad.append(f'{f["path"]} size {os.path.getsize(fp)} != {f["bytes"]}'); continue
        h = hashlib.sha256()
        with open(fp, 'rb') as fh:
            for b in iter(lambda: fh.read(1 << 20), b''): h.update(b)
        if h.hexdigest() != f['sha256']: bad.append(f'{f["path"]} sha256 differs')
    present = set()
    for dp, dn, fn in os.walk(D('data')):
        for n in fn:
            rel = os.path.relpath(os.path.join(dp, n), root).replace(os.sep, '/')
            if rel != 'data/manifest.json' and not n.startswith('.'): present.add(rel)
    bad += [f'{p} not listed in the manifest' for p in sorted(present - listed)]
    report('manifest', not bad, f'{len(man["files"])} files, bytes and sha256 match, no unlisted files' if not bad else '; '.join(bad[:10]))

    # schema -----------------------------------------------------------------------------------------------------
    docs = {}
    for name in ('points', 'meridians', 'rulers', 'manifest'):
        doc = json.load(open(D('data', f'{name}.json'), encoding='utf-8')); docs[name] = doc
        sch = json.load(open(D('schema', f'{name}.schema.json'), encoding='utf-8'))
        if sch.get('$schema') != 'https://json-schema.org/draft/2020-12/schema': report(f'schema {name}', False, 'not a draft 2020-12 schema'); continue
        errs = schema_errors(doc, sch, sch)
        report(f'schema {name}', not errs, f'data/{name}.json valid against schema/{name}.schema.json' if not errs else
               f'{len(errs)} errors: ' + '; '.join(errs[:8]))
    P = docs['points']['points']

    # points -----------------------------------------------------------------------------------------------------
    bad = []
    ids = [p['id'] for p in P]; dup = [k for k, n in Counter(ids).items() if n > 1]
    if dup: bad.append(f'duplicate ids {dup[:5]}')
    for p in P:
        if p['id'] != f'{p["code"]}_{p["side"]}': bad.append(f'{p["id"]}: id is not <code>_<side>')
        if p['code'] != f'{p["meridian"]}{p["index"]}': bad.append(f'{p["id"]}: code is not <meridian><index>')
        if (p['side'] == 'M') != (p['meridian'] in MIDLINE): bad.append(f'{p["id"]}: side {p["side"]} on meridian {p["meridian"]}')
    sides = {}
    for p in P: sides.setdefault(p['code'], set()).add(p['side'])
    for c, s in sides.items():
        if s not in ({'L', 'R'}, {'M'}): bad.append(f'{c}: sides {sorted(s)}')
    codes = sorted(sides, key=lambda c: (WHO_ORDER.index(re.match('[A-Z]+', c).group()), int(re.sub(r'\D', '', c))))
    per = Counter(re.match('[A-Z]+', c).group() for c in codes)
    for m in WHO_ORDER:
        want = [f'{m}{i}' for i in range(1, WHO_COUNTS[m] + 1)]
        got = [c for c in codes if re.match('[A-Z]+', c).group() == m]
        if got != want: bad.append(f'{m}: codes {got[:3]}... ({len(got)}) instead of {m}1..{m}{WHO_COUNTS[m]}')
    n_bi = sum(1 for s in sides.values() if s == {'L', 'R'}); n_mid = sum(1 for s in sides.values() if s == {'M'})
    if (len(codes), len(P), n_bi, n_mid) != (361, 670, 309, 52): bad.append(f'{len(codes)} codes, {len(P)} points, {n_bi} bilateral, {n_mid} midline')
    if docs['points']['counts']['points_per_meridian'] != {m: sum(1 for p in P if p['meridian'] == m) for m in WHO_ORDER}: bad.append('points_per_meridian in the header')
    report('points', not bad, f'{len(codes)} codes, {len(P)} points ({n_bi} bilateral x 2 + {n_mid} midline), ids unique; codes per meridian '
           + ' '.join(f'{m}{per[m]}' for m in WHO_ORDER) if not bad else '; '.join(bad[:10]))

    # symmetry ---------------------------------------------------------------------------------------------------
    pos = {p['id']: p['pos'] for p in P}
    res = [(math.dist(pos[f'{p["code"]}_R'], (-p['pos'][0], p['pos'][1], p['pos'][2])), p['code']) for p in P if p['side'] == 'L']
    mres = max(res); mx = max((abs(p['pos'][0]), p['id']) for p in P if p['side'] == 'M')
    report('mirror', mres[0] <= TOL_MIRROR_MM, f'{len(res)} pairs, max |R - mirror(L)| = {mres[0]:.4f} mm ({mres[1]}), tolerance {TOL_MIRROR_MM} mm')
    report('midline', mx[0] <= TOL_MIDLINE_MM, f'{n_mid} midline points, max |x| = {mx[0]:.2f} mm ({mx[1]}), tolerance {TOL_MIDLINE_MM} mm')

    # GLB --------------------------------------------------------------------------------------------------------
    glbs, bad, all_names = {}, [], Counter()
    for L in LAYERS:
        g = GLB(D('data', 'body', f'{L}.glb')); glbs[L] = g
        p, nv, nt = check_glb_structure(g)
        want = man['counts']['body_layers'][L]
        got = {'nodes': len(g.J['nodes']), 'meshes': len(g.J['meshes']), 'vertices': nv, 'triangles': nt}
        if got != want: p.append(f'counts {got} != manifest {want}')
        names = [nd['name'] for nd in g.J['nodes']]
        if len(set(names)) != len(names): p.append('duplicate node names')
        all_names.update(names)
        bad += [f'{L}.glb: {x}' for x in p]
    cross = [n for n, k in all_names.items() if k > 1]
    if cross: bad.append(f'node names repeated across layers: {cross[:5]}')
    dmg = sorted(DAMAGED_NAMES & set(all_names))
    tot = {k: sum(man['counts']['body_layers'][L][k] for L in LAYERS) for k in ('nodes', 'vertices', 'triangles')}
    report('glb', not bad, f'7 files parse; one node + one mesh per object, POSITION/NORMAL float32 + uint32 indices, min/max match; '
           f'{tot["nodes"]} nodes, {tot["vertices"]} vertices, {tot["triangles"]} triangles as in the manifest; node names unique; '
           f'extras keys within {sorted(EXTRAS_KEYS)}; upstream-damaged names present: {dmg}' if not bad else '; '.join(bad[:10]))

    # skin -------------------------------------------------------------------------------------------------------
    t1 = time.time()
    SV, SF, SO, _ = layer_mesh(glbs['skin'])
    skin = TriGrid(SV, SF, SO, 12.0)
    ds = sorted((skin.nearest(p['pos'])[0], p['id']) for p in P)
    med = ds[len(ds) // 2][0]
    report('skin', ds[-1][0] <= TOL_SKIN_MM, f'point to skin surface: median {med:.4f} mm, max {ds[-1][0]:.4f} mm ({ds[-1][1]}), tolerance '
           f'{TOL_SKIN_MM} mm  [{time.time() - t1:.1f} s]')

    # bone -------------------------------------------------------------------------------------------------------
    t1 = time.time()
    bone_names = [nd['name'] for nd in glbs['bone'].J['nodes']]
    miss = sorted({p['nearest_bone'] for p in P} - set(bone_names))
    if miss or a.skip_bone:
        report('bone names', not miss, f'all {len({p["nearest_bone"] for p in P})} distinct nearest_bone values are node names of bone.glb'
               if not miss else f'not in bone.glb: {miss[:10]}')
    if not miss and not a.skip_bone:
        BV, BF, BO, _ = layer_mesh(glbs['bone'])
        grid = TriGrid(BV, BF, BO, 8.0)
        bad = []; worst = 0.0
        for p in P:
            d, t = grid.nearest(p['pos']); name = bone_names[BO[t]]
            if name != p['nearest_bone']:
                d_named, _ = grid.nearest(p['pos'], only_owner=bone_names.index(p['nearest_bone']))
                if d_named - d > 0.01: bad.append(f'{p["id"]}: nearest is {name} ({d:.2f} mm), not {p["nearest_bone"]} ({d_named:.2f} mm)')
            dev = abs(d - p['bone_distance_mm']); worst = max(worst, dev)
            if dev > TOL_BONE_MM: bad.append(f'{p["id"]}: bone distance {d:.3f} mm vs {p["bone_distance_mm"]}')
        bd = sorted(p['bone_distance_mm'] for p in P)
        report('bone', not bad, f'all nearest_bone values are bone.glb node names; nearest bone recomputed for {len(P)} points: all agree, '
               f'max |bone_distance_mm - recomputed| = {worst:.3f} mm (rounding 0.05); bone_distance_mm median {bd[len(bd) // 2]}, '
               f'max {bd[-1]}  [{time.time() - t1:.1f} s]' if not bad else f'{len(bad)} problems: ' + '; '.join(bad[:8]))

    # meridians --------------------------------------------------------------------------------------------------
    t1 = time.time()
    M = docs['meridians']; bad = []; covered = set(); n_seg = n_samp = 0; knot_max = (0, ''); jump_max = (0, ''); dsamp = []
    side_of = {p['code']: sides[p['code']] for p in P}
    for m in WHO_ORDER:
        lines = M['meridians'][m]['lines']
        want_sides = {'M'} if m in MIDLINE else {'L', 'R'}
        if set(lines) != want_sides: bad.append(f'{m}: sides {sorted(lines)}')
        for side, segs in lines.items():
            ids_ = [s['id'] for s in segs]
            if len(set(ids_)) != len(ids_): bad.append(f'{m} {side}: duplicate segment ids')
            for s in segs:
                n_seg += 1; n_samp += len(s['points']); tag = f'{m} {side} {s["id"]}'
                if len(s['knots']) != len(s['codes']) or s['knots'] != sorted(s['knots']) or s['knots'][0] != 0 or s['knots'][-1] != len(s['points']) - 1:
                    bad.append(f'{tag}: knots'); continue
                for c, k in zip(s['codes'], s['knots']):
                    refs = c.split(':')[1:] if c.startswith('mid:') else [c]
                    for cc in refs:
                        if cc not in side_of: bad.append(f'{tag}: unknown code {cc}')
                    if c.startswith('mid:') or c not in side_of: continue
                    if c in s['via'] and re.match('[A-Z]+', c).group() == m: bad.append(f'{tag}: {c} marked via on its own meridian')
                    if c not in s['via']:
                        if re.match('[A-Z]+', c).group() != m: bad.append(f'{tag}: {c} belongs to another meridian but is not in via')
                        covered.add(c)
                    pid = f'{c}_{side}' if f'{c}_{side}' in pos else f'{c}_M'
                    d = math.dist(s['points'][k], pos[pid]); knot_max = max(knot_max, (d, f'{tag} {c}'))
                for v in s['via']:
                    if v not in s['codes']: bad.append(f'{tag}: via {v} not in codes')
                for q0, q1 in zip(s['points'], s['points'][1:]):
                    jump_max = max(jump_max, (math.dist(q0, q1), tag))
                dsamp += [skin.nearest(q)[0] for q in s['points']]
    miss_cov = [c for c in codes if c not in covered]
    if miss_cov: bad.append(f'points on no line of their meridian: {miss_cov[:10]}')
    if knot_max[0] > TOL_KNOT_MM: bad.append(f'knot {knot_max[1]} is {knot_max[0]:.2f} mm from its point')
    if jump_max[0] > TOL_JUMP_MM: bad.append(f'gap of {jump_max[0]:.1f} mm between samples in {jump_max[1]}')
    if (n_seg, n_samp) != (M['counts']['segments'], M['counts']['samples']): bad.append('counts in the header')
    dsamp.sort(); dmed = dsamp[len(dsamp) // 2]; n_out = sum(1 for d in dsamp if d < 0.5 or d > 3.0)
    if dsamp[-1] > TOL_LINE_SKIN_MM: bad.append(f'a sample is {dsamp[-1]:.2f} mm from the skin')
    report('meridians', not bad, f'14 meridians, {n_seg} segments, {n_samp} samples; every code resolves, all {len(covered)} codes lie on a line of '
           f'their meridian; knot to point max {knot_max[0]:.2f} mm; max gap between samples {jump_max[0]:.1f} mm; sample to skin median '
           f'{dmed:.2f}, min {dsamp[0]:.2f}, max {dsamp[-1]:.2f} mm ({n_out} samples outside 0.5-3 mm)  [{time.time() - t1:.1f} s]'
           if not bad else '; '.join(bad[:10]))

    # rulers -----------------------------------------------------------------------------------------------------
    R = docs['rulers']; bad = []; used = set(); n_inst = 0
    lm = R['landmarks']
    for r in R['rulers']:
        isides = [i['side'] for i in r['instances']]
        if len(set(isides)) != len(isides): bad.append(f'{r["id"]}: repeated instance side')
        if 'side' in r and isides != [r['side']]: bad.append(f'{r["id"]}: instances {isides} for a {r["side"]}-only ruler')
        for i in r['instances']:
            n_inst += 1
            for e, q in ((r['from'], i['a']), (r['to'], i['b'])):
                if 'landmark' in e:
                    used.add(e['landmark'])
                    if e['landmark'] not in lm: bad.append(f'{r["id"]}: unknown landmark {e["landmark"]}'); continue
                    ref = lm[e['landmark']]['pos']
                else:
                    sd = e.get('side') or (i['side'] if i['side'] in ('L', 'R') else 'M')
                    pid = f'{e["code"]}_{sd}' if f'{e["code"]}_{sd}' in pos else f'{e["code"]}_M'
                    if pid not in pos: bad.append(f'{r["id"]} {i["side"]}: no point {pid}'); continue
                    ref = pos[pid]
                if math.dist(ref, q) > TOL_POS_MM: bad.append(f'{r["id"]} {i["side"]}: endpoint {q} != {ref}')
            if abs(math.dist(i['a'], i['b']) - i['length_mm']) > 0.051: bad.append(f'{r["id"]} {i["side"]}: length_mm')
    unused = sorted(set(lm) - used)
    if unused: bad.append(f'unused landmarks {unused}')
    if (len(R['rulers']), n_inst, len(lm)) != (R['counts']['rulers'], R['counts']['instances'], R['counts']['landmarks']): bad.append('counts in the header')
    report('rulers', not bad, f'{len(R["rulers"])} rulers, {n_inst} instances, {len(lm)} landmarks; every endpoint resolves to a point or landmark '
           f'and matches the instance coordinates (<= {TOL_POS_MM} mm); lengths match' if not bad else '; '.join(bad[:10]))

    # terms ------------------------------------------------------------------------------------------------------
    t1 = time.time(); bad = []; n_text = 0
    for dp, dn, fn in os.walk(root):
        dn[:] = [d for d in dn if not d.startswith('.') and d != '__pycache__']
        for n in sorted(fn):
            fp = os.path.join(dp, n); rel = os.path.relpath(fp, root).replace(os.sep, '/')
            if n.startswith('.'): continue
            if n.endswith('.glb'):
                text = glbs[n[:-4]].json_text if dp == D('data', 'body') and n[:-4] in glbs else GLB(fp).json_text
                rel += ' (JSON chunk)'
            else:
                text = open(fp, 'rb').read().decode('utf-8', errors='replace'); n_text += 1
            bad += [f'{rel}: {x}' for x in scan_problems(text)]
    report('terms', not bad, f'{n_text} text files and 7 GLB JSON chunks: 0 occurrences of {len(FORBIDDEN)} internal terms, absolute user paths, '
           f'IP addresses or e-mail addresses other than the contact  [{time.time() - t1:.1f} s]' if not bad else f'{len(bad)} hits: ' + '; '.join(bad[:12]))

    n_fail = sum(1 for _, ok in RESULTS if not ok)
    print(f'{len(RESULTS) - n_fail} PASS, {n_fail} FAIL  ({time.time() - t0:.1f} s)')
    return 1 if n_fail else 0


if __name__ == '__main__':
    sys.exit(main())
