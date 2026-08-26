/**
 * End to end check of the reported workflow:
 *
 *   edit mode on object A -> grab one vertex -> snap it onto a vertex of
 *   object B, first with every axis free and then locked to X.
 *
 * The move is computed with the same pure helpers the viewport uses
 * (moveWithConstraint) and written through the real store, so the assertions
 * run against the mesh that ends up in the scene.
 *
 * Run with: npm run test:workflow
 */
import assert from 'node:assert/strict';
import * as THREE from 'three';

const { useAppStore } = await import('../.tmp-test/store.js');
const A = await import('../.tmp-test/components/axisConstraint.js');
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

const st = () => useAppStore.getState();
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

const box = (id, name, x) => ({
  id, name, type: 'mesh',
  position: { x, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 },
  dimensions: { x: 0.1, y: 0.1, z: 0.1 },
  geometryOffset: { x: 0, y: 0, z: 0 }, geometryRotation: { x: 0, y: 0, z: 0 },
  visible: true, geometry: 'box', color: '#4a90d9',
});

const reset = () => {
  const a = box('cube-a', 'CubeA', 0);
  const b = box('cube-b', 'CubeB', 0.3);
  useAppStore.setState({
    objects: [a, b],
    selectedIds: ['cube-a'],
    editorMode: 'object',
    editObjectId: null,
    editSelection: { vertices: [], edges: [], faces: [] },
    subObjectMode: 'vertex',
    modalTransform: null,
    snapSourceVertex: null,
    snapTarget: null,
    history: [[a, b]],
    historyIndex: 0,
  });
};

const editedObject = () => st().objects.find(o => o.id === st().editObjectId);
const localToWorld = (obj, v) => new THREE.Vector3(v.x, v.y, v.z).applyMatrix4(S.objectMatrix(obj));
const worldToLocal = (obj, p) => p.clone().applyMatrix4(S.objectMatrix(obj).clone().invert());

/** Every snap target of the scene, gathered exactly as the viewport does. */
const targetsOf = (excludeId) =>
  S.gatherSnapCandidates(st().objects, { midpoints: false, includeSelf: true })
    .filter(c => c.objectId !== excludeId);

/**
 * Moves one vertex so that it snaps onto `targetWorld`, honouring `mask`.
 * This mirrors what the viewport does: a snap shift is computed and then the
 * constraint decides which components may actually be applied.
 */
function snapVertex(vertexIndex, targetWorld, mask) {
  const obj = editedObject();
  const worldOrig = localToWorld(obj, obj.mesh.vertices[vertexIndex]);
  const snapShift = {
    x: targetWorld.x - worldOrig.x,
    y: targetWorld.y - worldOrig.y,
    z: targetWorld.z - worldOrig.z,
  };
  const finalWorld = A.moveWithConstraint(worldOrig, { x: 0, y: 0, z: 0 }, snapShift, mask);
  const local = worldToLocal(obj, new THREE.Vector3(finalWorld.x, finalWorld.y, finalWorld.z));
  st().runEditOp({ type: 'set-vertices', positions: { [vertexIndex]: { x: local.x, y: local.y, z: local.z } } }, true);
}

reset();
test('the scene starts with two separate primitive cubes', () => {
  assert.equal(st().objects.length, 2);
  assert.equal(st().objects[0].mesh, undefined, 'primitives are not meshes until edit mode');
});

reset();
test('entering edit mode converts cube A into an editable mesh', () => {
  st().enterEditMode('cube-a');
  assert.equal(st().editorMode, 'edit');
  assert.equal(editedObject().mesh.vertices.length, 8);
  assert.equal(st().objects.find(o => o.id === 'cube-b').mesh, undefined, 'cube B stays a primitive');
});

reset();
test('free move: the grabbed vertex lands exactly on the other object vertex', () => {
  st().enterEditMode('cube-a');
  st().setSubObjectMode('vertex');
  st().setEditSelection({ vertices: [1] });

  const target = targetsOf('cube-a').find(c => c.objectId === 'cube-b');
  assert.ok(target, 'no vertex of cube B is available as a snap target');

  snapVertex(1, target.point, A.maskFromLock('free'));

  const world = localToWorld(editedObject(), editedObject().mesh.vertices[1]);
  assert.ok(near(world.x, target.point.x), `X ${world.x} != ${target.point.x}`);
  assert.ok(near(world.y, target.point.y), `Y ${world.y} != ${target.point.y}`);
  assert.ok(near(world.z, target.point.z), `Z ${world.z} != ${target.point.z}`);
});

