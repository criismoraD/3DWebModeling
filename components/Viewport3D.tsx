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
    pasteRequest, // State to check if paste is requested
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
  
  // Ref to store the initial WORLD state of the geometry before a drag starts
  const geometryWorldState = useRef<{ pos: THREE.Vector3, quat: THREE.Quaternion } | null>(null);

  const isGridVisible = viewportGridStates[viewportId];

  // Update transform target when selection changes or objects update
  useEffect(() => {
    if (selectedId) {
      // Find the actual THREE.Object3D in the scene graph (The Group)
      const obj = scene.getObjectByName(selectedId);
      setTransformTarget(obj);
    } else {
      setTransformTarget(undefined);
    }
  }, [selectedId, scene, objects]);

  // Handle Paste Request (Ctrl+V at Cursor)
  useEffect(() => {
    if (pasteRequest && activeViewportId === viewportId) {
        // Calculate Intersection with the Grid Plane
        raycaster.setFromCamera(pointer, camera);
        
        // Define plane based on view type (Grid orientation)
        const planeNormal = new THREE.Vector3();
        const planeConstant = 0; // Grid is at origin
        
        if (type === 'front') {
            // XY Plane
            planeNormal.set(0, 0, 1);
        } else if (type === 'side' || type === 'left') {
            // YZ Plane
            planeNormal.set(1, 0, 0);
        } else {
            // XZ Plane (Top, Perspective)
            planeNormal.set(0, 1, 0);
        }

        const plane = new THREE.Plane(planeNormal, planeConstant);
        const target = new THREE.Vector3();
        
        const intersection = raycaster.ray.intersectPlane(plane, target);
        
        if (intersection) {
            // Pass the calculated 3D position to the paste action
            paste({ x: target.x, y: target.y, z: target.z });
        } else {
            // Fallback if no intersection (e.g. looking away from grid)
            paste(); 
        }
    }
  }, [pasteRequest, activeViewportId, viewportId, type, raycaster, pointer, camera, paste]);

  // Handle Pivot Commands (Center, Bottom, Reset)
  useEffect(() => {
    if (pivotCommand && selectedId && activeViewportId === viewportId) {
        const group = scene.getObjectByName(selectedId);
        
        if (group && group.children.length > 0) {
            const mesh = group.children[0]; // The Geometry
            
            // 1. Capture current Mesh World State (Where it is physically)
            const meshWorldPos = new THREE.Vector3();
            const meshWorldQuat = new THREE.Quaternion();
            mesh.getWorldPosition(meshWorldPos);
            mesh.getWorldQuaternion(meshWorldQuat);

            // 2. Determine NEW Group (Pivot) Position/Rotation
            const newGroupPos = group.position.clone();
            const newGroupQuat = group.quaternion.clone();

            const bbox = new THREE.Box3().setFromObject(mesh); // World Bounding Box

            if (pivotCommand === 'center') {
                // Move pivot to Center of Bounds
                bbox.getCenter(newGroupPos);
                // Keep current rotation
            } else if (pivotCommand === 'bottom') {
                // Move pivot to Bottom Center of Bounds
                bbox.getCenter(newGroupPos);
                newGroupPos.y = bbox.min.y;
                // Keep current rotation
            } else if (pivotCommand === 'reset') {
                // Reset pivot to World Origin (0,0,0) and Identity Rotation
                newGroupPos.set(0, 0, 0);
                newGroupQuat.identity();
                // We keep scale as is (1,1,1 typically)
            }

            // 3. Calculate NEW Mesh Local Offsets to maintain Visual Position
            // We need to express `meshWorldPos` and `meshWorldQuat` relative to `newGroupPos` and `newGroupQuat`
            
            // Create dummy object to represent the new Group Transform
            const dummyParent = new THREE.Object3D();
            dummyParent.position.copy(newGroupPos);
            dummyParent.quaternion.copy(newGroupQuat);
            dummyParent.scale.copy(group.scale);
            dummyParent.updateMatrixWorld();

            // Transform Mesh World -> Local
            const newLocalPos = dummyParent.worldToLocal(meshWorldPos.clone());
            
            // Rotation: Local = InverseParent * World
            const invParentQuat = dummyParent.quaternion.clone().invert();
            const newLocalQuat = invParentQuat.multiply(meshWorldQuat);
            const newLocalEuler = new THREE.Euler().setFromQuaternion(newLocalQuat);

            // 4. Update Store
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

        // Clear command
        setPivotCommand(null);
    }
  }, [pivotCommand, selectedId, activeViewportId, viewportId, scene, updateObject, setPivotCommand]);

  // Sync transform controls with store history
  useEffect(() => {
    if (transformRef.current) {
      const controls = transformRef.current;
      
      const callback = (event: any) => {
         const dragging = event.value;
         
         if (dragging && selectedObject && transformTarget) {
            // DRAG STARTED
            // If in Gizmo Edit mode, we need to snapshot the exact world position of the visual mesh
            // so we can keep it there while the pivot moves.
            const group = transformTarget;
            // The mesh is the first child of the group
            const mesh = group.children[0];
            
            if (mesh) {
                const worldPos = new THREE.Vector3();
                const worldQuat = new THREE.Quaternion();
                mesh.getWorldPosition(worldPos);
                mesh.getWorldQuaternion(worldQuat);
                geometryWorldState.current = { pos: worldPos, quat: worldQuat };
            }
         } else if (!dragging && selectedObject) {
           // DRAG ENDED
           geometryWorldState.current = null;
           recordHistory();
         }
      };
      
      controls.addEventListener('dragging-changed', callback);
      return () => controls.removeEventListener('dragging-changed', callback);
    }
  }, [recordHistory, selectedObject, transformTarget]);

  const handleTransformChange = () => {
    // Check if controls and object exist before accessing
    if (transformRef.current && transformRef.current.object && selectedObject) {
      const group = transformRef.current.object;
      
      // Calculate changes
      const changes: Partial<SceneObject> = {
        position: { x: group.position.x, y: group.position.y, z: group.position.z },
        rotation: { x: group.rotation.x, y: group.rotation.y, z: group.rotation.z },
        scale: { x: group.scale.x, y: group.scale.y, z: group.scale.z }
      };

      // GIZMO EDIT MODE (Pivot Editing)
      // Logic: If we move/rotate the group (pivot), we must move/rotate the geometry (child) inversely
      // so that the geometry appears static in world space.
      if (isGizmoEditMode && geometryWorldState.current) {
         // Get where the mesh SHOULD be in world space
         const desiredWorldPos = geometryWorldState.current.pos.clone();
         const desiredWorldQuat = geometryWorldState.current.quat.clone();
         
         // Convert that World position/rotation to Local space relative to the NEW group transform
         const newLocalPos = group.worldToLocal(desiredWorldPos);
         
         // Inverse of Group Quat * Desired World Quat = New Local Quat
         const invGroupQuat = group.quaternion.clone().invert();
         const newLocalQuat = invGroupQuat.multiply(desiredWorldQuat);
         const newLocalEuler = new THREE.Euler().setFromQuaternion(newLocalQuat);

         // CRITICAL: Apply directly to the mesh object to prevent frame-lag vibration
         const mesh = group.children[0] as THREE.Mesh;
         if (mesh) {
             mesh.position.copy(newLocalPos);
             mesh.quaternion.copy(newLocalQuat);
         }

         // Update state
         changes.geometryOffset = { 
             x: newLocalPos.x, 
             y: newLocalPos.y, 
             z: newLocalPos.z 
         };
         
         changes.geometryRotation = {
             x: newLocalEuler.x,
             y: newLocalEuler.y,
             z: newLocalEuler.z
         };
      }

      updateObject(selectedObject.id, changes, false); // Don't record history on every frame
    }
  };

  // Grid Configuration based on Unit
  // Base unit = Meter
  const getGridConfig = () => {
    switch (unit) {
      case 'm': 
        return { cell: 1, section: 10 }; // Cell 1m, Section 10m
      case 'cm':
        // User wants 1cm lines to be the "white" lines (cell). 1cm = 0.01m
        return { cell: 0.01, section: 0.1 }; // Cell 1cm, Section 10cm
      case 'mm':
        // User wants 1mm lines. 1mm = 0.001m
        return { cell: 0.001, section: 0.01 }; // Cell 1mm, Section 10mm
      case 'in':
        // 1 inch = 0.0254m
        return { cell: 0.0254, section: 0.3048 }; // Cell 1in, Section 1ft
      default:
        return { cell: 1, section: 10 };
    }
  };

  const gridConfig = getGridConfig();

  // Determine grid orientation based on view type
  const getGridTransform = (viewType: ViewportType) => {
    switch (viewType) {
        case 'front':
            // XY Plane (Rotate X 90)
            return { rotation: [Math.PI / 2, 0, 0] as [number, number, number], position: [0, 0, -0.001] as [number, number, number] };
        case 'side':
            // YZ Plane (Rotate Z -90) - Faces +X (Right View)
            return { rotation: [0, 0, -Math.PI / 2] as [number, number, number], position: [-0.001, 0, 0] as [number, number, number] };
        case 'left':
            // YZ Plane (Rotate Z 90) - Faces -X (Left View)
            return { rotation: [0, 0, Math.PI / 2] as [number, number, number], position: [0.001, 0, 0] as [number, number, number] };
        case 'top':
        case 'perspective':
        default:
            // XZ Plane (Default)
            return { rotation: [0, 0, 0] as [number, number, number], position: [0, -0.001, 0] as [number, number, number] };
    }
  };

  const gridTransform = getGridTransform(type);

  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[10, 10, 10]} intensity={1} />
      
      {isGridVisible && (
        <Grid 
          infiniteGrid 
          fadeDistance={50} 
          sectionColor="#808080" // Bright White for major sections
          cellColor="#888888"    // Lighter Gray for the unit lines so they are clearly visible
          position={gridTransform.position}
          rotation={gridTransform.rotation}
          cellSize={gridConfig.cell}
          sectionSize={gridConfig.section}
          raycast={() => null} // Disable raycasting so the grid doesn't block clicks
        />
      )}

      {objects.map((obj) => (
        <group
            key={obj.id}
            name={obj.id} // The Group is the "Selectable" entity (Pivot)
            position={[obj.position.x, obj.position.y, obj.position.z]}
            rotation={[obj.rotation.x, obj.rotation.y, obj.rotation.z]}
            scale={[obj.scale.x, obj.scale.y, obj.scale.z]} // Scale applies to the group
            visible={obj.visible}
            onClick={(e) => {
                e.stopPropagation();
                selectObject(obj.id);
            }}
            onPointerOver={() => document.body.style.cursor = 'pointer'}
            onPointerOut={() => document.body.style.cursor = 'auto'}
        >
            {/* The Mesh is the visual geometry, offset from the pivot */}
            {/* BoxGeometry uses Dimensions for its size */}
            <mesh
                position={[obj.geometryOffset.x, obj.geometryOffset.y, obj.geometryOffset.z]}
                rotation={[
                    obj.geometryRotation ? obj.geometryRotation.x : 0, 
                    obj.geometryRotation ? obj.geometryRotation.y : 0, 
                    obj.geometryRotation ? obj.geometryRotation.z : 0
                ]}
            >
                <boxGeometry args={[
                    obj.dimensions ? obj.dimensions.x : 1,
                    obj.dimensions ? obj.dimensions.y : 1,
                    obj.dimensions ? obj.dimensions.z : 1
                ]} />
                <meshNormalMaterial />
            </mesh>
            
            {/* Visual Pivot Helper (Tiny Axis) */}
            {selectedId === obj.id && (
                <axesHelper args={[gizmoSize * 1.5]} raycast={() => null} />
            )}
        </group>
      ))}

      {/* Only show transform controls if this is the active viewport, object is selected, and target is found */}
      {selectedId && selectedObject && selectedObject.visible && activeViewportId === viewportId && transformTarget && (
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
  const { activeViewportId, setActiveViewport, selectObject } = useAppStore();
  const isActive = activeViewportId === id;

  const getCameraProps = () => {
    switch (type) {
      case 'top': return { position: [0, 0.5, 0] as [number, number, number], up: [0, 0, -1] as [number, number, number], zoom: 500 };
      case 'front': return { position: [0, 0, 0.5] as [number, number, number], zoom: 500 };
      case 'side': return { position: [0.5, 0, 0] as [number, number, number], zoom: 500 }; // Right
      case 'left': return { position: [-0.5, 0, 0] as [number, number, number], zoom: 500 }; // Left
      default: return { position: [0.3, 0.3, 0.3] as [number, number, number], fov: 50 };
    }
  };

  const camProps = getCameraProps();
  const isOrtho = type !== 'perspective';

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
        onPointerMissed={() => selectObject(null)} // Click background to deselect
      >
        {isOrtho ? (
          <OrthographicCamera makeDefault position={camProps.position} up={camProps.up} zoom={camProps.zoom} />
        ) : (
          <PerspectiveCamera makeDefault position={camProps.position} fov={50} />
        )}
        
        <OrbitControls 
          makeDefault 
          enableRotate={!isOrtho}
          enableDamping 
          dampingFactor={0.1}
        />
        
        <SceneContent viewportId={id} type={type} />
      </Canvas>
    </div>
  );
};