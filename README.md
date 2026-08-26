# PolyView 3D Editor

A browser 3D **modeler** in the spirit of Blender / 3ds Max: multi-viewport, object mode
plus a real polygon **Edit Mode** with vertex / edge / face editing, snapping and welding.

## Run Locally

**Prerequisites:** Node.js

```bash
npm install
npm run dev          # http://localhost:3000
npm run build        # production bundle in dist/
npm test             # geometry kernel + store integration tests
```

## Two modes

| | Object Mode | Edit Mode |
|---|---|---|
| Switch | `Tab` | `Tab` |
| Works on | whole objects | vertices / edges / faces of one mesh |
| Entering | — | converts the primitive into an editable polygon mesh ("make editable", 3ds Max style) |

Edit Mode shows the wireframe, all vertices and the current sub-object selection, and dims
every other object so you can see what you are editing.

## Sub-object modes

`1` vertices · `2` edges · `3` faces — click, `Shift`/`Ctrl`-click to add/remove, drag a box
to select (box = fully inside test on the element centre), double-click or `L` to select the
connected/linked mesh, `[` / `]` to shrink / grow, `Ctrl+I` to invert, `A` all, `Alt+A` none.

## Modelling operations

| Key | Action |
|---|---|
| `G` `R` `S` | modal grab / rotate / scale, then `X` `Y` `Z` to lock an axis, `LMB`/`Enter` to confirm, `Esc`/`RMB` to cancel |
| `E` | extrude (faces → cap + side walls, edges → quad, vertices → loose edge) and immediately move |
| `F` | create a face from 3+ vertices, an edge from 2, or a face from a closed edge loop |
| `Ctrl+R` | subdivide (quad → 4 quads, triangle → 4 triangles) |
| `Ctrl+T` | triangulate |
| `Alt+M` | merge / weld the selection (at center, at target, at first, at last, or by distance) |
| `V` | weld by distance (removes duplicated vertices) |
| `X` / `Del` | delete the selected elements |
| `Shift+N` | flip normals |
| `P` | separate the mesh into its loose parts |
| `Ctrl+J` | (Object Mode) join the selected objects into one editable mesh |

The transform gizmo works in Edit Mode too and moves/rotates/scales the sub-object selection.

## Snapping: grab a vertex, drop it on another one

The magnet in the toolbar (`S` in Object Mode) enables snapping. Options: **grid points**,
**vertex**, **edge midpoint**, **weld on drop** and a screen-space **radius** in pixels.

Markers: **yellow ring** = the vertex you are about to grab · **blue dot** = the snap source
during the drag · **pink dot** = the target it is sticking to · **green dot** = a grid point.

### Grabbing from a vertex

Hover any vertex of the selected mesh: a yellow ring appears over it. **Press and drag that
ring** — the selection moves from that vertex (not from the pivot), and it sticks to the
nearest vertex / midpoint / grid point under the cursor. Releasing the button confirms; a
click without moving is just a selection.

The same works from the gizmo: hover a vertex first and the gizmo drag will use it as the
snap source. `G` also starts the move from the vertex closest to the cursor.

With **weld on drop** enabled, a source vertex snapped onto a vertex of the *same* mesh is
merged into it, so the two become a single watertight vertex. To weld across two different
objects, join them first with `Ctrl+J` and then snap + drop.

### Axis constraints

Snapping respects the active constraint, so a locked axis never drags the others along:

- Gizmo: drag the **X arrow** and the snap only changes X (the XY/XZ/YZ squares move two axes,
  the centre ball moves all three).
- Modal transform: `G` then `X`, `Y` or `Z` locks that axis; press it again to go back to free.
  The locked axes keep their exact value even while the source is snapped to a target.

`components/axisConstraint.ts` holds that logic and is unit tested (`npm run test:axis`).

## Primitives

Cube, sphere, plane, cylinder, cone and torus. They are drawn click-drag (base) then
click (height/radius). Any of them can be converted into an editable mesh with `Tab`.

## Project layout

| File | Role |
|---|---|
| `types.ts` | shared types (`MeshData`, edit-mode state, snap settings) |
| `editGeometry.ts` | **pure** mesh kernel: triangulation, render data, extrude / merge / weld / subdivide / create-face / delete, selection ops, primitive → mesh, join / separate |
| `store.ts` | zustand store: scene, selection, history, edit-mode actions |
| `components/Viewport3D.tsx` | viewports, cameras, grid, object gizmo, object-mode snapping |
| `components/EditModeController.tsx` | edit-mode picking, box select, gizmo, modal transforms, snap markers |
| `components/EditableMesh.tsx` | mesh surface, wireframe and sub-object overlays |
| `components/snapping.ts` | world/screen projection, snap target gathering and queries |
| `components/axisConstraint.ts` | axis masks: keeps a snap from moving locked axes |
| `components/editPicking.ts` | pixel -> vertex/edge/face resolution and box selection |

## Tests

```bash
npm run test:geometry   # 24 tests on the mesh kernel
npm run test:axis       # 13 tests on the axis constraint used by snapping
npm run test:picking    # 19 tests on click -> element picking and click -> selection rules
npm run test:store      # 15 tests driving the real store through the modelling workflows
npm run test:workflow   #  8 tests for the snap-a-vertex-onto-another-object workflow
```

`npm test` runs all five (79 groups).

The picking suite builds real perspective and orthographic cameras in Node — no WebGL — and
covers what is easy to get wrong by eye: elements that overlap on screen resolve to the one
closest to the camera, so a cube seen from a corner gives you the visible corner and not the
hidden one behind it.

`test:workflow` reproduces the reported case end to end: edit cube A, grab a vertex, snap it
onto a vertex of cube B with every axis free and then locked to X, and assert that the locked
axes keep their exact value while X lands on the target.

They compile the real `editGeometry.ts` / `store.ts` with `tsc` into `.tmp-test/` and run them
in Node, so the assertions exercise the shipped code paths (conversion, extrude, snap-weld,
undo/redo, join, separate, primitive drawing).
