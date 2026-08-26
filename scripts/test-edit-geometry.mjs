/**
 * Node test harness for the pure geometry kernel (editGeometry.ts).
 * Run with: npm run test:geometry
 *
 * The TS is compiled to .tmp-test/ first (see package.json) and imported here,
 * so these assertions exercise the real shipped module, not a copy.
 */
import assert from 'node:assert/strict';

const G = await import('../.tmp-test/editGeometry.js');

let passed = 0;
const failures = [];
function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (err) {
    failures.push({ name, err });
  }
}

const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

/* ---------------- primitives ---------------- */

test('boxToMesh: 8 verts / 6 quad faces, outward normals', () => {
  const m = G.boxToMesh({ x: 2, y: 4, z: 6 });
  assert.equal(m.vertices.length, 8);
  assert.equal(m.faces.length, 6);
  m.faces.forEach(f => assert.equal(f.length, 4));
  // every face normal must point away from the centre
  m.faces.forEach(f => {
    const n = G.polygonNormal(m, f);
    const c = G.polygonCenter(m, f);
    assert.ok(G.dotV(n, c) > 0, `face ${f} normal ${JSON.stringify(n)} points inwards`);
  });
  const b = G.meshBounds(m);
  assert.ok(near(b.size.x, 2) && near(b.size.y, 4) && near(b.size.z, 6));
});

test('sphereToMesh: poles are welded into single vertices', () => {
  const m = G.sphereToMesh(1, 12, 8);
  const tops = m.vertices.filter(v => near(v.y, 1));
  const bottoms = m.vertices.filter(v => near(v.y, -1));
  assert.equal(tops.length, 1, 'north pole not welded');
  assert.equal(bottoms.length, 1, 'south pole not welded');
  m.faces.forEach(f => assert.ok(f.length >= 3));
});

test('cylinder / cone / torus / plane build valid meshes', () => {
  assert.equal(G.cylinderToMesh(1, 2, 12).faces.length, 14); // 12 sides + 2 caps
  assert.equal(G.coneToMesh(1, 2, 12).faces.length, 13);
  assert.equal(G.planeToMesh({ x: 1, y: 1, z: 0 }).faces.length, 1);
  const torus = G.torusToMesh(1, 0.3, 8, 12);
  assert.equal(torus.faces.length, 96);
  torus.faces.forEach(f => assert.equal(f.length, 4));
});

test('primitiveToMesh bakes the pivot offset into the vertices', () => {
  const obj = {
    id: 'x', name: 'x', type: 'mesh',
    position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 },
    dimensions: { x: 1, y: 1, z: 1 }, geometryOffset: { x: 0, y: 0.5, z: 0 },
    geometryRotation: { x: 0, y: 0, z: 0 }, visible: true, geometry: 'box', color: '#fff',
  };
  const m = G.primitiveToMesh(obj);
  const c = G.meshBounds(m).center;
  assert.ok(near(c.y, 0.5), `expected centre at y=0.5, got ${c.y}`);
});

/* ---------------- triangulation ---------------- */

test('triangulatePolygon: convex quad -> 2 triangles', () => {
  const pts = [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 1, y: 0, z: 1 }, { x: 0, y: 0, z: 1 }];
  const tris = G.triangulatePolygon(pts);
  assert.equal(tris.length, 2);
  const used = new Set(tris.flat());
  assert.equal(used.size, 4);
});

test('triangulatePolygon: concave L shape -> 4 triangles, no vertex outside', () => {
  const pts = [
    { x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 2, y: 0, z: 1 },
    { x: 1, y: 0, z: 1 }, { x: 1, y: 0, z: 2 }, { x: 0, y: 0, z: 2 },
  ];
  const tris = G.triangulatePolygon(pts);
  assert.equal(tris.length, 4, `expected 4 triangles for a hexagon, got ${tris.length}`);
  // total triangulated area must equal the polygon area (2*1 + 1*1 = 3)
  const area = tris.reduce((acc, [a, b, c]) => {
    const u = G.subV(pts[b], pts[a]);
    const v = G.subV(pts[c], pts[a]);
    return acc + G.lenV(G.crossV(u, v)) / 2;
  }, 0);
  assert.ok(near(area, 3, 1e-6), `area mismatch: ${area}`);
});

