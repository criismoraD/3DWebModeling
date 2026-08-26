import type {
  EditOperation,
  EditOperationResult,
  EditSelection,
  MeshData,
  SceneObject,
  SubObjectMode,
  Vector3Data,
} from './types';

/* ------------------------------------------------------------------ *
 * Small vector helpers (kept dependency free so this module can be
 * unit tested in plain node without three.js).
 * ------------------------------------------------------------------ */

export const vec = (x = 0, y = 0, z = 0): Vector3Data => ({ x, y, z });
export const addV = (a: Vector3Data, b: Vector3Data): Vector3Data => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const subV = (a: Vector3Data, b: Vector3Data): Vector3Data => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const mulV = (a: Vector3Data, s: number): Vector3Data => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const dotV = (a: Vector3Data, b: Vector3Data) => a.x * b.x + a.y * b.y + a.z * b.z;
export const crossV = (a: Vector3Data, b: Vector3Data): Vector3Data => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
export const lenV = (a: Vector3Data) => Math.hypot(a.x, a.y, a.z);
export const distV = (a: Vector3Data, b: Vector3Data) => lenV(subV(a, b));
export const normV = (a: Vector3Data): Vector3Data => {
  const l = lenV(a);
  return l > 1e-12 ? mulV(a, 1 / l) : vec(0, 0, 0);
};
export const cloneV = (a: Vector3Data): Vector3Data => ({ x: a.x, y: a.y, z: a.z });
export const sameV = (a: Vector3Data, b: Vector3Data, eps = 1e-9) =>
  Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps && Math.abs(a.z - b.z) < eps;

export const emptySelection = (): EditSelection => ({ vertices: [], edges: [], faces: [] });

export const cloneMesh = (m: MeshData): MeshData => ({
  vertices: m.vertices.map(cloneV),
  faces: m.faces.map(f => f.slice()),
  edges: m.edges.map(e => [e[0], e[1]] as [number, number]),
});

export const createMesh = (
  vertices: Vector3Data[] = [],
  faces: number[][] = [],
  edges: [number, number][] = []
): MeshData => ({ vertices, faces, edges });

/* ------------------------------------------------------------------ *
 * Topology helpers
 * ------------------------------------------------------------------ */

export const edgeKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);

export const parseEdgeKey = (key: string): [number, number] => {
  const [a, b] = key.split('-').map(n => parseInt(n, 10));
  return [a, b];
};

/** Ordered edges of a face loop. */
export function faceEdges(face: number[]): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < face.length; i++) out.push([face[i], face[(i + 1) % face.length]]);
  return out;
}

/** edgeKey -> indices of the faces using it. */
export function buildEdgeFaceMap(mesh: MeshData): Map<string, number[]> {
  const map = new Map<string, number[]>();
  mesh.faces.forEach((face, fi) => {
    faceEdges(face).forEach(([a, b]) => {
      const k = edgeKey(a, b);
      const list = map.get(k);
      if (list) list.push(fi);
      else map.set(k, [fi]);
    });
  });
  return map;
}

/** vertex index -> neighbouring vertex indices (faces + loose edges). */
export function buildVertexAdjacency(mesh: MeshData): Map<number, Set<number>> {
  const adj = new Map<number, Set<number>>();
  const link = (a: number, b: number) => {
    if (a === b) return;
    if (!adj.has(a)) adj.set(a, new Set());
    if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a)!.add(b);
    adj.get(b)!.add(a);
  };
  mesh.faces.forEach(face => faceEdges(face).forEach(([a, b]) => link(a, b)));
  mesh.edges.forEach(([a, b]) => link(a, b));
  return adj;
}

/** vertex index -> faces using it. */
export function buildVertexFaceMap(mesh: MeshData): Map<number, number[]> {
  const map = new Map<number, number[]>();
  mesh.faces.forEach((face, fi) => {
    face.forEach(v => {
      const list = map.get(v);
      if (list) list.push(fi);
      else map.set(v, [fi]);
    });
  });
  return map;
}

/** Newell's method: robust polygon normal for planar *and* non planar loops. */
export function polygonNormal(mesh: MeshData, face: number[]): Vector3Data {
  let n = vec(0, 0, 0);
  for (let i = 0; i < face.length; i++) {
    const cur = mesh.vertices[face[i]];
    const next = mesh.vertices[face[(i + 1) % face.length]];
    if (!cur || !next) continue;
    n = addV(n, {
      x: (cur.y - next.y) * (cur.z + next.z),
      y: (cur.z - next.z) * (cur.x + next.x),
      z: (cur.x - next.x) * (cur.y + next.y),
    });
  }
  return normV(n);
}

export function polygonCenter(mesh: MeshData, face: number[]): Vector3Data {
  let c = vec(0, 0, 0);
  face.forEach(i => (c = addV(c, mesh.vertices[i] || vec())));
  return mulV(c, 1 / Math.max(1, face.length));
}

export function selectionCenter(mesh: MeshData, sel: EditSelection): Vector3Data | null {
  const idx = activeVertexIndices(mesh, sel);
  if (idx.length === 0) return null;
  let c = vec(0, 0, 0);
  idx.forEach(i => (c = addV(c, mesh.vertices[i])));
  return mulV(c, 1 / idx.length);
}

/** All vertex indices touched by the current selection. */
export function activeVertexIndices(mesh: MeshData, sel: EditSelection): number[] {
  const set = new Set<number>(sel.vertices.filter(i => i >= 0 && i < mesh.vertices.length));
  sel.edges.forEach(k => {
    const [a, b] = parseEdgeKey(k);
    if (a >= 0 && a < mesh.vertices.length) set.add(a);
    if (b >= 0 && b < mesh.vertices.length) set.add(b);
  });
  sel.faces.forEach(fi => {
    const face = mesh.faces[fi];
    if (face) face.forEach(v => set.add(v));
  });
  return Array.from(set);
}

/* ------------------------------------------------------------------ *
 * Triangulation (ear clipping on the polygon's best fit plane)
 * ------------------------------------------------------------------ */

export type Triangle = [number, number, number];

