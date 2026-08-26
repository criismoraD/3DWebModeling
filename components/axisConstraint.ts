import type { AxisLock } from '../types';

export interface XYZ {
  x: number;
  y: number;
  z: number;
}

/** 1 on the axes allowed to move, 0 on the locked ones. `null` = free. */
export type AxisMask = XYZ | null;

/**
 * Mask for a gizmo axis as reported by THREE.TransformControls
 * ('X', 'Y', 'Z', 'XY', 'XZ', 'YZ', 'XYZ', 'E' or null).
 */
export function maskFromGizmoAxis(axis: string | null | undefined): AxisMask {
  if (!axis) return null;
  const mask: XYZ = { x: 0, y: 0, z: 0 };
  if (axis.includes('X')) mask.x = 1;
  if (axis.includes('Y')) mask.y = 1;
  if (axis.includes('Z')) mask.z = 1;
  return mask.x || mask.y || mask.z ? mask : null; // 'E' / unknown -> free
}

/** Mask for the modal transform axis lock (G/R/S + X/Y/Z). */
export function maskFromLock(lock: AxisLock): AxisMask {
  if (lock === 'free') return null;
  return { x: lock === 'x' ? 1 : 0, y: lock === 'y' ? 1 : 0, z: lock === 'z' ? 1 : 0 };
}

/**
 * Keeps only the components the constraint allows.
 * Selects instead of multiplying so a negative input does not turn into -0 on
 * the locked axes (that leaks into stored coordinates and reads as "-0.000").
 */
export function applyMask<T extends XYZ>(v: T, mask: AxisMask): XYZ {
  if (!mask) return { x: v.x, y: v.y, z: v.z };
  return {
    x: mask.x ? v.x : 0,
    y: mask.y ? v.y : 0,
    z: mask.z ? v.z : 0,
  };
}

/** Human readable label of a constraint, for the status bar. */
export function maskLabel(mask: AxisMask): string {
  if (!mask) return 'FREE';
  const axes = (['x', 'y', 'z'] as const).filter(a => mask[a]).map(a => a.toUpperCase());
  return axes.join('');
}