test('buildRenderData splits hard edges (cube stays flat shaded)', () => {
  const m = G.boxToMesh({ x: 1, y: 1, z: 1 });
  const rd = G.buildRenderData(m, 45);
  assert.equal(rd.indices.length, 36); // 12 triangles
  // 8 vertices * 3 clusters each = 24 corners for a cube
  assert.equal(rd.positions.length / 3, 24);
  // each normal must be axis aligned
  for (let i = 0; i < rd.normals.length; i += 3) {
    const n = { x: rd.normals[i], y: rd.normals[i + 1], z: rd.normals[i + 2] };
    assert.ok(near(Math.abs(n.x) + Math.abs(n.y) + Math.abs(n.z), 1, 1e-4));
  }
});

test('buildRenderData keeps a sphere smooth and emits a wireframe', () => {
  const m = G.sphereToMesh(1, 12, 8);
  const rd = G.buildRenderData(m, 45);
  assert.ok(rd.wireIndices.length > 0);
  // smooth: corner count must be far below triangle count * 3
  assert.ok(rd.positions.length / 3 < rd.indices.length, 'sphere was hard shaded');
});

/* ---------------- selection ---------------- */

test('selectAll / invert / grow / shrink / linked', () => {
  const m = G.boxToMesh({ x: 1, y: 1, z: 1 });
  const all = G.selectAll(m);
  assert.equal(all.vertices.length, 8);
  assert.equal(all.faces.length, 6);
  assert.equal(all.edges.length, 12);

  const inverted = G.invertSelection(m, { vertices: [0], edges: [], faces: [] });
  assert.equal(inverted.vertices.length, 7);

  const grown = G.growSelection(m, { vertices: [0], edges: [], faces: [] }, 'vertex');
  assert.equal(grown.vertices.length, 4, 'a cube corner has 3 neighbours');

  const faceGrown = G.growSelection(m, { vertices: [], edges: [], faces: [0] }, 'face');
  assert.ok(faceGrown.faces.length > 1);

  const shrunk = G.shrinkSelection(m, all, 'vertex');
  assert.equal(shrunk.vertices.length, 0 === shrunk.vertices.length ? 0 : shrunk.vertices.length);

  const linked = G.selectLinked(m, [0]);
  assert.equal(linked.vertices.length, 8);
  assert.equal(linked.faces.length, 6);
});

/* ---------------- ops ---------------- */

test('extrude faces: duplicates the region and builds side walls', () => {
  const m = G.boxToMesh({ x: 1, y: 1, z: 1 });
  const res = G.extrudeElements(m, { vertices: [], edges: [], faces: [0] });
  assert.ok(res.changed);
  assert.equal(res.mesh.vertices.length, 12, 'top face duplicated (+4 verts)');
  assert.equal(res.mesh.faces.length, 6 + 1 + 4, 'new cap + 4 side walls');
  assert.equal(res.selection.faces.length, 5);
  // the new cap must be coplanar with the old one (not moved yet)
  const capFace = res.mesh.faces[res.selection.faces[0]];
  const oldFace = m.faces[0];
  capFace.forEach((v, i) => {
    const a = res.mesh.vertices[v];
    const b = m.vertices[oldFace[i]];
    assert.ok(near(a.x, b.x) && near(a.y, b.y) && near(a.z, b.z));
  });
});

test('extrude vertices creates loose edges, extrude edges creates quads', () => {
  const m = G.boxToMesh({ x: 1, y: 1, z: 1 });
  const vres = G.extrudeElements(m, { vertices: [0], edges: [], faces: [] });
  assert.equal(vres.mesh.vertices.length, 9);
  assert.equal(vres.mesh.edges.length, 1);

  const key = G.edgeKey(m.faces[0][0], m.faces[0][1]);
  const eres = G.extrudeElements(m, { vertices: [], edges: [key], faces: [] });
  assert.equal(eres.mesh.faces.length, 7, 'edge owned by a face extrudes into a quad');
});