/** Triangulates a planar-ish polygon given as points; returns index triples. */
export function triangulatePolygon(points: Vector3Data[]): Triangle[] {
  const n = points.length;
  if (n < 3) return [];
  if (n === 3) return [[0, 1, 2]];

  // Best fit plane basis
  let center = vec(0, 0, 0);
  points.forEach(p => (center = addV(center, p)));
  center = mulV(center, 1 / n);

  let normal = vec(0, 0, 0);
  for (let i = 0; i < n; i++) {
    normal = addV(normal, crossV(subV(points[i], center), subV(points[(i + 1) % n], center)));
  }
  normal = normV(normal);

  const fan = (): Triangle[] => {
    const out: Triangle[] = [];
    for (let i = 1; i < n - 1; i++) out.push([0, i, i + 1]);
    return out;
  };
  if (lenV(normal) < 1e-9) return fan();

  // Orthonormal basis (u, v) on the plane
  const helper = Math.abs(normal.x) < 0.9 ? vec(1, 0, 0) : vec(0, 1, 0);
  const u = normV(crossV(helper, normal));
  const v = crossV(normal, u);

  const pts2d = points.map(p => {
    const d = subV(p, center);
    return { x: dotV(d, u), y: dotV(d, v) };
  });

  // Make sure the 2D projection is counter clockwise
  let area = 0;
  for (let i = 0; i < n; i++) {
    const a = pts2d[i];
    const b = pts2d[(i + 1) % n];
    area += a.x * b.y - b.x * a.y;
  }
  const idx: number[] = [];
  for (let i = 0; i < n; i++) idx.push(i);
  if (area < 0) idx.reverse();

  const cross2 = (o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const pointInTri = (p: { x: number; y: number }, a: number, b: number, c: number) => {
    const d1 = cross2(p, pts2d[a], pts2d[b]);
    const d2 = cross2(p, pts2d[b], pts2d[c]);
    const d3 = cross2(p, pts2d[c], pts2d[a]);
    const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
    const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
    return !(hasNeg && hasPos);
  };

  const out: Triangle[] = [];
  let guard = 0;
  while (idx.length > 3 && guard++ < 4096) {
    let earFound = false;
    for (let i = 0; i < idx.length; i++) {
      const i0 = idx[(i + idx.length - 1) % idx.length];
      const i1 = idx[i];
      const i2 = idx[(i + 1) % idx.length];
      if (cross2(pts2d[i0], pts2d[i1], pts2d[i2]) <= 1e-12) continue; // reflex / degenerate

      let contains = false;
      for (const other of idx) {
        if (other === i0 || other === i1 || other === i2) continue;
        if (pointInTri(pts2d[other], i0, i1, i2)) {
          contains = true;
          break;
        }
      }
      if (contains) continue;

      out.push([i0, i1, i2]);
      idx.splice(i, 1);
      earFound = true;
      break;
    }
    if (!earFound) break; // degenerate polygon: fall back to a fan for the rest
  }
  if (idx.length === 3) out.push([idx[0], idx[1], idx[2]]);
  else if (idx.length > 3) {
    for (let i = 1; i < idx.length - 1; i++) out.push([idx[0], idx[i], idx[i + 1]]);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Render data (positions / normals / indices) with hard edge support
 * ------------------------------------------------------------------ */

export interface RenderData {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  /** Line segments for every edge (face edges + loose edges). */
  wireIndices: Uint32Array;
  triangles: Triangle[]; // per triangle: original vertex indices
  faceOfTriangle: number[];
}

/**
 * Builds renderable arrays. Vertices are split when the angle between two
 * adjacent face normals is above `smoothAngleDeg`, which keeps cubes flat and
 * spheres smooth (like Blender's auto smooth).
 */
export function buildRenderData(mesh: MeshData, smoothAngleDeg = 45): RenderData {
  const triangles: Triangle[] = [];
  const faceOfTriangle: number[] = [];
  const faceNormals: Vector3Data[] = [];

  mesh.faces.forEach((face, fi) => {
    if (!face || face.length < 3) return;
    const pts = face.map(i => mesh.vertices[i] || vec());
    const tris = triangulatePolygon(pts);
    let n = vec(0, 0, 0);
    for (let i = 0; i < face.length; i++) {
      n = addV(n, crossV(subV(pts[i], pts[0]), subV(pts[(i + 1) % face.length], pts[0])));
    }
    n = normV(n);
    faceNormals[fi] = n;
    tris.forEach(t => {
      triangles.push([face[t[0]], face[t[1]], face[t[2]]]);
      faceOfTriangle.push(fi);
    });
  });

  const vertFaces = buildVertexFaceMap(mesh);
  const cosThreshold = Math.cos((smoothAngleDeg * Math.PI) / 180);

  // corner key -> index in the output arrays
  const cornerIndex = new Map<string, number>();
  const positions: number[] = [];
  const normals: number[] = [];
  const vertexToCorner = new Map<number, number>();

  const addCorner = (vi: number, cluster: number, normal: Vector3Data) => {
    const key = `${vi}#${cluster}`;
    let idx = cornerIndex.get(key);
    if (idx === undefined) {
      idx = positions.length / 3;
      cornerIndex.set(key, idx);
      const p = mesh.vertices[vi] || vec();
      positions.push(p.x, p.y, p.z);
      normals.push(normal.x, normal.y, normal.z);
      if (!vertexToCorner.has(vi)) vertexToCorner.set(vi, idx);
    }
    return idx;
  };

  // Cluster the faces around each vertex by normal similarity
  const clusters = new Map<number, { normal: Vector3Data; id: number }[]>();
  const clusterOfCorner = new Map<string, number>(); // `${vi}|${fi}` -> cluster id
  mesh.faces.forEach((face, fi) => {
    face.forEach(vi => {
      const fn = faceNormals[fi] || vec(0, 1, 0);
      let list = clusters.get(vi);
      if (!list) {
        list = [];
        clusters.set(vi, list);
      }
      let found = list.find(c => dotV(c.normal, fn) >= cosThreshold);
      if (!found) {
        found = { normal: fn, id: list.length };
        list.push(found);
      }
      clusterOfCorner.set(`${vi}|${fi}`, found.id);
    });
  });

  const indices: number[] = [];
  triangles.forEach((tri, ti) => {
    const fi = faceOfTriangle[ti];
    const fn = faceNormals[fi] || vec(0, 1, 0);
    tri.forEach(vi => {
      const cluster = clusterOfCorner.get(`${vi}|${fi}`) ?? 0;
      indices.push(addCorner(vi, cluster, fn));
    });
  });

  // Smooth the normals of every corner that ended up alone in its cluster group
  const accumulated: number[] = new Array(positions.length).fill(0);
  triangles.forEach((tri, ti) => {
    const fn = faceNormals[faceOfTriangle[ti]] || vec(0, 1, 0);
    tri.forEach(vi => {
      const cluster = clusterOfCorner.get(`${vi}|${faceOfTriangle[ti]}`) ?? 0;
      const idx = cornerIndex.get(`${vi}#${cluster}`);
      if (idx === undefined) return;
      accumulated[idx * 3] += fn.x;
      accumulated[idx * 3 + 1] += fn.y;
      accumulated[idx * 3 + 2] += fn.z;
    });
  });
  for (let i = 0; i < positions.length / 3; i++) {
    const n = normV({ x: accumulated[i * 3], y: accumulated[i * 3 + 1], z: accumulated[i * 3 + 2] });
    normals[i * 3] = n.x;
    normals[i * 3 + 1] = n.y;
    normals[i * 3 + 2] = n.z;
  }

  // Wireframe indices
  const wireSet = new Set<string>();
  const wire: number[] = [];
  const pushWire = (a: number, b: number) => {
    if (a === b) return;
    const k = edgeKey(a, b);
    if (wireSet.has(k)) return;
    wireSet.add(k);
    const ia = vertexToCorner.get(a);
    const ib = vertexToCorner.get(b);
    if (ia === undefined || ib === undefined) return;
    wire.push(ia, ib);
  };
  mesh.faces.forEach(face => faceEdges(face).forEach(([a, b]) => pushWire(a, b)));
  mesh.edges.forEach(([a, b]) => pushWire(a, b));

  // Vertices without any corner yet (isolated) still need a slot for the point cloud
  mesh.vertices.forEach((_, vi) => {
    if (!vertexToCorner.has(vi)) {
      const idx = positions.length / 3;
      positions.push(mesh.vertices[vi].x, mesh.vertices[vi].y, mesh.vertices[vi].z);
      normals.push(0, 1, 0);
      vertexToCorner.set(vi, idx);
    }
  });

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
    wireIndices: new Uint32Array(wire),
    triangles,
    faceOfTriangle,
  };
}

/* ------------------------------------------------------------------ *
 * Primitive -> editable mesh conversion
 * ------------------------------------------------------------------ */

const quad = (a: number, b: number, c: number, d: number) => [a, b, c, d];

export function boxToMesh(size: Vector3Data): MeshData {
  const hx = size.x / 2, hy = size.y / 2, hz = size.z / 2;
  const vertices: Vector3Data[] = [
    vec(-hx, -hy, -hz), vec(hx, -hy, -hz), vec(hx, hy, -hz), vec(-hx, hy, -hz), // back  (0-3)
    vec(-hx, -hy, hz), vec(hx, -hy, hz), vec(hx, hy, hz), vec(-hx, hy, hz),      // front (4-7)
  ];
  const faces: number[][] = [
    quad(0, 3, 2, 1), // -Z
    quad(4, 5, 6, 7), // +Z
    quad(0, 1, 5, 4), // -Y
    quad(3, 7, 6, 2), // +Y
    quad(1, 2, 6, 5), // +X
    quad(0, 4, 7, 3), // -X
  ];
  return createMesh(vertices, faces);
}

export function planeToMesh(size: Vector3Data): MeshData {
  const hx = size.x / 2, hy = size.y / 2;
  const vertices = [vec(-hx, -hy, 0), vec(hx, -hy, 0), vec(hx, hy, 0), vec(-hx, hy, 0)];
  return createMesh(vertices, [quad(0, 1, 2, 3)]);
}

export function sphereToMesh(radius: number, segU = 20, segV = 12): MeshData {
  const vertices: Vector3Data[] = [];
  const faces: number[][] = [];
  const grid: number[][] = [];
  for (let iy = 0; iy <= segV; iy++) {
    const row: number[] = [];
    const v = iy / segV;
    const phi = v * Math.PI;
    for (let ix = 0; ix <= segU; ix++) {
      const u = ix / segU;
      const theta = u * Math.PI * 2;
      vertices.push(
        vec(-radius * Math.cos(theta) * Math.sin(phi), radius * Math.cos(phi), radius * Math.sin(theta) * Math.sin(phi))
      );
      row.push(vertices.length - 1);
    }
    grid.push(row);
  }
  for (let iy = 0; iy < segV; iy++) {
    for (let ix = 0; ix < segU; ix++) {
      const a = grid[iy][ix + 1];
      const b = grid[iy][ix];
      const c = grid[iy + 1][ix];
      const d = grid[iy + 1][ix + 1];
      if (iy !== 0) faces.push([a, b, d]);
      if (iy !== segV - 1) faces.push([b, c, d]);
    }
  }
  // Collapse the poles into single vertices (they are all stacked already)
  return weldMesh(createMesh(vertices, faces), 1e-7);
}

export function cylinderToMesh(radius: number, height: number, segments = 20): MeshData {
  const vertices: Vector3Data[] = [];
  const faces: number[][] = [];
  const hy = height / 2;
  const bottom: number[] = [];
  const top: number[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const x = Math.cos(a) * radius;
    const z = Math.sin(a) * radius;
    vertices.push(vec(x, -hy, z));
    bottom.push(vertices.length - 1);
    vertices.push(vec(x, hy, z));
    top.push(vertices.length - 1);
  }
  for (let i = 0; i < segments; i++) {
    const j = (i + 1) % segments;
    faces.push(quad(bottom[i], bottom[j], top[j], top[i]));
  }
  vertices.push(vec(0, -hy, 0));
  const bc = vertices.length - 1;
  vertices.push(vec(0, hy, 0));
  const tc = vertices.length - 1;
  faces.push([bc, ...bottom.slice().reverse()]);
  faces.push([tc, ...top]);
  return createMesh(vertices, faces);
}

export function coneToMesh(radius: number, height: number, segments = 20): MeshData {
  const vertices: Vector3Data[] = [];
  const faces: number[][] = [];
  const hy = height / 2;
  const ring: number[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    vertices.push(vec(Math.cos(a) * radius, -hy, Math.sin(a) * radius));
    ring.push(vertices.length - 1);
  }
  vertices.push(vec(0, hy, 0));
  const apex = vertices.length - 1;
  for (let i = 0; i < segments; i++) {
    const j = (i + 1) % segments;
    faces.push([ring[i], ring[j], apex]);
  }
  vertices.push(vec(0, -hy, 0));
  const bc = vertices.length - 1;
  faces.push([bc, ...ring.slice().reverse()]);
  return createMesh(vertices, faces);
}

export function torusToMesh(radius: number, tube: number, radialSeg = 16, tubularSeg = 24): MeshData {
  const vertices: Vector3Data[] = [];
  const faces: number[][] = [];
  const grid: number[][] = [];
  for (let j = 0; j <= radialSeg; j++) {
    const row: number[] = [];
    for (let i = 0; i <= tubularSeg; i++) {
      const u = (i / tubularSeg) * Math.PI * 2;
      const v = (j / radialSeg) * Math.PI * 2;
      vertices.push(
        vec((radius + tube * Math.cos(v)) * Math.cos(u), tube * Math.sin(v), (radius + tube * Math.cos(v)) * Math.sin(u))
      );
      row.push(vertices.length - 1);
    }
    grid.push(row);
  }
  for (let j = 1; j <= radialSeg; j++) {
    for (let i = 1; i <= tubularSeg; i++) {
      const a = grid[j - 1][i - 1];
      const b = grid[j - 1][i];
      const c = grid[j][i];
      const d = grid[j][i - 1];
      faces.push(quad(a, b, c, d));
    }
  }
  return weldMesh(createMesh(vertices, faces), 1e-7);
}

/** Bakes the object's pivot offset into the vertex data (offset/rotation reset). */
export function primitiveToMesh(obj: SceneObject): MeshData {
  const dims = obj.dimensions || vec(0.1, 0.1, 0.1);
  let mesh: MeshData;
  switch (obj.geometry) {
    case 'sphere':
      mesh = sphereToMesh(obj.radius ?? 0.05);
      break;
    case 'plane':
      mesh = planeToMesh(vec(dims.x, dims.z, 0));
      break;
    case 'cylinder':
      mesh = cylinderToMesh(obj.radius ?? dims.x / 2, dims.y);
      break;
    case 'cone':
      mesh = coneToMesh(obj.radius ?? dims.x / 2, dims.y);
      break;
    case 'torus':
      mesh = torusToMesh(obj.radius ?? dims.x / 2, (obj.radius ?? dims.x / 2) * 0.35);
      break;
    case 'box':
    default:
      mesh = boxToMesh(dims);
  }
  // Apply pivot offset so the world look does not change after conversion
  const off = obj.geometryOffset || vec();
  const rot = obj.geometryRotation || vec();
  if (lenV(off) > 1e-9 || lenV(rot) > 1e-9) {
    const cx = Math.cos(rot.x), sx = Math.sin(rot.x);
    const cy = Math.cos(rot.y), sy = Math.sin(rot.y);
    const cz = Math.cos(rot.z), sz = Math.sin(rot.z);
    mesh.vertices = mesh.vertices.map(p => {
      // Rz * Ry * Rx (matches THREE.Euler default XYZ order)
      let x = p.x, y = p.y, z = p.z;
      let y1 = y * cx - z * sx;
      let z1 = y * sx + z * cx;
      let x2 = x * cy + z1 * sy;
      let z2 = -x * sy + z1 * cy;
      let x3 = x2 * cz - y1 * sz;
      let y3 = x2 * sz + y1 * cz;
      return vec(x3 + off.x, y3 + off.y, z2 + off.z);
    });
  }
  return mesh;
}

/** World space bounding box size of a mesh (local units, ignores object scale). */
export function meshBounds(mesh: MeshData): { min: Vector3Data; max: Vector3Data; size: Vector3Data; center: Vector3Data } {
  if (mesh.vertices.length === 0) {
    const z = vec();
    return { min: z, max: z, size: z, center: z };
  }
  const min = vec(Infinity, Infinity, Infinity);
  const max = vec(-Infinity, -Infinity, -Infinity);
  mesh.vertices.forEach(p => {
    min.x = Math.min(min.x, p.x); min.y = Math.min(min.y, p.y); min.z = Math.min(min.z, p.z);
    max.x = Math.max(max.x, p.x); max.y = Math.max(max.y, p.y); max.z = Math.max(max.z, p.z);
  });
  return {
    min,
    max,
    size: subV(max, min),
    center: mulV(addV(min, max), 0.5),
  };
}

/* ------------------------------------------------------------------ *
 * Topology editing operations
 * ------------------------------------------------------------------ */

/**
 * Removes degenerate / duplicated faces. Returns a map from the old face index
 * to the new one (-1 when the face was dropped) so selections can be remapped.
 */
function sanitizeFaces(mesh: MeshData): Map<number, number> {
  const remap = new Map<number, number>();
  const seen = new Set<string>();
  const kept: number[][] = [];
  mesh.faces.forEach((face, i) => {
    const clean: number[] = [];
    face.forEach(v => {
      if (clean[clean.length - 1] !== v) clean.push(v);
    });
    if (clean.length > 1 && clean[0] === clean[clean.length - 1]) clean.pop();
    if (clean.length < 3 || new Set(clean).size < 3) {
      remap.set(i, -1);
      return;
    }
    const key = clean.slice().sort((a, b) => a - b).join(',');
    if (seen.has(key)) {
      remap.set(i, -1);
      return;
    }
    seen.add(key);
    kept.push(clean);
    remap.set(i, kept.length - 1);
  });
  mesh.faces = kept;
  return remap;
}

/** Remaps a face selection through the map produced by sanitizeFaces. */
function remapFaceSelection(indices: number[], remap: Map<number, number>): number[] {
  const out: number[] = [];
  indices.forEach(i => {
    const n = remap.get(i);
    if (n !== undefined && n >= 0) out.push(n);
  });
  return out;
}

function sanitizeEdges(mesh: MeshData): void {
  const seen = new Set<string>();
  const faceEdgesSet = new Set<string>();
  mesh.faces.forEach(face => faceEdges(face).forEach(([a, b]) => faceEdgesSet.add(edgeKey(a, b))));
  mesh.edges = mesh.edges.filter(([a, b]) => {
    if (a === b) return false;
    const k = edgeKey(a, b);
    if (seen.has(k)) return false;
    if (faceEdgesSet.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export interface WeldResult {
  mesh: MeshData;
  /** old vertex index -> new vertex index */
  vertexRemap: number[];
  /** old face index -> new face index (-1 when dropped) */
  faceRemap: Map<number, number>;
}

/** Removes vertices closer than `threshold` (union-find, keeps the average). */
export function weldMeshWithRemap(mesh: MeshData, threshold: number): WeldResult {
  const n = mesh.vertices.length;
  const parent = new Array(n).fill(0).map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a: number, b: number) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };
  const t2 = threshold * threshold;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = mesh.vertices[i].x - mesh.vertices[j].x;
      if (dx * dx > t2) continue;
      const dy = mesh.vertices[i].y - mesh.vertices[j].y;
      if (dy * dy > t2) continue;
      const dz = mesh.vertices[i].z - mesh.vertices[j].z;
      if (dx * dx + dy * dy + dz * dz <= t2) union(i, j);
    }
  }
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    const list = groups.get(r);
    if (list) list.push(i);
    else groups.set(r, [i]);
  }
  const remap = new Array(n).fill(0);
  const vertices: Vector3Data[] = [];
  groups.forEach(members => {
    let c = vec(0, 0, 0);
    members.forEach(m => (c = addV(c, mesh.vertices[m])));
    c = mulV(c, 1 / members.length);
    const newIndex = vertices.length;
    vertices.push(c);
    members.forEach(m => (remap[m] = newIndex));
  });
  const out = createMesh(
    vertices,
    mesh.faces.map(f => f.map(v => remap[v])),
    mesh.edges.map(([a, b]) => [remap[a], remap[b]] as [number, number])
  );
  const faceRemap = sanitizeFaces(out);
  sanitizeEdges(out);
  return { mesh: out, vertexRemap: remap, faceRemap };
}

/** Removes vertices closer than `threshold` (union-find, keeps the average). */
export function weldMesh(mesh: MeshData, threshold: number): MeshData {
  return weldMeshWithRemap(mesh, threshold).mesh;
}

function applyRemap(
  mesh: MeshData,
  remap: number[],
  removeIndices: Set<number>
): { mesh: MeshData; faceRemap: Map<number, number> } {
  const kept: number[] = [];
  const newIndexOf = new Map<number, number>();
  mesh.vertices.forEach((_, i) => {
    if (removeIndices.has(i)) return;
    newIndexOf.set(i, kept.length);
    kept.push(i);
  });
  const map = (v: number) => {
    const target = remap[v] ?? v;
    const ni = newIndexOf.get(target);
    return ni === undefined ? -1 : ni;
  };
  const out = createMesh(
    kept.map(i => cloneV(mesh.vertices[i])),
    mesh.faces.map(f => f.map(map)),
    mesh.edges.map(([a, b]) => [map(a), map(b)] as [number, number])
  );
  out.faces = out.faces.map(f => f.filter(v => v >= 0));
  out.edges = out.edges.filter(([a, b]) => a >= 0 && b >= 0);
  const faceRemap = sanitizeFaces(out);
  sanitizeEdges(out);
  return { mesh: out, faceRemap };
}

/* ------------------------------ extrude ------------------------------ */

export function extrudeElements(mesh: MeshData, sel: EditSelection): EditOperationResult {
  const result = cloneMesh(mesh);
  const dup = new Map<number, number>();
  const duplicate = (i: number) => {
    let d = dup.get(i);
    if (d === undefined) {
      d = result.vertices.length;
      result.vertices.push(cloneV(result.vertices[i]));
      dup.set(i, d);
    }
    return d;
  };

  if (sel.faces.length > 0) {
    const region = new Set(sel.faces);
    const edgeCount = new Map<string, number>();
    region.forEach(fi => {
      const face = mesh.faces[fi];
      if (!face) return;
      faceEdges(face).forEach(([a, b]) => {
        const k = edgeKey(a, b);
        edgeCount.set(k, (edgeCount.get(k) || 0) + 1);
      });
    });
    const faceSel: number[] = [];
    region.forEach(fi => {
      const face = mesh.faces[fi];
      if (!face) return;
      faceSel.push(result.faces.length);
      result.faces.push(face.map(duplicate));
    });
    // Side walls on the region boundary
    const edgeSel: string[] = [];
    region.forEach(fi => {
      const face = mesh.faces[fi];
      if (!face) return;
      faceEdges(face).forEach(([a, b]) => {
        if ((edgeCount.get(edgeKey(a, b)) || 0) !== 1) return;
        const a2 = duplicate(a);
        const b2 = duplicate(b);
        faceSel.push(result.faces.length);
        result.faces.push([a, b, b2, a2]);
        edgeSel.push(edgeKey(a2, b2));
      });
    });
    const vertSel = Array.from(dup.values());
    const remap = sanitizeFaces(result);
    return {
      mesh: result,
      selection: { vertices: vertSel, edges: edgeSel, faces: remapFaceSelection(faceSel, remap) },
      changed: true,
    };
  }

  if (sel.edges.length > 0) {
    const edgeFaceMap = buildEdgeFaceMap(mesh);
    const edgeSel: string[] = [];
    const vertSel: number[] = [];
    const faceSel: number[] = [];
    sel.edges.forEach(key => {
      const [a, b] = parseEdgeKey(key);
      if (a < 0 || b < 0 || a >= mesh.vertices.length || b >= mesh.vertices.length) return;
      const a2 = duplicate(a);
      const b2 = duplicate(b);
      const owners = edgeFaceMap.get(key) || [];
      if (owners.length > 0) {
        faceSel.push(result.faces.length);
        result.faces.push([a, b, b2, a2]);
      } else {
        result.edges.push([a, a2]);
        result.edges.push([b, b2]);
        result.edges.push([a2, b2]);
        edgeSel.push(edgeKey(a2, b2));
      }
      vertSel.push(a2, b2);
    });
    const remap = sanitizeFaces(result);
    sanitizeEdges(result);
    return {
      mesh: result,
      selection: { vertices: Array.from(new Set(vertSel)), edges: edgeSel, faces: remapFaceSelection(faceSel, remap) },
      changed: true,
    };
  }

  if (sel.vertices.length > 0) {
    const vertSel: number[] = [];
    const edgeSel: string[] = [];
    sel.vertices.forEach(i => {
      if (i < 0 || i >= mesh.vertices.length) return;
      const d = duplicate(i);
      result.edges.push([i, d]);
      vertSel.push(d);
      edgeSel.push(edgeKey(i, d));
    });
    sanitizeEdges(result);
    return {
      mesh: result,
      selection: { vertices: vertSel, edges: edgeSel, faces: [] },
      changed: true,
    };
  }

  return { mesh, selection: sel, changed: false };
}

/* ------------------------------ delete ------------------------------ */

export function deleteElements(mesh: MeshData, sel: EditSelection, mode: SubObjectMode): EditOperationResult {
  if (mode === 'face' && sel.faces.length > 0) {
    const drop = new Set(sel.faces);
    const faces = mesh.faces.filter((_, i) => !drop.has(i));
    const out = createMesh(mesh.vertices.map(cloneV), faces, mesh.edges.map(e => [e[0], e[1]] as [number, number]));
    sanitizeEdges(out);
    return { mesh: out, selection: emptySelection(), changed: true };
  }
  if (mode === 'edge' && sel.edges.length > 0) {
    const dropKeys = new Set(sel.edges.map(k => {
      const [a, b] = parseEdgeKey(k);
      return edgeKey(a, b);
    }));
    const faces = mesh.faces.filter(face => !faceEdges(face).some(([a, b]) => dropKeys.has(edgeKey(a, b))));
    const edges = mesh.edges.filter(([a, b]) => !dropKeys.has(edgeKey(a, b)));
    const out = createMesh(mesh.vertices.map(cloneV), faces, edges);
    return { mesh: out, selection: emptySelection(), changed: true };
  }
  if (mode === 'vertex' && sel.vertices.length > 0) {
    const dropVerts = new Set(sel.vertices);
    const faces = mesh.faces.filter(face => !face.some(v => dropVerts.has(v)));
    const edges = mesh.edges.filter(([a, b]) => !dropVerts.has(a) && !dropVerts.has(b));
    const out = createMesh(mesh.vertices.map(cloneV), faces, edges);
    const remap = new Array(mesh.vertices.length).fill(-1);
    out.vertices = [];
    mesh.vertices.forEach((p, i) => {
      if (dropVerts.has(i)) return;
      remap[i] = out.vertices.length;
      out.vertices.push(cloneV(p));
    });
    out.faces = faces.map(f => f.map(v => remap[v]));
    out.edges = edges.map(([a, b]) => [remap[a], remap[b]] as [number, number]);
    sanitizeFaces(out);
    sanitizeEdges(out);
    return { mesh: out, selection: emptySelection(), changed: true };
  }
  return { mesh, selection: sel, changed: false };
}

/** Blender "X > Only Faces / Only Edges" style dissolve (keeps the vertices). */
export function dissolveElements(mesh: MeshData, sel: EditSelection, mode: SubObjectMode): EditOperationResult {
  if (mode === 'face') return deleteElements(mesh, sel, 'face');
  if (mode === 'edge') return deleteElements(mesh, sel, 'edge');
  return { mesh, selection: sel, changed: false };
}

/* ------------------------------ merge ------------------------------ */

export function mergeVertices(
  mesh: MeshData,
  indices: number[],
  mode: 'center' | 'first' | 'last' | 'cursor',
  cursor?: Vector3Data
): EditOperationResult {
  const unique = Array.from(new Set(indices.filter(i => i >= 0 && i < mesh.vertices.length))).sort((a, b) => a - b);
  if (unique.length < 2) return { mesh, selection: { vertices: unique, edges: [], faces: [] }, changed: false };

  let target: Vector3Data;
  if (mode === 'cursor' && cursor) target = cloneV(cursor);
  else if (mode === 'first') target = cloneV(mesh.vertices[unique[0]]);
  else if (mode === 'last') target = cloneV(mesh.vertices[unique[unique.length - 1]]);
  else {
    target = vec(0, 0, 0);
    unique.forEach(i => (target = addV(target, mesh.vertices[i])));
    target = mulV(target, 1 / unique.length);
  }

  const survivor = unique[0];
  const merged = new Set(unique);
  const touchedFaces: number[] = [];
  mesh.faces.forEach((f, i) => {
    if (f.some(v => merged.has(v))) touchedFaces.push(i);
  });

  const moved = cloneMesh(mesh);
  moved.vertices[survivor] = cloneV(target);

  // Collapse every merged vertex onto the survivor, then drop the leftovers
  const identity = mesh.vertices.map((_, i) => i);
  unique.forEach(i => (identity[i] = survivor));
  const removeSet = new Set(unique.filter(i => i !== survivor));
  const { mesh: out, faceRemap } = applyRemap(moved, identity, removeSet);
  const finalIndex = keptIndexOf(mesh, removeSet, survivor);

  const faceSel = remapFaceSelection(touchedFaces, faceRemap);

  return {
    mesh: out,
    selection: {
      vertices: [finalIndex],
      edges: out.edges.filter(([a, b]) => a === finalIndex || b === finalIndex).map(([a, b]) => edgeKey(a, b)),
      faces: faceSel,
    },
    changed: true,
  };
}

/** Index a vertex gets after the vertices in `removed` are dropped. */
function keptIndexOf(mesh: MeshData, removed: Set<number>, index: number): number {
  let n = 0;
  for (let i = 0; i < index; i++) if (!removed.has(i)) n++;
  return n;
}

/* ------------------------------ subdivide ------------------------------ */

export function subdivideFaces(mesh: MeshData, faceIndices: number[], iterations = 1): EditOperationResult {
  let current = cloneMesh(mesh);
  let targets = new Set(faceIndices);

  for (let it = 0; it < Math.max(1, iterations); it++) {
    const next: MeshData = createMesh(current.vertices.map(cloneV), [], []);
    const midpointCache = new Map<string, number>();
    const midpoint = (a: number, b: number) => {
      const k = edgeKey(a, b);
      let idx = midpointCache.get(k);
      if (idx === undefined) {
        idx = next.vertices.length;
        next.vertices.push(mulV(addV(current.vertices[a], current.vertices[b]), 0.5));
        midpointCache.set(k, idx);
      }
      return idx;
    };

    const newFaces: number[][] = [];
    const producedCounts: number[] = [];
    current.faces.forEach((face, fi) => {
      if (!targets.has(fi) || face.length < 3) {
        newFaces.push(face.slice());
        producedCounts.push(1);
        return;
      }
      const n = face.length;
      const mids: number[] = [];
      for (let i = 0; i < n; i++) mids.push(midpoint(face[i], face[(i + 1) % n]));

      const produced: number[][] = [];
      if (n === 3) {
        // Classic 1-to-4 triangle split: 3 corner triangles + midpoint triangle
        produced.push([face[0], mids[0], mids[2]]);
        produced.push([face[1], mids[1], mids[0]]);
        produced.push([face[2], mids[2], mids[1]]);
        produced.push([mids[0], mids[1], mids[2]]);
      } else {
        // n quads around the face centre: tiles the polygon exactly
        let center = vec(0, 0, 0);
        face.forEach(v => (center = addV(center, current.vertices[v])));
        center = mulV(center, 1 / n);
        next.vertices.push(center);
        const c = next.vertices.length - 1;
        for (let i = 0; i < n; i++) {
          const prev = (i + n - 1) % n;
          produced.push([face[i], mids[i], c, mids[prev]]);
        }
      }
      produced.forEach(f => newFaces.push(f));
      producedCounts.push(produced.length);
    });

    next.faces = newFaces;
    next.edges = current.edges.map(([a, b]) => [a, b] as [number, number]);
    const faceRemap = sanitizeFaces(next);
    sanitizeEdges(next);

    // Re-target the faces created by this pass so `iterations` keeps subdividing them
    const nextTargets = new Set<number>();
    let cursor = 0;
    current.faces.forEach((face, fi) => {
      const count = producedCounts[fi] ?? 1;
      const subdivided = targets.has(fi) && face.length >= 3;
      for (let k = 0; k < count; k++) {
        if (!subdivided) continue;
        const mapped = faceRemap.get(cursor + k);
        if (mapped !== undefined && mapped >= 0) nextTargets.add(mapped);
      }
      cursor += count;
    });

    current = next;
    targets = nextTargets;
  }

  const sel = Array.from(targets).sort((a, b) => a - b);
  const verts = new Set<number>();
  const edgeSel = new Set<string>();
  sel.forEach(fi => {
    const face = current.faces[fi];
    if (!face) return;
    face.forEach((v, i) => {
      verts.add(v);
      edgeSel.add(edgeKey(v, face[(i + 1) % face.length]));
    });
  });
  return {
    mesh: current,
    selection: { vertices: Array.from(verts), edges: Array.from(edgeSel), faces: sel },
    changed: true,
  };
}

/* ------------------------------ inset ------------------------------ */

/**
 * Insets the selected faces: each face shrinks towards its own centre, leaving
 * a ring of quads around a smaller inner face (Blender "I", individual mode).
 * The inner faces stay selected so they can be extruded right away.
 */
export function insetFaces(mesh: MeshData, faceIndices: number[], amount: number): EditOperationResult {
  const t = Math.max(0.0001, Math.min(0.999, amount));
  const out = cloneMesh(mesh);
  const targets = faceIndices.length > 0 ? faceIndices : out.faces.map((_, i) => i);
  const innerFaces: number[][] = [];
  const ringFaces: number[][] = [];

  targets.forEach(fi => {
    const face = out.faces[fi];
    if (!face || face.length < 3) return;
    let center = vec(0, 0, 0);
    face.forEach(v => (center = addV(center, out.vertices[v])));
    center = mulV(center, 1 / face.length);

    const inner: number[] = [];
    face.forEach(v => {
      const p = out.vertices[v];
      inner.push(out.vertices.length);
      out.vertices.push(addV(p, mulV(subV(center, p), t)));
    });

    // same winding as the original face
    innerFaces.push(inner.slice());
    for (let i = 0; i < face.length; i++) {
      const next = (i + 1) % face.length;
      ringFaces.push([face[i], face[next], inner[next], inner[i]]);
    }
  });

  if (innerFaces.length === 0) return { mesh, selection: { vertices: [], edges: [], faces: faceIndices.slice() }, changed: false };

  ringFaces.forEach(f => out.faces.push(f));
  innerFaces.forEach(f => out.faces.push(f));

  // the inset faces replace the originals, like Blender does
  const replaced = new Set(targets);
  const faces: number[][] = [];
  out.faces.forEach((f, i) => {
    if (!replaced.has(i)) faces.push(f);
  });
  out.faces = faces;
  const faceRemap = sanitizeFaces(out);
  sanitizeEdges(out);

  // the inner faces were appended last, so recover their indices after sanitizing
  const innerSel = remapFaceSelection(
    faces.map((_, i) => i).filter(i => i >= faces.length - innerFaces.length),
    faceRemap
  );

  const verts = new Set<number>();
  innerSel.forEach(fi => out.faces[fi]?.forEach(v => verts.add(v)));
  return {
    mesh: out,
    selection: { vertices: Array.from(verts), edges: [], faces: innerSel.filter(fi => out.faces[fi]) },
    changed: true,
  };
}

/* ------------------------------ mirror ------------------------------ */

export type MirrorAxis = 'x' | 'y' | 'z';

/**
 * Mirrors the mesh across the plane `axis = 0` of its local space and welds the
 * vertices that land on the plane, so the result is a single watertight mesh.
 * Mirrored faces get reversed winding to keep the normals pointing outwards.
 */
export function mirrorMesh(mesh: MeshData, axis: MirrorAxis, mergeThreshold = 1e-6): EditOperationResult {
  const out = cloneMesh(mesh);
  const mirroredIndexOf = new Map<number, number>();

  mesh.vertices.forEach((p, i) => {
    if (Math.abs(p[axis]) < mergeThreshold) {
      mirroredIndexOf.set(i, i); // on the plane: shared, not duplicated
      return;
    }
    const q = cloneV(p);
    q[axis] = -q[axis];
    mirroredIndexOf.set(i, out.vertices.length);
    out.vertices.push(q);
  });

  const newFaces: number[][] = [];
  mesh.faces.forEach(face => {
    // reversed winding keeps the normal pointing away from the mirrored side
    newFaces.push(face.slice().reverse().map(v => mirroredIndexOf.get(v)!));
  });
  mesh.edges.forEach(([a, b]) => {
    const ma = mirroredIndexOf.get(a)!;
    const mb = mirroredIndexOf.get(b)!;
    if (ma !== mb) out.edges.push([ma, mb]);
  });

  newFaces.forEach(f => out.faces.push(f));
  const welded = weldMeshWithRemap(out, mergeThreshold);
  const allFaces = welded.mesh.faces.map((_, i) => i);
  const verts = new Set<number>();
  allFaces.forEach(fi => welded.mesh.faces[fi].forEach(v => verts.add(v)));
  return {
    mesh: welded.mesh,
    selection: { vertices: Array.from(verts), edges: [], faces: allFaces },
    changed: true,
  };
}

/* ------------------------------ loop cut ------------------------------ */

/**
 * The edge opposite to (a,b) inside a quad face, which is what an edge loop
 * follows. Returns null for triangles and ngons, where "opposite" is ambiguous.
 */
export function oppositeEdgeInFace(face: number[], a: number, b: number): [number, number] | null {
  if (face.length !== 4) return null;
  const ia = face.indexOf(a);
  const ib = face.indexOf(b);
  if (ia < 0 || ib < 0) return null;
  const adjacent = (ia + 1) % 4 === ib || (ib + 1) % 4 === ia;
  if (!adjacent) return null;
  return [face[(ia + 2) % 4], face[(ib + 2) % 4]];
}

/** Walks the whole edge loop through `seedKey` (quad meshes only). */
export function findEdgeLoop(mesh: MeshData, seedKey: string): string[] {
  const edgeFaces = buildEdgeFaceMap(mesh);
  const loop: string[] = [seedKey];

  const walk = (forward: boolean) => {
    let cur = seedKey;
    for (let guard = 0; guard < mesh.faces.length * 4 + 4; guard++) {
      const [a, b] = parseEdgeKey(cur);
      let next: string | null = null;
      for (const fi of edgeFaces.get(cur) || []) {
        const opp = oppositeEdgeInFace(mesh.faces[fi], a, b);
        if (!opp) continue;
        const key = edgeKey(opp[0], opp[1]);
        if (loop.includes(key)) continue;
        next = key;
        break;
      }
      if (!next) return;
      if (forward) loop.push(next);
      else loop.unshift(next);
      cur = next;
    }
  };

  walk(true);
  walk(false);
  return loop;
}

/**
 * Cuts an edge loop: inserts a vertex on every edge of the loop at parameter `t`
 * and splits each face the loop crosses into two, preserving winding.
 */
export function loopCut(mesh: MeshData, seedKey: string, t = 0.5): EditOperationResult {
  const loop = findEdgeLoop(mesh, seedKey);
  if (loop.length === 0) return { mesh, selection: emptySelection(), changed: false };

  const out = cloneMesh(mesh);
  const newVertexOnEdge = new Map<string, number>();
  const cutAt = Math.max(0.001, Math.min(0.999, t));

  loop.forEach(key => {
    const [a, b] = parseEdgeKey(key);
    const pa = out.vertices[a];
    const pb = out.vertices[b];
    if (!pa || !pb) return;
    newVertexOnEdge.set(key, out.vertices.length);
    out.vertices.push(addV(pa, mulV(subV(pb, pa), cutAt)));
  });

  const loopSet = new Set(loop);
  const faces: number[][] = [];
  const newFaces: number[][] = [];

  out.faces.forEach(face => {
    // edges of this face that the loop crosses, as edge indices
    const crossed: number[] = [];
    for (let i = 0; i < face.length; i++) {
      const k = edgeKey(face[i], face[(i + 1) % face.length]);
      if (loopSet.has(k) && newVertexOnEdge.has(k)) crossed.push(i);
    }
    if (crossed.length !== 2) {
      faces.push(face.slice());
      return;
    }
    const [p, q] = crossed[0] < crossed[1] ? crossed : [crossed[1], crossed[0]];
    const mp = newVertexOnEdge.get(edgeKey(face[p], face[(p + 1) % face.length]))!;
    const mq = newVertexOnEdge.get(edgeKey(face[q], face[(q + 1) % face.length]))!;

    // two halves, both keeping the original winding
    const a: number[] = [mp];
    for (let i = p + 1; i <= q; i++) a.push(face[i]);
    a.push(mq);

    const b: number[] = [mq];
    for (let i = q + 1; i < face.length + p + 1; i++) b.push(face[i % face.length]);
    b.push(mp);

    newFaces.push(a, b);
  });

  if (newFaces.length === 0) return { mesh, selection: emptySelection(), changed: false };

  const firstNew = faces.length;
  newFaces.forEach(f => faces.push(f));
  out.faces = faces;
  const faceRemap = sanitizeFaces(out);
  sanitizeEdges(out);

  const created: number[] = [];
  for (let i = firstNew; i < firstNew + newFaces.length; i++) {
    const mapped = faceRemap.get(i);
    if (mapped !== undefined && mapped >= 0) created.push(mapped);
  }
  const edges = new Set<string>();
  created.forEach(fi => {
    const f = out.faces[fi];
    if (!f) return;
    f.forEach((v, i) => edges.add(edgeKey(v, f[(i + 1) % f.length])));
  });

  return {
    mesh: out,
    selection: {
      vertices: Array.from(newVertexOnEdge.values()),
      edges: Array.from(edges),
      faces: created,
    },
    changed: true,
  };
}

/* ------------------------------ create face ------------------------------ */

function orderPlanar(points: Vector3Data[]): number[] {
  const n = points.length;
  const idx = points.map((_, i) => i);
  if (n < 4) return idx;
  let center = vec(0, 0, 0);
  points.forEach(p => (center = addV(center, p)));
  center = mulV(center, 1 / n);
  let normal = vec(0, 0, 0);
  points.forEach(p => (normal = addV(normal, subV(p, center))));
  normal = normV(normal);
  if (lenV(normal) < 1e-9) {
    // Degenerate: fall back to the dominant axis plane
    normal = vec(0, 1, 0);
  }
  const helper = Math.abs(normal.x) < 0.9 ? vec(1, 0, 0) : vec(0, 1, 0);
  const u = normV(crossV(helper, normal));
  const v = crossV(normal, u);
  return idx.sort((a, b) => {
    const da = subV(points[a], center);
    const db = subV(points[b], center);
    return Math.atan2(dotV(da, v), dotV(da, u)) - Math.atan2(dotV(db, v), dotV(db, u));
  });
}

export function createFace(mesh: MeshData, sel: EditSelection): EditOperationResult {
  const out = cloneMesh(mesh);

  if (sel.vertices.length >= 3) {
    const ordered = orderPlanar(sel.vertices.map(i => mesh.vertices[i])).map(i => sel.vertices[i]);
    const key = ordered.slice().sort((a, b) => a - b).join(',');
    const exists = out.faces.some(f => f.slice().sort((a, b) => a - b).join(',') === key);
    if (exists) return { mesh, selection: sel, changed: false };
    const pushedIndex = out.faces.length;
    out.faces.push(ordered);
    const remap = sanitizeFaces(out);
    const newFaceIndex = remap.get(pushedIndex) ?? -1;
    return {
      mesh: out,
      selection: { vertices: ordered.slice(), edges: [], faces: newFaceIndex >= 0 ? [newFaceIndex] : [] },
      changed: true,
    };
  }

  if (sel.vertices.length === 2) {
    const [a, b] = sel.vertices;
    const k = edgeKey(a, b);
    const exists = out.edges.some(([x, y]) => edgeKey(x, y) === k);
    if (exists) return { mesh, selection: sel, changed: false };
    out.edges.push([a, b]);
    return { mesh: out, selection: { vertices: [], edges: [k], faces: [] }, changed: true };
  }

  if (sel.edges.length >= 2) {
    // Try to walk a closed loop out of the selected edges
    const adj = new Map<number, number[]>();
    sel.edges.forEach(key => {
      const [a, b] = parseEdgeKey(key);
      if (!adj.has(a)) adj.set(a, []);
      if (!adj.has(b)) adj.set(b, []);
      adj.get(a)!.push(b);
      adj.get(b)!.push(a);
    });
    let loop: number[] | null = null;
    const allDeg2 = Array.from(adj.values()).every(list => list.length === 2);
    if (allDeg2 && adj.size >= 3) {
      const start = Array.from(adj.keys())[0];
      const path: number[] = [start];
      let prev = -1;
      let cur = start;
      for (let guard = 0; guard < adj.size + 2; guard++) {
        const next = adj.get(cur)!.find(n => n !== prev);
        if (next === undefined) break;
        if (next === start) {
          loop = path;
          break;
        }
        path.push(next);
        prev = cur;
        cur = next;
      }
    }
    if (loop && loop.length >= 3) {
      const ordered = orderPlanar(loop.map(i => mesh.vertices[i])).map(i => loop![i]);
      const pushedIndex = out.faces.length;
      out.faces.push(ordered);
      const remap = sanitizeFaces(out);
      const idx = remap.get(pushedIndex) ?? -1;
      return {
        mesh: out,
        selection: { vertices: [], edges: [], faces: idx >= 0 ? [idx] : [] },
        changed: true,
      };
    }
    if (sel.edges.length === 2) {
      const [a1, b1] = parseEdgeKey(sel.edges[0]);
      const [a2, b2] = parseEdgeKey(sel.edges[1]);
      const pushedIndex = out.faces.length;
      out.faces.push([a1, b1, b2, a2]);
      const remap = sanitizeFaces(out);
      const idx = remap.get(pushedIndex) ?? -1;
      return {
        mesh: out,
        selection: { vertices: [], edges: [], faces: idx >= 0 ? [idx] : [] },
        changed: true,
      };
    }
  }

  return { mesh, selection: sel, changed: false };
}

/* ------------------------------ misc ops ------------------------------ */

export function deleteLoose(mesh: MeshData): EditOperationResult {
  const used = new Set<number>();
  mesh.faces.forEach(f => f.forEach(v => used.add(v)));
  mesh.edges.forEach(([a, b]) => {
    used.add(a);
    used.add(b);
  });
  const unused = mesh.vertices.map((_, i) => i).filter(i => !used.has(i));
  if (unused.length === 0) return { mesh, selection: emptySelection(), changed: false };
  const { mesh: out } = applyRemap(mesh, mesh.vertices.map((_, i) => i), new Set(unused));
  return { mesh: out, selection: emptySelection(), changed: true };
}

export function flipNormals(mesh: MeshData, faceIndices: number[]): EditOperationResult {
  const out = cloneMesh(mesh);
  const targets = faceIndices.length > 0 ? faceIndices : out.faces.map((_, i) => i);
  targets.forEach(fi => {
    if (out.faces[fi]) out.faces[fi] = out.faces[fi].slice().reverse();
  });
  return { mesh: out, selection: { vertices: [], edges: [], faces: targets.slice() }, changed: true };
}

export function triangulateFaces(mesh: MeshData, faceIndices: number[]): EditOperationResult {
  const out = cloneMesh(mesh);
  const targets = new Set(faceIndices.length > 0 ? faceIndices : out.faces.map((_, i) => i));
  const faces: number[][] = [];
  out.faces.forEach((face, fi) => {
    if (!targets.has(fi) || face.length < 4) {
      faces.push(face.slice());
      return;
    }
    const pts = face.map(i => out.vertices[i]);
    triangulatePolygon(pts).forEach(t => faces.push([face[t[0]], face[t[1]], face[t[2]]]));
  });
  out.faces = faces;
  return { mesh: out, selection: { vertices: [], edges: [], faces: out.faces.map((_, i) => i) }, changed: true };
}

/* ------------------------------ selection ops ------------------------------ */

export function selectAll(mesh: MeshData): EditSelection {
  return {
    vertices: mesh.vertices.map((_, i) => i),
    edges: [
      ...new Set([
        ...mesh.faces.flatMap(f => faceEdges(f).map(([a, b]) => edgeKey(a, b))),
        ...mesh.edges.map(([a, b]) => edgeKey(a, b)),
      ]),
    ],
    faces: mesh.faces.map((_, i) => i),
  };
}

export function invertSelection(mesh: MeshData, sel: EditSelection): EditSelection {
  const all = selectAll(mesh);
  return {
    vertices: all.vertices.filter(i => !sel.vertices.includes(i)),
    edges: all.edges.filter(k => !sel.edges.includes(k)),
    faces: all.faces.filter(i => !sel.faces.includes(i)),
  };
}

export function growSelection(mesh: MeshData, sel: EditSelection, mode: SubObjectMode): EditSelection {
  const adj = buildVertexAdjacency(mesh);
  if (mode === 'vertex') {
    const next = new Set(sel.vertices);
    sel.vertices.forEach(v => adj.get(v)?.forEach(n => next.add(n)));
    return { ...sel, vertices: Array.from(next) };
  }
  if (mode === 'edge') {
    const allEdges = new Set([
      ...mesh.faces.flatMap(f => faceEdges(f).map(([a, b]) => edgeKey(a, b))),
      ...mesh.edges.map(([a, b]) => edgeKey(a, b)),
    ]);
    const touched = new Set<number>();
    sel.edges.forEach(k => {
      const [a, b] = parseEdgeKey(k);
      touched.add(a);
      touched.add(b);
    });
    const next = new Set(sel.edges);
    allEdges.forEach(k => {
      const [a, b] = parseEdgeKey(k);
      if (touched.has(a) || touched.has(b)) next.add(k);
    });
    return { ...sel, edges: Array.from(next) };
  }
  const edgeMap = buildEdgeFaceMap(mesh);
  const next = new Set(sel.faces);
  sel.faces.forEach(fi => {
    const face = mesh.faces[fi];
    if (!face) return;
    faceEdges(face).forEach(([a, b]) => {
      edgeMap.get(edgeKey(a, b))?.forEach(other => next.add(other));
    });
  });
  return { ...sel, faces: Array.from(next) };
}

export function shrinkSelection(mesh: MeshData, sel: EditSelection, mode: SubObjectMode): EditSelection {
  const adj = buildVertexAdjacency(mesh);
  if (mode === 'vertex') {
    const set = new Set(sel.vertices);
    const next = sel.vertices.filter(v => {
      const neighbours = adj.get(v);
      if (!neighbours || neighbours.size === 0) return false;
      return Array.from(neighbours).every(n => set.has(n));
    });
    if (next.length === 0) return sel;
    return { ...sel, vertices: next };
  }
  if (mode === 'edge') {
    const set = new Set(sel.edges);
    const allEdges = new Set([
      ...mesh.faces.flatMap(f => faceEdges(f).map(([a, b]) => edgeKey(a, b))),
      ...mesh.edges.map(([a, b]) => edgeKey(a, b)),
    ]);
    const next = sel.edges.filter(k => {
      const [a, b] = parseEdgeKey(k);
      const neighbours = Array.from(allEdges).filter(other => {
        if (other === k) return false;
        const [x, y] = parseEdgeKey(other);
        return x === a || x === b || y === a || y === b;
      });
      return neighbours.length > 0 && neighbours.every(n => set.has(n));
    });
    if (next.length === 0) return sel;
    return { ...sel, edges: next };
  }
  const edgeMap = buildEdgeFaceMap(mesh);
  const set = new Set(sel.faces);
  const next = sel.faces.filter(fi => {
    const face = mesh.faces[fi];
    if (!face) return false;
    const neighbours = faceEdges(face).flatMap(([a, b]) => edgeMap.get(edgeKey(a, b)) || []);
    const others = neighbours.filter(n => n !== fi);
    return others.length > 0 && others.every(n => set.has(n));
  });
  if (next.length === 0) return sel;
  return { ...sel, faces: next };
}

export function selectLinked(mesh: MeshData, seedVertices: number[]): EditSelection {
  const adj = buildVertexAdjacency(mesh);
  const visited = new Set<number>();
  const queue = seedVertices.slice();
  while (queue.length > 0) {
    const v = queue.pop()!;
    if (visited.has(v)) continue;
    visited.add(v);
    adj.get(v)?.forEach(n => {
      if (!visited.has(n)) queue.push(n);
    });
  }
  const verts = Array.from(visited);
  const vertSet = new Set(verts);
  const edges = [
    ...new Set([
      ...mesh.faces.flatMap(f => faceEdges(f).map(([a, b]) => edgeKey(a, b))),
      ...mesh.edges.map(([a, b]) => edgeKey(a, b)),
    ]),
  ].filter(k => {
    const [a, b] = parseEdgeKey(k);
    return vertSet.has(a) && vertSet.has(b);
  });
  const faces = mesh.faces.map((_, i) => i).filter(fi => mesh.faces[fi].every(v => vertSet.has(v)));
  return { vertices: verts, edges, faces };
}

/**
 * Applies an edit operation. Pure: never mutates the input mesh.
 */
export function applyEditOperation(
  mesh: MeshData,
  sel: EditSelection,
  mode: SubObjectMode,
  op: EditOperation
): EditOperationResult {
  switch (op.type) {
    case 'set-vertices': {
      const out = cloneMesh(mesh);
      Object.entries(op.positions).forEach(([k, p]) => {
        const i = parseInt(k, 10);
        if (out.vertices[i]) out.vertices[i] = { x: p.x, y: p.y, z: p.z };
      });
      return { mesh: out, selection: sel, changed: true };
    }
    case 'extrude':
      return extrudeElements(mesh, sel);
    case 'delete':
      return deleteElements(mesh, sel, mode);
    case 'merge':
      return mergeVertices(mesh, activeVertexIndices(mesh, sel), op.mode, op.cursor);
    case 'weld': {
      const { mesh: welded, vertexRemap, faceRemap } = weldMeshWithRemap(mesh, op.threshold);
      const nextSelection: EditSelection = {
        vertices: Array.from(new Set(sel.vertices.map(v => vertexRemap[v]).filter(v => v !== undefined))),
        edges: Array.from(
          new Set(
            sel.edges
              .map(k => {
                const [a, b] = parseEdgeKey(k);
                return edgeKey(vertexRemap[a], vertexRemap[b]);
              })
              .filter(k => !k.includes('undefined') && !k.startsWith('NaN'))
          )
        ).filter(k => {
          const [a, b] = parseEdgeKey(k);
          return a !== b;
        }),
        faces: remapFaceSelection(sel.faces, faceRemap),
      };
      return { mesh: welded, selection: nextSelection, changed: true };
    }
    case 'subdivide':
      return subdivideFaces(mesh, sel.faces.length > 0 ? sel.faces : mesh.faces.map((_, i) => i), op.iterations ?? 1);
    case 'create-face':
      return createFace(mesh, sel);
    case 'delete-loose':
      return deleteLoose(mesh);
    case 'flip-normals':
      return flipNormals(mesh, sel.faces);
    case 'triangulate':
      return triangulateFaces(mesh, sel.faces);
    case 'inset':
      return insetFaces(mesh, sel.faces, op.amount);
    case 'mirror':
      return mirrorMesh(mesh, op.axis);
    case 'loop-cut':
      return loopCut(mesh, op.edge, op.t ?? 0.5);
    default:
      return { mesh, selection: sel, changed: false };
  }
}

/* ------------------------------ join / separate ------------------------------ */

export interface WorldTransform {
  position: Vector3Data;
  rotation: Vector3Data;
  scale: Vector3Data;
}

function rotateEulerXYZ(p: Vector3Data, r: Vector3Data): Vector3Data {
  const cx = Math.cos(r.x), sx = Math.sin(r.x);
  const cy = Math.cos(r.y), sy = Math.sin(r.y);
  const cz = Math.cos(r.z), sz = Math.sin(r.z);
  const y1 = p.y * cx - p.z * sx;
  const z1 = p.y * sx + p.z * cx;
  const x2 = p.x * cy + z1 * sy;
  const z2 = -p.x * sy + z1 * cy;
  const x3 = x2 * cz - y1 * sz;
  const y3 = x2 * sz + y1 * cz;
  return vec(x3, y3, z2);
}

export function transformMesh(mesh: MeshData, t: WorldTransform): MeshData {
  const out = cloneMesh(mesh);
  out.vertices = out.vertices.map(p => {
    const scaled = vec(p.x * t.scale.x, p.y * t.scale.y, p.z * t.scale.z);
    const rotated = rotateEulerXYZ(scaled, t.rotation);
    return addV(rotated, t.position);
  });
  return out;
}

/** Merges several objects into a single editable mesh placed at the origin. */
export function joinMeshes(meshes: MeshData[]): MeshData {
  const out = createMesh([], [], []);
  meshes.forEach(m => {
    const offset = out.vertices.length;
    m.vertices.forEach(v => out.vertices.push(cloneV(v)));
    m.faces.forEach(f => out.faces.push(f.map(v => v + offset)));
    m.edges.forEach(([a, b]) => out.edges.push([a + offset, b + offset]));
  });
  return out;
}

/** Splits a mesh into its connected components (3ds Max "Detach / Blender P"). */
export function separateMesh(mesh: MeshData): MeshData[] {
  const adj = buildVertexAdjacency(mesh);
  const visited = new Set<number>();
  const parts: MeshData[] = [];
  mesh.vertices.forEach((_, start) => {
    if (visited.has(start)) return;
    const component = new Set<number>();
    const queue = [start];
    while (queue.length > 0) {
      const v = queue.pop()!;
      if (component.has(v)) continue;
      component.add(v);
      adj.get(v)?.forEach(n => {
        if (!component.has(n)) queue.push(n);
      });
    }
    component.forEach(v => visited.add(v));
    const list = Array.from(component).sort((a, b) => a - b);
    const remap = new Map<number, number>();
    list.forEach((v, i) => remap.set(v, i));
    parts.push(
      createMesh(
        list.map(v => cloneV(mesh.vertices[v])),
        mesh.faces.filter(f => f.every(v => component.has(v))).map(f => f.map(v => remap.get(v)!)),
        mesh.edges.filter(([a, b]) => component.has(a) && component.has(b)).map(([a, b]) => [remap.get(a)!, remap.get(b)!] as [number, number])
      )
    );
  });
  return parts.filter(p => p.vertices.length > 0);
}
