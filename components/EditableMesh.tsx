import React, { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { buildRenderData, createMesh, edgeKey, faceEdges, parseEdgeKey, polygonCenter } from '../editGeometry';
import type { RenderData } from '../editGeometry';
import type { EditSelection, MeshData, SubObjectMode } from '../types';

/**
 * MeshData objects are treated as immutable (every edit produces a new one), so
 * the derived render data can be cached per object. The surface, the wireframe
 * and the picking code all ask for it on the same frame.
 */
const renderCache = new WeakMap<MeshData, RenderData>();
export function getRenderData(mesh: MeshData): RenderData {
  let data = renderCache.get(mesh);
  if (!data) {
    data = buildRenderData(mesh, 45);
    renderCache.set(mesh, data);
  }
  return data;
}

/* ------------------------------------------------------------------ *
 * Geometry builders
 * ------------------------------------------------------------------ */

function makeGeometry(mesh: MeshData): THREE.BufferGeometry {
  const data = getRenderData(mesh);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
  geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

function makeWireGeometry(mesh: MeshData): THREE.BufferGeometry {
  const data = getRenderData(mesh);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(data.wireIndices, 1));
  return geometry;
}

function makeSubsetGeometry(mesh: MeshData, faces: number[]): THREE.BufferGeometry | null {
  if (faces.length === 0) return null;
  const sub = createMesh(
    mesh.vertices.map(v => ({ ...v })),
    faces.map(fi => mesh.faces[fi]).filter(Boolean),
    []
  );
  if (sub.faces.length === 0) return null;
  // flat shading for the highlight: build it directly instead of via the cache
  const data = buildRenderData(sub, 180);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
  geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
  return geometry;
}

function makeSegmentGeometry(mesh: MeshData, keys: string[]): THREE.BufferGeometry | null {
  if (keys.length === 0) return null;
  const positions: number[] = [];
  keys.forEach(key => {
    const [a, b] = parseEdgeKey(key);
    const pa = mesh.vertices[a];
    const pb = mesh.vertices[b];
    if (!pa || !pb) return;
    positions.push(pa.x, pa.y, pa.z, pb.x, pb.y, pb.z);
  });
  if (positions.length === 0) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}

function makePointsGeometry(mesh: MeshData, indices: number[]): THREE.BufferGeometry | null {
  if (indices.length === 0) return null;
  const positions: number[] = [];
  indices.forEach(i => {
    const p = mesh.vertices[i];
    if (p) positions.push(p.x, p.y, p.z);
  });
  if (positions.length === 0) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}

/**
 * Disposes the *previous* GPU resource when a new one replaces it.
 * The value is captured at effect setup time on purpose: reading it from a ref
 * in the cleanup would dispose the geometry that is currently in use.
 */
function useDisposable<T extends { dispose: () => void } | null>(value: T): T {
  useEffect(() => {
    const current = value;
    return () => {
      current?.dispose();
    };
  }, [value]);
  return value;
}

/* ------------------------------------------------------------------ *
 * Shaded surface + base wireframe
 * ------------------------------------------------------------------ */

export const MeshSurface: React.FC<{
  mesh: MeshData;
  color: string;
  opacity?: number;
  wireframe?: boolean;
  doubleSide?: boolean;
}> = ({ mesh, color, opacity = 1, wireframe = false, doubleSide = true }) => {
  const geometry = useDisposable(useMemo(() => makeGeometry(mesh), [mesh]));
  const wireGeometry = useDisposable(useMemo(() => (wireframe ? makeWireGeometry(mesh) : null), [mesh, wireframe]));

  return (
    <>
      <mesh geometry={geometry} raycast={() => null}>
        <meshStandardMaterial
          color={color}
          roughness={0.68}
          metalness={0.06}
          transparent={opacity < 1}
          opacity={opacity}
          side={doubleSide ? THREE.DoubleSide : THREE.FrontSide}
        />
      </mesh>
      {wireframe && wireGeometry && (
        <lineSegments geometry={wireGeometry} raycast={() => null}>
          <lineBasicMaterial color="#000000" transparent opacity={0.22} />
        </lineSegments>
      )}
    </>
  );
};

/* ------------------------------------------------------------------ *
 * Sub-object overlays (vertices / edges / faces)
 * ------------------------------------------------------------------ */

/**
 * Sub-object overlay. `hoverKey` is already filtered by the viewport so it only
 * contains an element of the active sub-object mode.
 */
export const EditOverlays: React.FC<{
  mesh: MeshData;
  selection: EditSelection;
  hoverKey: string | null;
}> = ({ mesh, selection, hoverKey }) => {
  const allVertices = useDisposable(
    useMemo(() => makePointsGeometry(mesh, mesh.vertices.map((_, i) => i)), [mesh])
  );
  const allEdges = useDisposable(useMemo(() => makeWireGeometry(mesh), [mesh]));

  const selectedVerts = useDisposable(useMemo(() => makePointsGeometry(mesh, selection.vertices), [mesh, selection.vertices]));
  const selectedEdges = useDisposable(
    useMemo(
      () =>
        makeSegmentGeometry(
          mesh,
          selection.edges.length > 0
            ? selection.edges
            : selection.faces.flatMap(fi => (mesh.faces[fi] ? faceEdges(mesh.faces[fi]).map(([a, b]) => edgeKey(a, b)) : []))
        ),
      [mesh, selection.edges, selection.faces]
    )
  );
  const selectedFaces = useDisposable(useMemo(() => makeSubsetGeometry(mesh, selection.faces), [mesh, selection.faces]));

  const hoverVertex = useDisposable(
    useMemo(() => (hoverKey !== null ? makePointsGeometry(mesh, [parseInt(hoverKey, 10)]) : null), [mesh, hoverKey])
  );
  const hoverEdge = useDisposable(useMemo(() => (hoverKey ? makeSegmentGeometry(mesh, [hoverKey]) : null), [mesh, hoverKey]));
  const hoverFace = useDisposable(
    useMemo(() => {
      if (hoverKey === null) return null;
      const index = parseInt(hoverKey, 10);
      if (Number.isNaN(index)) return null;
      return makeSubsetGeometry(mesh, [index]);
    }, [mesh, hoverKey])
  );

  return (
    <group raycast={() => null}>
      {/* base wireframe */}
      {allEdges && (
        <lineSegments geometry={allEdges} renderOrder={900}>
          <lineBasicMaterial color="#1b1b1b" transparent opacity={0.35} depthTest={false} />
        </lineSegments>
      )}

      {/* selected faces */}
      {selectedFaces && (
        <mesh geometry={selectedFaces} renderOrder={910}>
          <meshBasicMaterial color="#ff8a00" transparent opacity={0.35} depthTest={false} side={THREE.DoubleSide} />
        </mesh>
      )}
      {hoverFace && (
        <mesh geometry={hoverFace} renderOrder={909}>
          <meshBasicMaterial color="#ffffff" transparent opacity={0.16} depthTest={false} side={THREE.DoubleSide} />
        </mesh>
      )}

      {/* selected edges */}
      {selectedEdges && (
        <lineSegments geometry={selectedEdges} renderOrder={920}>
          <lineBasicMaterial color="#ff8a00" depthTest={false} />
        </lineSegments>
      )}
      {hoverEdge && (
        <lineSegments geometry={hoverEdge} renderOrder={919}>
          <lineBasicMaterial color="#ffffff" depthTest={false} />
        </lineSegments>
      )}

      {/* vertices */}
      {allVertices && (
        <points geometry={allVertices} renderOrder={930}>
          <pointsMaterial color="#cfd6dd" size={4} sizeAttenuation={false} depthTest={false} />
        </points>
      )}
      {selectedVerts && (
        <points geometry={selectedVerts} renderOrder={931}>
          <pointsMaterial color="#ff8a00" size={7} sizeAttenuation={false} depthTest={false} />
        </points>
      )}
      {hoverVertex && (
        <points geometry={hoverVertex} renderOrder={932}>
          <pointsMaterial color="#31ffb0" size={9} sizeAttenuation={false} depthTest={false} />
        </points>
      )}
    </group>
  );
};

/** World space center of a sub-object element, used for markers. */
export function elementCenter(mesh: MeshData, mode: SubObjectMode, key: string): { x: number; y: number; z: number } | null {
  if (mode === 'vertex') {
    const p = mesh.vertices[parseInt(key, 10)];
    return p ? { ...p } : null;
  }
  if (mode === 'face') {
    const face = mesh.faces[parseInt(key, 10)];
    return face ? polygonCenter(mesh, face) : null;
  }
  const [a, b] = parseEdgeKey(key);
  const pa = mesh.vertices[a];
  const pb = mesh.vertices[b];
  if (!pa || !pb) return null;
  return { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2, z: (pa.z + pb.z) / 2 };
}
