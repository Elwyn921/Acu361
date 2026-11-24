# GLB conventions

`data/body/<layer>.glb` holds the Z-Anatomy male body, standing and undeformed, split into seven layers. How the files were made from Z-Anatomy is listed under *Changes made* in `ATTRIBUTIONS.md`. `scripts/validate.py` checks the points below.

## Files

| layer | content | nodes = meshes | vertices | triangles |
|---|---|---:|---:|---:|
| `skin` | skin (Regions of human body), one merged mesh | 1 | 28,271 | 50,876 |
| `bone` | Skeletal system without its cartilages | 246 | 291,940 | 582,676 |
| `ligament` | Joints, plus the cartilages of the Skeletal system | 380 | 70,317 | 123,334 |
| `muscle` | Muscular system | 675 | 384,877 | 759,653 |
| `organ` | Visceral systems, Lymphoid organs, heart | 277 | 143,956 | 276,206 |
| `vessel` | Cardiovascular system without the heart | 653 | 111,771 | 206,006 |
| `nerve` | Nervous system & Sense organs | 580 | 237,152 | 451,795 |
| total | | 2,812 | 1,268,284 | 2,450,546 |

## Container

- glTF 2.0 binary: 12-byte header, one JSON chunk, one BIN chunk, both 4-byte aligned.
- `asset.generator` is `Acu361 1.0.1`; `asset.copyright` carries the attribution to Z-Anatomy and BodyParts3D.
- One scene listing every node. One node and one mesh per object (`meshes[nodes[i].mesh].name == nodes[i].name`). No hierarchy and no node transforms: vertex positions are already in the frame below.
- Each mesh has one primitive, `mode` 4 (triangles), with attributes `POSITION` and `NORMAL` (float32 VEC3) and `indices` (uint32 SCALAR). `POSITION` accessors carry `min` / `max` equal to the data.
- `NORMAL` holds per-vertex normals. 3,056 of the 1,268,284 vertices have the normal (0, 0, 0) because no non-degenerate triangle uses them; do not rely on normals there.
- No materials, textures, images, UVs, vertex colours, skins, animations or cameras. A viewer assigns its own materials.

## Units and frame

Millimetres. +x toward the body's left, +y up, +z anterior (the body faces +z), right-handed (glTF convention). The origin is Z-Anatomy's own: x = 0 is the mid-sagittal plane of the model and the soles are at y = 0 (skin bounding box x -339.99 to 339.99, y -0.38 to 1709.15, z -148.34 to 145.65). The JSON files in `data/` use the same frame.

## Node names

`node.name` is the Z-Anatomy object name, with the suffix `.l` or `.r` for objects of the left or right side (e.g. `Hip bone.l`). Names are unique within each file and across all seven files (2,812 names). `nearest_bone` in `data/points.json` is always one of the node names of `bone.glb`, written exactly as here.

Names are kept exactly as they are upstream, including:

- three names damaged by a character-encoding problem in Z-Anatomy, all in `vessel.glb`: `????????` (parent group *Coronary sinus*) and `?x.l`, `?x.r` (parent group *Artery of pterygoid canal*);
- two names that begin with a space: ` Posterior transverse collateral sulcus.l` and ` Posterior transverse collateral sulcus.r` (`nerve.glb`);
- upstream punctuation such as asterisks, parentheses and underscores (e.g. `Lat_Fis-ant-Vertical.l`).

## Node extras

| key | meaning |
|---|---|
| `group_en` | name of the object's parent in the Z-Anatomy hierarchy (Z-Anatomy's group suffix `.g` removed), e.g. `Bones of cranium`; `Integument` for the skin |
| `how` | `rest` on every node: the object is in Z-Anatomy's original position, not deformed |

The JSON chunks were rewritten for this release; the BIN chunks (all geometry) were not changed.

## Winding and rendering

Z-Anatomy objects do not share one winding convention. Each object was flipped where needed so that its signed volume is positive, which makes closed meshes face outward. For thin sheets and open shells (membranes, fascia, sinus walls) the winding has no meaning. Render with double-sided materials.

## Not in the GLB files

Acupoints, meridian lines and rulers are not glTF nodes; they are in `data/points.json`, `data/meridians.json` and `data/rulers.json`.
