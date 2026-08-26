
export type ViewportType = 'perspective' | 'top' | 'front' | 'side' | 'left';
export type TransformMode = 'translate' | 'rotate' | 'scale';
export type TransformSpace = 'local' | 'world';
export type PivotCommand = 'center' | 'bottom' | 'reset' | null;
export type PivotMode = 'selection' | 'individual'; // New: Group vs Individual transform
export type UnitType = 'mm' | 'cm' | 'm' | 'in';
export type InteractionMode =
  | 'select'
  | 'create_cube'
  | 'create_sphere'
  | 'create_plane'
  | 'create_cylinder'
  | 'create_cone'
  | 'create_torus';
export type DrawingPhase = 'idle' | 'drawing_base' | 'drawing_height';

// --- MODELLING (Blender / 3ds Max like) ---
export type EditorMode = 'object' | 'edit';
export type SubObjectMode = 'vertex' | 'edge' | 'face';
export type ModalTransformType = 'move' | 'rotate' | 'scale';
export type AxisLock = 'free' | 'x' | 'y' | 'z';
export type MergeMode = 'center' | 'first' | 'last' | 'cursor' | 'distance';
export type PrimitiveKind = 'box' | 'sphere' | 'plane' | 'cylinder' | 'cone' | 'torus';

export interface Vector3Data {
  x: number;
  y: number;
  z: number;
}

/**
 * Editable polygon mesh (local space, before the object transform).
 * Faces are ordered index loops (3+ verts) so quads/ngons stay editable.
 * `edges` holds loose edges (created by extruding vertices / "Create Edge").
 */
export interface MeshData {
  vertices: Vector3Data[];
  faces: number[][];
  edges: [number, number][];
}

/** What the pointer is currently over inside edit mode. */
export interface HoverElement {
  kind: SubObjectMode;
  /** vertex index / face index / "a-b" edge key */
  key: string;
  point: Vector3Data; // world space position of the element
}

/** Something the moving selection can snap onto. */
export interface SnapTarget {
  kind: 'vertex' | 'midpoint' | 'grid';
  point: Vector3Data; // world space
  objectId: string | null;
  vertexIndex: number | null; // index inside `objectId` mesh (vertex snaps only)
}

export interface SnapSettings {
  enabled: boolean;
  grid: boolean;
  vertex: boolean;
  midpoint: boolean; // edge midpoints
  weld: boolean; // merge source vertex into target vertex when dropping a snap
  radiusPx: number; // screen space snap radius in pixels
  threshold: number; // world units, used for "merge by distance"
}

/** Live Blender-style modal transform (G / R / S + axis lock). */
export interface ModalTransform {
  type: ModalTransformType;
  axis: AxisLock;
  objectId: string;
  sourceVertex: number | null; // mesh vertex index used as snap source
  amount: number; // distance (move) / degrees (rotate) / factor (scale)
  snapped: boolean;
}

/**
 * Per-frame readout of the running modal transform. Kept apart from
 * ModalTransform so updating it does not retrigger the transform effect.
 */
export interface ModalReadout {
  amount: number;
  snapped: boolean;
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
  color: string;
  /** Present once the object has been converted into an editable mesh. */
  mesh?: MeshData;
  /** True when `mesh` is authoritative (primitive params are frozen). */
  editable?: boolean;
}

/** Element selection inside edit mode. */
export interface EditSelection {
  vertices: number[];
  edges: string[];
  faces: number[];
}

/**
 * Declarative edit-mode operations. They are applied by the store through the
 * pure helpers in `editGeometry.ts` so they can be unit tested.
 */
export type EditOperation =
  | { type: 'set-vertices'; positions: Record<number, Vector3Data> }
  | { type: 'extrude' }
  | { type: 'delete' }
  | { type: 'merge'; mode: Exclude<MergeMode, 'distance'>; cursor?: Vector3Data }
  | { type: 'weld'; threshold: number }
  | { type: 'subdivide'; iterations?: number }
  | { type: 'create-face' }
  | { type: 'delete-loose' }
  | { type: 'flip-normals' }
  | { type: 'triangulate' }
  | { type: 'inset'; amount: number }
  | { type: 'mirror'; axis: 'x' | 'y' | 'z' };

