
import { create } from 'zustand';
import { AppState, EditOperation, EditSelection, MeshData, SceneObject, SubObjectMode, Vector3Data } from './types';
import {
  activeVertexIndices,
  applyEditOperation,
  cloneMesh,
  createMesh,
  edgeKey,
  emptySelection,
  growSelection,
  invertSelection,
  joinMeshes,
  meshBounds,
  parseEdgeKey,
  primitiveToMesh,
  selectAll as selectAllElementsOf,
  selectLinked,
  separateMesh,
  shrinkSelection,
  transformMesh,
} from './editGeometry';

const cloneObjects = (objects: SceneObject[]): SceneObject[] => JSON.parse(JSON.stringify(objects));

/** Appends an objects snapshot to the undo stack and commits extra state. */
const pushObjects = (
  set: (partial: Partial<AppState>) => void,
  get: () => AppState,
  objects: SceneObject[],
  extra: Partial<AppState> = {}
) => {
  const { history, historyIndex } = get();
  const nextHistory = history.slice(0, historyIndex + 1);
  nextHistory.push(cloneObjects(objects));
  if (nextHistory.length > 60) nextHistory.shift();
  set({
    objects,
    history: nextHistory,
    historyIndex: nextHistory.length - 1,
    ...extra,
  });
};

