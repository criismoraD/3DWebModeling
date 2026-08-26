/**
 * Integration test: drives the real zustand store (store.ts) through the
 * modelling workflows, so the store actions and the geometry kernel are
 * exercised together exactly as the UI drives them.
 *
 * Run with: npm run test:store
 */
import assert from 'node:assert/strict';

const { useAppStore } = await import('../.tmp-test/store.js');

let passed = 0;
const failures = [];
async function test(name, fn) {
  try {
    await fn();
    passed++;
  } catch (err) {
    failures.push({ name, err });
  }
}

const st = () => useAppStore.getState();

const freshCube = () => ({
  id: 'cube-1', name: 'Cube', type: 'mesh',
  position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 },
  dimensions: { x: 0.1, y: 0.1, z: 0.1 },
  geometryOffset: { x: 0, y: 0, z: 0 }, geometryRotation: { x: 0, y: 0, z: 0 },
  visible: true, geometry: 'box', color: '#4a90d9',
});

/** Every test starts from the same known scene (data fields only, actions stay). */
const reset = () =>
  useAppStore.setState({
    objects: [freshCube()],
    selectedIds: ['cube-1'],
    editorMode: 'object',
    editObjectId: null,
    editSelection: { vertices: [], edges: [], faces: [] },
    subObjectMode: 'vertex',
    interactionMode: 'select',
    drawingPhase: 'idle',
    drawingStartPoint: null,
    modalTransform: null,
    hoverElement: null,
    snapSourceVertex: null,
    snapTarget: null,
    history: [[freshCube()]],
    historyIndex: 0,
  });
const editedMesh = () => st().objects.find(o => o.id === st().editObjectId)?.mesh;
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

reset();
await test('enterEditMode converts the primitive cube into an editable mesh', () => {
  assert.equal(st().editorMode, 'object');
  assert.equal(st().objects.length, 1);
  assert.equal(st().objects[0].geometry, 'box');

  st().enterEditMode();

  const s = st();
  assert.equal(s.editorMode, 'edit');
  assert.ok(s.editObjectId, 'no edit object');
  const obj = s.objects.find(o => o.id === s.editObjectId);
  assert.equal(obj.geometry, 'mesh');
  assert.equal(obj.editable, true);
  assert.equal(obj.mesh.vertices.length, 8);
  assert.equal(obj.mesh.faces.length, 6);
  assert.deepEqual(obj.geometryOffset, { x: 0, y: 0, z: 0 });
});

reset();
await test('Tab (toggleEditorMode) round trips object <-> edit', () => {
  st().enterEditMode();
  assert.equal(st().editorMode, 'edit');
  st().toggleEditorMode();
  assert.equal(st().editorMode, 'object');
  assert.equal(st().editObjectId, null);
  st().toggleEditorMode();
  assert.equal(st().editorMode, 'edit');
});

reset();
await test('selectAllElements / sub object modes / invert / grow / shrink', () => {
  st().enterEditMode();
  st().selectAllElements();
  let sel = st().editSelection;
  assert.equal(sel.vertices.length, 8);
  assert.equal(sel.edges.length, 12);
  assert.equal(sel.faces.length, 6);

  st().setSubObjectMode('face');
  assert.equal(st().subObjectMode, 'face');

  st().setEditSelection({ faces: [0] });
  st().growEditSelection();
  assert.ok(st().editSelection.faces.length > 1, 'grow did not add faces');

  st().selectAllElements();
  st().invertEditSelection();
  assert.equal(st().editSelection.faces.length, 0);
  assert.equal(st().editSelection.vertices.length, 0);

  st().setSubObjectMode('vertex');
  st().setEditSelection({ vertices: [0] });
  st().growEditSelection();
  assert.equal(st().editSelection.vertices.length, 4, 'a cube corner has 3 neighbours + itself');
  // shrinking a full selection is a no-op (every neighbour is already selected)
  st().selectAllElements();
  st().shrinkEditSelection();
  assert.equal(st().editSelection.vertices.length, 8);

  // shrinking a selection with a hole removes the vertices around the hole
  st().setEditSelection({ vertices: [0, 1, 2, 3, 4, 5, 6] });
  st().shrinkEditSelection();
  const shrunk = st().editSelection.vertices;
  assert.ok(shrunk.length > 0 && shrunk.length < 7, `expected a smaller selection, got ${shrunk.length}`);
  assert.ok(!shrunk.includes(7), 'vertex 7 was never selected');
});

