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

## Snapping: pick the source vertex, drop it on a target

The magnet in the toolbar (`S` in Object Mode) enables snapping. Options: **grid points**,
**vertex**, **edge midpoint**, **weld on drop** and a screen-space **radius** in pixels.

The flow that the snapping is built around:

1. Hover a vertex of the selection — it highlights green. That vertex becomes the **snap
   source** (blue marker) when the drag starts, so you decide *which* corner you are grabbing
   instead of always moving from the pivot.
2. Drag with the gizmo, or press `G`. The source vertex sticks to the nearest target vertex /
   midpoint / grid point under the cursor (yellow marker).
3. Release. With **weld on drop** enabled, a source vertex snapped onto a vertex of the *same*
   mesh is merged into it, so the two become a single watertight vertex.

To weld across two different objects, join them first with `Ctrl+J` and then snap + drop.

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

## Tests

```bash
npm run test:geometry   # 24 tests on the mesh kernel
npm run test:store      # 15 tests driving the real store through the modelling workflows
```

They compile the real `editGeometry.ts` / `store.ts` with `tsc` into `.tmp-test/` and run them
in Node, so the assertions exercise the shipped code paths (conversion, extrude, snap-weld,
undo/redo, join, separate, primitive drawing).
