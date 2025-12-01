import { create } from 'zustand';
import { AppState, SceneObject } from './types';

const INITIAL_OBJECTS: SceneObject[] = [
  {
    id: 'cube-1',
    name: 'Cube',
    type: 'mesh',
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    geometryOffset: { x: 0, y: 0, z: 0 },
    geometryRotation: { x: 0, y: 0, z: 0 },
    visible: true,
    geometry: 'box'
  }
];

export const useAppStore = create<AppState>((set, get) => ({
  objects: JSON.parse(JSON.stringify(INITIAL_OBJECTS)),
  selectedId: 'cube-1',
  viewportLayout: 4,
  activeViewportId: 0,
  // Default configuration for up to 4 viewports
  viewportConfigs: {
    0: 'top',
    1: 'perspective',
    2: 'front',
    3: 'side'
  },
  transformMode: 'translate',
  transformSpace: 'local',
  gridVisible: true,
  isGizmoEditMode: false,
  history: [JSON.parse(JSON.stringify(INITIAL_OBJECTS))],
  historyIndex: 0,

  setViewportLayout: (layout) => set({ viewportLayout: layout }),
  
  setActiveViewport: (id) => set({ activeViewportId: id }),
  
  setViewportType: (id, type) => set((state) => ({
    viewportConfigs: { ...state.viewportConfigs, [id]: type }
  })),
  
  setTransformMode: (mode) => set({ transformMode: mode }),
  
  setTransformSpace: (space) => set({ transformSpace: space }),
  
  toggleGrid: () => set((state) => ({ gridVisible: !state.gridVisible })),
  
  toggleGizmoEditMode: () => set((state) => ({ isGizmoEditMode: !state.isGizmoEditMode })),
  
  selectObject: (id) => set({ selectedId: id }),
  
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