reset();
await test('extrude in face mode creates the cap + side walls and keeps them selected', () => {
  st().enterEditMode();
  st().setSubObjectMode('face');
  st().setEditSelection({ faces: [0] });
  const before = editedMesh();
  st().runEditOp({ type: 'extrude' });
  const after = editedMesh();

  assert.equal(after.vertices.length, before.vertices.length + 4);
  assert.equal(after.faces.length, before.faces.length + 5);
  assert.equal(st().editSelection.faces.length, 5);
  // the new cap sits exactly on the old face until it is moved
  const cap = after.faces[st().editSelection.faces[0]];
  assert.equal(cap.length, 4);
});

reset();
await test('G + drag: set-vertices moves only the selected geometry', () => {
  st().enterEditMode();
  st().setSubObjectMode('vertex');
  st().setEditSelection({ vertices: [0] });
  const before = editedMesh().vertices[0];
  st().runEditOp({ type: 'set-vertices', positions: { 0: { x: before.x + 0.25, y: before.y, z: before.z } } }, false);
  const after = editedMesh().vertices[0];
  assert.ok(near(after.x, before.x + 0.25));
  assert.deepEqual(editedMesh().vertices[1], st().objects.find(o => o.id === st().editObjectId).mesh.vertices[1]);
});

reset();
await test('snap + weld on drop merges the source vertex into the target', () => {
  st().enterEditMode();
  // Two vertices of the cube, dragged on top of each other, then welded
  st().setSubObjectMode('vertex');
  st().setEditSelection({ vertices: [0, 1] });

  const mesh = editedMesh();
  const vertsBefore = mesh.vertices.length;
  const target = mesh.vertices[1];
  // simulate the drag landing exactly on the target vertex
  st().runEditOp({ type: 'set-vertices', positions: { 0: { ...target } } }, false);
  assert.equal(editedMesh().vertices.length, vertsBefore, 'drag alone must not merge');

  // what the controller does on drop when "weld on drop" is enabled
  st().setEditSelection({ vertices: [0, 1] });
  st().runEditOp({ type: 'merge', mode: 'cursor', cursor: { ...target } }, true);

  const welded = editedMesh();
  assert.equal(welded.vertices.length, vertsBefore - 1, 'source vertex was not merged into the target');
  assert.equal(st().editSelection.vertices.length, 1);
  const survivor = welded.vertices[st().editSelection.vertices[0]];
  assert.ok(near(survivor.x, target.x) && near(survivor.y, target.y) && near(survivor.z, target.z));
});

reset();
await test('weld by distance removes duplicated vertices after a snap', () => {
  st().enterEditMode();
  st().setSubObjectMode('vertex');
  st().setEditSelection({ vertices: [2] });
  const mesh = editedMesh();
  st().runEditOp({ type: 'set-vertices', positions: { 2: { ...mesh.vertices[3] } } }, false);
  assert.equal(editedMesh().vertices.length, 8);
  st().runEditOp({ type: 'weld', threshold: 0.001 }, true);
  assert.equal(editedMesh().vertices.length, 7);
});

reset();
await test('create face / delete / undo chain', () => {
  st().enterEditMode();

  const facesBefore = editedMesh().faces.length;
  st().setSubObjectMode('face');
  st().setEditSelection({ faces: [0] });
  st().runEditOp({ type: 'delete' }, true);
  assert.equal(editedMesh().faces.length, facesBefore - 1);

  st().undo();
  assert.equal(editedMesh().faces.length, facesBefore, 'undo did not restore the face');

  st().redo();
  assert.equal(editedMesh().faces.length, facesBefore - 1, 'redo did not re-apply the delete');
});

reset();
await test('subdivide + triangulate keep the mesh valid', () => {
  st().enterEditMode();
  st().setSubObjectMode('face');
  st().setEditSelection({ faces: [0] });
  st().runEditOp({ type: 'subdivide', iterations: 1 }, true);
  assert.equal(editedMesh().faces.length, 9);

  st().setSubObjectMode('face');
  st().selectAllElements();
  st().runEditOp({ type: 'triangulate' }, true);
  editedMesh().faces.forEach(f => assert.equal(f.length, 3));
  editedMesh().faces.forEach(f => f.forEach(v => assert.ok(v >= 0 && v < editedMesh().vertices.length)));
});

reset();
await test('joinSelected merges two objects into one editable mesh', () => {
  // build a second object through the store's drawing flow
  st().setInteractionMode('create_cube');
  st().startDrawing({ x: 0.3, y: 0, z: 0 });
  st().updateDrawing({ x: 0.4, y: 0, z: 0.1 });
  st().stopDrawingBase();
  st().updateDrawing({ x: 0.4, y: 0.1, z: 0.1 });
  st().finishDrawing();
  st().setInteractionMode('select');
  assert.equal(st().objects.length, 2, 'second cube was not created');

  st().setSelection(st().objects.map(o => o.id));
  st().joinSelected();
  const s = st();
  assert.equal(s.objects.length, 1);
  assert.equal(s.objects[0].mesh.vertices.length, 16);
  assert.equal(s.objects[0].mesh.faces.length, 12);
  assert.equal(s.editorMode, 'object');
});

