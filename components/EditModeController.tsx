import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { TransformControls } from '@react-three/drei';
import * as THREE from 'three';
import { useAppStore } from '../store';
import type { AxisLock, ModalTransform, SceneObject, SnapTarget, Vector3Data } from '../types';
import { getRenderData } from './EditableMesh';
import { applyMask, maskFromGizmoAxis, maskFromLock } from './axisConstraint';
import type { AxisMask } from './axisConstraint';
import {
  activeVertexIndices,
  edgeKey,
  faceEdges,
  parseEdgeKey,
  polygonCenter,
  selectionCenter,
} from '../editGeometry';
import {
  distanceToSegment,
  findNearestCandidate,
  gatherSnapCandidates,
  objectMatrix,
  pointInTriangle,
  projectToScreen,
  snapPointToGrid,
  toVec3,
} from './snapping';

const AXIS_VECTORS: Record<Exclude<AxisLock, 'free'>, THREE.Vector3> = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
};

/**
 * Component mask of the active constraint: 1 on the axes that may move, 0 on the
 * locked ones. `null` means free (no constraint). Lives in axisConstraint.ts so
 * it can be unit tested.
 */

/**
 * Clickable "grab from here" handle drawn over the hovered vertex. It keeps a
 * constant pixel size in every viewport (perspective and ortho) and always
 * faces the camera, so it reads as a UI icon rather than as geometry.
 */
const GrabHandle: React.FC<{ position: THREE.Vector3; color?: string }> = ({ position, color = '#ffd400' }) => {
  const group = useRef<THREE.Group>(null);

  useFrame(({ camera, size }) => {
    const g = group.current;
    if (!g) return;
    let worldPerPixel: number;
    if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
      const dist = camera.position.distanceTo(position);
      const fov = ((camera as THREE.PerspectiveCamera).fov * Math.PI) / 180;
      worldPerPixel = (2 * Math.tan(fov / 2) * dist) / Math.max(1, size.height);
    } else {
      worldPerPixel = 1 / Math.max(1e-6, (camera as THREE.OrthographicCamera).zoom);
    }
    const px = worldPerPixel * 17;
    g.scale.set(px, px, px);
    g.quaternion.copy(camera.quaternion);
  });

  return (
    <group ref={group} position={position}>
      <mesh renderOrder={960}>
        <ringGeometry args={[0.34, 0.5, 28]} />
        <meshBasicMaterial color={color} depthTest={false} transparent opacity={0.95} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
      <mesh renderOrder={961}>
        <circleGeometry args={[0.15, 16]} />
        <meshBasicMaterial color={color} depthTest={false} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
    </group>
  );
};

interface DragState {
  originals: Map<number, THREE.Vector3>; // local space
  startIndex: number[];
  sourceVertex: number | null;
  startAnchorMatrix: THREE.Matrix4 | null; // gizmo drags
  startPointer: THREE.Vector2 | null; // modal drags
  startPlanePoint: THREE.Vector3 | null;
  center: THREE.Vector3 | null; // world space pivot for rotate/scale
  snapped: boolean;
  moved: boolean;
  /** constraint in force during the drag (null = free) */
  axisMask: AxisMask;
}