const randomId = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 11)}`;

// Internal Unit = 1 Meter
// Initial Cube: 10cm x 10cm x 10cm
// 10cm = 0.1m
const INITIAL_OBJECTS: SceneObject[] = [
  {
    id: 'cube-1',
    name: 'Cube',
    type: 'mesh',
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 }, // Scale is a multiplier (default 1)
    dimensions: { x: 0.1, y: 0.1, z: 0.1 }, // Actual size: 0.1m (10cm)
    geometryOffset: { x: 0, y: 0, z: 0 },
    geometryRotation: { x: 0, y: 0, z: 0 },
    visible: true,
    geometry: 'box',
    color: '#4a90d9'
  }
];

export const useAppStore = create<AppState>((set, get) => ({
  objects: JSON.parse(JSON.stringify(INITIAL_OBJECTS)),
  selectedIds: ['cube-1'],
  clipboard: null,
  pasteRequest: false,
  viewportLayout: 4,
  activeViewportId: 0,
  viewportConfigs: {
    0: 'top',
    1: 'perspective',
    2: 'front',
    3: 'side'
  },
  viewportGridStates: {
    0: true,
    1: true,
    2: true,
    3: true
  },
  transformMode: 'translate',
  transformSpace: 'local',
  isGizmoEditMode: false,
  isTransforming: false,
  gizmoSize: 1.0, // Increased default size
  pivotCommand: null,
  pivotMode: 'selection', // Default to Group/Selection Center
  snapSettings: {
      enabled: true,
      grid: true,
      vertex: true,
      midpoint: true,
      weld: true, // drop a snapped vertex onto its target and merge them
      radiusPx: 14,
      threshold: 0.002 // merge-by-distance tolerance in meters
  },
  unit: 'cm', 
  history: [JSON.parse(JSON.stringify(INITIAL_OBJECTS))],
  historyIndex: 0,
  
  interactionMode: 'select',
  drawingPhase: 'idle',
  drawingStartPoint: null,

  // --- Modelling / edit mode ---
  editorMode: 'object',
  editObjectId: null,
  subObjectMode: 'vertex',
  editSelection: { vertices: [], edges: [], faces: [] },
  hoverElement: null,
  modalTransform: null,
  modalReadout: null,
  snapSourceVertex: null,
  snapTarget: null,
  editBoxSelect: null,

  setViewportLayout: (layout) => set({ viewportLayout: layout }),
  
  setActiveViewport: (id) => set({ activeViewportId: id }),
  
  setViewportType: (id, type) => set((state) => ({
    viewportConfigs: { ...state.viewportConfigs, [id]: type }
  })),
  
  setTransformMode: (mode) => set({ transformMode: mode }),
  
  setTransformSpace: (space) => set({ transformSpace: space }),
  
  toggleGrid: () => set((state) => ({ 
    viewportGridStates: {
        ...state.viewportGridStates,
        [state.activeViewportId]: !state.viewportGridStates[state.activeViewportId]
    }
  })),
  
  toggleGizmoEditMode: () => set((state) => ({ isGizmoEditMode: !state.isGizmoEditMode })),

  setIsTransforming: (isTransforming) => set({ isTransforming }),

  updateGizmoSize: (delta) => set((state) => ({ 
    gizmoSize: Math.max(0.1, Math.min(5.0, state.gizmoSize + delta)) 
  })),
  
  setPivotCommand: (command) => set({ pivotCommand: command }),
  
  setPivotMode: (mode) => set({ pivotMode: mode }),

  toggleSnapEnabled: () => set((state) => ({ 
      snapSettings: { ...state.snapSettings, enabled: !state.snapSettings.enabled } 
  })),

  setSnapMode: (mode, active) => set((state) => ({
      snapSettings: { ...state.snapSettings, [mode]: active }
  })),

  setSnapRadius: (px) => set((state) => ({
      snapSettings: { ...state.snapSettings, radiusPx: Math.max(2, Math.min(60, px)) }
  })),

  setUnit: (unit) => set({ unit }),
  
  // --- SELECTION LOGIC ---
  
  selectObject: (id, multi = false) => {
      if (id === null) {
          if (!multi) set({ selectedIds: [] });
          return;
      }
      
      const { selectedIds } = get();
      
      if (multi) {
          // Toggle selection
          if (selectedIds.includes(id)) {
              set({ selectedIds: selectedIds.filter(sid => sid !== id) });
          } else {
              set({ selectedIds: [...selectedIds, id] });
          }
      } else {
          // Single select (replace)
          set({ selectedIds: [id] });
      }
  },

  setSelection: (ids) => set({ selectedIds: ids }),
  
  selectAll: () => set((state) => ({ selectedIds: state.objects.map(o => o.id) })),
  
  deselectAll: () => set({ selectedIds: [] }),
  
  deleteSelected: () => {
    const { selectedIds, objects, history, historyIndex } = get();
    if (selectedIds.length === 0) return;

    const newObjects = objects.filter(o => !selectedIds.includes(o.id));

    // Add to history
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(cloneObjects(newObjects));

    set({
        objects: newObjects,
        selectedIds: [],
        history: newHistory,
        historyIndex: newHistory.length - 1,
        ...(get().editObjectId && selectedIds.includes(get().editObjectId!)
          ? { editorMode: 'object' as const, editObjectId: null, editSelection: emptySelection() }
          : {}),
    });
  },
  
  updateObject: (id, changes, recordHistory = true) => {
    const { objects, history, historyIndex } = get();
    
    const newObjects = objects.map(obj => 
      obj.id === id ? { ...obj, ...changes } : obj
    );

    const newState: Partial<AppState> = { objects: newObjects };

    if (recordHistory) {
      const newHistory = history.slice(0, historyIndex + 1);
      newHistory.push(JSON.parse(JSON.stringify(newObjects)));
      if (newHistory.length > 50) newHistory.shift();
      newState.history = newHistory;
      newState.historyIndex = newHistory.length - 1;
    }

    set(newState);
  },

  updateMultipleObjects: (updates, recordHistory = true) => {
      const { objects, history, historyIndex } = get();
      
      // Create a map for faster lookup of changes
      const changesMap = new Map(updates.map(u => [u.id, u.changes]));
      
      const newObjects = objects.map(obj => {
          const changes = changesMap.get(obj.id);
          return changes ? { ...obj, ...changes } : obj;
      });

      const newState: Partial<AppState> = { objects: newObjects };

      if (recordHistory) {
        const newHistory = history.slice(0, historyIndex + 1);
        newHistory.push(JSON.parse(JSON.stringify(newObjects)));
        if (newHistory.length > 50) newHistory.shift();
        newState.history = newHistory;
        newState.historyIndex = newHistory.length - 1;
      }

      set(newState);
  },

  toggleVisibility: (id) => {
    const { objects, history, historyIndex } = get();
    const newObjects = objects.map(obj => 
      obj.id === id ? { ...obj, visible: !obj.visible } : obj
    );

    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(JSON.parse(JSON.stringify(newObjects)));

    set({ 
      objects: newObjects,
      history: newHistory,
      historyIndex: newHistory.length - 1
    });
  },

  duplicateSelected: () => {
    const { selectedIds, objects, history, historyIndex } = get();
    if (selectedIds.length === 0) return;
    const selected = objects.filter(obj => selectedIds.includes(obj.id));
    const duplicates = selected.map((obj, index) => ({
      ...JSON.parse(JSON.stringify(obj)),
      id: `${obj.geometry || 'obj'}-${crypto.randomUUID()}`,
      name: `${obj.name}_copy`,
      position: { ...obj.position, x: obj.position.x + 0.1, z: obj.position.z + 0.1 }
    }));
    const nextObjects = [...objects, ...duplicates];
    const nextHistory = history.slice(0, historyIndex + 1);
    nextHistory.push(JSON.parse(JSON.stringify(nextObjects)));
    set({ objects: nextObjects, selectedIds: duplicates.map(obj => obj.id), history: nextHistory, historyIndex: nextHistory.length - 1 });
  },

  copy: () => {
    const { selectedIds, objects } = get();
    if (selectedIds.length === 0) return;
    
    // Copy all selected objects
    const objsToCopy = objects.filter(o => selectedIds.includes(o.id));
    if (objsToCopy.length > 0) {
        set({ clipboard: JSON.parse(JSON.stringify(objsToCopy)) });
    }
  },

  setRequestPaste: (active) => set({ pasteRequest: active }),

  paste: (position) => {
    const { clipboard, objects, history, historyIndex } = get();
    if (!clipboard || clipboard.length === 0) return;

    const newObjectsToAdd: SceneObject[] = [];
    const newSelectedIds: string[] = [];
    
    // Calculate center of clipboard objects to apply offset relative to group
    let centerX = 0, centerY = 0, centerZ = 0;
    clipboard.forEach(obj => {
        centerX += obj.position.x;
        centerY += obj.position.y;
        centerZ += obj.position.z;
    });
    centerX /= clipboard.length;
    centerY /= clipboard.length;
    centerZ /= clipboard.length;

    clipboard.forEach(clipObj => {
        const newObj = JSON.parse(JSON.stringify(clipObj));
        
        // Generate new ID
        const randomId = Math.random().toString(36).substr(2, 9);
        newObj.id = `${newObj.geometry || 'obj'}-${randomId}`;

        // Naming
        const nameMatch = newObj.name.match(/^(.*)_(\d+)$/);
        let baseName = newObj.name;
        if (nameMatch) baseName = nameMatch[1];

        let maxSuffix = 0;
        const regex = new RegExp(`^${baseName}_(\\d+)$`);
        objects.forEach(obj => {
            const match = obj.name.match(regex);
            if (match) {
                const num = parseInt(match[1]);
                if (num > maxSuffix) maxSuffix = num;
            }
        });
        const nextSuffix = maxSuffix + 1;
        newObj.name = `${baseName}_${nextSuffix.toString().padStart(2, '0')}`;
        
        // Positioning
        if (position) {
            // Apply relative offset from center
            const offsetX = clipObj.position.x - centerX;
            const offsetY = clipObj.position.y - centerY;
            const offsetZ = clipObj.position.z - centerZ;
            
            newObj.position.x = position.x + offsetX;
            newObj.position.y = position.y + offsetY;
            newObj.position.z = position.z + offsetZ;
        } else {
            newObj.position.x += 0.1;
            newObj.position.z += 0.1;
        }
        
        newObjectsToAdd.push(newObj);
        newSelectedIds.push(newObj.id);
    });

    const newObjects = [...objects, ...newObjectsToAdd];
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(JSON.parse(JSON.stringify(newObjects)));
    
    set({
        objects: newObjects,
        selectedIds: newSelectedIds,
        history: newHistory,
        historyIndex: newHistory.length - 1,
        pasteRequest: false
    });
  },

  recordHistory: () => {
    const { objects, history, historyIndex } = get();
    const newHistory = history.slice(0, historyIndex + 1);
    const currentSnapshot = JSON.stringify(objects);
    const lastSnapshot = JSON.stringify(history[historyIndex]);
    
    if (currentSnapshot !== lastSnapshot) {
        newHistory.push(JSON.parse(currentSnapshot));
        set({ 
            history: newHistory,
            historyIndex: newHistory.length - 1
        });
    }
  },

  undo: () => {
    const { historyIndex, history, editObjectId } = get();
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      const objects = cloneObjects(history[newIndex]);
      const stillThere = editObjectId ? objects.some(o => o.id === editObjectId && o.mesh) : false;
      set({
        historyIndex: newIndex,
        objects,
        selectedIds: stillThere ? [editObjectId!] : [], // Clear selection on undo to avoid ghost references
        editSelection: emptySelection(),
        snapSourceVertex: null,
        snapTarget: null,
        modalTransform: null,
        ...(stillThere ? {} : { editorMode: 'object' as const, editObjectId: null }),
      });
    }
  },

  redo: () => {
    const { historyIndex, history, editObjectId } = get();
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      const objects = cloneObjects(history[newIndex]);
      const stillThere = editObjectId ? objects.some(o => o.id === editObjectId && o.mesh) : false;
      set({
        historyIndex: newIndex,
        objects,
        selectedIds: stillThere ? [editObjectId!] : [],
        editSelection: emptySelection(),
        snapSourceVertex: null,
        snapTarget: null,
        modalTransform: null,
        ...(stillThere ? {} : { editorMode: 'object' as const, editObjectId: null }),
      });
    }
  },

  // --- INTERACTION / DRAWING ACTIONS ---
  
  setInteractionMode: (mode) => set({
      interactionMode: mode,
      drawingPhase: 'idle',
      ...(mode === 'select' ? {} : { selectedIds: [], editorMode: 'object' as const, editObjectId: null, editSelection: emptySelection() }),
  }),
  
  startDrawing: (pos) => {
      const { interactionMode, objects } = get();
      
      const primitiveByMode: Record<string, { geometry: string; name: string }> = {
          create_cube: { geometry: 'box', name: 'Cube' },
          create_sphere: { geometry: 'sphere', name: 'Sphere' },
          create_plane: { geometry: 'plane', name: 'Plane' },
          create_cylinder: { geometry: 'cylinder', name: 'Cylinder' },
          create_cone: { geometry: 'cone', name: 'Cone' },
          create_torus: { geometry: 'torus', name: 'Torus' },
      };
      const primitive = primitiveByMode[interactionMode] || primitiveByMode.create_cube;
      const geometry = primitive.geometry;
      const namePrefix = primitive.name;

      let maxSuffix = 0;
      const regex = new RegExp(`^${namePrefix}_(\\d+)$`);
      objects.forEach(obj => {
          const match = obj.name.match(regex);
          if (match) {
            const num = parseInt(match[1]);
            if (num > maxSuffix) maxSuffix = num;
          }
      });
      const name = `${namePrefix}_${(maxSuffix + 1).toString().padStart(2, '0')}`;
      
      const newObj: SceneObject = {
        id: `${geometry}-${Math.random().toString(36).substr(2, 9)}`,
        name,
        type: 'mesh',
        geometry,
        visible: true,
        position: { ...pos },
        rotation: interactionMode === 'create_plane' ? { x: -Math.PI / 2, y: 0, z: 0 } : { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        dimensions: { x: 0.01, y: 0.01, z: 0.01 },
        radius: 0.01,
        geometryOffset: { x: 0, y: 0, z: 0 },
        geometryRotation: { x: 0, y: 0, z: 0 },
        color: '#4a90d9'
      };
      
      set({ 
          objects: [...objects, newObj],
          selectedIds: [newObj.id],
          drawingStartPoint: pos,
          drawingPhase: 'drawing_base'
      });
  },
  
  updateDrawing: (pos) => {
    const { drawingPhase, drawingStartPoint, selectedIds, objects, interactionMode } = get();
    if (!drawingStartPoint || selectedIds.length === 0) return;

    const activeId = selectedIds[0];

    const newObjects = objects.map(obj => {
        if (obj.id !== activeId) return obj;
        
        const updatedObj = { ...obj };
        
        if (drawingPhase === 'drawing_base') {
            const dx = pos.x - drawingStartPoint.x;
            const dz = pos.z - drawingStartPoint.z;
            
            const radial = interactionMode === 'create_sphere'
                || interactionMode === 'create_cylinder'
                || interactionMode === 'create_cone'
                || interactionMode === 'create_torus';

            if (radial) {
                const dist = Math.sqrt(dx*dx + dz*dz);
                updatedObj.radius = dist;
                updatedObj.dimensions = { x: dist * 2, y: interactionMode === 'create_torus' ? dist * 0.7 : 0.01, z: dist * 2 };
                updatedObj.position = { ...drawingStartPoint }; 
            } else {
                updatedObj.dimensions = { 
                    x: Math.abs(dx), 
                    y: 0.01,
                    z: Math.abs(dz) 
                };
                updatedObj.position = {
                    x: drawingStartPoint.x + dx / 2,
                    y: drawingStartPoint.y,
                    z: drawingStartPoint.z + dz / 2
                };
            }
        } else if (drawingPhase === 'drawing_height') {
            const height = pos.y - drawingStartPoint.y;
            if (interactionMode === 'create_torus') {
                // second drag sets the tube radius
                const tube = Math.min(Math.abs(height), (updatedObj.radius || 0.01) * 0.9);
                updatedObj.dimensions = { ...updatedObj.dimensions, y: tube * 2 };
            } else {
                updatedObj.dimensions = {
                    ...updatedObj.dimensions,
                    y: Math.abs(height)
                };
                updatedObj.position = {
                    ...updatedObj.position,
                    y: drawingStartPoint.y + height / 2
                };
            }
        }
        
        return updatedObj;
    });

    set({ objects: newObjects });
  },
  
  stopDrawingBase: () => {
      const { interactionMode, recordHistory } = get();
      
      const needsHeight = interactionMode === 'create_cube'
          || interactionMode === 'create_cylinder'
          || interactionMode === 'create_cone'
          || interactionMode === 'create_torus';

      if (needsHeight) {
          set({ drawingPhase: 'drawing_height' });
      } else {
          recordHistory();
          set({ drawingPhase: 'idle', drawingStartPoint: null, interactionMode: 'select' });
      }
  },
  
  finishDrawing: () => {
      const { recordHistory } = get();
      recordHistory();
      set({ drawingPhase: 'idle', drawingStartPoint: null, interactionMode: 'select' });
  },

  cancelDrawing: () => {
      const { drawingPhase, selectedIds, objects } = get();
      if (drawingPhase === 'idle') return;
      const nextObjects = objects.filter(obj => !selectedIds.includes(obj.id));
      set({ objects: nextObjects, selectedIds: [], drawingPhase: 'idle', drawingStartPoint: null, interactionMode: 'select' });
  },

  /* ------------------------------------------------------------------ *
   * MODELLING (Blender / 3ds Max style edit mode)
   * ------------------------------------------------------------------ */

  convertToMesh: (id) => {
      const { objects } = get();
      const obj = objects.find(o => o.id === id);
      if (!obj || obj.mesh) return;
      const mesh = primitiveToMesh(obj);
      const bounds = meshBounds(mesh);
      pushObjects(set, get, objects.map(o => o.id === id ? {
          ...o,
          mesh,
          editable: true,
          geometry: 'mesh',
          geometryOffset: { x: 0, y: 0, z: 0 },
          geometryRotation: { x: 0, y: 0, z: 0 },
          dimensions: bounds.size,
      } : o));
  },

  enterEditMode: (id) => {
      const state = get();
      const targetId = id ?? state.selectedIds[state.selectedIds.length - 1];
      if (!targetId) return;
      const obj = state.objects.find(o => o.id === targetId);
      if (!obj) return;

      if (!obj.mesh) state.convertToMesh(targetId);

      const current = get().objects.find(o => o.id === targetId);
      if (!current || !current.mesh) return;

      const objects = get().objects.map(o => o.id === targetId ? { ...o, visible: true } : o);
      set({
          objects,
          editorMode: 'edit',
          editObjectId: targetId,
          selectedIds: [targetId],
          editSelection: emptySelection(),
          hoverElement: null,
          modalTransform: null,
          snapSourceVertex: null,
          snapTarget: null,
          interactionMode: 'select',
          drawingPhase: 'idle',
      });
  },

  exitEditMode: () => {
      const { editObjectId } = get();
      set({
          editorMode: 'object',
          editObjectId: null,
          editSelection: emptySelection(),
          hoverElement: null,
          modalTransform: null,
          snapSourceVertex: null,
          snapTarget: null,
          editBoxSelect: null,
          selectedIds: editObjectId ? [editObjectId] : [],
      });
  },

  toggleEditorMode: () => {
      const { editorMode, enterEditMode, exitEditMode } = get();
      if (editorMode === 'edit') exitEditMode();
      else enterEditMode();
  },

  setSubObjectMode: (mode) => set({ subObjectMode: mode, hoverElement: null }),

  setEditSelection: (selection, additive = false) => set((state) => {
      if (!additive) return { editSelection: { ...emptySelection(), ...selection } };
      const cur = state.editSelection;
      return {
          editSelection: {
              vertices: selection.vertices ? Array.from(new Set([...cur.vertices, ...selection.vertices])) : cur.vertices,
              edges: selection.edges ? Array.from(new Set([...cur.edges, ...selection.edges])) : cur.edges,
              faces: selection.faces ? Array.from(new Set([...cur.faces, ...selection.faces])) : cur.faces,
          },
      };
  }),

  toggleEditElement: (kind, key) => set((state) => {
      const sel = state.editSelection;
      if (kind === 'vertex') {
          const i = parseInt(key, 10);
          const has = sel.vertices.includes(i);
          return { editSelection: { ...sel, vertices: has ? sel.vertices.filter(v => v !== i) : [...sel.vertices, i] } };
      }
      if (kind === 'face') {
          const i = parseInt(key, 10);
          const has = sel.faces.includes(i);
          return { editSelection: { ...sel, faces: has ? sel.faces.filter(v => v !== i) : [...sel.faces, i] } };
      }
      const has = sel.edges.includes(key);
      return { editSelection: { ...sel, edges: has ? sel.edges.filter(k => k !== key) : [...sel.edges, key] } };
  }),

  clearEditSelection: () => set({ editSelection: emptySelection(), snapSourceVertex: null }),

  selectAllElements: () => {
      const state = get();
      const obj = state.objects.find(o => o.id === state.editObjectId);
      if (!obj || !obj.mesh) return;
      set({ editSelection: selectAllElementsOf(obj.mesh) });
  },

  invertEditSelection: () => {
      const state = get();
      const obj = state.objects.find(o => o.id === state.editObjectId);
      if (!obj || !obj.mesh) return;
      set({ editSelection: invertSelection(obj.mesh, state.editSelection) });
  },

  growEditSelection: () => {
      const state = get();
      const obj = state.objects.find(o => o.id === state.editObjectId);
      if (!obj || !obj.mesh) return;
      set({ editSelection: growSelection(obj.mesh, state.editSelection, state.subObjectMode) });
  },

  shrinkEditSelection: () => {
      const state = get();
      const obj = state.objects.find(o => o.id === state.editObjectId);
      if (!obj || !obj.mesh) return;
      set({ editSelection: shrinkSelection(obj.mesh, state.editSelection, state.subObjectMode) });
  },

  selectLinked: (seed) => {
      const state = get();
      const obj = state.objects.find(o => o.id === state.editObjectId);
      if (!obj || !obj.mesh) return;
      let seeds: number[] = [];
      if (seed !== undefined) seeds = [parseInt(seed, 10)];
      else if (state.editSelection.vertices.length > 0) seeds = state.editSelection.vertices;
      else if (state.hoverElement && state.hoverElement.kind === 'vertex') seeds = [parseInt(state.hoverElement.key, 10)];
      if (seeds.length === 0 || seeds.some(s => Number.isNaN(s))) return;
      set({ editSelection: selectLinked(obj.mesh, seeds) });
  },

  runEditOp: (op, recordHistory = true) => {
      const state = get();
      const id = state.editObjectId;
      if (!id) return;
      const obj = state.objects.find(o => o.id === id);
      if (!obj || !obj.mesh) return;

      const result = applyEditOperation(obj.mesh, state.editSelection, state.subObjectMode, op);
      if (!result.changed) return;

      const bounds = meshBounds(result.mesh);
      const objects = state.objects.map(o => o.id === id
          ? { ...o, mesh: result.mesh, dimensions: bounds.size }
          : o);

      const extra: Partial<AppState> = {
          editSelection: result.selection,
          snapTarget: null,
      };

      if (recordHistory) pushObjects(set, get, objects, extra);
      else set({ objects, ...extra });
  },

  setEditMesh: (mesh, recordHistory = true) => {
      const state = get();
      const id = state.editObjectId;
      if (!id) return;
      const bounds = meshBounds(mesh);
      const objects = state.objects.map(o => o.id === id
          ? { ...o, mesh, dimensions: bounds.size }
          : o);
      if (recordHistory) pushObjects(set, get, objects);
      else set({ objects });
  },

  setHoverElement: (el) => set({ hoverElement: el }),
  setModalTransform: (t) => set({ modalTransform: t, modalReadout: t ? { amount: 0, snapped: false } : null }),
  setModalReadout: (r) => set({ modalReadout: r }),
  setModalAxis: (axis) => set((state) => (state.modalTransform ? { modalTransform: { ...state.modalTransform, axis } } : {})),
  setSnapSourceVertex: (index) => set({ snapSourceVertex: index }),
  setSnapTarget: (t) => set({ snapTarget: t }),
  setEditBoxSelect: (box) => set({ editBoxSelect: box }),

  joinSelected: () => {
      const state = get();
      if (state.selectedIds.length < 2) return;
      const chosen = state.objects.filter(o => state.selectedIds.includes(o.id));
      const meshes = chosen.map(o => {
          const mesh = o.mesh ? cloneMesh(o.mesh) : primitiveToMesh(o);
          return transformMesh(mesh, { position: o.position, rotation: o.rotation, scale: o.scale });
      });
      const joined = joinMeshes(meshes);
      const bounds = meshBounds(joined);
      const newObj: SceneObject = {
          id: randomId('mesh'),
          name: `${chosen[0].name}_joined`,
          type: 'mesh',
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          dimensions: bounds.size,
          geometryOffset: { x: 0, y: 0, z: 0 },
          geometryRotation: { x: 0, y: 0, z: 0 },
          visible: true,
          geometry: 'mesh',
          color: chosen[0].color,
          mesh: joined,
          editable: true,
      };
      const rest = state.objects.filter(o => !state.selectedIds.includes(o.id));
      pushObjects(set, get, [...rest, newObj], {
          selectedIds: [newObj.id],
          editorMode: 'object',
          editObjectId: null,
          editSelection: emptySelection(),
      });
  },

  separateSelected: () => {
      const state = get();
      const id = state.editObjectId ?? state.selectedIds[state.selectedIds.length - 1];
      if (!id) return;
      const obj = state.objects.find(o => o.id === id);
      if (!obj || !obj.mesh) return;
      const parts = separateMesh(obj.mesh);
      if (parts.length < 2) return;

      const created: SceneObject[] = parts.map((mesh, i) => ({
          ...JSON.parse(JSON.stringify(obj)),
          id: randomId('mesh'),
          name: parts.length > 1 ? `${obj.name}_${(i + 1).toString().padStart(2, '0')}` : obj.name,
          mesh,
          editable: true,
          geometry: 'mesh',
          dimensions: meshBounds(mesh).size,
      }));
      const rest = state.objects.filter(o => o.id !== id);
      pushObjects(set, get, [...rest, ...created], {
          selectedIds: created.map(o => o.id),
          editorMode: 'object',
          editObjectId: null,
          editSelection: emptySelection(),
      });
  },
}));
