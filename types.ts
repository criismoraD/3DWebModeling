
export type ViewportType = 'perspective' | 'top' | 'front' | 'side' | 'left';
export type TransformMode = 'translate' | 'rotate' | 'scale';
export type TransformSpace = 'local' | 'world';
export type PivotCommand = 'center' | 'bottom' | 'reset' | null;
export type UnitType = 'mm' | 'cm' | 'm' | 'in';
export type InteractionMode = 'select' | 'create_cube' | 'create_sphere' | 'create_plane';
export type DrawingPhase = 'idle' | 'drawing_base' | 'drawing_height';

export interface Vector3Data {
  x: number;
  y: number;
  z: number;
}

export interface SceneObject {
  id: string;
  name: string;
  type: 'mesh' | 'group' | 'light';
  position: Vector3Data;
  rotation: Vector3Data; // Stored in radians
  scale: Vector3Data;
  dimensions: Vector3Data; // Actual size in meters (before scale)
  radius?: number; // For spheres
  geometryOffset: Vector3Data; // Offset of the mesh position relative to the pivot
  geometryRotation: Vector3Data; // Offset of the mesh rotation relative to the pivot
  visible: boolean;
  geometry?: string;
}

export interface AppState {
  objects: SceneObject[];
  selectedIds: string[]; // Changed from selectedId to array
  clipboard: SceneObject[] | null; // Stores the copied objects
  pasteRequest: boolean; // Signal to viewports to handle paste at cursor
  viewportLayout: 1 | 2 | 4;
  activeViewportId: number;
  viewportConfigs: Record<number, ViewportType>; // Configuration for each viewport ID
  viewportGridStates: Record<number, boolean>; // Grid visibility for each viewport ID
  transformMode: TransformMode;
  transformSpace: TransformSpace;
  isGizmoEditMode: boolean; // "D" key toggle
  gizmoSize: number; // Size of the transform gizmo
  pivotCommand: PivotCommand; // Command to manipulate pivot
  unit: UnitType; // Current display unit
  history: SceneObject[][]; // Simple undo stack (snapshots of objects array)
  historyIndex: number;
  
  // Interaction / Drawing
  interactionMode: InteractionMode;
  drawingPhase: DrawingPhase;
  drawingStartPoint: Vector3Data | null;
  
  // Actions
  setViewportLayout: (layout: 1 | 2 | 4) => void;
  setActiveViewport: (id: number) => void;
  setViewportType: (id: number, type: ViewportType) => void;
  setTransformMode: (mode: TransformMode) => void;
  setTransformSpace: (space: TransformSpace) => void;
  toggleGrid: () => void;
  toggleGizmoEditMode: () => void;
  updateGizmoSize: (delta: number) => void;
  setPivotCommand: (command: PivotCommand) => void;
  setUnit: (unit: UnitType) => void;
  
  // Selection Actions
  selectObject: (id: string | null, multi?: boolean) => void; // Multi flag for ctrl/shift click
  setSelection: (ids: string[]) => void;
  selectAll: () => void;
  deselectAll: () => void;

  deleteSelected: () => void;
  updateObject: (id: string, changes: Partial<SceneObject>, recordHistory?: boolean) => void;
  // New: Update multiple objects at once (for transforms)
  updateMultipleObjects: (updates: {id: string, changes: Partial<SceneObject>}[], recordHistory?: boolean) => void;

  toggleVisibility: (id: string) => void;
  undo: () => void;
  redo: () => void;
  recordHistory: () => void;
  copy: () => void;
  paste: (position?: Vector3Data) => void; // Updated to accept optional position
  setRequestPaste: (active: boolean) => void; // Trigger paste flow
  
  // Interaction Actions
  setInteractionMode: (mode: InteractionMode) => void;
  startDrawing: (pos: Vector3Data) => void;
  updateDrawing: (pos: Vector3Data) => void;
  stopDrawingBase: () => void; // Transition base -> height (Mouse Up)
  finishDrawing: () => void; // Finish creation (Click)
}