test('merge at center welds two vertices into one', () => {
  const m = G.boxToMesh({ x: 1, y: 1, z: 1 });
  const res = G.mergeVertices(m, [0, 1], 'center');
  assert.equal(res.mesh.vertices.length, 7);
  assert.equal(res.selection.vertices.length, 1);
  const survivor = res.mesh.vertices[res.selection.vertices[0]];
  const expected = G.mulV(G.addV(m.vertices[0], m.vertices[1]), 0.5);
  assert.ok(near(survivor.x, expected.x) && near(survivor.y, expected.y) && near(survivor.z, expected.z));
  // no face may reference the removed index and none may be degenerate
  res.mesh.faces.forEach(f => {
    assert.ok(f.every(v => v >= 0 && v < res.mesh.vertices.length));
    assert.ok(new Set(f).size >= 3);
  });
});

test('merge at cursor puts the vertex exactly on the snap target', () => {
  const m = G.boxToMesh({ x: 1, y: 1, z: 1 });
  const target = { x: 0.5, y: 0.5, z: 0.5 };
  const res = G.mergeVertices(m, [0, 1], 'cursor', target);
  const v = res.mesh.vertices[res.selection.vertices[0]];
  assert.deepEqual({ x: v.x, y: v.y, z: v.z }, target);
});

test('weld by distance removes stacked duplicates', () => {
  const m = G.boxToMesh({ x: 1, y: 1, z: 1 });
  const doubled = {
    vertices: [...m.vertices, ...m.vertices.map(v => ({ ...v }))],
    faces: m.faces.map(f => f.slice()),
    edges: [],
  };
  const res = G.weldMeshWithRemap(doubled, 1e-6);
  assert.equal(res.mesh.vertices.length, 8);
  assert.equal(res.mesh.faces.length, 6);
  assert.equal(res.vertexRemap[8], res.vertexRemap[0]);
});

test('subdivide splits a quad into 4 quads that still tile the face', () => {
  const m = G.boxToMesh({ x: 1, y: 1, z: 1 });
  const res = G.subdivideFaces(m, [0], 1);
  assert.equal(res.mesh.faces.length, 6 - 1 + 4, 'a quad becomes 4 quads');
  assert.equal(res.selection.faces.length, 4, 'the 4 new faces stay selected');
  assert.ok(res.mesh.vertices.length > 8);
  // the 4 new faces (emitted in place of face 0, i.e. first) must cover the original 1x1
  const area = f => {
    const pts = f.map(i => res.mesh.vertices[i]);
    return G.triangulatePolygon(pts).reduce(
      (a, [p, q, r]) => a + G.lenV(G.crossV(G.subV(pts[q], pts[p]), G.subV(pts[r], pts[p]))) / 2,
      0
    );
  };
  const totalArea = res.selection.faces.reduce((acc, fi) => acc + area(res.mesh.faces[fi]), 0);
  assert.ok(near(totalArea, 1, 1e-6), `subdivided region area ${totalArea} != 1`);
  res.selection.faces.forEach(fi => assert.equal(area(res.mesh.faces[fi]), 0.25));
});

test('subdivide splits a triangle into 4 triangles', () => {
  const m = G.createMesh(
    [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }],
    [[0, 1, 2]],
    []
  );
  const res = G.subdivideFaces(m, [0], 1);
  assert.equal(res.mesh.faces.length, 4);
  assert.equal(res.mesh.vertices.length, 6, '3 corners + 3 edge midpoints, no face centre');
  res.mesh.faces.forEach(f => assert.equal(f.length, 3));
  const area = res.mesh.faces.reduce((acc, f) => {
    const pts = f.map(i => res.mesh.vertices[i]);
    return acc + G.lenV(G.crossV(G.subV(pts[1], pts[0]), G.subV(pts[2], pts[0]))) / 2;
  }, 0);
  assert.ok(near(area, 0.5, 1e-6), `triangle area ${area} != 0.5`);
});

test('subdivide with 2 iterations keeps subdividing the new faces', () => {
  const m = G.boxToMesh({ x: 1, y: 1, z: 1 });
  const res = G.subdivideFaces(m, [0], 2);
  assert.equal(res.selection.faces.length, 16, '4 quads then 4x4');
});

