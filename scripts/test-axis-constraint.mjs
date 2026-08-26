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

test('a locked axis keeps its exact value while moving, snapped or not', () => {
  const original = { x: 0.1, y: -0.25, z: 0.4 };
  const delta = { x: 0.05, y: 0.02, z: -0.03 };
  const snapShift = { x: 0.001, y: -0.7, z: 0.9 }; // a snap far away on Y and Z

  const lockedX = A.moveWithConstraint(original, delta, snapShift, A.maskFromLock('x'));
  assert.equal(lockedX.y, original.y, 'Y drifted while locked to X');
  assert.equal(lockedX.z, original.z, 'Z drifted while locked to X');
  assert.ok(Math.abs(lockedX.x - (0.1 + 0.05 + 0.001)) < 1e-12, 'X did not follow the snap');

  const lockedY = A.moveWithConstraint(original, delta, snapShift, A.maskFromLock('y'));
  assert.equal(lockedY.x, original.x);
  assert.equal(lockedY.z, original.z);
  assert.ok(Math.abs(lockedY.y - (-0.25 + 0.02 - 0.7)) < 1e-12);
});

test('free move applies the whole delta and the whole snap shift', () => {
  const original = { x: 0, y: 0, z: 0 };
  const moved = A.moveWithConstraint(original, { x: 1, y: 2, z: 3 }, { x: 0.5, y: 0, z: 0 }, null);
  assert.deepEqual(moved, { x: 1.5, y: 2, z: 3 });
});

test('a move with no snap shift at all still works', () => {
  const moved = A.moveWithConstraint({ x: 1, y: 1, z: 1 }, { x: 0.5, y: 0, z: 0 }, null, A.maskFromLock('x'));
  assert.deepEqual(moved, { x: 1.5, y: 1, z: 1 });
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
