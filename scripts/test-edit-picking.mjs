/**
 * Tests for the sub-object picking used by edit mode, driven with real
 * three.js cameras (no WebGL needed) so the click -> element resolution is
 * verified instead of assumed.
 *
 * Run with: npm run test:picking
 */
import assert from 'node:assert/strict';
import * as THREE from 'three';

const G = await import('../.tmp-test/editGeometry.js');
const P = await import('../.tmp-test/components/editPicking.js');
const S = await import('../.tmp-test/components/snapping.js');

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

const WIDTH = 800;
const HEIGHT = 600;

/** Top-down orthographic camera over the origin, like the "Top" viewport. */
function topCamera() {
  const cam = new THREE.OrthographicCamera(-0.2, 0.2, 0.15, -0.15, 0.1, 100);
  cam.position.set(0, 10, 0);
  cam.up.set(0, 0, -1);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();
  cam.updateProjectionMatrix();
  return cam;
}

/** Perspective camera, like the "Perspective" viewport. */
function perspCamera() {
  const cam = new THREE.PerspectiveCamera(50, WIDTH / HEIGHT, 0.01, 100);
  cam.position.set(0.3, 0.3, 0.3);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();
  cam.updateProjectionMatrix();
  return cam;
}

function setup(camera, position = { x: 0, y: 0, z: 0 }) {
  const mesh = G.boxToMesh({ x: 0.1, y: 0.1, z: 0.1 });
  const obj = {
    id: 'cube-1', name: 'Cube', type: 'mesh',
    position, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 },
    dimensions: { x: 0.1, y: 0.1, z: 0.1 },
    geometryOffset: { x: 0, y: 0, z: 0 }, geometryRotation: { x: 0, y: 0, z: 0 },
    visible: true, geometry: 'box', color: '#fff', mesh,
  };
  const matrix = S.objectMatrix(obj);
  const worldVertices = mesh.vertices.map(v => new THREE.Vector3(v.x, v.y, v.z).applyMatrix4(matrix));
  return {
    mesh,
    worldVertices,
    renderData: G.buildRenderData(mesh, 45),
    camera,
    width: WIDTH,
    height: HEIGHT,
    radiusPx: 14,
  };
}

const px = (ctx, v) => S.projectToScreen(v, ctx.camera, WIDTH, HEIGHT);

function distToSeg(px0, py0, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-9) return Math.hypot(px0 - ax, py0 - ay);
  let t = ((px0 - ax) * dx + (py0 - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px0 - (ax + t * dx), py0 - (ay + t * dy));
}

/* ------------------------------- vertices ------------------------------- */

/** The invariant that matters: the picked element really is under the cursor. */
function assertPixelMatches(ctx, hit, x, y, tolerance = 0.01) {
  const s = px(ctx, ctx.worldVertices[parseInt(hit.key, 10)]);
  assert.ok(s, 'picked vertex does not project');
  assert.ok(Math.hypot(s.x - x, s.y - y) <= tolerance, `picked vertex projects ${Math.hypot(s.x - x, s.y - y).toFixed(3)}px away from the click`);
}

test('clicking exactly on a vertex picks the vertex under the cursor (ortho top)', () => {
  const ctx = setup(topCamera());
  ctx.mode = 'vertex';
  ctx.worldVertices.forEach((wp, i) => {
    const s = px(ctx, wp);
    if (!s) return;
    const hit = P.pickElement(ctx, s.x, s.y);
    assert.ok(hit, `no hit for vertex ${i}`);
    assert.equal(hit.kind, 'vertex');
    assertPixelMatches(ctx, hit, s.x, s.y);
  });
});

test('clicking exactly on a vertex picks the vertex under the cursor (perspective)', () => {
  const ctx = setup(perspCamera());
  ctx.mode = 'vertex';
  ctx.worldVertices.forEach((wp, i) => {
    const s = px(ctx, wp);
    if (!s) return;
    const hit = P.pickElement(ctx, s.x, s.y);
    assert.ok(hit, `no hit for vertex ${i}`);
    assert.equal(hit.kind, 'vertex');
    assertPixelMatches(ctx, hit, s.x, s.y);
  });
});

