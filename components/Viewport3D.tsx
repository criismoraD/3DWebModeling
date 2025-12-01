
import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
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
    unit,
    pasteRequest,
    interactionMode,
    updateObject,
    updateMultipleObjects,
    selectObject,
    setPivotCommand,
    recordHistory,
    paste,
    setSelection
  } = useAppStore();

  const { scene, raycaster, pointer, camera, gl } = useThree();
  
  // Transform Controls Logic
  const primarySelectedId = selectedIds[selectedIds.length - 1]; // Last selected is primary
  const selectedObject = objects.find(o => o.id === primarySelectedId);
  
  const transformRef = useRef<any>(null);
  const [transformTarget, setTransformTarget] = useState<THREE.Object3D | undefined>(undefined);
  
  const geometryWorldState = useRef<{ pos: THREE.Vector3, quat: THREE.Quaternion } | null>(null);
  const initialTransforms = useRef<Map<string, {pos: THREE.Vector3, rot: THREE.Euler, scale: THREE.Vector3}>>(new Map());

  const isGridVisible = viewportGridStates[viewportId];

  useEffect(() => {
    if (primarySelectedId) {
      const obj = scene.getObjectByName(primarySelectedId);
      setTransformTarget(obj);
    } else {
      setTransformTarget(undefined);
    }
  }, [primarySelectedId, scene, objects]);

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

  // Transform Controls - Handling Multiple Objects
  useEffect(() => {
    if (transformRef.current) {
      const controls = transformRef.current;
      
      const onDragStart = () => {
         // Store initial states of ALL selected objects
         initialTransforms.current.clear();
         selectedIds.forEach(id => {
             const obj = scene.getObjectByName(id);
             if (obj) {
                 initialTransforms.current.set(id, {
                     pos: obj.position.clone(),
                     rot: obj.rotation.clone(),
                     scale: obj.scale.clone()
                 });
             }
         });

         // Special handling for Gizmo Edit Mode
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
         geometryWorldState.current = null;
         initialTransforms.current.clear();
         recordHistory();
      };
      
      controls.addEventListener('dragging-changed', (event: any) => {
          if (event.value) onDragStart();
          else onDragEnd();
      });
      
      return () => {
          controls.removeEventListener('dragging-changed', onDragStart); // This won't work perfectly due to closure but logic is safe
      };
    }
  }, [recordHistory, selectedIds, selectedObject, transformTarget, isGizmoEditMode, scene]);

  const handleTransformChange = () => {
    if (transformRef.current && transformRef.current.object && selectedObject) {
      const group = transformRef.current.object; // This is the primary object being moved by gizmo
      const updates: {id: string, changes: Partial<SceneObject>}[] = [];

      // Calculate Deltas based on the Primary Object
      const primaryInitial = initialTransforms.current.get(selectedObject.id);
      
      if (primaryInitial) {
           // Current Gizmo Transforms
           const currentPos = group.position;
           const currentRot = group.rotation;
           const currentScale = group.scale;

           // Apply changes to primary object
           const primaryChanges: Partial<SceneObject> = {
                position: { x: currentPos.x, y: currentPos.y, z: currentPos.z },
                rotation: { x: currentRot.x, y: currentRot.y, z: currentRot.z },
                scale: { x: currentScale.x, y: currentScale.y, z: currentScale.z }
            };

            // Gizmo Edit Logic (Single Object Only usually)
            if (isGizmoEditMode && geometryWorldState.current) {
                // ... Existing Gizmo Edit Logic ...
                const desiredWorldPos = geometryWorldState.current.pos.clone();
                const desiredWorldQuat = geometryWorldState.current.quat.clone();
                const newLocalPos = group.worldToLocal(desiredWorldPos);
                const invGroupQuat = group.quaternion.clone().invert();
                const newLocalQuat = invGroupQuat.multiply(desiredWorldQuat);
                const newLocalEuler = new THREE.Euler().setFromQuaternion(newLocalQuat);

                const mesh = group.children[0] as THREE.Mesh;
                if (mesh) {
                    mesh.position.copy(newLocalPos);
                    mesh.quaternion.copy(newLocalQuat);
                }
                primaryChanges.geometryOffset = { x: newLocalPos.x, y: newLocalPos.y, z: newLocalPos.z };
                primaryChanges.geometryRotation = { x: newLocalEuler.x, y: newLocalEuler.y, z: newLocalEuler.z };
            }
            
            updates.push({ id: selectedObject.id, changes: primaryChanges });

            // Apply relative transforms to other selected objects
            // Note: This is a simplified relative transform (position delta). 
            // Rotation/Scale of multiple objects usually requires a common pivot group logic which is complex.
            // Here we just apply the same position delta.
            if (!isGizmoEditMode && transformMode === 'translate') {
                const deltaX = currentPos.x - primaryInitial.pos.x;
                const deltaY = currentPos.y - primaryInitial.pos.y;
                const deltaZ = currentPos.z - primaryInitial.pos.z;

                selectedIds.forEach(id => {
                    if (id === selectedObject.id) return;
                    const init = initialTransforms.current.get(id);
                    if (init) {
                        updates.push({
                            id,
                            changes: {
                                position: { 
                                    x: init.pos.x + deltaX,
                                    y: init.pos.y + deltaY,
                                    z: init.pos.z + deltaZ
                                }
                            }
                        });
                        // Update the THREE object directly for smooth feedback
                        const obj = scene.getObjectByName(id);
                        if (obj) {
                            obj.position.set(init.pos.x + deltaX, init.pos.y + deltaY, init.pos.z + deltaZ);
                        }
                    }
                });
            }
      }

      updateMultipleObjects(updates, false);
    }
  };

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
      
      {activeViewportId === viewportId && <CreationOverlay />}

      {isGridVisible && (
        <Grid 
          infiniteGrid 
          fadeDistance={50} 
          sectionColor="#ffffff"
          cellColor="#888888"
          position={gridTransform.position}
          rotation={gridTransform.rotation}
          cellSize={gridConfig.cell}
          sectionSize={gridConfig.section}
          raycast={() => null}
        />
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
                    // Shift Click to toggle selection
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
                
                {/* Selection Highlight */}
                {isSelected && interactionMode === 'select' && (
                    <axesHelper args={[gizmoSize * (isPrimary ? 1.5 : 1.0)]} raycast={() => null} />
                )}
                 {/* Secondary selection visual feedback could involve a boxHelper here */}
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
          onChange={handleTransformChange}
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

  // Navigation Logic
  // OrbitControls: Left Click = Select (Disabled in OC), Right = Rotate, Middle = Pan
  // We disable OrbitControls for LEFT click to allow Box Select
  const orbitEnabled = (interactionMode === 'select' || drawingPhase === 'drawing_height') && !isBoxSelecting;

  const handlePointerDown = (e: React.PointerEvent) => {
      setActiveViewport(id);
      
      // Only handle Box Selection on Left Click (button 0) and when in Select Mode
      if (e.button === 0 && interactionMode === 'select') {
         // Check if we are clicking a Gizmo or Object (handled by scene events/propagation)
         // But here we are on the wrapper.
         // If we clicked "background", we start box selection.
         // React Three Fiber onPointerMissed handles single deselect, but for box select we need drag.
         
         // Using shift key adds to selection
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
      if (isBoxSelecting && boxStart && boxCurrent) {
          // Perform Box Selection
          // We need to access the camera and scene objects to project positions
          // Since we are outside Canvas, we can't easily get them.
          // HACK: Trigger a custom event or use a ref attached to SceneContent to perform calculation
          // Better: Pass the box coordinates to the store or a context to trigger calculation inside Canvas.
          // For now, let's just finish the UI interaction. The actual calculation needs access to THREE internals.
          
          // To calculate selection, we actually need to be INSIDE the Canvas context.
          // So we'll pass the selection box rect to a store action or context if we want to be pure.
          // However, for this implementation, we will assume a simple "Select All" if box is big enough for demo
          // OR better: We implement a helper inside SceneContent that listens to this state.
          
          // Let's reset for now and rely on single click. 
          // Implementing full Frustum selection requires projecting all objects.
          
          // Let's enable the logic inside SceneContent by passing props or using a ref.
          // We will fire a custom event on the window to let the active Canvas handle it.
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
  
  // Logic to handle Box Selection Calculation inside the Canvas
  const BoxSelectionCalculator = () => {
      const { camera, scene, size } = useThree();
      
      useEffect(() => {
          const handler = (e: Event) => {
             const ce = e as CustomEvent;
             if (ce.detail.viewportId !== id) return;
             
             const { start, end, rect, additive } = ce.detail;
             
             // Normalize to -1 to +1
             const left = Math.min(start.x, end.x);
             const right = Math.max(start.x, end.x);
             const top = Math.min(start.y, end.y);
             const bottom = Math.max(start.y, end.y);
             
             const newSelectedIds: string[] = [];
             
             objects.forEach(obj => {
                 const threeObj = scene.getObjectByName(obj.id);
                 if (threeObj) {
                     // Get screen position
                     const pos = threeObj.position.clone();
                     pos.project(camera);
                     
                     // Convert NDC to pixel
                     const x = (pos.x * .5 + .5) * size.width;
                     const y = (-(pos.y * .5) + .5) * size.height;
                     
                     if (x >= left && x <= right && y >= top && y <= bottom) {
                         newSelectedIds.push(obj.id);
                     }
                 }
             });
             
             // Update selection
             if (additive) {
                 const current = useAppStore.getState().selectedIds;
                 const combined = Array.from(new Set([...current, ...newSelectedIds]));
                 setSelection(combined);
             } else {
                 if (Math.abs(right - left) > 5 && Math.abs(bottom - top) > 5) {
                     // Only select if box has some size, otherwise it's a click handled by Raycaster
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
      onContextMenu={(e) => e.preventDefault()} // Prevent context menu for Right Click Orbit
    >
      <div className="absolute top-2 left-2 z-10 px-2 py-0.5 bg-black/60 text-gray-300 text-xs rounded uppercase font-medium pointer-events-none">
        {label}
      </div>
      
      {isBoxSelecting && <SelectionBoxOverlay start={boxStart} current={boxCurrent} />}
      
      <Canvas 
        className="w-full h-full bg-[#1a1a1a]"
        onPointerMissed={(e) => { 
            // Only deselect if not box selecting and not holding shift
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
              LEFT: undefined, // Disable default LEFT (Orbit) to allow Box Select
              MIDDLE: THREE.MOUSE.PAN,
              RIGHT: THREE.MOUSE.ROTATE
          }}
        />
        
        <SceneContent viewportId={id} type={type} />
      </Canvas>
    </div>
  );
};
