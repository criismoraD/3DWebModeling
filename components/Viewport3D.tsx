
import React, { useRef, useEffect, useState } from 'react';
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
        selectedId,
        objects
    } = useAppStore();
    
    const { raycaster, pointer, camera, scene } = useThree();
    const planeRef = useRef<THREE.Mesh>(null);

    const handlePointerDown = (e: any) => {
        if (interactionMode === 'select') return;
        e.stopPropagation();
        
        if (drawingPhase === 'idle') {
            // Start Drawing (Click 1)
            startDrawing({ x: e.point.x, y: 0, z: e.point.z });
        } else if (drawingPhase === 'drawing_height') {
            // Finish Drawing (Click 2 for Cube)
            finishDrawing();
        }
    };

    const handlePointerMove = (e: any) => {
        if (interactionMode === 'select' || drawingPhase === 'idle') return;
        e.stopPropagation();
        
        // BASE PHASE: Raycast against Ground Plane
        if (drawingPhase === 'drawing_base') {
            updateDrawing({ x: e.point.x, y: 0, z: e.point.z });
        }
        // HEIGHT PHASE: Raycast against Vertical Plane
        else if (drawingPhase === 'drawing_height') {
            const selectedObj = objects.find(o => o.id === selectedId);
            if (!selectedObj) return;

            // Define a vertical plane passing through the object center, facing the camera roughly
            const center = new THREE.Vector3(selectedObj.position.x, 0, selectedObj.position.z);
            
            // Calculate a normal vector on the XZ plane that points towards camera
            const camPos = camera.position.clone();
            const normal = new THREE.Vector3(camPos.x - center.x, 0, camPos.z - center.z).normalize();
            
            // Create Plane
            const plane = new THREE.Plane();
            plane.setFromNormalAndCoplanarPoint(normal, center);
            
            // Raycast manually
            raycaster.setFromCamera(pointer, camera);
            const target = new THREE.Vector3();
            const intersection = raycaster.ray.intersectPlane(plane, target);
            
            if (intersection) {
                // Pass the height (Y) to the store
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
            visible={false} // Invisible but raycastable
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
        >
            <planeGeometry args={[1000, 1000]} />
            <meshBasicMaterial color="red" wireframe opacity={0.1} transparent />
        </mesh>
    );
};

const SceneContent: React.FC<{ viewportId: number; type: ViewportType }> = ({ viewportId, type }) => {
  const { 
    objects, 
    selectedId, 
    transformMode, 
    transformSpace, 
    viewportGridStates, 
    activeViewportId, 
    isGizmoEditMode,
    gizmoSize,
    pivotCommand,
    unit,
    pasteRequest,
    interactionMode, // Get interaction mode
    drawingPhase,    // Get phase
    updateObject,
    selectObject,
    setPivotCommand,
    recordHistory,
    paste,
    setRequestPaste
  } = useAppStore();

  const { scene, raycaster, pointer, camera } = useThree();
  const selectedObject = objects.find(o => o.id === selectedId);
  const transformRef = useRef<any>(null);
  const [transformTarget, setTransformTarget] = useState<THREE.Object3D | undefined>(undefined);
  
  const geometryWorldState = useRef<{ pos: THREE.Vector3, quat: THREE.Quaternion } | null>(null);

  const isGridVisible = viewportGridStates[viewportId];

  useEffect(() => {
    if (selectedId) {
      const obj = scene.getObjectByName(selectedId);
      setTransformTarget(obj);
    } else {
      setTransformTarget(undefined);
    }
  }, [selectedId, scene, objects]);

  // Paste Request Logic
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

  // Pivot Command Logic
  useEffect(() => {
    if (pivotCommand && selectedId && activeViewportId === viewportId) {
        const group = scene.getObjectByName(selectedId);
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

            updateObject(selectedId, {
                position: { x: newGroupPos.x, y: newGroupPos.y, z: newGroupPos.z },
                rotation: { 
                    x: new THREE.Euler().setFromQuaternion(newGroupQuat).x,
                    y: new THREE.Euler().setFromQuaternion(newGroupQuat).y,
                    z: new THREE.Euler().setFromQuaternion(newGroupQuat).z
                },
                geometryOffset: { x: newLocalPos.x, y: newLocalPos.y, z: newLocalPos.z },
                geometryRotation: { x: newLocalEuler.x, y: newLocalEuler.y, z: newLocalEuler.z }
            }, true);
        }
        setPivotCommand(null);
    }
  }, [pivotCommand, selectedId, activeViewportId, viewportId, scene, updateObject, setPivotCommand]);

  // Transform Controls Logic
  useEffect(() => {
    if (transformRef.current) {
      const controls = transformRef.current;
      const callback = (event: any) => {
         const dragging = event.value;
         if (dragging && selectedObject && transformTarget) {
            const group = transformTarget;
            const mesh = group.children[0];
            if (mesh) {
                const worldPos = new THREE.Vector3();
                const worldQuat = new THREE.Quaternion();
                mesh.getWorldPosition(worldPos);
                mesh.getWorldQuaternion(worldQuat);
                geometryWorldState.current = { pos: worldPos, quat: worldQuat };
            }
         } else if (!dragging && selectedObject) {
           geometryWorldState.current = null;
           recordHistory();
         }
      };
      controls.addEventListener('dragging-changed', callback);
      return () => controls.removeEventListener('dragging-changed', callback);
    }
  }, [recordHistory, selectedObject, transformTarget]);

  const handleTransformChange = () => {
    if (transformRef.current && transformRef.current.object && selectedObject) {
      const group = transformRef.current.object;
      const changes: Partial<SceneObject> = {
        position: { x: group.position.x, y: group.position.y, z: group.position.z },
        rotation: { x: group.rotation.x, y: group.rotation.y, z: group.rotation.z },
        scale: { x: group.scale.x, y: group.scale.y, z: group.scale.z }
      };

      if (isGizmoEditMode && geometryWorldState.current) {
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
         changes.geometryOffset = { x: newLocalPos.x, y: newLocalPos.y, z: newLocalPos.z };
         changes.geometryRotation = { x: newLocalEuler.x, y: newLocalEuler.y, z: newLocalEuler.z };
      }
      updateObject(selectedObject.id, changes, false);
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
              // Plane is usually created on XZ, flat. Dimensions X/Z
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
      
      {/* Creation Overlay only active when drawing */}
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

      {objects.map((obj) => (
        <group
            key={obj.id}
            name={obj.id}
            position={[obj.position.x, obj.position.y, obj.position.z]}
            rotation={[obj.rotation.x, obj.rotation.y, obj.rotation.z]}
            scale={[obj.scale.x, obj.scale.y, obj.scale.z]}
            visible={obj.visible}
            onClick={(e) => {
                if (interactionMode !== 'select') return; // Don't select while drawing
                e.stopPropagation();
                selectObject(obj.id);
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
            
            {/* Outline selection effect could go here */}

            {selectedId === obj.id && interactionMode === 'select' && (
                <axesHelper args={[gizmoSize * 1.5]} raycast={() => null} />
            )}
        </group>
      ))}

      {selectedId && selectedObject && selectedObject.visible && activeViewportId === viewportId && transformTarget && interactionMode === 'select' && (
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
  const { activeViewportId, setActiveViewport, selectObject, interactionMode, drawingPhase } = useAppStore();
  const isActive = activeViewportId === id;

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

  // Disable OrbitControls when drawing to avoid conflicts
  const orbitEnabled = interactionMode === 'select' || drawingPhase === 'drawing_height';

  return (
    <div 
      className={`relative w-full h-full border ${isActive ? 'border-accent-500 border-2' : 'border-gray-700'}`}
      onMouseDown={() => setActiveViewport(id)}
    >
      <div className="absolute top-2 left-2 z-10 px-2 py-0.5 bg-black/60 text-gray-300 text-xs rounded uppercase font-medium pointer-events-none">
        {label}
      </div>
      
      <Canvas 
        className="w-full h-full bg-[#1a1a1a]"
        onPointerMissed={() => { if(interactionMode === 'select') selectObject(null); }}
      >
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
        />
        
        <SceneContent viewportId={id} type={type} />
      </Canvas>
    </div>
  );
};