test('when two vertices share a pixel, the one closest to the camera wins', () => {
  // seen from the diagonal, the two opposite corners of a cube land on the same pixel
  const ctx = setup(perspCamera());
  ctx.mode = 'vertex';
  const a = px(ctx, ctx.worldVertices[0]);
  const b = px(ctx, ctx.worldVertices[6]);
  assert.ok(a && b);
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 0.01, 'test premise: the corners must overlap');
  assert.notEqual(a.depth, b.depth, 'test premise: one must be in front of the other');

  const hit = P.pickElement(ctx, a.x, a.y);
  assert.ok(hit);
  const expected = a.depth < b.depth ? '0' : '6';
  assert.equal(hit.key, expected, 'the hidden vertex was picked instead of the visible one');
});

test('in the top view the upper vertex wins over the one below it', () => {
  const ctx = setup(topCamera());
  ctx.mode = 'vertex';
  // vertices 0 and 3 differ only in Y, so they overlap in a top view
  const a = px(ctx, ctx.worldVertices[0]);
  const b = px(ctx, ctx.worldVertices[3]);
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 0.01, 'test premise: they must overlap');
  const hit = P.pickElement(ctx, a.x, a.y);
  const expected = a.depth < b.depth ? '0' : '3';
  assert.equal(hit.key, expected);
});

test('a click a few pixels away still grabs the nearest vertex (snap radius)', () => {
  const ctx = setup(topCamera());
  ctx.mode = 'vertex';
  const s = px(ctx, ctx.worldVertices[4]); // bottom-left-front corner, alone on its pixel row
  const hit = P.pickElement(ctx, s.x + 9, s.y + 7); // ~11px away, radius is 14
  assert.ok(hit);
  assert.equal(hit.kind, 'vertex');
  assertPixelMatches(ctx, hit, s.x + 9, s.y + 7, 14);
});

test('a click far from everything picks nothing', () => {
  const ctx = setup(topCamera());
  ctx.mode = 'vertex';
  assert.equal(P.pickElement(ctx, WIDTH - 5, 5), null);
});

test('the world position of the picked vertex follows the object transform', () => {
  const ctx = setup(topCamera(), { x: 0.5, y: 0, z: 0 });
  ctx.mode = 'vertex';
  const s = px(ctx, ctx.worldVertices[0]);
  const hit = P.pickElement(ctx, s.x, s.y);
  assert.ok(hit);
  assert.ok(Math.abs(hit.point.x - ctx.worldVertices[0].x) < 1e-9);
});

/* -------------------------------- edges -------------------------------- */

test('edge mode picks the edge under the cursor at its midpoint', () => {
  const ctx = setup(topCamera());
  ctx.mode = 'edge';
  const keys = P.collectEdgeKeys(ctx.mesh);
  assert.equal(keys.length, 12, 'a cube has 12 edges');

  let checked = 0;
  keys.forEach(key => {
    const [a, b] = key.split('-').map(Number);
    const sa = px(ctx, ctx.worldVertices[a]);
    const sb = px(ctx, ctx.worldVertices[b]);
    if (!sa || !sb) return;
    const mid = { x: (sa.x + sb.x) / 2, y: (sa.y + sb.y) / 2 };
    // skip midpoints that land within the vertex radius of a corner
    if (Math.hypot(mid.x - sa.x, mid.y - sa.y) < 20) return;
    const hit = P.pickElement(ctx, mid.x, mid.y);
    assert.ok(hit, `no hit for edge ${key}`);
    assert.equal(hit.kind, 'edge', `expected an edge at the midpoint of ${key}`);
    // in the top view opposite edges overlap, so accept the one actually under the cursor
    const [ha, hb] = hit.key.split('-').map(Number);
    const shA = px(ctx, ctx.worldVertices[ha]);
    const shB = px(ctx, ctx.worldVertices[hb]);
    const dHit = distToSeg(mid.x, mid.y, shA.x, shA.y, shB.x, shB.y);
    assert.ok(dHit < 1, `picked edge ${hit.key} is ${dHit.toFixed(2)}px from the click, expected ${key}`);
    checked++;
  });
  assert.ok(checked > 0, 'no edge midpoints were testable');
});

