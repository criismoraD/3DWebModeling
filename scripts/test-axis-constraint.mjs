/**
 * Unit tests for the axis constraint used by the snapping code: a locked axis
 * must never be moved by a snap.
 *
 * Run with: npm run test:axis
 */
import assert from 'node:assert/strict';

const A = await import('../.tmp-test/components/axisConstraint.js');

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

test('gizmo axis names map to the right component mask', () => {
  assert.deepEqual(A.maskFromGizmoAxis('X'), { x: 1, y: 0, z: 0 });
  assert.deepEqual(A.maskFromGizmoAxis('Y'), { x: 0, y: 1, z: 0 });
  assert.deepEqual(A.maskFromGizmoAxis('Z'), { x: 0, y: 0, z: 1 });
  assert.deepEqual(A.maskFromGizmoAxis('XY'), { x: 1, y: 1, z: 0 });
  assert.deepEqual(A.maskFromGizmoAxis('XYZ'), { x: 1, y: 1, z: 1 });
});

test('the free-move ball (XYZ) and unknown axes mean "no constraint"', () => {
  assert.deepEqual(A.maskFromGizmoAxis('XYZ'), { x: 1, y: 1, z: 1 });
  assert.equal(A.maskFromGizmoAxis('E'), null);
  assert.equal(A.maskFromGizmoAxis(null), null);
  assert.equal(A.maskFromGizmoAxis(undefined), null);
});

test('modal axis lock (G/R/S + X/Y/Z) maps to a mask', () => {
  assert.deepEqual(A.maskFromLock('x'), { x: 1, y: 0, z: 0 });
  assert.deepEqual(A.maskFromLock('y'), { x: 0, y: 1, z: 0 });
  assert.deepEqual(A.maskFromLock('z'), { x: 0, y: 0, z: 1 });
  assert.equal(A.maskFromLock('free'), null);
});

test('a snap shift on a locked X axis only moves X', () => {
  const shift = { x: 0.25, y: -0.4, z: 0.9 };
  const masked = A.applyMask(shift, A.maskFromLock('x'));
  assert.deepEqual(masked, { x: 0.25, y: 0, z: 0 });
  assert.equal(masked.y, 0, 'Y was modified while locked to X');
  assert.equal(masked.z, 0, 'Z was modified while locked to X');
});

test('a snap shift on a locked Y / Z axis only moves that axis', () => {
  const shift = { x: 0.25, y: -0.4, z: 0.9 };
  assert.deepEqual(A.applyMask(shift, A.maskFromLock('y')), { x: 0, y: -0.4, z: 0 });
  assert.deepEqual(A.applyMask(shift, A.maskFromLock('z')), { x: 0, y: 0, z: 0.9 });
});

test('a plane constraint (gizmo XY square) moves the two axes and freezes Z', () => {
  const shift = { x: 0.25, y: -0.4, z: 0.9 };
  assert.deepEqual(A.applyMask(shift, A.maskFromGizmoAxis('XY')), { x: 0.25, y: -0.4, z: 0 });
});

test('free move keeps the whole snap shift', () => {
  const shift = { x: 0.25, y: -0.4, z: 0.9 };
  assert.deepEqual(A.applyMask(shift, A.maskFromLock('free')), shift);
  assert.deepEqual(A.applyMask(shift, null), shift);
});

test('selecting every gizmo axis constrains nothing', () => {
  assert.equal(A.isConstrained(A.maskFromGizmoAxis('XYZ')), false, 'the centre ball must not count as a lock');
  assert.equal(A.isConstrained(null), false);
  assert.equal(A.isConstrained(A.maskFromLock('free')), false);
});

test('a single axis or a plane constraint does freeze an axis', () => {
  assert.equal(A.isConstrained(A.maskFromLock('x')), true);
  assert.equal(A.isConstrained(A.maskFromGizmoAxis('Y')), true);
  assert.equal(A.isConstrained(A.maskFromGizmoAxis('XY')), true);
  assert.equal(A.isConstrained(A.maskFromGizmoAxis('XZ')), true);
});

test('maskLabel describes the constraint for the status bar', () => {
  assert.equal(A.maskLabel(A.maskFromLock('x')), 'X');
  assert.equal(A.maskLabel(A.maskFromGizmoAxis('XZ')), 'XZ');
  assert.equal(A.maskLabel(null), 'FREE');
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  failures.forEach(({ name, err }) => console.error(`\n✗ ${name}\n  ${err.message}`));
  process.exit(1);
}
