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
  selectedId: 'cube-1',
  clipboard: null,
  pasteRequest: false,
  viewportLayout: 4,
  activeViewportId: 0,
  // Default configuration for up to 4 viewports
  viewportConfigs: {
    0: 'top',
    1: 'perspective',
    2: 'front',
    3: 'side'
  },
  // Default grid state for viewports
  viewportGridStates: {
    0: true,
    1: true,
    2: true,
    3: true
  },
  transformMode: 'translate',
  transformSpace: 'local',
  isGizmoEditMode: false,
  gizmoSize: 0.5, // Smaller default because object is 0.1
  pivotCommand: null,
  unit: 'cm', // Default unit
  history: [JSON.parse(JSON.stringify(INITIAL_OBJECTS))],
  historyIndex: 0,

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
  
  selectObject: (id) => set({ selectedId: id }),
  
  deleteSelected: () => {
    const { selectedId, objects, history, historyIndex } = get();
    if (!selectedId) return;

    const newObjects = objects.filter(o => o.id !== selectedId);

    // Add to history
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(JSON.parse(JSON.stringify(newObjects)));
    
    set({
        objects: newObjects,
        selectedId: null,
        history: newHistory,
        historyIndex: newHistory.length - 1
    });
  },
  
  updateObject: (id, changes, recordHistory = true) => {
    const { objects, history, historyIndex } = get();
    
    // Create new objects array
    const newObjects = objects.map(obj => 
      obj.id === id ? { ...obj, ...changes } : obj
    );

    const newState: Partial<AppState> = { objects: newObjects };

    if (recordHistory) {
      const newHistory = history.slice(0, historyIndex + 1);
      newHistory.push(JSON.parse(JSON.stringify(newObjects)));
      
      // Limit history size
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
    const { selectedId, objects } = get();
    if (!selectedId) return;
    
    const objToCopy = objects.find(o => o.id === selectedId);
    if (objToCopy) {
        set({ clipboard: JSON.parse(JSON.stringify(objToCopy)) });
    }
  },

  setRequestPaste: (active) => set({ pasteRequest: active }),

  paste: (position) => {
    const { clipboard, objects, history, historyIndex } = get();
    if (!clipboard) return;

    // Deep clone clipboard to create new instance
    const newObj = JSON.parse(JSON.stringify(clipboard));
    
    // Generate new ID
    const randomId = Math.random().toString(36).substr(2, 9);
    newObj.id = `${newObj.geometry || 'obj'}-${randomId}`;

    // --- SMART NAMING LOGIC (Cube -> Cube_01 -> Cube_02) ---
    // 1. Identify Base Name (e.g., "Cube_05" -> "Cube")
    const nameMatch = newObj.name.match(/^(.*)_(\d+)$/);
    let baseName = newObj.name;
    if (nameMatch) {
        baseName = nameMatch[1];
    }

    // 2. Find max suffix for this base name
    let maxSuffix = 0;
    // If the base name itself exists (e.g. "Cube"), we start counting from 1
    const baseExists = objects.some(o => o.name === baseName);
    
    const regex = new RegExp(`^${baseName}_(\\d+)$`);
    
    objects.forEach(obj => {
        const match = obj.name.match(regex);
        if (match) {
            const num = parseInt(match[1]);
            if (num > maxSuffix) maxSuffix = num;
        }
    });

    // If we only have "Cube", maxSuffix is 0, so next is 01.
    // If we have "Cube_02", maxSuffix is 2, next is 03.
    const nextSuffix = maxSuffix + 1;
    newObj.name = `${baseName}_${nextSuffix.toString().padStart(2, '0')}`;
    
    // --- POSITIONING ---
    if (position) {
        newObj.position.x = position.x;
        newObj.position.y = position.y;
        newObj.position.z = position.z;
    } else {
        // Fallback: Offset position slightly to make duplication visible
        newObj.position.x += 0.1;
        newObj.position.z += 0.1;
    }

    const newObjects = [...objects, newObj];

    // Add to history
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(JSON.parse(JSON.stringify(newObjects)));
    
    set({
        objects: newObjects,
        selectedId: newObj.id, // Select the new object
        history: newHistory,
        historyIndex: newHistory.length - 1,
        pasteRequest: false // Reset request flag
    });
  },

  recordHistory: () => {
    const { objects, history, historyIndex } = get();
    const newHistory = history.slice(0, historyIndex + 1);
    // Only push if different
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
        objects: JSON.parse(JSON.stringify(history[newIndex]))
      });
    }
  },

  redo: () => {
    const { historyIndex, history } = get();
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      set({
        historyIndex: newIndex,
        objects: JSON.parse(JSON.stringify(history[newIndex]))
      });
    }
  }
}));