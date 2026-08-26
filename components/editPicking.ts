import * as THREE from 'three';
import type { MeshData, SubObjectMode, Vector3Data } from '../types';
import type { RenderData } from '../editGeometry';
import { edgeKey, faceEdges, parseEdgeKey } from '../editGeometry';
import { distanceToSegment, pointInTriangle, projectToScreen } from './snapping';

export interface PickedElement {
  kind: SubObjectMode;
  /** vertex index / face index as a string, or an "a-b" edge key */
  key: string;
  /** world space position of the element */
  point: Vector3Data;
  /** screen space distance in pixels (depth for faces) */
  distance: number;
  /** normalized depth, used to resolve elements that overlap on screen */
  depth: number;
}

/**
 * Pixels within which two elements are visually indistinguishable. When that
 * happens the one closest to the camera wins, so you never grab a hidden vertex
 * that sits exactly behind the one you can see (a cube seen from a corner does
 * exactly that: two opposite corners share one pixel).
 */
const OVERLAP_TOLERANCE_PX = 1.5;

function isBetter(candidate: { distance: number; depth: number }, best: { distance: number; depth: number } | null): boolean {
  if (!best) return true;
  if (Math.abs(candidate.distance - best.distance) <= OVERLAP_TOLERANCE_PX) return candidate.depth < best.depth;
  return candidate.distance < best.distance;
}

export interface PickContext {
  mesh: MeshData;
  worldVertices: THREE.Vector3[];
  renderData: RenderData;
  camera: THREE.Camera;
  width: number;
  height: number;
  mode: SubObjectMode;
  radiusPx: number;
}

const toData = (v: THREE.Vector3): Vector3Data => ({ x: v.x, y: v.y, z: v.z });

/** Every edge of the mesh (face edges + loose edges) as "a-b" keys. */
export function collectEdgeKeys(mesh: MeshData): string[] {
  const keys = new Set<string>();
  mesh.faces.forEach(f => faceEdges(f).forEach(([a, b]) => keys.add(edgeKey(a, b))));
  mesh.edges.forEach(([a, b]) => keys.add(edgeKey(a, b)));
  return Array.from(keys);
}

/**
 * Finds the sub-object under a pixel.
 *
 * Priority follows the active mode, falling back to the smaller element types so
 * a vertex on top of a face stays clickable:
 *   vertex -> vertex
 *   edge   -> edge, vertex
 *   face   -> face, edge, vertex
 */
export function pickElement(ctx: PickContext, px: number, py: number): PickedElement | null {
  const { mesh, worldVertices, renderData, camera, width, height, mode } = ctx;
  const radius = Math.max(6, ctx.radiusPx);

  let bestVertex: PickedElement | null = null;
  worldVertices.forEach((wp, i) => {
    const s = projectToScreen(wp, camera, width, height);
    if (!s) return;
    const d = Math.hypot(s.x - px, s.y - py);
    if (d > radius) return;
    const candidate = { kind: 'vertex' as const, key: String(i), point: toData(wp), distance: d, depth: s.depth };
    if (isBetter(candidate, bestVertex)) bestVertex = candidate;
  });

  let bestEdge: PickedElement | null = null;
  collectEdgeKeys(mesh).forEach(key => {
    const [a, b] = parseEdgeKey(key);
    const pa = worldVertices[a];
    const pb = worldVertices[b];
    if (!pa || !pb) return;
    const sa = projectToScreen(pa, camera, width, height);
    const sb = projectToScreen(pb, camera, width, height);
    if (!sa || !sb) return;
    const d = distanceToSegment(px, py, sa.x, sa.y, sb.x, sb.y);
    if (d > radius) return;
    const candidate = {
      kind: 'edge' as const,
      key,
      point: toData(pa.clone().add(pb).multiplyScalar(0.5)),
      distance: d,
      depth: (sa.depth + sb.depth) / 2,
    };
    if (isBetter(candidate, bestEdge)) bestEdge = candidate;
  });

  let bestFace: PickedElement | null = null;
  if (mode === 'face') {
    renderData.triangles.forEach((tri, ti) => {
      const faceIndex = renderData.faceOfTriangle[ti];
      const pts = tri.map(i => worldVertices[i]);
      if (pts.some(p => !p)) return;
      const sp = pts.map(p => projectToScreen(p, camera, width, height));
      if (sp.some(s => !s)) return;
      const [a, b, c] = sp as { x: number; y: number; depth: number }[];
      if (!pointInTriangle(px, py, a.x, a.y, b.x, b.y, c.x, c.y)) return;
      const depth = (a.depth + b.depth + c.depth) / 3;
      if (!bestFace || depth < bestFace.distance) {
        const face = mesh.faces[faceIndex];
        let center = new THREE.Vector3();
        face.forEach(i => center.add(worldVertices[i]));
        center.multiplyScalar(1 / Math.max(1, face.length));
        bestFace = { kind: 'face', key: String(faceIndex), point: toData(center), distance: depth, depth };
      }
    });
  }

  if (mode === 'vertex') return bestVertex;
  if (mode === 'edge') return bestEdge ?? bestVertex;
  return bestFace ?? bestEdge ?? bestVertex;
}

