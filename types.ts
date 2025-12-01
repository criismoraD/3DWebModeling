export type ViewportType = 'perspective' | 'top' | 'front' | 'side' | 'left';
export type TransformMode = 'translate' | 'rotate' | 'scale';
export type TransformSpace = 'local' | 'world';
export type PivotCommand = 'center' | 'bottom' | 'reset' | null;
export type UnitType = 'mm' | 'cm' | 'm' | 'in';

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
  geometryOffset: Vector3Data; // Offset of the mesh position relative to the pivot
  geometryRotation: Vector3Data; // Offset of the mesh rotation relative to the pivot
  visible: boolean;
  geometry?: string;
}

export interface AppState {
  objects: SceneObject[];
  selectedId: string | null;
  viewportLayout: 1 | 2 | 4;
  activeViewportId: number;
  viewportConfigs: Record<number, ViewportType>; // Configuration for each viewport ID
  transformMode: TransformMode;
  transformSpace: TransformSpace;
  gridVisible: boolean;
  isGizmoEditMode: boolean; // "D" key toggle
  gizmoSize: number; // Size of the transform gizmo
  pivotCommand: PivotCommand; // Command to manipulate pivot
  unit: UnitType; // Current display unit
  history: SceneObject[][]; // Simple undo stack (snapshots of objects array)
  historyIndex: number;
  
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
  selectObject: (id: string | null) => void;
  updateObject: (id: string, changes: Partial<SceneObject>, recordHistory?: boolean) => void;
  toggleVisibility: (id: string) => void;
  undo: () => void;
  redo: () => void;
  recordHistory: () => void;
}