reset();
test('locked to X: the vertex snaps on X and Y/Z do not move at all', () => {
  st().enterEditMode('cube-a');
  st().setSubObjectMode('vertex');
  st().setEditSelection({ vertices: [1] });

  const obj = editedObject();
  const before = localToWorld(obj, obj.mesh.vertices[1]);
  // a target that differs on all three axes, so the lock is really exercised
  const target = new THREE.Vector3(0.25, 0.42, -0.77);

  snapVertex(1, target, A.maskFromLock('x'));

  const after = localToWorld(editedObject(), editedObject().mesh.vertices[1]);
  assert.ok(near(after.x, target.x), `X did not snap: ${after.x} != ${target.x}`);
  assert.equal(after.y, before.y, 'Y moved while locked to X');
  assert.equal(after.z, before.z, 'Z moved while locked to X');
});

reset();
test('locked to Y: only Y follows the snap', () => {
  st().enterEditMode('cube-a');
  st().setEditSelection({ vertices: [1] });

  const before = localToWorld(editedObject(), editedObject().mesh.vertices[1]);
  snapVertex(1, new THREE.Vector3(0.9, 0.42, -0.77), A.maskFromLock('y'));

  const after = localToWorld(editedObject(), editedObject().mesh.vertices[1]);
  assert.ok(near(after.y, 0.42), `Y did not snap: ${after.y}`);
  assert.equal(after.x, before.x, 'X moved while locked to Y');
  assert.equal(after.z, before.z, 'Z moved while locked to Y');
});

reset();
test('every axis selected behaves as free: all three axes follow the snap', () => {
  st().enterEditMode('cube-a');
  st().setEditSelection({ vertices: [1] });

  const target = new THREE.Vector3(0.9, 0.42, -0.77);
  snapVertex(1, target, A.maskFromGizmoAxis('XYZ')); // the gizmo centre ball

  const after = localToWorld(editedObject(), editedObject().mesh.vertices[1]);
  assert.ok(near(after.x, target.x) && near(after.y, target.y) && near(after.z, target.z));
  assert.equal(A.isConstrained(A.maskFromGizmoAxis('XYZ')), false, 'the centre ball must not be a lock');
});

reset();
test('join + merge welds the two cubes into one watertight mesh', () => {
  st().setSelection(['cube-a', 'cube-b']);
  st().joinSelected();
  assert.equal(st().objects.length, 1);
  assert.equal(st().objects[0].mesh.vertices.length, 16);

  st().enterEditMode(st().objects[0].id);
  const mesh = editedObject().mesh;
  st().setEditSelection({ vertices: [0, 8] });
  // stack them, which is what a snap + drop leaves behind
  st().runEditOp({ type: 'set-vertices', positions: { 0: { ...mesh.vertices[8] } } }, false);
  st().runEditOp({ type: 'merge', mode: 'center' }, true);

  const welded = editedObject().mesh;
  assert.equal(welded.vertices.length, 15, 'the two vertices were not welded into one');
  welded.faces.forEach(f => {
    assert.ok(f.every(v => v >= 0 && v < welded.vertices.length), 'a face references a dropped vertex');
    assert.ok(new Set(f).size >= 3, 'the merge left a degenerate face');
  });
});

reset();
test('undo puts the vertex back exactly where it was before the snap', () => {
  st().enterEditMode('cube-a');
  st().setEditSelection({ vertices: [1] });
  const before = { ...editedObject().mesh.vertices[1] };

  snapVertex(1, new THREE.Vector3(0.9, 0.42, -0.77), A.maskFromLock('free'));
  const moved = editedObject().mesh.vertices[1];
  assert.ok(!near(moved.x, before.x), 'the move did not happen');

  st().undo();
  const restored = (editedObject() ?? st().objects.find(o => o.id === 'cube-a')).mesh.vertices[1];
  assert.ok(near(restored.x, before.x, 1e-12) && near(restored.y, before.y, 1e-12) && near(restored.z, before.z, 1e-12),
    `undo left the vertex at ${JSON.stringify(restored)}, expected ${JSON.stringify(before)}`);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  failures.forEach(({ name, err }) => console.error(`\n✗ ${name}\n  ${err.message}`));
  process.exit(1);
}