export const EditModeController: React.FC<{ viewportId: number }> = ({ viewportId }) => {
  const {
    objects,
    editObjectId,
    editSelection,
    subObjectMode,
    snapSettings,
    snapTarget,
    snapSourceVertex,
    modalTransform,
    transformMode,
    gizmoSize,
    transformSpace,
    activeViewportId,
    hoverElement,
    setHoverElement,
    setEditSelection,
    toggleEditElement,
    clearEditSelection,
    runEditOp,
    setModalTransform,
    setModalReadout,
    setModalAxis,
    setSnapSourceVertex,
    setSnapTarget,
    setEditBoxSelect,
    setIsTransforming,
    selectLinked,
  } = useAppStore();

  const { camera, gl, size } = useThree();
  const anchor = useMemo(() => new THREE.Object3D(), []);
  const transformRef = useRef<any>(null);
  const drag = useRef<DragState | null>(null);
  const pointerPx = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const boxSelect = useRef<{ x: number; y: number } | null>(null);

  const editObject = objects.find(o => o.id === editObjectId) || null;
  const mesh = editObject?.mesh ?? null;
  const isActive = activeViewportId === viewportId;

  const matrices = useMemo(() => {
    if (!editObject) return null;
    const m = objectMatrix(editObject);
    return { world: m, local: m.clone().invert() };
  }, [editObject?.position, editObject?.rotation, editObject?.scale, editObject]);

  const renderData = useMemo(() => (mesh ? getRenderData(mesh) : null), [mesh]);

  const activeVerts = useMemo(
    () => (mesh ? activeVertexIndices(mesh, editSelection) : []),
    [mesh, editSelection]
  );

  const snapCandidates = useMemo(
    () => gatherSnapCandidates(objects, { midpoints: snapSettings.midpoint, includeSelf: true }),
    [objects, snapSettings.midpoint]
  );

  /* ---------------- world space helpers ---------------- */

  const toWorld = (p: Vector3Data) => (matrices ? toVec3(p).applyMatrix4(matrices.world) : toVec3(p));
  const toLocal = (p: THREE.Vector3) => (matrices ? p.clone().applyMatrix4(matrices.local) : p.clone());

  const worldVertices = useMemo(() => {
    if (!mesh || !matrices) return [];
    return mesh.vertices.map(v => toVec3(v).applyMatrix4(matrices.world));
  }, [mesh, matrices]);

  const selectionMedian = useMemo(() => {
    if (!mesh || activeVerts.length === 0) return null;
    if (!matrices) return null;
    const center = selectionCenter(mesh, { vertices: activeVerts, edges: [], faces: [] });
    return center ? toVec3(center).applyMatrix4(matrices.world) : null;
  }, [mesh, activeVerts, matrices]);

  /* ---------------- gizmo placement ---------------- */

  useEffect(() => {
    if (drag.current) return;
    if (selectionMedian) {
      anchor.position.copy(selectionMedian);
      anchor.quaternion.identity();
      anchor.scale.set(1, 1, 1);
      anchor.updateMatrixWorld(true);
    }
  }, [selectionMedian, anchor, mesh, editSelection]);

  /* ---------------- snapping query ---------------- */

  const movingVertexSet = useMemo(() => new Set(activeVerts), [activeVerts]);

  const querySnap = (
    sourceWorld: THREE.Vector3,
    px: number,
    py: number,
    excludeSelfSelected: boolean
  ): SnapTarget | null => {
    if (!snapSettings.enabled) return null;

    const filtered = snapCandidates.filter(c => {
      if (c.objectId !== editObjectId) return true;
      if (!excludeSelfSelected) return true;
      // do not snap onto the vertices we are dragging
      return c.vertexIndex === null || !movingVertexSet.has(c.vertexIndex);
    });

    const vertexHits = filtered.filter(c => c.kind === 'vertex' || (c.kind === 'midpoint' && snapSettings.midpoint));
    if ((snapSettings.vertex || snapSettings.midpoint) && vertexHits.length > 0) {
      const hit = findNearestCandidate(vertexHits, camera, size.width, size.height, px, py, snapSettings.radiusPx);
      if (hit) {
        return {
          kind: hit.candidate.kind,
          point: { x: hit.candidate.point.x, y: hit.candidate.point.y, z: hit.candidate.point.z },
          objectId: hit.candidate.objectId,
          vertexIndex: hit.candidate.vertexIndex,
        };
      }
    }
    return null;
  };

  const gridSnapShift = (sourceWorld: THREE.Vector3): THREE.Vector3 | null => {
    if (!snapSettings.enabled || !snapSettings.grid) return null;
    const cell =
      useAppStore.getState().unit === 'm' ? 1 : useAppStore.getState().unit === 'cm' ? 0.01 : useAppStore.getState().unit === 'mm' ? 0.001 : 0.0254;
    const snapped = snapPointToGrid(sourceWorld, cell);
    if (snapped.distanceTo(sourceWorld) < 1e-9) return null;
    return snapped.sub(sourceWorld);
  };

  /* ---------------- picking ---------------- */

  const pick = (px: number, py: number) => {
    if (!mesh || !matrices || !renderData) return null;
    const radius = Math.max(6, snapSettings.radiusPx);

    // vertices
    let bestVertex: { key: string; dist: number; point: THREE.Vector3 } | null = null;
    worldVertices.forEach((wp, i) => {
      const s = projectToScreen(wp, camera, size.width, size.height);
      if (!s) return;
      const d = Math.hypot(s.x - px, s.y - py);
      if (d > radius) return;
      if (!bestVertex || d < bestVertex.dist) bestVertex = { key: String(i), dist: d, point: wp };
    });

    // edges
    const edgeKeys = new Set<string>();
    mesh.faces.forEach(f => faceEdges(f).forEach(([a, b]) => edgeKeys.add(edgeKey(a, b))));
    mesh.edges.forEach(([a, b]) => edgeKeys.add(edgeKey(a, b)));

    let bestEdge: { key: string; dist: number; point: THREE.Vector3 } | null = null;
    edgeKeys.forEach(key => {
      const [a, b] = parseEdgeKey(key);
      const pa = worldVertices[a];
      const pb = worldVertices[b];
      if (!pa || !pb) return;
      const sa = projectToScreen(pa, camera, size.width, size.height);
      const sb = projectToScreen(pb, camera, size.width, size.height);
      if (!sa || !sb) return;
      const d = distanceToSegment(px, py, sa.x, sa.y, sb.x, sb.y);
      if (d > radius) return;
      if (!bestEdge || d < bestEdge.dist) {
        bestEdge = { key, dist: d, point: pa.clone().add(pb).multiplyScalar(0.5) };
      }
    });

    // faces
    let bestFace: { key: string; depth: number; point: THREE.Vector3 } | null = null;
    if (subObjectMode === 'face') {
      renderData.triangles.forEach((tri, ti) => {
        const faceIndex = renderData!.faceOfTriangle[ti];
        const pts = tri.map(i => worldVertices[i]);
        const sp = pts.map(p => projectToScreen(p, camera, size.width, size.height));
        if (sp.some(s => !s)) return;
        const [a, b, c] = sp as { x: number; y: number; depth: number }[];
        if (!pointInTriangle(px, py, a.x, a.y, b.x, b.y, c.x, c.y)) return;
        const depth = (a.depth + b.depth + c.depth) / 3;
        if (!bestFace || depth < bestFace.depth) {
          const center = polygonCenter(mesh!, mesh!.faces[faceIndex]);
          bestFace = { key: String(faceIndex), depth, point: toWorld(center) };
        }
      });
    }

    if (subObjectMode === 'vertex' && bestVertex) return { kind: 'vertex' as const, ...bestVertex };
    if (subObjectMode === 'edge') {
      if (bestEdge) return { kind: 'edge' as const, ...bestEdge };
      if (bestVertex) return { kind: 'vertex' as const, ...bestVertex };
      return null;
    }
    if (bestFace) return { kind: 'face' as const, ...bestFace };
    if (bestEdge) return { kind: 'edge' as const, ...bestEdge };
    if (bestVertex) return { kind: 'vertex' as const, ...bestVertex };
    return null;
  };

  /* ---------------- box selection ---------------- */

  const elementsInRect = (x0: number, y0: number, x1: number, y1: number) => {
    if (!mesh || !renderData) return null;
    const left = Math.min(x0, x1), right = Math.max(x0, x1);
    const top = Math.min(y0, y1), bottom = Math.max(y0, y1);
    const inside = (s: { x: number; y: number }) => s.x >= left && s.x <= right && s.y >= top && s.y <= bottom;

    const vertices: number[] = [];
    worldVertices.forEach((wp, i) => {
      const s = projectToScreen(wp, camera, size.width, size.height);
      if (s && inside(s)) vertices.push(i);
    });

    const edgeKeys = new Set<string>();
    mesh.faces.forEach(f => faceEdges(f).forEach(([a, b]) => edgeKeys.add(edgeKey(a, b))));
    mesh.edges.forEach(([a, b]) => edgeKeys.add(edgeKey(a, b)));
    const edges: string[] = [];
    edgeKeys.forEach(key => {
      const [a, b] = parseEdgeKey(key);
      const sa = projectToScreen(worldVertices[a], camera, size.width, size.height);
      const sb = projectToScreen(worldVertices[b], camera, size.width, size.height);
      if (!sa || !sb) return;
      const mid = { x: (sa.x + sb.x) / 2, y: (sa.y + sb.y) / 2 };
      if (inside(mid)) edges.push(key);
    });

    const faces: number[] = [];
    mesh.faces.forEach((face, fi) => {
      const center = polygonCenter(mesh, face);
      const s = projectToScreen(toWorld(center), camera, size.width, size.height);
      if (s && inside(s)) faces.push(fi);
    });

    return { vertices, edges, faces };
  };

  /* ---------------- DOM input ---------------- */

  useEffect(() => {
    if (!isActive || !mesh) return;
    const element = gl.domElement;

    const localPx = (e: PointerEvent) => {
      const rect = element.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const onMove = (e: PointerEvent) => {
      const { x, y } = localPx(e);
      pointerPx.current = { x, y };

      if (boxSelect.current) {
        setEditBoxSelect({ start: boxSelect.current, current: { x, y } });
        return;
      }
      if (drag.current || modalTransform) return;
      if (transformRef.current?.axis) return; // pointer is over the gizmo

      const hit = pick(x, y);
      if (hit) {
        setHoverElement({
          kind: hit.kind,
          key: hit.key,
          point: { x: hit.point.x, y: hit.point.y, z: hit.point.z },
        });
        element.style.cursor = 'pointer';
      } else {
        if (hoverElement) setHoverElement(null);
        element.style.cursor = 'crosshair';
      }
    };

    const onDown = (e: PointerEvent) => {
      const { x, y } = localPx(e);
      pointerPx.current = { x, y };
      if (e.button !== 0) return;
      if (modalTransform) return; // confirmed by the modal handler
      if (transformRef.current?.axis) return; // clicking the gizmo

      const hit = pick(x, y);
      if (hit) {
        if (e.shiftKey || e.ctrlKey || e.metaKey) {
          toggleEditElement(hit.kind, hit.key);
          return;
        }
        // Blender style: a click selects, a drag grabs the element right there
        // and moves it (from the vertex you clicked, not from the pivot).
        const field = hit.kind === 'edge' ? 'edges' : hit.kind === 'face' ? 'faces' : 'vertices';
        const value = hit.kind === 'edge' ? [hit.key] : [parseInt(hit.key, 10)];
        setEditSelection({ [field]: value } as any);
        startDirectDrag(hit.kind === 'vertex' ? parseInt(hit.key, 10) : null, e.clientX, e.clientY);
        return;
      }
      boxSelect.current = { x, y };
      setEditBoxSelect({ start: { x, y }, current: { x, y } });
    };

    const onUp = (e: PointerEvent) => {
      if (!boxSelect.current) return;
      const { x, y } = localPx(e);
      const start = boxSelect.current;
      boxSelect.current = null;
      setEditBoxSelect(null);

      const moved = Math.hypot(x - start.x, y - start.y);
      if (moved < 4) {
        if (!e.shiftKey && !e.ctrlKey && !e.metaKey) clearEditSelection();
        return;
      }
      const result = elementsInRect(start.x, start.y, x, y);
      if (!result) return;
      const additive = e.shiftKey || e.ctrlKey || e.metaKey;
      if (subObjectMode === 'vertex') setEditSelection({ vertices: result.vertices }, additive);
      else if (subObjectMode === 'edge') setEditSelection({ edges: result.edges }, additive);
      else setEditSelection({ faces: result.faces }, additive);
    };

    const onDoubleClick = (e: MouseEvent) => {
      const { x, y } = localPx(e as unknown as PointerEvent);
      const hit = pick(x, y);
      if (hit && hit.kind === 'vertex') selectLinked(hit.key);
    };

    element.addEventListener('pointermove', onMove);
    element.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);
    element.addEventListener('dblclick', onDoubleClick);
    return () => {
      element.removeEventListener('pointermove', onMove);
      element.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      element.removeEventListener('dblclick', onDoubleClick);
      element.style.cursor = 'auto';
    };
  });

  /* ---------------- gizmo dragging ---------------- */

  const beginDrag = (sourceVertex: number | null, startAnchorMatrix: THREE.Matrix4 | null, startPointer: THREE.Vector2 | null) => {
    if (!mesh || !matrices) return;
    const originals = new Map<number, THREE.Vector3>();
    activeVerts.forEach(i => originals.set(i, toVec3(mesh.vertices[i])));
    drag.current = {
      originals,
      startIndex: activeVerts.slice(),
      sourceVertex,
      startAnchorMatrix,
      startPointer,
      startPlanePoint: null,
      center: selectionMedian ? selectionMedian.clone() : null,
      snapped: false,
      moved: false,
      axisMask: null,
    };
    setSnapSourceVertex(sourceVertex);
  };

  const applyPositions = (positions: Map<number, THREE.Vector3>, record: boolean) => {
    const payload: Record<number, Vector3Data> = {};
    positions.forEach((p, i) => {
      payload[i] = { x: p.x, y: p.y, z: p.z };
    });
    runEditOp({ type: 'set-vertices', positions: payload }, record);
  };

  const finishDrag = () => {
    const state = drag.current;
    drag.current = null;
    setSnapSourceVertex(null);
    setSnapTarget(null);
    setIsTransforming(false);
    return state;
  };

  /**
   * Snaps the moving selection so `sourceVertex` lands on the best target.
   * The returned shift is projected onto `mask`, so a constrained axis never
   * drags the other two along with it.
   */
  const computeSnapShift = (
    movedWorld: Map<number, THREE.Vector3>,
    sourceVertex: number | null,
    mask: AxisMask = null
  ): { shift: THREE.Vector3; target: SnapTarget | null } => {
    const px = pointerPx.current.x;
    const py = pointerPx.current.y;
    const source = sourceVertex !== null ? movedWorld.get(sourceVertex) : null;
    const probe = source ?? (selectionMedian || new THREE.Vector3());

    const target = querySnap(probe, px, py, true);
    if (target) {
      const masked = applyMask(toVec3(target.point).sub(probe), mask);
      return { shift: new THREE.Vector3(masked.x, masked.y, masked.z), target };
    }
    const gridShift = gridSnapShift(probe);
    if (gridShift) {
      const masked = applyMask(gridShift, mask);
      return {
        shift: new THREE.Vector3(masked.x, masked.y, masked.z),
        target: {
          kind: 'grid',
          point: { x: probe.x + gridShift.x, y: probe.y + gridShift.y, z: probe.z + gridShift.z },
          objectId: null,
          vertexIndex: null,
        },
      };
    }
    return { shift: new THREE.Vector3(), target: null };
  };

  /**
   * Grabs the element under the cursor and moves it until the button is
   * released. A click without movement behaves as a plain selection.
   */
  const startDirectDrag = (sourceVertex: number | null, clientX: number, clientY: number) => {
    if (!editObjectId) return;
    setModalTransform({
      type: 'move',
      axis: 'free',
      objectId: editObjectId,
      sourceVertex,
      amount: 0,
      snapped: false,
    });

    const onRelease = (up: PointerEvent) => {
      window.removeEventListener('pointerup', onRelease);
      const moved = Math.hypot(up.clientX - clientX, up.clientY - clientY);
      // below the threshold it was a click, not a drag: revert the transform
      if (moved < 4) modalApi.current?.cancel();
      else modalApi.current?.commit();
    };
    window.addEventListener('pointerup', onRelease);
  };

  /** Live gizmo drag: applies the anchor delta to the selected vertices. */
  const onGizmoChange = () => {
    const state = drag.current;
    if (!state || !mesh || !matrices) return;
    state.moved = true;

    const movedWorld = new Map<number, THREE.Vector3>();
    if (state.startAnchorMatrix) {
      const delta = anchor.matrixWorld.clone().multiply(state.startAnchorMatrix.clone().invert());
      state.originals.forEach((localPos, i) => {
        movedWorld.set(i, localPos.clone().applyMatrix4(matrices.world).applyMatrix4(delta));
      });
    }

    // rotate/scale gizmos must not be translated by the snap
    const isTranslate = useAppStore.getState().transformMode === 'translate';
    const mask = isTranslate ? maskFromGizmoAxis(transformRef.current?.axis) : null;
    state.axisMask = mask;
    const { shift, target } = isTranslate
      ? computeSnapShift(movedWorld, state.sourceVertex, mask)
      : { shift: new THREE.Vector3(), target: null };
    setSnapTarget(target);
    state.snapped = !!target;

    const result = new Map<number, THREE.Vector3>();
    movedWorld.forEach((world, i) => {
      result.set(i, toLocal(world.clone().add(shift)));
    });
    applyPositions(result, false);
  };

  /**
   * Welds the snapped source vertex into its target. Returns true when a merge
   * happened, so the caller can skip the plain position commit.
   */
  const weldOnDrop = (state: DragState): boolean => {
    const current = useAppStore.getState();
    const target = current.snapTarget;
    if (!target || target.kind !== 'vertex' || !current.snapSettings.weld) return false;
    if (target.objectId !== editObjectId) return false; // join the objects first
    if (state.sourceVertex === null || target.vertexIndex === null) return false;
    if (state.startIndex.includes(target.vertexIndex)) return false;
    // a locked axis must win over the weld: merging would move the frozen axes
    if (state.axisMask || (current.modalTransform && current.modalTransform.axis !== 'free')) return false;

    const localTarget = toLocal(toVec3(target.point));
    current.setEditSelection({ vertices: [state.sourceVertex, target.vertexIndex] });
    runEditOp({ type: 'merge', mode: 'cursor', cursor: { x: localTarget.x, y: localTarget.y, z: localTarget.z } }, true);
    return true;
  };

  /** Releases the gizmo: welds onto the snap target, or commits with history. */
  const endGizmoDrag = () => {
    const state = finishDrag();
    if (!state || !state.moved) return;

    if (weldOnDrop(state)) return;

    const current = useAppStore.getState();

    const payload: Record<number, Vector3Data> = {};
    const liveMesh = current.objects.find(o => o.id === editObjectId)?.mesh;
    state.originals.forEach((_, i) => {
      const live = liveMesh?.vertices[i];
      if (live) payload[i] = { x: live.x, y: live.y, z: live.z };
    });
    if (Object.keys(payload).length > 0) runEditOp({ type: 'set-vertices', positions: payload }, true);
  };

  const onGizmoDraggingChanged = (event: any) => {
    if (event.value) {
      // the snap source is the hovered vertex when it belongs to the selection,
      // otherwise the selected vertex closest to the selection median
      let source: number | null = null;
      if (hoverElement && hoverElement.kind === 'vertex') {
        const index = parseInt(hoverElement.key, 10);
        if (activeVerts.includes(index)) source = index;
      }
      if (source === null && activeVerts.length > 0 && selectionMedian) {
        let best = Infinity;
        activeVerts.forEach(i => {
          const d = worldVertices[i]?.distanceTo(selectionMedian) ?? Infinity;
          if (d < best) {
            best = d;
            source = i;
          }
        });
      }
      setIsTransforming(true);
      beginDrag(source, anchor.matrixWorld.clone(), null);
    } else {
      endGizmoDrag();
    }
  };

  /**
   * The handlers above close over fresh state every render, so they are exposed
   * through a ref: the gizmo listeners are attached once (when the controls
   * mount) instead of being re-registered on every frame of a drag.
   */
  const gizmoApi = useRef<{ change: () => void; dragging: (e: any) => void } | null>(null);
  gizmoApi.current = { change: onGizmoChange, dragging: onGizmoDraggingChanged };

  const [controlsReady, setControlsReady] = useState(false);

  useEffect(() => {
    const controls = transformRef.current;
    if (!controls || !controlsReady || !isActive) return;

    const onChange = () => gizmoApi.current?.change();
    const onDragging = (event: any) => gizmoApi.current?.dragging(event);

    controls.addEventListener('change', onChange);
    controls.addEventListener('dragging-changed', onDragging);
    return () => {
      controls.removeEventListener('change', onChange);
      controls.removeEventListener('dragging-changed', onDragging);
    };
  }, [controlsReady, isActive]);

  /* ---------------- modal transform (G / R / S) ---------------- */

  const planeIntersect = (px: number, py: number, center: THREE.Vector3 | null): THREE.Vector3 | null => {
    const ndc = new THREE.Vector2((px / size.width) * 2 - 1, -(py / size.height) * 2 + 1);
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, camera);
    const normal = new THREE.Vector3();
    camera.getWorldDirection(normal);
    const pivot = center ?? new THREE.Vector3();
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, pivot);
    const hit = new THREE.Vector3();
    return raycaster.ray.intersectPlane(plane, hit) ? hit : null;
  };

  /** Captures the selection and the starting pointer plane point. */
  const startModalDrag = () => {
    if (drag.current || !modalTransform || !mesh || !matrices) return;

    let source: number | null = modalTransform.sourceVertex;
    if (source === null && activeVerts.length > 0) {
      // grab the selected vertex closest to the cursor, Blender style
      let best = Infinity;
      const px = pointerPx.current.x;
      const py = pointerPx.current.y;
      activeVerts.forEach(i => {
        const sp = projectToScreen(worldVertices[i], camera, size.width, size.height);
        if (!sp) return;
        const d = Math.hypot(sp.x - px, sp.y - py);
        if (d < best) {
          best = d;
          source = i;
        }
      });
    }

    beginDrag(source, null, new THREE.Vector2(pointerPx.current.x, pointerPx.current.y));
    if (drag.current) {
      drag.current.startPlanePoint = planeIntersect(pointerPx.current.x, pointerPx.current.y, drag.current.center);
      drag.current.axisMask = maskFromLock(modalTransform.axis);
    }
  };

  const computeModal = () => {
    const state = drag.current;
    if (!state || !state.startPlanePoint || !modalTransform || !matrices) return;
    const current = planeIntersect(pointerPx.current.x, pointerPx.current.y, state.center);
    if (!current) return;

    const axisLock = modalTransform.axis;
    const axis = axisLock === 'free' ? null : AXIS_VECTORS[axisLock].clone();
    const pivot = state.center ?? new THREE.Vector3();
    const movedWorld = new Map<number, THREE.Vector3>();
    let amount = 0;
    let snapped = false;

    if (modalTransform.type === 'move') {
      let delta = current.clone().sub(state.startPlanePoint);
      if (axis) delta = axis.clone().multiplyScalar(delta.dot(axis));
      amount = delta.length();

      const project = (d: THREE.Vector3) => {
        movedWorld.clear();
        state.originals.forEach((localPos, i) => {
          movedWorld.set(i, localPos.clone().applyMatrix4(matrices.world).add(d));
        });
      };
      project(delta);

      const snap = computeSnapShift(movedWorld, state.sourceVertex, maskFromLock(axisLock));
      snapped = !!snap.target;
      setSnapTarget(snap.target);
      if (snap.target) {
        delta = delta.add(snap.shift); // already masked: locked axes keep their value
        amount = delta.length();
        project(delta);
      }
    } else if (modalTransform.type === 'rotate') {
      const viewAxis = new THREE.Vector3();
      camera.getWorldDirection(viewAxis);
      const rotAxis = axis ?? viewAxis.negate();
      const from = state.startPlanePoint.clone().sub(pivot);
      const to = current.clone().sub(pivot);
      if (axis) {
        from.addScaledVector(axis, -from.dot(axis));
        to.addScaledVector(axis, -to.dot(axis));
      }
      const angle = Math.atan2(from.clone().cross(to).dot(rotAxis), from.dot(to));
      amount = (angle * 180) / Math.PI;
      const quat = new THREE.Quaternion().setFromAxisAngle(rotAxis.clone().normalize(), angle);
      state.originals.forEach((localPos, i) => {
        movedWorld.set(i, localPos.clone().applyMatrix4(matrices.world).sub(pivot).applyQuaternion(quat).add(pivot));
      });
    } else {
      const from = state.startPlanePoint.clone().sub(pivot);
      const to = current.clone().sub(pivot);
      let factor = from.length() > 1e-9 ? to.length() / from.length() : 1;
      if (axis) {
        const f = from.dot(axis);
        factor = Math.abs(f) > 1e-9 ? to.dot(axis) / f : 1;
      }
      amount = factor;
      state.originals.forEach((localPos, i) => {
        const world = localPos.clone().applyMatrix4(matrices.world).sub(pivot);
        if (axis) {
          const along = axis.clone().multiplyScalar(world.dot(axis));
          const rest = world.clone().sub(along);
          world.copy(rest.add(along.multiplyScalar(factor)));
        } else {
          world.multiplyScalar(factor);
        }
        movedWorld.set(i, world.add(pivot));
      });
    }

    const result = new Map<number, THREE.Vector3>();
    movedWorld.forEach((world, i) => result.set(i, toLocal(world)));
    applyPositions(result, false);
    state.snapped = snapped;
    setModalReadout({ amount, snapped });
  };

  const commitModal = () => {
    const state = drag.current;
    if (!state) {
      // released before the drag was even initialised: nothing to commit
      setModalTransform(null);
      return;
    }
    const welded = weldOnDrop(state);
    const payload: Record<number, Vector3Data> = {};
    const live = useAppStore.getState().objects.find(o => o.id === editObjectId)?.mesh;
    state.originals.forEach((_, i) => {
      const v = live?.vertices[i];
      if (v) payload[i] = { x: v.x, y: v.y, z: v.z };
    });
    drag.current = null;
    setSnapSourceVertex(null);
    setSnapTarget(null);
    setModalTransform(null);
    // the merge already recorded the moved positions, do not commit them twice
    if (!welded && Object.keys(payload).length > 0) runEditOp({ type: 'set-vertices', positions: payload }, true);
  };

  const cancelModal = () => {
    const state = drag.current;
    if (!state) {
      setModalTransform(null);
      return;
    }
    applyPositions(state.originals, false);
    drag.current = null;
    setSnapSourceVertex(null);
    setSnapTarget(null);
    setModalTransform(null);
  };

  /** Same pattern as the gizmo: fresh closures behind a ref, listeners attached once. */
  const modalApi = useRef<{ start: () => void; compute: () => void; commit: () => void; cancel: () => void } | null>(null);
  modalApi.current = { start: startModalDrag, compute: computeModal, commit: commitModal, cancel: cancelModal };

  const modalActive = !!modalTransform && isActive;

  // 1. capture the selection when the modal starts
  useEffect(() => {
    if (modalActive) modalApi.current?.start();
  }, [modalActive, modalTransform?.type, modalTransform?.objectId]);

  // 2. input listeners, registered once per modal session
  useEffect(() => {
    if (!modalActive) return;
    const element = gl.domElement;

    const onMove = (e: PointerEvent) => {
      const r = element.getBoundingClientRect();
      pointerPx.current = { x: e.clientX - r.left, y: e.clientY - r.top };
      modalApi.current?.compute();
    };
    const onDown = (e: PointerEvent) => {
      if (e.button === 0) {
        e.preventDefault();
        e.stopPropagation();
        modalApi.current?.commit();
      } else if (e.button === 2) {
        e.preventDefault();
        e.stopPropagation();
        modalApi.current?.cancel();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (key === 'escape') {
        e.preventDefault();
        modalApi.current?.cancel();
      } else if (key === 'enter') {
        e.preventDefault();
        modalApi.current?.commit();
      } else if (key === 'x' || key === 'y' || key === 'z') {
        e.preventDefault();
        const axis = useAppStore.getState().modalTransform?.axis;
        setModalAxis(axis === key ? 'free' : (key as Exclude<AxisLock, 'free'>));
      }
    };
    const onContext = (e: Event) => e.preventDefault();

    window.addEventListener('pointermove', onMove);
    element.addEventListener('pointerdown', onDown, true);
    element.addEventListener('contextmenu', onContext);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointermove', onMove);
      element.removeEventListener('pointerdown', onDown, true);
      element.removeEventListener('contextmenu', onContext);
      window.removeEventListener('keydown', onKey);
    };
  }, [modalActive, gl]);

  // 3. recompute when the axis lock changes (and once right after the start)
  useEffect(() => {
    if (modalActive) modalApi.current?.compute();
  }, [modalActive, modalTransform?.axis]);

  /* ---------------- markers ---------------- */

  const sourceWorld = useMemo(() => {
    if (snapSourceVertex === null || !mesh || !matrices) return null;
    const v = mesh.vertices[snapSourceVertex];
    return v ? toVec3(v).applyMatrix4(matrices.world) : null;
  }, [snapSourceVertex, mesh, matrices]);

  if (!mesh || !isActive) return null;

  const markerScale = camera.type === 'OrthographicCamera' ? 1 / Math.max(1, (camera as THREE.OrthographicCamera).zoom) : 0.05;

  return (
    <group>
      <primitive object={anchor} />

      <TransformControls
        ref={(node: any) => {
          transformRef.current = node;
          setControlsReady(!!node);
        }}
        object={anchor}
        mode={transformMode}
        space={transformSpace}
        size={gizmoSize}
        enabled={activeVerts.length > 0 && !modalTransform}
        visible={activeVerts.length > 0 && !modalTransform}
      />

      {hoverElement && hoverElement.kind === 'vertex' && !modalTransform && !drag.current && (
        <GrabHandle position={toVec3(hoverElement.point)} />
      )}

      {sourceWorld && (
        <mesh position={sourceWorld} renderOrder={950}>
          <sphereGeometry args={[0.004 + markerScale * 0.4, 12, 12]} />
          <meshBasicMaterial color="#2aa9ff" depthTest={false} transparent opacity={0.95} />
        </mesh>
      )}

      {snapTarget && (
        <mesh position={toVec3(snapTarget.point)} renderOrder={951}>
          <sphereGeometry args={[0.005 + markerScale * 0.5, 12, 12]} />
          <meshBasicMaterial
            color={snapTarget.kind === 'grid' ? '#9be564' : '#ff5bd0'}
            depthTest={false}
            transparent
            opacity={0.95}
          />
        </mesh>
      )}
    </group>
  );
};