await test('separateSelected splits joined parts back apart', () => {
  st().setSelection([st().objects[0].id]);
  st().enterEditMode();
  assert.equal(st().editorMode, 'edit');
  st().separateSelected();
  const s = st();
  assert.equal(s.objects.length, 2, 'mesh was not separated');
  assert.equal(s.editorMode, 'object');
  s.objects.forEach(o => assert.equal(o.mesh.vertices.length, 8));
});

await test('deleting the edited object leaves edit mode', () => {
  st().setSelection([st().objects[0].id]);
  st().enterEditMode();
  assert.equal(st().editorMode, 'edit');
  st().deleteSelected();
  assert.equal(st().editorMode, 'object');
  assert.equal(st().editObjectId, null);
});

await test('undo restores edit mode safely when the mesh disappears', () => {
  st().undo();
  const s = st();
  // the object is back; edit mode must not point at a missing mesh
  if (s.editorMode === 'edit') assert.ok(s.objects.some(o => o.id === s.editObjectId && o.mesh));
  else assert.equal(s.editObjectId, null);
});


reset();
await test('cylinder / cone / torus can be drawn and converted to editable meshes', () => {
  const draw = (mode, radiusPoint, heightPoint) => {
    st().setInteractionMode(mode);
    st().startDrawing({ x: 0, y: 0, z: 0 });
    st().updateDrawing(radiusPoint);
    st().stopDrawingBase();
    assert.equal(st().drawingPhase, 'drawing_height', `${mode} should ask for a height`);
    st().updateDrawing(heightPoint);
    st().finishDrawing();
    st().setInteractionMode('select');
    return st().objects[st().objects.length - 1];
  };

  const cylinder = draw('create_cylinder', { x: 0.05, y: 0, z: 0 }, { x: 0.05, y: 0.2, z: 0 });
  assert.equal(cylinder.geometry, 'cylinder');
  assert.ok(Math.abs(cylinder.radius - 0.05) < 1e-9, `radius ${cylinder.radius}`);
  assert.ok(Math.abs(cylinder.dimensions.y - 0.2) < 1e-9, `height ${cylinder.dimensions.y}`);

  const cone = draw('create_cone', { x: 0.04, y: 0, z: 0 }, { x: 0.04, y: 0.15, z: 0 });
  assert.equal(cone.geometry, 'cone');
  assert.ok(Math.abs(cone.dimensions.y - 0.15) < 1e-9);

  const torus = draw('create_torus', { x: 0.06, y: 0, z: 0 }, { x: 0.06, y: 0.02, z: 0 });
  assert.equal(torus.geometry, 'torus');
  assert.ok(Math.abs(torus.dimensions.y - 0.04) < 1e-9, `tube diameter ${torus.dimensions.y}`);

  // each one converts into a watertight editable mesh
  for (const obj of [cylinder, cone, torus]) {
    st().setSelection([obj.id]);
    st().enterEditMode(obj.id);
    const m = st().objects.find(o => o.id === obj.id).mesh;
    assert.ok(m.vertices.length > 8, `${obj.geometry}: too few vertices`);
    assert.ok(m.faces.length > 8, `${obj.geometry}: too few faces`);
    m.faces.forEach(f => {
      assert.ok(f.length >= 3, `${obj.geometry}: degenerate face`);
      f.forEach(v => assert.ok(v >= 0 && v < m.vertices.length, `${obj.geometry}: bad index`));
    });
    st().exitEditMode();
  }
});

reset();
await test('drawing a box still works and enters edit mode', () => {
  st().setInteractionMode('create_cube');
  st().startDrawing({ x: 0, y: 0, z: 0 });
  st().updateDrawing({ x: 0.2, y: 0, z: 0.1 });
  st().stopDrawingBase();
  st().updateDrawing({ x: 0.2, y: 0.3, z: 0.1 });
  st().finishDrawing();
  st().setInteractionMode('select');
  const box = st().objects[st().objects.length - 1];
  assert.equal(box.geometry, 'box');
  assert.ok(Math.abs(box.dimensions.x - 0.2) < 1e-9);
  assert.ok(Math.abs(box.dimensions.y - 0.3) < 1e-9);

  st().setSelection([box.id]);
  st().enterEditMode(box.id);
  assert.equal(st().objects.find(o => o.id === box.id).mesh.vertices.length, 8);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  failures.forEach(({ name, err }) => console.error(`\n✗ ${name}\n  ${err.message}`));
  process.exit(1);
}