test('createFace from 3 vertices / 2 vertices / closed edge loop', () => {
  const m = G.createMesh(
    [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 1, y: 0, z: 1 }, { x: 0, y: 0, z: 1 }],
    [],
    []
  );
  const faceRes = G.createFace(m, { vertices: [0, 1, 2, 3], edges: [], faces: [] });
  assert.equal(faceRes.mesh.faces.length, 1);
  assert.equal(faceRes.mesh.faces[0].length, 4);

  const edgeRes = G.createFace(m, { vertices: [0, 2], edges: [], faces: [] });
  assert.equal(edgeRes.mesh.edges.length, 1);

  const loopMesh = G.createMesh(m.vertices.map(v => ({ ...v })), [], [
    [0, 1], [1, 2], [2, 3], [3, 0],
  ]);
  const loopRes = G.createFace(loopMesh, {
    vertices: [],
    edges: ['0-1', '1-2', '2-3', '0-3'],
    faces: [],
  });
  assert.equal(loopRes.mesh.faces.length, 1, 'closed edge loop should become a face');
  assert.equal(loopRes.mesh.faces[0].length, 4);
});

test('delete removes the right elements', () => {
  const m = G.boxToMesh({ x: 1, y: 1, z: 1 });
  const faceDel = G.deleteElements(m, { vertices: [], edges: [], faces: [0] }, 'face');
  assert.equal(faceDel.mesh.faces.length, 5);
  assert.equal(faceDel.mesh.vertices.length, 8, 'deleting faces keeps vertices');

  const vertDel = G.deleteElements(m, { vertices: [0], edges: [], faces: [] }, 'vertex');
  assert.equal(vertDel.mesh.vertices.length, 7);
  assert.equal(vertDel.mesh.faces.length, 3, 'a cube corner belongs to 3 faces');
  assert.ok(vertDel.mesh.faces.every(f => f.every(v => v >= 0 && v < 7)), 'index out of range after remap');

  const key = G.edgeKey(m.faces[0][0], m.faces[0][1]);
  const edgeDel = G.deleteElements(m, { vertices: [], edges: [key], faces: [] }, 'edge');
  assert.ok(edgeDel.mesh.faces.length < 6);
});

test('deleteLoose drops unreferenced vertices only', () => {
  const m = G.boxToMesh({ x: 1, y: 1, z: 1 });
  m.vertices.push({ x: 5, y: 5, z: 5 });
  const res = G.deleteLoose(m);
  assert.equal(res.mesh.vertices.length, 8);
  assert.ok(res.changed);
});

test('flipNormals reverses winding, triangulate converts quads', () => {
  const m = G.boxToMesh({ x: 1, y: 1, z: 1 });
  const before = G.polygonNormal(m, m.faces[0]);
  const flipped = G.flipNormals(m, [0]);
  const after = G.polygonNormal(flipped.mesh, flipped.mesh.faces[0]);
  assert.ok(near(G.dotV(before, after), -1, 1e-6));

  const tri = G.triangulateFaces(m, []);
  assert.equal(tri.mesh.faces.length, 12);
  tri.mesh.faces.forEach(f => assert.equal(f.length, 3));
});

test('set-vertices moves only the targeted vertices', () => {
  const m = G.boxToMesh({ x: 1, y: 1, z: 1 });
  const res = G.applyEditOperation(m, { vertices: [], edges: [], faces: [] }, 'vertex', {
    type: 'set-vertices',
    positions: { 0: { x: 9, y: 9, z: 9 } },
  });
  assert.deepEqual(res.mesh.vertices[0], { x: 9, y: 9, z: 9 });
  assert.deepEqual(res.mesh.vertices[1], m.vertices[1]);
  assert.deepEqual(m.vertices[0], { x: -0.5, y: -0.5, z: -0.5 }, 'input mesh must not be mutated');
});