export interface EditOperationResult {
  mesh: MeshData;
  selection: EditSelection;
  changed: boolean;
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
  isTransforming: boolean; // New: Track if user is currently dragging gizmo
  gizmoSize: number; // Size of the transform gizmo
  pivotCommand: PivotCommand; // Command to manipulate pivot
  pivotMode: PivotMode; // New state
  snapSettings: SnapSettings; // New: Snapping configuration
  unit: UnitType; // Current display unit
  history: SceneObject[][]; // Simple undo stack (snapshots of objects array)
  historyIndex: number;

  // Interaction / Drawing
  interactionMode: InteractionMode;
  drawingPhase: DrawingPhase;
  drawingStartPoint: Vector3Data | null;

  // --- Modelling / Edit mode ---
  editorMode: EditorMode;
  editObjectId: string | null;
  subObjectMode: SubObjectMode;
  editSelection: EditSelection;
  hoverElement: HoverElement | null;
  modalTransform: ModalTransform | null;
  modalReadout: ModalReadout | null;
  /** Snap source chosen before a drag ("grab this vertex, drop it on another"). */
  snapSourceVertex: number | null;
  snapTarget: SnapTarget | null;
  /** Box selection of sub-objects, driven by the viewport. */
  editBoxSelect: { start: { x: number; y: number }; current: { x: number; y: number } } | null;

  // Actions
  setViewportLayout: (layout: 1 | 2 | 4) => void;
  setActiveViewport: (id: number) => void;
  setViewportType: (id: number, type: ViewportType) => void;
  setTransformMode: (mode: TransformMode) => void;
  setTransformSpace: (space: TransformSpace) => void;
  toggleGrid: () => void;
  toggleGizmoEditMode: () => void;
  setIsTransforming: (isTransforming: boolean) => void; // New action
  updateGizmoSize: (delta: number) => void;
  setPivotCommand: (command: PivotCommand) => void;
  setPivotMode: (mode: PivotMode) => void; // New action
  toggleSnapEnabled: () => void;
  setSnapMode: (mode: 'grid' | 'vertex' | 'midpoint' | 'weld', active: boolean) => void;
  setSnapRadius: (px: number) => void;
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
  cancelDrawing: () => void;
  duplicateSelected: () => void;

  // --- Modelling actions ---
  enterEditMode: (id?: string) => void;
  exitEditMode: () => void;
  toggleEditorMode: () => void;
  setSubObjectMode: (mode: SubObjectMode) => void;
  convertToMesh: (id: string) => void; // "Make editable" (3ds Max style)
  setEditSelection: (selection: Partial<EditSelection>, additive?: boolean) => void;
  toggleEditElement: (kind: SubObjectMode, key: string) => void;
  clearEditSelection: () => void;
  selectAllElements: () => void;
  invertEditSelection: () => void;
  growEditSelection: () => void;
  shrinkEditSelection: () => void;
  selectLinked: (seed?: string) => void;
  runEditOp: (op: EditOperation, recordHistory?: boolean) => void;
  setEditMesh: (mesh: MeshData, recordHistory?: boolean) => void;
  setHoverElement: (el: HoverElement | null) => void;
  setModalTransform: (t: ModalTransform | null) => void;
  setModalReadout: (r: ModalReadout | null) => void;
  setModalAxis: (axis: AxisLock) => void;
  setSnapSourceVertex: (index: number | null) => void;
  setSnapTarget: (t: SnapTarget | null) => void;
  setEditBoxSelect: (box: AppState['editBoxSelect']) => void;
  joinSelected: () => void;
  separateSelected: () => void;
}
