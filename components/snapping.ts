import * as THREE from 'three';
import type { SceneObject, Vector3Data } from '../types';
import { faceEdges, primitiveToMesh, vec } from '../editGeometry';

export interface SnapCandidate {
  point: THREE.Vector3;
  kind: 'vertex' | 'midpoint';
  objectId: string;
  vertexIndex: number | null;
}

export const toVec3 = (p: Vector3Data) => new THREE.Vector3(p.x, p.y, p.z);
export const toData = (p: THREE.Vector3): Vector3Data => vec(p.x, p.y, p.z);

/** World matrix of an object (pivot offset is baked into editable meshes). */
export function objectMatrix(obj: SceneObject): THREE.Matrix4 {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(obj.rotation.x, obj.rotation.y, obj.rotation.z, 'XYZ')
  );
  m.compose(
    new THREE.Vector3(obj.position.x, obj.position.y, obj.position.z),
    q,
    new THREE.Vector3(obj.scale.x, obj.scale.y, obj.scale.z)
  );
  return m;
}

interface GatherOptions {
  /** Objects whose vertices must be ignored (usually the dragged one). */
  excludeIds?: string[];
  midpoints?: boolean;
  /** Only collect vertices of these indices for the excluded object (self snap). */
  includeSelf?: boolean;
}

/**
 * Every point the selection can snap to, in world space.
 * Primitives are converted on the fly so snapping works before "make editable".
 */
export function gatherSnapCandidates(objects: SceneObject[], opts: GatherOptions = {}): SnapCandidate[] {
  const out: SnapCandidate[] = [];
  const excluded = new Set(opts.excludeIds || []);

  objects.forEach(obj => {
    if (!obj.visible) return;
    const isExcluded = excluded.has(obj.id);
    if (isExcluded && !opts.includeSelf) return;

    const mesh = obj.mesh ?? primitiveToMesh(obj);
    const matrix = objectMatrix(obj);
    const v = new THREE.Vector3();

    mesh.vertices.forEach((p, i) => {
      v.set(p.x, p.y, p.z).applyMatrix4(matrix);
      out.push({ point: v.clone(), kind: 'vertex', objectId: obj.id, vertexIndex: i });
    });

    if (opts.midpoints) {
      const seen = new Set<string>();
      const pushMid = (a: number, b: number) => {
        const key = a < b ? `${a}-${b}` : `${b}-${a}`;
        if (seen.has(key)) return;
        seen.add(key);
        const pa = mesh.vertices[a];
        const pb = mesh.vertices[b];
        if (!pa || !pb) return;
        const mid = new THREE.Vector3((pa.x + pb.x) / 2, (pa.y + pb.y) / 2, (pa.z + pb.z) / 2).applyMatrix4(matrix);
        out.push({ point: mid, kind: 'midpoint', objectId: obj.id, vertexIndex: null });
      };
      mesh.faces.forEach(f => faceEdges(f).forEach(([a, b]) => pushMid(a, b)));
      mesh.edges.forEach(([a, b]) => pushMid(a, b));
    }
  });

  return out;
}

/** Projects a world point to viewport pixels. Returns null when behind the camera. */
export function projectToScreen(
  point: THREE.Vector3,
  camera: THREE.Camera,
  width: number,
  height: number
): { x: number; y: number; depth: number } | null {
  const p = point.clone().project(camera);
  if (p.z < -1 || p.z > 1) return null;
  return { x: (p.x * 0.5 + 0.5) * width, y: (-p.y * 0.5 + 0.5) * height, depth: p.z };
}

/** Nearest candidate to a pixel position, within `radiusPx`. */
export function findNearestCandidate(
  candidates: SnapCandidate[],
  camera: THREE.Camera,
  width: number,
  height: number,
  px: number,
  py: number,
  radiusPx: number
): { candidate: SnapCandidate; distance: number } | null {
  let best: { candidate: SnapCandidate; distance: number } | null = null;
  for (const candidate of candidates) {
    const s = projectToScreen(candidate.point, camera, width, height);
    if (!s) continue;
    const d = Math.hypot(s.x - px, s.y - py);
    if (d > radiusPx) continue;
    // Prefer the closest to the cursor, then the closest to the camera
    if (!best || d < best.distance - 1e-6 || (Math.abs(d - best.distance) < 1e-6 && s.depth < 0)) {
      best = { candidate, distance: d };
    }
  }
  return best;
}

/** Snaps a world point onto the grid. */
export function snapPointToGrid(point: THREE.Vector3, cell: number): THREE.Vector3 {
  if (!cell || cell <= 0) return point.clone();
  return new THREE.Vector3(
    Math.round(point.x / cell) * cell,
    Math.round(point.y / cell) * cell,
    Math.round(point.z / cell) * cell
  );
}

/** Distance from a pixel to a screen space segment. */
export function distanceToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-9) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function pointInTriangle(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number
): boolean {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}