export interface RectSelection {
  vertices: number[];
  edges: string[];
  faces: number[];
}

/** Elements whose screen space representative falls inside the drag rectangle. */
export function elementsInRect(
  ctx: Omit<PickContext, 'mode' | 'radiusPx'>,
  x0: number,
  y0: number,
  x1: number,
  y1: number
): RectSelection {
  const { mesh, worldVertices, camera, width, height } = ctx;
  const left = Math.min(x0, x1), right = Math.max(x0, x1);
  const top = Math.min(y0, y1), bottom = Math.max(y0, y1);
  const inside = (s: { x: number; y: number }) =>
    s.x >= left && s.x <= right && s.y >= top && s.y <= bottom;

  const vertices: number[] = [];
  worldVertices.forEach((wp, i) => {
    const s = projectToScreen(wp, camera, width, height);
    if (s && inside(s)) vertices.push(i);
  });

  const edges: string[] = [];
  collectEdgeKeys(mesh).forEach(key => {
    const [a, b] = parseEdgeKey(key);
    const sa = projectToScreen(worldVertices[a], camera, width, height);
    const sb = projectToScreen(worldVertices[b], camera, width, height);
    if (!sa || !sb) return;
    if (inside({ x: (sa.x + sb.x) / 2, y: (sa.y + sb.y) / 2 })) edges.push(key);
  });

  const faces: number[] = [];
  mesh.faces.forEach((face, fi) => {
    let center = new THREE.Vector3();
    face.forEach(i => center.add(worldVertices[i]));
    center.multiplyScalar(1 / Math.max(1, face.length));
    const s = projectToScreen(center, camera, width, height);
    if (s && inside(s)) faces.push(fi);
  });

  return { vertices, edges, faces };
}

/**
 * Decides what a plain left click on an element does to the selection:
 *   - the element is already selected -> keep the selection (a drag then moves
 *     everything, like Blender)
 *   - anything else -> select only that element
 * Returns null when the selection must stay untouched.
 */
export function resolveClickSelection(
  current: { vertices: number[]; edges: string[]; faces: number[] },
  hit: { kind: SubObjectMode; key: string }
): { vertices: number[]; edges: string[]; faces: number[] } | null {
  const index = parseInt(hit.key, 10);
  const alreadySelected =
    hit.kind === 'vertex'
      ? current.vertices.includes(index)
      : hit.kind === 'edge'
      ? current.edges.includes(hit.key)
      : current.faces.includes(index);

  if (alreadySelected) return null;
  if (hit.kind === 'vertex') return { vertices: [index], edges: [], faces: [] };
  if (hit.kind === 'edge') return { vertices: [], edges: [hit.key], faces: [] };
  return { vertices: [], edges: [], faces: [index] };
}
