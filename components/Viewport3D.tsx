
import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, Grid, TransformControls, PerspectiveCamera, OrthographicCamera } from '@react-three/drei';
import * as THREE from 'three';
import { useAppStore } from '../store';
import { ViewportType, SceneObject } from '../types';

interface Viewport3DProps {
  id: number;
  type: ViewportType;
  label: string;
}

// Transparent Plane for intercepting creation clicks
const CreationOverlay: React.FC = () => {
    const { 
        interactionMode, 
        drawingPhase, 
        startDrawing, 
        updateDrawing, 
        stopDrawingBase, 
        finishDrawing,
        selectedIds,
        objects
    } = useAppStore();
    
    const { raycaster, pointer, camera } = useThree();
    const planeRef = useRef<THREE.Mesh>(null);

    const handlePointerDown = (e: any) => {
        if (interactionMode === 'select') return;
        e.stopPropagation();
        
        if (drawingPhase === 'idle') {
            startDrawing({ x: e.point.x, y: 0, z: e.point.z });
        } else if (drawingPhase === 'drawing_height') {
            finishDrawing();
        }
    };

    const handlePointerMove = (e: any) => {
        if (interactionMode === 'select' || drawingPhase === 'idle') return;
        e.stopPropagation();
        
        if (drawingPhase === 'drawing_base') {
            updateDrawing({ x: e.point.x, y: 0, z: e.point.z });
        }
        else if (drawingPhase === 'drawing_height') {
            const selectedObj = objects.find(o => o.id === selectedIds[0]);
            if (!selectedObj) return;

            const center = new THREE.Vector3(selectedObj.position.x, 0, selectedObj.position.z);
            const camPos = camera.position.clone();
            const normal = new THREE.Vector3(camPos.x - center.x, 0, camPos.z - center.z).normalize();
            
            const plane = new THREE.Plane();
            plane.setFromNormalAndCoplanarPoint(normal, center);
            
            raycaster.setFromCamera(pointer, camera);
            const target = new THREE.Vector3();
            const intersection = raycaster.ray.intersectPlane(plane, target);
            
            if (intersection) {
                updateDrawing({ x: intersection.x, y: intersection.y, z: intersection.z });
            }
        }
    };

    const handlePointerUp = (e: any) => {
        if (interactionMode === 'select') return;
        if (drawingPhase === 'drawing_base') {
            e.stopPropagation();
            stopDrawingBase();
        }
    };

    if (interactionMode === 'select') return null;

    return (
        <mesh 
            ref={planeRef}
            rotation={[-Math.PI / 2, 0, 0]} 
            position={[0, 0, 0]}
            visible={false}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
        >
            <planeGeometry args={[1000, 1000]} />
            <meshBasicMaterial color="red" wireframe opacity={0.1} transparent />
        </mesh>
    );
};

// Selection Box Overlay (DOM Element)
const SelectionBoxOverlay: React.FC<{ 
    start: {x: number, y: number} | null, 
    current: {x: number, y: number} | null 
}> = ({ start, current }) => {
    if (!start || !current) return null;

    const left = Math.min(start.x, current.x);
    const top = Math.min(start.y, current.y);
    const width = Math.abs(current.x - start.x);
    const height = Math.abs(current.y - start.y);

    return (
        <div style={{
            position: 'absolute',
            left: left,
            top: top,
            width: width,
            height: height,
            border: '1px solid #4a90d9',
            backgroundColor: 'rgba(74, 144, 217, 0.2)',
            pointerEvents: 'none',
            zIndex: 100
        }} />
    );
};

