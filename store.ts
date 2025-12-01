
import { create } from 'zustand';
import { AppState, SceneObject } from './types';

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
    geometry: 'box'
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
  gizmoSize: 0.5,
  pivotCommand: null,
  unit: 'cm', 
  history: [JSON.parse(JSON.stringify(INITIAL_OBJECTS))],
  historyIndex: 0,
  
  interactionMode: 'select',
  drawingPhase: 'idle',
  drawingStartPoint: null,

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

  updateGizmoSize: (delta) => set((state) => ({ 
    gizmoSize: Math.max(0.1, Math.min(5.0, state.gizmoSize + delta)) 
  })),
  
  setPivotCommand: (command) => set({ pivotCommand: command }),

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
    newHistory.push(JSON.parse(JSON.stringify(newObjects)));
    
    set({
        objects: newObjects,
        selectedIds: [],
        history: newHistory,
        historyIndex: newHistory.length - 1
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
    const { historyIndex, history } = get();
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      set({
        historyIndex: newIndex,
        objects: JSON.parse(JSON.stringify(history[newIndex])),
        selectedIds: [] // Clear selection on undo to avoid ghost references
      });
    }
  },

  redo: () => {
    const { historyIndex, history } = get();
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      set({
        historyIndex: newIndex,
        objects: JSON.parse(JSON.stringify(history[newIndex])),
        selectedIds: []
      });
    }
  },

  // --- INTERACTION / DRAWING ACTIONS ---
  
  setInteractionMode: (mode) => set({ interactionMode: mode, drawingPhase: 'idle', selectedIds: [] }),
  
  startDrawing: (pos) => {
      const { interactionMode, objects } = get();
      
      let geometry = 'box';
      let namePrefix = 'Cube';
      
      if (interactionMode === 'create_sphere') {
          geometry = 'sphere';
          namePrefix = 'Sphere';
      } else if (interactionMode === 'create_plane') {
          geometry = 'plane';
          namePrefix = 'Plane';
      }

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
        geometryRotation: { x: 0, y: 0, z: 0 }
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
            
            if (interactionMode === 'create_sphere') {
                const dist = Math.sqrt(dx*dx + dz*dz);
                updatedObj.radius = dist;
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
        } else if (drawingPhase === 'drawing_height' && interactionMode === 'create_cube') {
            const height = pos.y - drawingStartPoint.y;
            updatedObj.dimensions = {
                ...updatedObj.dimensions,
                y: Math.abs(height)
            };
            updatedObj.position = {
                ...updatedObj.position,
                y: drawingStartPoint.y + height / 2
            };
        }
        
        return updatedObj;
    });

    set({ objects: newObjects });
  },
  
  stopDrawingBase: () => {
      const { interactionMode, recordHistory } = get();
      
      if (interactionMode === 'create_cube') {
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
  }
}));