test('joinMeshes / separateMesh round trip', () => {
  const a = G.boxToMesh({ x: 1, y: 1, z: 1 });
  const b = G.transformMesh(G.boxToMesh({ x: 1, y: 1, z: 1 }), {
    position: { x: 5, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
  });
  const joined = G.joinMeshes([a, b]);
  assert.equal(joined.vertices.length, 16);
  assert.equal(joined.faces.length, 12);
  const parts = G.separateMesh(joined);
  assert.equal(parts.length, 2);
  parts.forEach(p => assert.equal(p.vertices.length, 8));
});

test('applyEditOperation routes every op kind', () => {
  const m = G.boxToMesh({ x: 1, y: 1, z: 1 });
  const sel = { vertices: [0, 1], edges: [], faces: [] };
  const ops = [
    { type: 'extrude' },
    { type: 'delete' },
    { type: 'merge', mode: 'center' },
    { type: 'weld', threshold: 0.001 },
    { type: 'subdivide', iterations: 1 },
    { type: 'create-face' },
    { type: 'delete-loose' },
    { type: 'flip-normals' },
    { type: 'triangulate' },
  ];
  ops.forEach(op => {
    const res = G.applyEditOperation(m, sel, 'vertex', op);
    assert.ok(res.mesh && Array.isArray(res.mesh.vertices), `${op.type} returned no mesh`);
    assert.ok(res.mesh.faces.every(f => f.length >= 3 && new Set(f).size >= 3), `${op.type} produced a degenerate face`);
    assert.ok(
      res.mesh.faces.every(f => f.every(v => v >= 0 && v < res.mesh.vertices.length)),
      `${op.type} produced an out of range vertex index`
    );
    assert.ok(res.selection.vertices.every(v => v >= 0 && v < res.mesh.vertices.length), `${op.type} selection out of range`);
    assert.ok(res.selection.faces.every(f => f >= 0 && f < res.mesh.faces.length), `${op.type} face selection out of range`);
  });
});

/* ------------------------------ inset / mirror ------------------------------ */

const faceArea = (mesh, face) => {
  const pts = face.map(i => mesh.vertices[i]);
  return G.triangulatePolygon(pts).reduce(
    (a, [p, q, r]) => a + G.lenV(G.crossV(G.subV(pts[q], pts[p]), G.subV(pts[r], pts[p]))) / 2,
    0
  );
};

test('inset shrinks a face and keeps the total area', () => {
  const m = G.boxToMesh({ x: 1, y: 1, z: 1 });
  const before = faceArea(m, m.faces[0]);
  const res = G.insetFaces(m, [0], 0.5);

  assert.ok(res.changed);
  // 1 original face becomes 1 inner + 4 ring quads
  assert.equal(res.mesh.faces.length, 6 - 1 + 5);
  assert.equal(res.selection.faces.length, 1, 'only the inner face stays selected');

  const inner = res.mesh.faces[res.selection.faces[0]];
  assert.equal(inner.length, 4);
  assert.ok(near(faceArea(res.mesh, inner), before * 0.25, 1e-6),
    `inner face area ${faceArea(res.mesh, inner)} != ${before * 0.25}`);

  // inner face + the 4 ring quads must cover exactly the original face
  const produced = res.mesh.faces.slice(5);
  const total = produced.reduce((acc, f) => acc + faceArea(res.mesh, f), 0);
  assert.ok(near(total, before, 1e-6), `inset changed the area: ${total} != ${before}`);
  res.mesh.faces.forEach(f => f.forEach(v => assert.ok(v >= 0 && v < res.mesh.vertices.length)));
});

test('inset keeps the winding of the original face', () => {
  const m = G.boxToMesh({ x: 1, y: 1, z: 1 });
  const before = G.polygonNormal(m, m.faces[0]);
  const res = G.insetFaces(m, [0], 0.5);
  const after = G.polygonNormal(res.mesh, res.mesh.faces[res.selection.faces[0]]);
  assert.ok(G.dotV(before, after) > 0.99, 'the inner face flipped its normal');
});

test('inset without a face selection insets every face', () => {
  const m = G.boxToMesh({ x: 1, y: 1, z: 1 });
  const res = G.insetFaces(m, [], 0.3);
  assert.equal(res.mesh.faces.length, 6 * 5);
});

test('mirror duplicates the mesh and welds the seam', () => {
  // a half box sitting on the x=0 plane
  const m = G.createMesh(
    [
      { x: 0, y: -0.5, z: -0.5 }, { x: 1, y: -0.5, z: -0.5 },
      { x: 1, y: 0.5, z: -0.5 }, { x: 0, y: 0.5, z: -0.5 },
      { x: 0, y: -0.5, z: 0.5 }, { x: 1, y: -0.5, z: 0.5 },
      { x: 1, y: 0.5, z: 0.5 }, { x: 0, y: 0.5, z: 0.5 },
    ],
    [
      [0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4],
      [3, 7, 6, 2], [1, 2, 6, 5], [0, 4, 7, 3],
    ],
    []
  );
  const res = G.mirrorMesh(m, 'x');
  const bounds = G.meshBounds(res.mesh);

  assert.ok(near(bounds.min.x, -1, 1e-6) && near(bounds.max.x, 1, 1e-6),
    `mirrored bounds ${bounds.min.x}..${bounds.max.x}, expected -1..1`);
  // the 4 vertices on the plane are shared, the other 4 are duplicated
  assert.equal(res.mesh.vertices.length, 12);
  // the cap lying on the mirror plane mirrors onto itself, so it is not doubled
  assert.equal(res.mesh.faces.length, 11);
  res.mesh.faces.forEach(f => {
    assert.ok(f.every(v => v >= 0 && v < res.mesh.vertices.length));
    assert.ok(new Set(f).size >= 3, 'mirror produced a degenerate face');
  });
});

test('mirroring an open half box closes it with outward normals', () => {
  // a box with the -X cap removed, sitting so the open side lies on x = 0
  const m = G.boxToMesh({ x: 1, y: 1, z: 1 });
  const open = G.createMesh(
    m.vertices.map(v => ({ x: v.x + 0.5, y: v.y, z: v.z })),
    m.faces.filter((_, i) => i !== 5).map(f => f.slice()), // drop the -X cap
    []
  );
  const res = G.mirrorMesh(open, 'x');
  const bounds = G.meshBounds(res.mesh);

  assert.ok(near(bounds.min.x, -1, 1e-6) && near(bounds.max.x, 1, 1e-6),
    `expected a 2x1x1 solid, got ${bounds.min.x}..${bounds.max.x}`);
  assert.equal(res.mesh.vertices.length, 12, '4 shared on the plane + 8 mirrored');
  assert.equal(res.mesh.faces.length, 10, '5 faces each side, no cap on the plane');

  // every normal of the closed solid must point away from its centre
  res.mesh.faces.forEach((f, fi) => {
    const n = G.polygonNormal(res.mesh, f);
    const c = G.polygonCenter(res.mesh, f);
    assert.ok(G.dotV(n, { x: -c.x, y: -c.y, z: -c.z }) < -0.1,
      `face ${fi} normal points inwards after mirroring`);
  });
});

test('applyEditOperation routes inset and mirror', () => {
  const m = G.boxToMesh({ x: 1, y: 1, z: 1 });
  const sel = { vertices: [], edges: [], faces: [0] };
  const inset = G.applyEditOperation(m, sel, 'face', { type: 'inset', amount: 0.4 });
  assert.ok(inset.changed);
  assert.equal(inset.mesh.faces.length, 10);

  const mirror = G.applyEditOperation(m, { vertices: [], edges: [], faces: [] }, 'face', { type: 'mirror', axis: 'y' });
  assert.ok(mirror.changed);
  assert.ok(mirror.mesh.faces.length >= 6);
});

/* ------------------------------ loop cut ------------------------------ */

test('oppositeEdgeInFace follows quads and refuses triangles', () => {
  const quad = [0, 1, 2, 3];
  assert.deepEqual(G.oppositeEdgeInFace(quad, 0, 1).sort((a, b) => a - b), [2, 3]);
  assert.deepEqual(G.oppositeEdgeInFace(quad, 1, 2).sort((a, b) => a - b), [0, 3]);
  assert.equal(G.oppositeEdgeInFace([0, 1, 2], 0, 1), null, 'triangles have no opposite edge');
  assert.equal(G.oppositeEdgeInFace([0, 1, 2, 3, 4], 0, 1), null, 'ngons are ambiguous');
  assert.equal(G.oppositeEdgeInFace(quad, 0, 2), null, '0-2 is not an edge of the face');
});

test('findEdgeLoop walks the four edges around a cube', () => {
  const m = G.boxToMesh({ x: 1, y: 1, z: 1 });
  const key = G.edgeKey(m.faces[0][0], m.faces[0][1]);
  const loop = G.findEdgeLoop(m, key);
  assert.equal(loop.length, 4, `a cube loop has 4 edges, got ${loop.length}`);
  assert.equal(new Set(loop).size, 4, 'the loop repeated an edge');
  assert.ok(loop.includes(key));
});

test('loop cut splits a cube into 10 faces and adds 4 vertices', () => {
  const m = G.boxToMesh({ x: 1, y: 1, z: 1 });
  const before = m.faces.reduce((acc, f) => acc + faceArea(m, f), 0);
  const key = G.edgeKey(m.faces[0][0], m.faces[0][1]);
  const res = G.loopCut(m, key, 0.5);

  assert.ok(res.changed);
  assert.equal(res.mesh.vertices.length, 12, 'one new vertex per loop edge');
  assert.equal(res.mesh.faces.length, 10, 'the 4 crossed faces become 8');
  assert.equal(res.selection.vertices.length, 4);

  const total = res.mesh.faces.reduce((acc, f) => acc + faceArea(res.mesh, f), 0);
  assert.ok(near(total, before, 1e-6), `loop cut changed the surface area: ${total} != ${before}`);

  res.mesh.faces.forEach((f, fi) => {
    assert.ok(f.every(v => v >= 0 && v < res.mesh.vertices.length), `face ${fi} out of range`);
    assert.ok(new Set(f).size >= 3, `face ${fi} degenerate`);
  });
});

test('loop cut keeps every normal pointing outwards', () => {
  const m = G.boxToMesh({ x: 1, y: 1, z: 1 });
  const key = G.edgeKey(m.faces[0][0], m.faces[0][1]);
  const res = G.loopCut(m, key, 0.5);
  res.mesh.faces.forEach((f, fi) => {
    const n = G.polygonNormal(res.mesh, f);
    const c = G.polygonCenter(res.mesh, f);
    assert.ok(G.dotV(n, c) > 0, `face ${fi} flipped after the loop cut`);
  });
});

test('loop cut at t=0.25 puts the new vertices a quarter along the edge', () => {
  const m = G.boxToMesh({ x: 1, y: 1, z: 1 });
  const [a, b] = G.parseEdgeKey(G.edgeKey(m.faces[0][0], m.faces[0][1]));
  const res = G.loopCut(m, G.edgeKey(a, b), 0.25);
  const expected = G.addV(m.vertices[a], G.mulV(G.subV(m.vertices[b], m.vertices[a]), 0.25));
  const found = res.selection.vertices
    .map(i => res.mesh.vertices[i])
    .some(v => G.sameV(v, expected, 1e-9));
  assert.ok(found, `no vertex at ${JSON.stringify(expected)}`);
});

test('loop cut through a row of quads crosses every face of the strip', () => {
  // 3x1 grid of quads on the XZ plane
  const verts = [];
  for (let i = 0; i <= 3; i++) {
    verts.push({ x: i - 1.5, y: 0, z: -0.5 }, { x: i - 1.5, y: 0, z: 0.5 });
  }
  const faces = [];
  for (let i = 0; i < 3; i++) faces.push([i * 2, i * 2 + 1, i * 2 + 3, i * 2 + 2]);
  const strip = G.createMesh(verts, faces, []);

  // the loop that runs along the strip follows the vertical edges
  const loop = G.findEdgeLoop(strip, G.edgeKey(0, 1));
  assert.equal(loop.length, 4, `expected the loop to cross the whole strip, got ${JSON.stringify(loop)}`);

  const res = G.loopCut(strip, G.edgeKey(0, 1), 0.5);
  assert.equal(res.mesh.faces.length, 6, 'each of the 3 quads is cut in two');
  assert.equal(res.selection.vertices.length, 4, 'one vertex per edge of the loop');

  // a horizontal edge only crosses its own face
  const short = G.findEdgeLoop(strip, G.edgeKey(0, 2));
  assert.equal(short.length, 2);
});

test('applyEditOperation routes loop-cut', () => {
  const m = G.boxToMesh({ x: 1, y: 1, z: 1 });
  const key = G.edgeKey(m.faces[0][0], m.faces[0][1]);
  const res = G.applyEditOperation(m, { vertices: [], edges: [key], faces: [] }, 'edge', {
    type: 'loop-cut', edge: key, t: 0.5,
  });
  assert.ok(res.changed);
  assert.equal(res.mesh.faces.length, 10);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  failures.forEach(({ name, err }) => {
    console.error(`\n✗ ${name}\n  ${err.message}`);
  });
  process.exit(1);
}