const SceneContent: React.FC<{ viewportId: number; type: ViewportType }> = ({ viewportId, type }) => {
  const { 
    objects, 
    selectedIds, 
    transformMode, 
    transformSpace, 
    viewportGridStates, 
    activeViewportId, 
    isGizmoEditMode,
    gizmoSize,
    pivotCommand,
    pivotMode,
    snapSettings,
    unit,
    pasteRequest,
    interactionMode,
    updateObject,
    updateMultipleObjects,
    selectObject,
    setPivotCommand,
    recordHistory,
    paste,
    setIsTransforming
  } = useAppStore();

  const { scene, raycaster, pointer, camera } = useThree();
  
  // Transform Controls Logic
  const primarySelectedId = selectedIds[selectedIds.length - 1]; // Last selected is primary
  const selectedObject = objects.find(o => o.id === primarySelectedId);
  
  const transformRef = useRef<any>(null);
  const selectionAnchorRef = useRef<THREE.Group>(null);
  const [transformTarget, setTransformTarget] = useState<THREE.Object3D | undefined>(undefined);
  
  // Stores initial states for transform operations
  const isDragging = useRef(false);
  const ignoreSelectionClick = useRef(false); // New: Debounce click after drag
  const geometryWorldState = useRef<{ pos: THREE.Vector3, quat: THREE.Quaternion } | null>(null);
  const initialTransforms = useRef<Map<string, {pos: THREE.Vector3, rot: THREE.Euler, scale: THREE.Vector3, quat: THREE.Quaternion}>>(new Map());
  // Store offsets relative to selection anchor
  const anchorOffsets = useRef<Map<string, THREE.Matrix4>>(new Map());
  
  // Snap visualizer
  const [snapMarker, setSnapMarker] = useState<THREE.Vector3 | null>(null);
  const [sourceSnapMarker, setSourceSnapMarker] = useState<THREE.Vector3 | null>(null);
  const [hoveredSourceVertex, setHoveredSourceVertex] = useState<THREE.Vector3 | null>(null);
  const snapOffset = useRef<THREE.Vector3 | null>(null);

  const isGridVisible = viewportGridStates[viewportId];

  const getGridConfig = () => {
    switch (unit) {
      case 'm': return { cell: 1, section: 10 };
      case 'cm': return { cell: 0.01, section: 0.1 };
      case 'mm': return { cell: 0.001, section: 0.01 };
      case 'in': return { cell: 0.0254, section: 0.3048 };
      default: return { cell: 1, section: 10 };
    }
  };
  const gridConfig = getGridConfig();

  // Manage Transform Target (Anchor vs Primary Object)
  useEffect(() => {
    // If we are currently dragging, DO NOT update the target.
    // This prevents the gizmo from resetting or flickering during state updates.
    if (isDragging.current) return;

    if (selectedIds.length === 0) {
        setTransformTarget(undefined);
        return;
    }

    if (selectedIds.length > 1 && pivotMode === 'selection' && selectionAnchorRef.current) {
        // Multi-select & Group Pivot: Target is the anchor
        const anchor = selectionAnchorRef.current;
        
        // Calculate center
        const center = new THREE.Vector3();
        const box = new THREE.Box3();
        let valid = false;
        
        selectedIds.forEach(id => {
            const obj = scene.getObjectByName(id);
            if (obj) {
                const groupPos = obj.position.clone();
                if (!valid) {
                    box.setFromCenterAndSize(groupPos, new THREE.Vector3(0,0,0));
                    valid = true;
                } else {
                    box.expandByPoint(groupPos);
                }
            }
        });
        
        if (valid) {
            box.getCenter(center);
            anchor.position.copy(center);
            anchor.rotation.set(0,0,0);
            anchor.scale.set(1,1,1);
            anchor.updateMatrixWorld(true);
            setTransformTarget(anchor);
        }
    } else {
        // Single select OR Individual pivot: Target is primary object
        if (primarySelectedId) {
            const obj = scene.getObjectByName(primarySelectedId);
            setTransformTarget(obj);
        }
    }
  }, [primarySelectedId, selectedIds, pivotMode, scene, objects]);

  // Paste Request
  useEffect(() => {
    if (pasteRequest && activeViewportId === viewportId) {
        raycaster.setFromCamera(pointer, camera);
        const planeNormal = new THREE.Vector3();
        if (type === 'front') planeNormal.set(0, 0, 1);
        else if (type === 'side' || type === 'left') planeNormal.set(1, 0, 0);
        else planeNormal.set(0, 1, 0);

        const plane = new THREE.Plane(planeNormal, 0);
        const target = new THREE.Vector3();
        const intersection = raycaster.ray.intersectPlane(plane, target);
        
        if (intersection) paste({ x: target.x, y: target.y, z: target.z });
        else paste(); 
    }
  }, [pasteRequest, activeViewportId, viewportId, type, raycaster, pointer, camera, paste]);

  // Pivot Command
  useEffect(() => {
    if (pivotCommand && primarySelectedId && activeViewportId === viewportId) {
        const group = scene.getObjectByName(primarySelectedId);
        if (group && group.children.length > 0) {
            const mesh = group.children[0];
            const meshWorldPos = new THREE.Vector3();
            const meshWorldQuat = new THREE.Quaternion();
            mesh.getWorldPosition(meshWorldPos);
            mesh.getWorldQuaternion(meshWorldQuat);

            const newGroupPos = group.position.clone();
            const newGroupQuat = group.quaternion.clone();
            const bbox = new THREE.Box3().setFromObject(mesh);

            if (pivotCommand === 'center') bbox.getCenter(newGroupPos);
            else if (pivotCommand === 'bottom') {
                bbox.getCenter(newGroupPos);
                newGroupPos.y = bbox.min.y;
            } else if (pivotCommand === 'reset') {
                newGroupPos.set(0, 0, 0);
                newGroupQuat.identity();
            }

            const dummyParent = new THREE.Object3D();
            dummyParent.position.copy(newGroupPos);
            dummyParent.quaternion.copy(newGroupQuat);
            dummyParent.scale.copy(group.scale);
            dummyParent.updateMatrixWorld();

            const newLocalPos = dummyParent.worldToLocal(meshWorldPos.clone());
            const invParentQuat = dummyParent.quaternion.clone().invert();
            const newLocalQuat = invParentQuat.multiply(meshWorldQuat);
            const newLocalEuler = new THREE.Euler().setFromQuaternion(newLocalQuat);

            updateObject(primarySelectedId, {
                position: { x: newGroupPos.x, y: newGroupPos.y, z: newGroupPos.z },
                rotation: { x: new THREE.Euler().setFromQuaternion(newGroupQuat).x, y: new THREE.Euler().setFromQuaternion(newGroupQuat).y, z: new THREE.Euler().setFromQuaternion(newGroupQuat).z },
                geometryOffset: { x: newLocalPos.x, y: newLocalPos.y, z: newLocalPos.z },
                geometryRotation: { x: newLocalEuler.x, y: newLocalEuler.y, z: newLocalEuler.z }
            }, true);
        }
        setPivotCommand(null);
    }
  }, [pivotCommand, primarySelectedId, activeViewportId, viewportId, scene, updateObject, setPivotCommand]);

  // --- SOURCE VERTEX HOVER SYSTEM (INTERACTIVE) ---
  useFrame((state) => {
    if (isDragging.current || 
        !snapSettings.enabled || 
        !snapSettings.vertex || 
        transformMode !== 'translate' || 
        selectedIds.length === 0 || 
        isGizmoEditMode // Don't hover source vertex in gizmo edit mode (Source is pivot)
    ) {
        if (hoveredSourceVertex) setHoveredSourceVertex(null);
        return;
    }

    // Raycast to find closest vertex on selected objects
    state.raycaster.setFromCamera(state.pointer, state.camera);
    
    // Gather selected meshes
    const selectedMeshes: THREE.Object3D[] = [];
    selectedIds.forEach(id => {
        const obj = scene.getObjectByName(id);
        if (obj) {
            obj.traverse(child => {
                if ((child as THREE.Mesh).isMesh) selectedMeshes.push(child);
            });
        }
    });

    const intersects = state.raycaster.intersectObjects(selectedMeshes, false);
    if (intersects.length > 0) {
        const hit = intersects[0];
        const mesh = hit.object as THREE.Mesh;
        
        if (mesh.geometry) {
             const posAttr = mesh.geometry.attributes.position;
             const vertex = new THREE.Vector3();
             let closestDist = Infinity;
             let closestVert = new THREE.Vector3();

             // Optimization: Only check vertices reasonably close? 
             // For now iterate all (ok for simple primitives)
             for (let i = 0; i < posAttr.count; i++) {
                 vertex.fromBufferAttribute(posAttr, i);
                 vertex.applyMatrix4(mesh.matrixWorld);
                 const dist = hit.point.distanceTo(vertex);
                 if (dist < closestDist) {
                     closestDist = dist;
                     closestVert.copy(vertex);
                 }
             }
             
             // Threshold for visual feedback
             if (closestDist < 0.5) {
                setHoveredSourceVertex(closestVert);
                return;
             }
        }
    }
    
    if (hoveredSourceVertex) setHoveredSourceVertex(null);
  });

  // Transform Controls Event Handlers
  useEffect(() => {
    if (transformRef.current) {
      const controls = transformRef.current;
      
      const onDragStart = () => {
         isDragging.current = true;
         ignoreSelectionClick.current = true; // Block clicks immediately
         setIsTransforming(true);
         initialTransforms.current.clear();
         anchorOffsets.current.clear();
         snapOffset.current = null;
         setSourceSnapMarker(null);
         setHoveredSourceVertex(null); // Clear hover effect

         const isGroupMode = pivotMode === 'selection' && selectedIds.length > 1;
         const anchor = selectionAnchorRef.current;
         
         if (isGroupMode && anchor) {
             anchor.updateMatrixWorld(true);
         }

         selectedIds.forEach(id => {
             const obj = scene.getObjectByName(id);
             if (obj) {
                 initialTransforms.current.set(id, {
                     pos: obj.position.clone(),
                     rot: obj.rotation.clone(),
                     scale: obj.scale.clone(),
                     quat: obj.quaternion.clone()
                 });

                 if (isGroupMode && anchor) {
                     const invAnchor = anchor.matrixWorld.clone().invert();
                     const offset = invAnchor.multiply(obj.matrixWorld);
                     anchorOffsets.current.set(id, offset);
                 }
             }
         });

         // --- VERTEX SNAP SOURCE LOCK-IN ---
         if (snapSettings.enabled && snapSettings.vertex && transformMode === 'translate') {
             if (!isGizmoEditMode && hoveredSourceVertex) {
                 // Use the interactively hovered vertex
                 const gizmoPos = controls.object!.position.clone();
                 snapOffset.current = hoveredSourceVertex.clone().sub(gizmoPos);
                 setSourceSnapMarker(hoveredSourceVertex);
             } else {
                 // Default to Pivot (Offset 0)
                 snapOffset.current = new THREE.Vector3(0,0,0);
                 if (controls.object) setSourceSnapMarker(controls.object.position.clone());
             }
         }

         // Gizmo Edit Mode Snapshots
         if (isGizmoEditMode && selectedObject && transformTarget) {
            const group = transformTarget;
            const mesh = group.children[0];
            if (mesh) {
                const worldPos = new THREE.Vector3();
                const worldQuat = new THREE.Quaternion();
                mesh.getWorldPosition(worldPos);
                mesh.getWorldQuaternion(worldQuat);
                geometryWorldState.current = { pos: worldPos, quat: worldQuat };
            }
         }
      };

      const onDragEnd = () => {
         isDragging.current = false;
         setIsTransforming(false);
         setSnapMarker(null);
         setSourceSnapMarker(null);
         snapOffset.current = null;
         
         setTimeout(() => {
             ignoreSelectionClick.current = false;
         }, 100);
         
         const updates: {id: string, changes: Partial<SceneObject>}[] = [];

         selectedIds.forEach(id => {
             const obj = scene.getObjectByName(id);
             if (obj) {
                 const changes: Partial<SceneObject> = {
                     position: { x: obj.position.x, y: obj.position.y, z: obj.position.z },
                     rotation: { x: obj.rotation.x, y: obj.rotation.y, z: obj.rotation.z },
                     scale: { x: obj.scale.x, y: obj.scale.y, z: obj.scale.z }
                 };

                 if (isGizmoEditMode && selectedIds.length === 1 && id === primarySelectedId) {
                     const mesh = obj.children[0] as THREE.Mesh;
                     if(mesh) {
                         changes.geometryOffset = { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z };
                         changes.geometryRotation = { x: mesh.rotation.x, y: mesh.rotation.y, z: mesh.rotation.z };
                     }
                 }
                 
                 updates.push({ id, changes });
             }
         });

         if (updates.length > 0) {
             updateMultipleObjects(updates, true);
         }

         geometryWorldState.current = null;
         initialTransforms.current.clear();
         anchorOffsets.current.clear();
      };
      
      const onTransformChange = () => {
          if (!isDragging.current || !controls.object) return;
          
          const gizmoObj = controls.object;

          // --- VERTEX SNAP LOGIC ---
          setSnapMarker(null);
          if (snapSettings.enabled && snapSettings.vertex && transformMode === 'translate') {
              const sourcePos = gizmoObj.position.clone();
              if (snapOffset.current) {
                  sourcePos.add(snapOffset.current);
              }
              
              let closestDist = snapSettings.threshold;
              let targetVertex: THREE.Vector3 | null = null;

              objects.forEach(obj => {
                  // In Normal Mode: Don't snap to self.
                  // In Gizmo Edit Mode: Allow snap to self (to place pivot on corner)
                  if (!isGizmoEditMode && selectedIds.includes(obj.id)) return;
                  
                  const threeObj = scene.getObjectByName(obj.id);
                  if (threeObj) {
                      const mesh = threeObj.children[0] as THREE.Mesh;
                      if (mesh && mesh.geometry) {
                          const positionAttribute = mesh.geometry.attributes.position;
                          const vertex = new THREE.Vector3();
                          for (let i = 0; i < positionAttribute.count; i++) {
                              vertex.fromBufferAttribute(positionAttribute, i);
                              vertex.applyMatrix4(mesh.matrixWorld);
                              
                              const dist = sourcePos.distanceTo(vertex);
                              if (dist < closestDist) {
                                  closestDist = dist;
                                  targetVertex = vertex.clone();
                              }
                          }
                      }
                  }
              });

              if (targetVertex) {
                  const newGizmoPos = targetVertex.clone();
                  if (snapOffset.current) {
                      newGizmoPos.sub(snapOffset.current);
                  }
                  
                  gizmoObj.position.copy(newGizmoPos);
                  setSnapMarker(targetVertex);
              }
          }

          // --- CASE 1: GROUP TRANSFORM ---
          if (pivotMode === 'selection' && selectedIds.length > 1) {
              const anchorMatrix = gizmoObj.matrixWorld;
              
              selectedIds.forEach(id => {
                  const offsetMatrix = anchorOffsets.current.get(id);
                  const obj = scene.getObjectByName(id);
                  
                  if (offsetMatrix && obj) {
                      const newMatrix = anchorMatrix.clone().multiply(offsetMatrix);
                      const pos = new THREE.Vector3();
                      const quat = new THREE.Quaternion();
                      const scale = new THREE.Vector3();
                      newMatrix.decompose(pos, quat, scale);
                      
                      obj.position.copy(pos);
                      obj.quaternion.copy(quat);
                      obj.scale.copy(scale);
                  }
              });
          }
          // --- CASE 2: INDIVIDUAL TRANSFORM ---
          else {
              if (selectedIds.length > 1 && !isGizmoEditMode) {
                  const primaryInit = initialTransforms.current.get(primarySelectedId);
                  if (!primaryInit) return;

                  const currentPos = gizmoObj.position;
                  const currentScale = gizmoObj.scale;
                  const currentQuat = gizmoObj.quaternion;

                  const deltaPos = currentPos.clone().sub(primaryInit.pos);
                  const initQuatInv = primaryInit.quat.clone().invert();
                  const deltaQuat = currentQuat.clone().multiply(initQuatInv);
                  const scaleRatio = new THREE.Vector3(
                      primaryInit.scale.x === 0 ? 1 : currentScale.x / primaryInit.scale.x,
                      primaryInit.scale.y === 0 ? 1 : currentScale.y / primaryInit.scale.y,
                      primaryInit.scale.z === 0 ? 1 : currentScale.z / primaryInit.scale.z
                  );

                  selectedIds.forEach(id => {
                      if (id === primarySelectedId) return;
                      const obj = scene.getObjectByName(id);
                      const init = initialTransforms.current.get(id);
                      
                      if (obj && init) {
                          if (transformMode === 'translate') {
                              obj.position.copy(init.pos.clone().add(deltaPos));
                          } else if (transformMode === 'rotate') {
                              obj.quaternion.copy(deltaQuat.clone().multiply(init.quat));
                          } else if (transformMode === 'scale') {
                              obj.scale.copy(init.scale.clone().multiply(scaleRatio));
                          }
                      }
                  });
              } else if (isGizmoEditMode && selectedIds.length === 1 && geometryWorldState.current) {
                   const desiredWorldPos = geometryWorldState.current.pos.clone();
                   const desiredWorldQuat = geometryWorldState.current.quat.clone();
                   
                   const newLocalPos = gizmoObj.worldToLocal(desiredWorldPos);
                   const invGroupQuat = gizmoObj.quaternion.clone().invert();
                   const newLocalQuat = invGroupQuat.multiply(desiredWorldQuat);
                   
                   const mesh = gizmoObj.children[0] as THREE.Mesh;
                   if (mesh) {
                       mesh.position.copy(newLocalPos);
                       mesh.quaternion.copy(newLocalQuat);
                   }
              }
          }
      };

      controls.addEventListener('dragging-changed', (event: any) => {
          if (event.value) onDragStart();
          else onDragEnd();
      });
      controls.addEventListener('change', onTransformChange);
      
      return () => {
          controls.removeEventListener('dragging-changed', onDragStart); 
          controls.removeEventListener('change', onTransformChange);
      };
    }
  }, [selectedIds, selectedObject, transformTarget, isGizmoEditMode, scene, pivotMode, transformMode, primarySelectedId, updateMultipleObjects, setIsTransforming, snapSettings, objects, hoveredSourceVertex]);

  const getGridTransform = (viewType: ViewportType) => {
    switch (viewType) {
        case 'front': return { rotation: [Math.PI / 2, 0, 0] as [number, number, number], position: [0, 0, -0.001] as [number, number, number] };
        case 'side': return { rotation: [0, 0, -Math.PI / 2] as [number, number, number], position: [-0.001, 0, 0] as [number, number, number] };
        case 'left': return { rotation: [0, 0, Math.PI / 2] as [number, number, number], position: [0.001, 0, 0] as [number, number, number] };
        case 'top':
        case 'perspective':
        default: return { rotation: [0, 0, 0] as [number, number, number], position: [0, -0.001, 0] as [number, number, number] };
    }
  };
  const gridTransform = getGridTransform(type);

  // Helper to render specific geometry
  const renderGeometry = (obj: SceneObject) => {
      switch(obj.geometry) {
          case 'sphere':
              return <sphereGeometry args={[obj.radius || 0.5, 32, 32]} />;
          case 'plane':
              return <planeGeometry args={[obj.dimensions.x, obj.dimensions.z]} />;
          case 'box':
          default:
              return <boxGeometry args={[obj.dimensions.x, obj.dimensions.y, obj.dimensions.z]} />;
      }
  };

  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[10, 10, 10]} intensity={1} />
      
      <group ref={selectionAnchorRef} name="selection-anchor" visible={true}>
      </group>
      
      {activeViewportId === viewportId && <CreationOverlay />}

      {isGridVisible && (
        <Grid 
          infiniteGrid 
          fadeDistance={50} 
          sectionColor="#505050" // Softer major lines
          cellColor="#303030"    // Softer minor lines
          position={gridTransform.position}
          rotation={gridTransform.rotation}
          cellSize={gridConfig.cell}
          sectionSize={gridConfig.section}
          raycast={() => null}
        />
      )}
      
      {/* Target Snap Marker (Yellow) - Reduced Size */}
      {snapMarker && (
          <mesh position={snapMarker}>
              <sphereGeometry args={[0.0015 * (1/Math.max(0.1, camera.zoom/500)), 8, 8]} />
              <meshBasicMaterial color="#ffff00" depthTest={false} transparent opacity={0.8} />
          </mesh>
      )}

      {/* Source Snap Marker (Blue) - Shows the vertex on the dragged object we are snapping from */}
      {sourceSnapMarker && (
          <mesh position={sourceSnapMarker}>
              <sphereGeometry args={[0.0015 * (1/Math.max(0.1, camera.zoom/500)), 8, 8]} />
              <meshBasicMaterial color="#00aaff" depthTest={false} transparent opacity={0.8} />
          </mesh>
      )}

      {/* Hover Source Preview Marker (Green) - Shows interactive vertex picking */}
      {hoveredSourceVertex && !isDragging.current && (
           <mesh position={hoveredSourceVertex}>
              <sphereGeometry args={[0.002 * (1/Math.max(0.1, camera.zoom/500)), 8, 8]} />
              <meshBasicMaterial color="#00ffaa" depthTest={false} transparent opacity={0.8} />
          </mesh>
      )}

      {objects.map((obj) => {
          const isSelected = selectedIds.includes(obj.id);
          const isPrimary = obj.id === primarySelectedId;

          return (
            <group
                key={obj.id}
                name={obj.id}
                position={[obj.position.x, obj.position.y, obj.position.z]}
                rotation={[obj.rotation.x, obj.rotation.y, obj.rotation.z]}
                scale={[obj.scale.x, obj.scale.y, obj.scale.z]}
                visible={obj.visible}
                onClick={(e) => {
                    if (interactionMode !== 'select') return;
                    e.stopPropagation();
                    // New: check if we should ignore this click due to drag end
                    if (ignoreSelectionClick.current) return;
                    selectObject(obj.id, e.shiftKey || e.ctrlKey); 
                }}
                onPointerOver={() => { if(interactionMode === 'select') document.body.style.cursor = 'pointer'; }}
                onPointerOut={() => { document.body.style.cursor = 'auto'; }}
            >
                <mesh
                    position={[obj.geometryOffset.x, obj.geometryOffset.y, obj.geometryOffset.z]}
                    rotation={[
                        obj.geometryRotation ? obj.geometryRotation.x : 0, 
                        obj.geometryRotation ? obj.geometryRotation.y : 0, 
                        obj.geometryRotation ? obj.geometryRotation.z : 0
                    ]}
                >
                    {renderGeometry(obj)}
                    <meshNormalMaterial wireframe={false} />
                </mesh>
                
                {isSelected && interactionMode === 'select' && (
                    <axesHelper args={[gizmoSize * (isPrimary ? 1.5 : 1.0)]} raycast={() => null} />
                )}
            </group>
        );
      })}

      {primarySelectedId && selectedObject && selectedObject.visible && activeViewportId === viewportId && transformTarget && interactionMode === 'select' && (
        <TransformControls
          ref={transformRef}
          object={transformTarget}
          mode={transformMode}
          space={transformSpace}
          size={gizmoSize}
          translationSnap={snapSettings.enabled && snapSettings.grid ? gridConfig.cell : null}
        />
      )}
    </>
  );
};