test('edge mode resolves a corner to one of the edges touching it', () => {
  const ctx = setup(topCamera());
  ctx.mode = 'edge';
  const s = px(ctx, ctx.worldVertices[4]);
  const hit = P.pickElement(ctx, s.x, s.y);
  assert.ok(hit);
  assert.equal(hit.kind, 'edge', 'edges have priority in edge mode, like Blender');
  // in the top view several corners share a pixel, so the invariant is that the
  // picked edge really passes through the click, not that it owns vertex 4
  const [a, b] = hit.key.split('-').map(Number);
  const sa = px(ctx, ctx.worldVertices[a]);
  const sb = px(ctx, ctx.worldVertices[b]);
  const d = distToSeg(s.x, s.y, sa.x, sa.y, sb.x, sb.y);
  assert.ok(d < 1, `picked edge ${hit.key} is ${d.toFixed(2)}px from the click`);
});

test('edge mode falls back to a vertex that has no incident edge', () => {
  // a triangle plus one loose vertex far from every edge
  const mesh = G.createMesh(
    [{ x: -0.1, y: 0, z: -0.1 }, { x: 0.1, y: 0, z: -0.1 }, { x: -0.1, y: 0, z: 0.05 }, { x: 0.14, y: 0, z: 0.11 }],
    [[0, 1, 2]],
    []
  );
  const camera = topCamera();
  const worldVertices = mesh.vertices.map(v => new THREE.Vector3(v.x, v.y, v.z));
  const ctx = {
    mesh, worldVertices,
    renderData: G.buildRenderData(mesh, 45),
    camera, width: WIDTH, height: HEIGHT, mode: 'edge', radiusPx: 14,
  };
  const loose = px(ctx, worldVertices[3]);
  assert.ok(loose, 'the loose vertex must be on screen');
  const hit = P.pickElement(ctx, loose.x, loose.y);
  assert.ok(hit, 'the loose vertex was not pickable');
  assert.equal(hit.kind, 'vertex', 'a vertex without edges must still be selectable');
  assert.equal(hit.key, '3');
});

/* -------------------------------- faces -------------------------------- */

test('face mode picks the face under the cursor', () => {
  const ctx = setup(topCamera());
  ctx.mode = 'face';
  // the +Y face of the cube is the one facing a top camera
  const topFace = ctx.mesh.faces.findIndex((f, fi) => {
    const n = G.polygonNormal(ctx.mesh, f);
    return n.y > 0.9;
  });
  assert.ok(topFace >= 0, 'no face pointing up');

  const face = ctx.mesh.faces[topFace];
  let center = new THREE.Vector3();
  face.forEach(i => center.add(ctx.worldVertices[i]));
  center.multiplyScalar(1 / face.length);
  const s = px(ctx, center);
  const hit = P.pickElement(ctx, s.x, s.y);
  assert.ok(hit);
  assert.equal(hit.kind, 'face');
  assert.equal(hit.key, String(topFace));
});

test('face mode still lets you grab a vertex sitting on the face', () => {
  const ctx = setup(topCamera());
  ctx.mode = 'face';
  const s = px(ctx, ctx.worldVertices[3]); // a corner of the top face
  const hit = P.pickElement(ctx, s.x, s.y);
  assert.ok(hit);
  assert.equal(hit.kind, 'face', 'faces win over vertices inside a face');

  // vertex mode must win when that is the active mode
  ctx.mode = 'vertex';
  const hit2 = P.pickElement(ctx, s.x, s.y);
  assert.equal(hit2.kind, 'vertex');
});

/* ----------------------------- box selection ----------------------------- */

test('a rectangle over the whole model selects everything', () => {
  const ctx = setup(topCamera());
  const sel = P.elementsInRect(ctx, 0, 0, WIDTH, HEIGHT);
  assert.equal(sel.vertices.length, 8);
  assert.equal(sel.edges.length, 12);
  assert.equal(sel.faces.length, 6);
});

test('a rectangle in empty space selects nothing', () => {
  const ctx = setup(topCamera());
  const sel = P.elementsInRect(ctx, WIDTH - 40, 0, WIDTH, 40);
  assert.deepEqual(sel, { vertices: [], edges: [], faces: [] });
});

test('a small rectangle selects only the vertices inside it', () => {
  const ctx = setup(topCamera());
  const projected = ctx.worldVertices.map(v => px(ctx, v));
  const target = projected[0];
  const sel = P.elementsInRect(ctx, target.x - 2, target.y - 2, target.x + 2, target.y + 2);
  assert.ok(sel.vertices.includes(0));
  assert.ok(sel.vertices.length < 8, 'the box grabbed the whole cube');
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  failures.forEach(({ name, err }) => console.error(`\n✗ ${name}\n  ${err.message}`));
  process.exit(1);
}