export const Viewport3D: React.FC<Viewport3DProps> = ({ id, type, label }) => {
  const { activeViewportId, setActiveViewport, selectObject, setSelection, interactionMode, drawingPhase, objects, selectedIds } = useAppStore();
  const isActive = activeViewportId === id;
  const [isBoxSelecting, setIsBoxSelecting] = useState(false);
  const [boxStart, setBoxStart] = useState<{x: number, y: number} | null>(null);
  const [boxCurrent, setBoxCurrent] = useState<{x: number, y: number} | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  const getCameraProps = () => {
    switch (type) {
      case 'top': return { position: [0, 0.5, 0] as [number, number, number], up: [0, 0, -1] as [number, number, number], zoom: 500 };
      case 'front': return { position: [0, 0, 0.5] as [number, number, number], zoom: 500 };
      case 'side': return { position: [0.5, 0, 0] as [number, number, number], zoom: 500 };
      case 'left': return { position: [-0.5, 0, 0] as [number, number, number], zoom: 500 };
      default: return { position: [0.3, 0.3, 0.3] as [number, number, number], fov: 50 };
    }
  };
  const camProps = getCameraProps();
  const isOrtho = type !== 'perspective';

  const orbitEnabled = (interactionMode === 'select' || drawingPhase === 'drawing_height') && !isBoxSelecting;

  const handlePointerDown = (e: React.PointerEvent) => {
      setActiveViewport(id);
      
      if (e.button === 0 && interactionMode === 'select') {
         const rect = canvasRef.current?.getBoundingClientRect();
         if(rect) {
             setBoxStart({ x: e.clientX - rect.left, y: e.clientY - rect.top });
             setBoxCurrent({ x: e.clientX - rect.left, y: e.clientY - rect.top });
             setIsBoxSelecting(true);
         }
      }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
      if (isBoxSelecting && boxStart) {
        const rect = canvasRef.current?.getBoundingClientRect();
        if(rect) {
            setBoxCurrent({ x: e.clientX - rect.left, y: e.clientY - rect.top });
        }
      }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
      if (useAppStore.getState().isTransforming) {
          setIsBoxSelecting(false);
          setBoxStart(null);
          setBoxCurrent(null);
          return;
      }

      if (isBoxSelecting && boxStart && boxCurrent) {
          const rect = canvasRef.current?.getBoundingClientRect();
          if (rect) {
              const event = new CustomEvent('box-select', { 
                  detail: { 
                      viewportId: id,
                      start: boxStart, 
                      end: boxCurrent,
                      rect: { width: rect.width, height: rect.height },
                      additive: e.shiftKey || e.ctrlKey
                  } 
              });
              window.dispatchEvent(event);
          }

          setIsBoxSelecting(false);
          setBoxStart(null);
          setBoxCurrent(null);
      }
  };
  
  const BoxSelectionCalculator = () => {
      const { camera, scene, size } = useThree();
      
      useEffect(() => {
          const handler = (e: Event) => {
             const ce = e as CustomEvent;
             if (ce.detail.viewportId !== id) return;
             
             const { start, end, rect, additive } = ce.detail;
             
             // Selection Rect in Canvas Coordinates
             const selLeft = Math.min(start.x, end.x);
             const selRight = Math.max(start.x, end.x);
             const selTop = Math.min(start.y, end.y);
             const selBottom = Math.max(start.y, end.y);
             
             const newSelectedIds: string[] = [];
             
             objects.forEach(obj => {
                 const threeObj = scene.getObjectByName(obj.id);
                 if (threeObj) {
                     // Get World Bounding Box (includes children/mesh)
                     const box = new THREE.Box3().setFromObject(threeObj);
                     
                     if (box.isEmpty()) {
                        // Fallback for empty objects (unlikely in this app but good safety)
                        const pos = threeObj.position.clone();
                        pos.project(camera);
                        const x = (pos.x * .5 + .5) * size.width;
                        const y = (-(pos.y * .5) + .5) * size.height;
                        if (x >= selLeft && x <= selRight && y >= selTop && y <= selBottom) {
                            newSelectedIds.push(obj.id);
                        }
                        return;
                     }

                     // Project all 8 corners to screen space
                     const corners = [
                        new THREE.Vector3(box.min.x, box.min.y, box.min.z),
                        new THREE.Vector3(box.min.x, box.min.y, box.max.z),
                        new THREE.Vector3(box.min.x, box.max.y, box.min.z),
                        new THREE.Vector3(box.min.x, box.max.y, box.max.z),
                        new THREE.Vector3(box.max.x, box.min.y, box.min.z),
                        new THREE.Vector3(box.max.x, box.min.y, box.max.z),
                        new THREE.Vector3(box.max.x, box.max.y, box.min.z),
                        new THREE.Vector3(box.max.x, box.max.y, box.max.z),
                     ];

                     let objMinX = Infinity;
                     let objMaxX = -Infinity;
                     let objMinY = Infinity;
                     let objMaxY = -Infinity;

                     corners.forEach(v => {
                        v.project(camera);
                        const x = (v.x * 0.5 + 0.5) * size.width;
                        const y = (-(v.y * 0.5) + 0.5) * size.height;
                        
                        objMinX = Math.min(objMinX, x);
                        objMaxX = Math.max(objMaxX, x);
                        objMinY = Math.min(objMinY, y);
                        objMaxY = Math.max(objMaxY, y);
                     });

                     // AABB Intersection Check (Crossing Selection)
                     // Overlap logic: NOT (one is to the left, or right, or top, or bottom of the other)
                     const overlaps = !(objMaxX < selLeft || objMinX > selRight || objMaxY < selTop || objMinY > selBottom);

                     if (overlaps) {
                         newSelectedIds.push(obj.id);
                     }
                 }
             });
             
             if (additive) {
                 const current = useAppStore.getState().selectedIds;
                 const combined = Array.from(new Set([...current, ...newSelectedIds]));
                 setSelection(combined);
             } else {
                 if (Math.abs(selRight - selLeft) > 5 && Math.abs(selBottom - selTop) > 5) {
                    setSelection(newSelectedIds);
                 }
             }
          };
          
          window.addEventListener('box-select', handler);
          return () => window.removeEventListener('box-select', handler);
      }, [camera, scene, size, objects]);
      
      return null;
  };

  return (
    <div 
      ref={canvasRef}
      className={`relative w-full h-full border ${isActive ? 'border-accent-500 border-2' : 'border-gray-700'}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="absolute top-2 left-2 z-10 px-2 py-0.5 bg-black/60 text-gray-300 text-xs rounded uppercase font-medium pointer-events-none">
        {label}
      </div>
      
      {isBoxSelecting && <SelectionBoxOverlay start={boxStart} current={boxCurrent} />}
      
      <Canvas 
        className="w-full h-full bg-[#1a1a1a]"
        onPointerMissed={(e) => { 
            if(!isBoxSelecting && interactionMode === 'select' && !e.shiftKey) {
                 selectObject(null); 
            }
        }}
      >
        <BoxSelectionCalculator />
        {isOrtho ? (
          <OrthographicCamera makeDefault position={camProps.position} up={camProps.up} zoom={camProps.zoom} />
        ) : (
          <PerspectiveCamera makeDefault position={camProps.position} fov={50} />
        )}
        
        <OrbitControls 
          makeDefault 
          enabled={orbitEnabled}
          enableRotate={!isOrtho}
          enableDamping 
          dampingFactor={0.1}
          mouseButtons={{
              LEFT: undefined,
              MIDDLE: THREE.MOUSE.PAN,
              RIGHT: THREE.MOUSE.ROTATE
          }}
        />
        
        <SceneContent viewportId={id} type={type} />
      </Canvas>
    </div>
  );
};
