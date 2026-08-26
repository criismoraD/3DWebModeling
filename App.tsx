
import React, { useEffect, useState } from 'react';
import { useAppStore } from './store';
import { Viewport3D } from './components/Viewport3D';
import { ViewportType, UnitType, SceneObject, SubObjectMode } from './types';
import { activeVertexIndices, meshBounds } from './editGeometry';
import { objectMatrix } from './components/snapping';
import * as THREE from 'three';
import { 
  Box, 
  Eye, 
  EyeOff, 
  Grid3X3, 
  Move, 
  RotateCw, 
  Scaling, 
  Undo, 
  Redo, 
  Globe, 
  BoxSelect, 
  FolderOpen,
  Anchor,
  AlignCenter,
  ArrowDownToLine,
  RefreshCcw,
  Ruler,
  Copy,
  Clipboard,
  Trash2,
  Square,
  Circle,
  Component,
  Layers,
  Disc,
  CircleDashed,
  Target,
  Hash,
  Magnet,
  Triangle,
  Boxes,
  Move3d,
  PenTool,
  Scissors,
  Combine,
  Split,
  Wand2,
  Crosshair,
  Hexagon,
  Dot,
  FlipHorizontal2,
  GitMerge,
  Layers3,
  Spline,
  Minus,
  Plus
} from 'lucide-react';

const getUnitFactor = (u: UnitType) => {
  switch (u) { case 'mm': return 1000; case 'cm': return 100; case 'in': return 39.3701; default: return 1; }
};

const HeaderButton: React.FC<{ 
  active?: boolean; 
  onClick: () => void; 
  title: string; 
  children: React.ReactNode 
}> = ({ active, onClick, title, children }) => (
  <button
    onClick={onClick}
    title={title}
    className={`p-1.5 rounded-md transition-all text-xs flex items-center gap-2 ${
      active 
        ? 'bg-accent-500 text-white shadow-sm' 
        : 'bg-gray-750 text-gray-400 hover:bg-gray-700 hover:text-white border border-gray-700'
    }`}
  >
    {children}
  </button>
);

const PropertyInput: React.FC<{ 
  label: string; 
  value: number; 
  color: string; 
  onChange: (val: number) => void;
  step?: number;
  conversionFactor?: number;
}> = ({ label, value, color, onChange, step = 0.1, conversionFactor = 1 }) => {
  const displayValue = value * conversionFactor;
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const newVal = parseFloat(e.target.value);
      if (!isNaN(newVal)) onChange(newVal / conversionFactor);
  };
  return (
    <div className="flex items-center gap-1 flex-1 bg-gray-850 border border-gray-700 rounded-sm overflow-hidden">
        <div className={`w-4 text-[10px] flex items-center justify-center font-bold ${color}`}>
        {label}
        </div>
        <input 
        type="number" 
        step={step}
        value={Number(displayValue).toFixed(3)}
        onChange={handleChange}
        className="w-full bg-transparent text-gray-300 text-[11px] p-1 focus:outline-none"
        />
    </div>
  );
};

// New Coordinate Input Component
const CoordinateInputBar: React.FC = () => {
    const { selectedIds, objects, updateMultipleObjects, transformMode, unit } = useAppStore();
    const [isRelative, setIsRelative] = useState(false);
    
    // Local state for inputs to allow typing before commit
    const [inputs, setInputs] = useState({ x: '0', y: '0', z: '0' });

    // When selection changes or mode changes, update inputs (Absolute only)
    useEffect(() => {
        if (!isRelative && selectedIds.length > 0) {
             const primary = objects.find(o => o.id === selectedIds[selectedIds.length - 1]);
             if (primary) {
                 const factor = getUnitFactor(unit);
                 let val = { x: 0, y: 0, z: 0 };
                 if (transformMode === 'translate') val = primary.position;
                 else if (transformMode === 'rotate') val = { x: toDeg(primary.rotation.x), y: toDeg(primary.rotation.y), z: toDeg(primary.rotation.z) };
                 else if (transformMode === 'scale') val = primary.scale;

                 // For Rotation/Scale, we handle differently, but let's assume standard behavior
                 setInputs({
                     x: (val.x * (transformMode === 'translate' ? factor : 1)).toFixed(3),
                     y: (val.y * (transformMode === 'translate' ? factor : 1)).toFixed(3),
                     z: (val.z * (transformMode === 'translate' ? factor : 1)).toFixed(3)
                 });
             }
        } else if (isRelative) {
            setInputs({ x: '0', y: '0', z: '0' });
        }
    }, [selectedIds, objects, transformMode, unit, isRelative]);

    const getUnitFactor = (u: UnitType) => {
        switch(u) { case 'mm': return 1000; case 'cm': return 100; case 'in': return 39.3701; default: return 1; }
    };
    const toDeg = (rad: number) => rad * (180 / Math.PI);
    const toRad = (deg: number) => deg * (Math.PI / 180);

    const handleCommit = (axis: 'x' | 'y' | 'z', value: string) => {
        const numVal = parseFloat(value);
        if (isNaN(numVal)) return;

        const factor = getUnitFactor(unit);
        const updates: {id: string, changes: Partial<SceneObject>}[] = [];

        objects.forEach(obj => {
            if (!selectedIds.includes(obj.id)) return;
            
            const changes: Partial<SceneObject> = {};
            
            // RELATIVE (Offset)
            if (isRelative) {
                if (transformMode === 'translate') {
                     const delta = numVal / factor;
                     changes.position = { ...obj.position, [axis]: obj.position[axis] + delta };
                } else if (transformMode === 'rotate') {
                     const deltaRad = toRad(numVal);
                     changes.rotation = { ...obj.rotation, [axis]: obj.rotation[axis] + deltaRad };
                } else if (transformMode === 'scale') {
                    changes.scale = { ...obj.scale, [axis]: obj.scale[axis] + numVal };
                }
            } 
            // ABSOLUTE
            else {
                if (transformMode === 'translate') {
                    changes.position = { ...obj.position, [axis]: numVal / factor };
                } else if (transformMode === 'rotate') {
                    changes.rotation = { ...obj.rotation, [axis]: toRad(numVal) };
                } else if (transformMode === 'scale') {
                    changes.scale = { ...obj.scale, [axis]: numVal };
                }
            }
            updates.push({ id: obj.id, changes });
        });

        if (updates.length > 0) {
            updateMultipleObjects(updates, true);
            if (isRelative) setInputs(prev => ({ ...prev, [axis]: '0' })); // Reset relative input
        }
    };

    if (selectedIds.length === 0) return null;

    return (
        <div className="flex items-center gap-4 bg-gray-850 border border-gray-700 rounded px-2 py-1 h-full shadow-inner">
            <button 
               onClick={() => setIsRelative(!isRelative)}
               className={`p-1 rounded flex items-center justify-center w-6 h-6 transition-colors ${isRelative ? 'bg-accent-500 text-white' : 'bg-gray-700 text-gray-400 hover:text-white'}`}
               title={isRelative ? "Relative Mode (Offset)" : "Absolute Mode"}
            >
                {isRelative ? <Move size={12} className="rotate-45" /> : <Hash size={12} />}
            </button>
            
            <div className="flex items-center gap-2">
                <span className="text-[10px] text-gray-400 font-bold w-4 text-center">X:</span>
                <input 
                    type="text" 
                    value={inputs.x} 
                    onChange={e => setInputs({...inputs, x: e.target.value})} 
                    onKeyDown={e => { if(e.key === 'Enter') handleCommit('x', inputs.x); }}
                    onBlur={() => handleCommit('x', inputs.x)}
                    className="w-16 bg-gray-900 border border-gray-600 hover:border-gray-500 focus:border-accent-500 rounded text-xs px-1 text-gray-200 focus:outline-none transition-colors"
                />
            </div>
            <div className="flex items-center gap-2">
                <span className="text-[10px] text-gray-400 font-bold w-4 text-center">Y:</span>
                <input 
                    type="text" 
                    value={inputs.y} 
                    onChange={e => setInputs({...inputs, y: e.target.value})} 
                    onKeyDown={e => { if(e.key === 'Enter') handleCommit('y', inputs.y); }}
                    onBlur={() => handleCommit('y', inputs.y)}
                    className="w-16 bg-gray-900 border border-gray-600 hover:border-gray-500 focus:border-accent-500 rounded text-xs px-1 text-gray-200 focus:outline-none transition-colors"
                />
            </div>
            <div className="flex items-center gap-2">
                <span className="text-[10px] text-gray-400 font-bold w-4 text-center">Z:</span>
                <input 
                    type="text" 
                    value={inputs.z} 
                    onChange={e => setInputs({...inputs, z: e.target.value})} 
                    onKeyDown={e => { if(e.key === 'Enter') handleCommit('z', inputs.z); }}
                    onBlur={() => handleCommit('z', inputs.z)}
                    className="w-16 bg-gray-900 border border-gray-600 hover:border-gray-500 focus:border-accent-500 rounded text-xs px-1 text-gray-200 focus:outline-none transition-colors"
                />
            </div>
            
            <div className="h-4 w-px bg-gray-700 mx-2"></div>
            
            <span className="text-[10px] text-gray-500 font-medium">
                Grid = {unit === 'mm' ? '1mm' : unit === 'cm' ? '1cm' : '1m'}
            </span>
        </div>
    );
};

// Snap Toolbar Dropdown
const SnapDropdown: React.FC = () => {
    const { snapSettings, setSnapMode, setSnapRadius, unit } = useAppStore();
    const [isOpen, setIsOpen] = useState(false);

    return (
        <div className="relative">
             <button 
                onClick={() => setIsOpen(!isOpen)}
                className="h-full px-1 hover:bg-gray-700 rounded-r border-l border-gray-700 flex items-center"
             >
                <div className="w-0 h-0 border-l-[3px] border-l-transparent border-r-[3px] border-r-transparent border-t-[4px] border-t-gray-400"></div>
             </button>
             {isOpen && (
                 <>
                    <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)}></div>
                    <div className="absolute top-full left-0 mt-1 bg-gray-850 border border-gray-700 shadow-xl rounded w-48 z-50 py-1 flex flex-col">
                        <label className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-700 cursor-pointer text-xs">
                            <input type="checkbox" checked={snapSettings.grid} onChange={(e) => setSnapMode('grid', e.target.checked)} />
                            <Grid3X3 size={12} /> Grid Points
                        </label>
                        <label className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-700 cursor-pointer text-xs">
                            <input type="checkbox" checked={snapSettings.vertex} onChange={(e) => setSnapMode('vertex', e.target.checked)} />
                            <Triangle size={12} /> Vertex
                        </label>
                        <label className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-700 cursor-pointer text-xs">
                            <input type="checkbox" checked={snapSettings.midpoint} onChange={(e) => setSnapMode('midpoint', e.target.checked)} />
                            <Dot size={12} /> Edge Midpoint
                        </label>
                        <div className="border-t border-gray-700 my-1"></div>
                        <label className="flex items-start gap-2 px-3 py-1.5 hover:bg-gray-700 cursor-pointer text-xs">
                            <input type="checkbox" className="mt-0.5" checked={snapSettings.weld} onChange={(e) => setSnapMode('weld', e.target.checked)} />
                            <span className="flex items-center gap-1"><GitMerge size={12} /> Weld on drop
                            <span className="block text-[9px] text-gray-500 leading-tight">merges the snapped vertex into its target</span></span>
                        </label>
                        <div className="px-3 py-1.5 text-xs flex items-center gap-2 border-t border-gray-700">
                            <span className="text-gray-400">Radius</span>
                            <input
                                type="range"
                                min={4}
                                max={40}
                                value={snapSettings.radiusPx}
                                onChange={(e) => setSnapRadius(parseInt(e.target.value, 10))}
                                className="flex-1 accent-accent-500"
                            />
                            <span className="text-gray-500 w-8 text-right">{snapSettings.radiusPx}px</span>
                        </div>
                        <div className="px-3 py-1 text-[10px] text-gray-500">
                            Grid = {unit === 'mm' ? '1mm' : unit === 'cm' ? '1cm' : unit === 'in' ? '1in' : '1m'}
                        </div>
                    </div>
                 </>
             )}
        </div>
    );
};

/** Object Mode / Edit Mode switch (Tab). */
const ModeSwitch: React.FC = () => {
  const { editorMode, toggleEditorMode, selectedIds } = useAppStore();
  const canEdit = selectedIds.length > 0;
  return (
    <div className="flex items-center bg-gray-850 border border-gray-700 rounded h-[26px] p-0.5">
      <button
        onClick={() => editorMode !== 'object' && toggleEditorMode()}
        title="Object Mode (Tab)"
        className={`px-2 h-full rounded text-xs flex items-center gap-1 transition-colors ${
          editorMode === 'object' ? 'bg-accent-500 text-white' : 'text-gray-400 hover:text-white'
        }`}
      >
        <Box size={13} /> Object
      </button>
      <button
        onClick={() => editorMode !== 'edit' && canEdit && toggleEditorMode()}
        title={canEdit ? 'Edit Mode (Tab) - converts the object into an editable mesh' : 'Select an object first'}
        className={`px-2 h-full rounded text-xs flex items-center gap-1 transition-colors ${
          editorMode === 'edit' ? 'bg-orange-500 text-white' : canEdit ? 'text-gray-400 hover:text-white' : 'text-gray-600 cursor-not-allowed'
        }`}
      >
        <PenTool size={13} /> Edit
      </button>
    </div>
  );
};

/** Vertex / Edge / Face sub-object modes (1 / 2 / 3). */
const SubObjectModes: React.FC = () => {
  const { subObjectMode, setSubObjectMode, editSelection } = useAppStore();
  const items: { mode: SubObjectMode; label: string; icon: React.ReactNode; count: number }[] = [
    { mode: 'vertex', label: 'Vertices (1)', icon: <Dot size={14} />, count: editSelection.vertices.length },
    { mode: 'edge', label: 'Edges (2)', icon: <Spline size={14} />, count: editSelection.edges.length },
    { mode: 'face', label: 'Faces (3)', icon: <Square size={14} />, count: editSelection.faces.length },
  ];
  return (
    <div className="flex items-center bg-gray-850 border border-gray-700 rounded h-[26px] p-0.5">
      {items.map(item => (
        <button
          key={item.mode}
          onClick={() => setSubObjectMode(item.mode)}
          title={item.label}
          className={`px-2 h-full rounded text-xs flex items-center gap-1 transition-colors ${
            subObjectMode === item.mode ? 'bg-orange-500 text-white' : 'text-gray-400 hover:text-white'
          }`}
        >
          {item.icon}
          {item.count > 0 && <span className="text-[10px] opacity-80">{item.count}</span>}
        </button>
      ))}
    </div>
  );
};

/** Merge / Weld dropdown. */
const MergeDropdown: React.FC = () => {
  const { runEditOp, editObjectId, objects, editSelection, snapTarget, hoverElement, snapSettings } = useAppStore();
  const [isOpen, setIsOpen] = useState(false);

  const targetLocal = (): { x: number; y: number; z: number } | undefined => {
    const obj = objects.find(o => o.id === editObjectId);
    if (!obj) return undefined;
    const world = snapTarget?.point ?? hoverElement?.point;
    if (!world) return undefined;
    const inv = objectMatrix(obj).invert();
    const p = new THREE.Vector3(world.x, world.y, world.z).applyMatrix4(inv);
    return { x: p.x, y: p.y, z: p.z };
  };

  const merge = (mode: 'center' | 'first' | 'last' | 'cursor') => {
    setIsOpen(false);
    if (mode === 'cursor') {
      const cursor = targetLocal();
      if (!cursor) return;
      runEditOp({ type: 'merge', mode: 'cursor', cursor });
      return;
    }
    runEditOp({ type: 'merge', mode });
  };

  const item = (label: string, hint: string, onClick: () => void) => (
    <button onClick={onClick} className="text-left px-3 py-1.5 hover:bg-gray-700 text-xs w-full">
      <span className="block">{label}</span>
      <span className="block text-[9px] text-gray-500 leading-tight">{hint}</span>
    </button>
  );

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        title="Merge / Weld vertices (Alt+M)"
        className="p-1.5 rounded-md bg-gray-750 text-gray-400 hover:bg-gray-700 hover:text-white border border-gray-700 flex items-center gap-1 text-xs"
      >
        <GitMerge size={14} />
      </button>
      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)}></div>
          <div className="absolute top-full right-0 mt-1 bg-gray-850 border border-gray-700 shadow-xl rounded w-56 z-50 py-1 flex flex-col">
            {item('At Center', 'collapse the selection to its average position', () => merge('center'))}
            {item('At Target / Cursor', 'drop onto the highlighted snap target', () => merge('cursor'))}
            {item('At First', 'keep the first selected vertex position', () => merge('first'))}
            {item('At Last', 'keep the last selected vertex position', () => merge('last'))}
            <div className="border-t border-gray-700 my-1"></div>
            {item(
              'Weld by distance',
              `merge every pair closer than ${(snapSettings.threshold * 1000).toFixed(1)}mm`,
              () => {
                setIsOpen(false);
                runEditOp({ type: 'weld', threshold: snapSettings.threshold });
              }
            )}
            <div className="px-3 py-1 text-[10px] text-gray-500 border-t border-gray-700">
              {activeVertexCountLabel(objects.find(o => o.id === editObjectId), editSelection)}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

const activeVertexCountLabel = (obj: SceneObject | undefined, selection: { vertices: number[]; edges: string[]; faces: number[] }) => {
  if (!obj?.mesh) return 'No editable mesh';
  const n = activeVertexIndices(obj.mesh, selection).length;
  return `${n} vertex${n === 1 ? '' : 'es'} in the selection`;
};

/** Edit-mode modelling tools. */
const EditToolbar: React.FC = () => {
  const {
    runEditOp, setModalTransform, editObjectId, editSelection, subObjectMode, selectAllElements,
    clearEditSelection, invertEditSelection, growEditSelection, shrinkEditSelection, separateSelected,
  } = useAppStore();

  const startModal = (type: 'move' | 'rotate' | 'scale') => {
    if (!editObjectId) return;
    setModalTransform({ type, axis: 'free', objectId: editObjectId, sourceVertex: null, amount: 0, snapped: false });
  };

  const extrude = () => {
    if (activeVertexCount(editSelection) === 0) return;
    runEditOp({ type: 'extrude' });
    if (editObjectId) {
      setModalTransform({ type: 'move', axis: 'free', objectId: editObjectId, sourceVertex: null, amount: 0, snapped: false });
    }
  };

  const btn = (title: string, onClick: () => void, icon: React.ReactNode, disabled = false) => (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={`p-1.5 rounded-md border text-xs flex items-center gap-1 transition-colors ${
        disabled
          ? 'bg-gray-800 text-gray-600 border-gray-800 cursor-not-allowed'
          : 'bg-gray-750 text-gray-400 hover:bg-gray-700 hover:text-white border-gray-700'
      }`}
    >
      {icon}
    </button>
  );

  return (
    <div className="flex items-center gap-1">
      {btn('Grab / Move (G)', () => startModal('move'), <Move size={14} />, activeVertexCount(editSelection) === 0)}
      {btn('Rotate (R)', () => startModal('rotate'), <RotateCw size={14} />, activeVertexCount(editSelection) === 0)}
      {btn('Scale (S)', () => startModal('scale'), <Scaling size={14} />, activeVertexCount(editSelection) === 0)}
      <div className="w-px h-4 bg-gray-700 mx-1"></div>
      {btn('Extrude (E)', extrude, <Layers3 size={14} />, activeVertexCount(editSelection) === 0)}
      {btn('Create Face / Edge (F)', () => runEditOp({ type: 'create-face' }), <PenTool size={14} />, activeVertexCount(editSelection) < 2)}
      {btn('Subdivide (Ctrl+R)', () => runEditOp({ type: 'subdivide', iterations: 1 }), <Grid2x2Icon />, false)}
      {btn('Triangulate (Ctrl+T)', () => runEditOp({ type: 'triangulate' }), <Triangle size={14} />, editSelection.faces.length === 0)}
      {btn('Flip Normals (Shift+N)', () => runEditOp({ type: 'flip-normals' }), <FlipHorizontal2 size={14} />, editSelection.faces.length === 0)}
      <MergeDropdown />
      <div className="w-px h-4 bg-gray-700 mx-1"></div>
      {btn('Delete (X)', () => runEditOp({ type: 'delete' }), <Trash2 size={14} />, activeVertexCount(editSelection) === 0)}
      {btn('Remove loose vertices', () => runEditOp({ type: 'delete-loose' }), <Scissors size={14} />)}
      <div className="w-px h-4 bg-gray-700 mx-1"></div>
      {btn('Select all elements (A)', selectAllElements, <BoxSelect size={14} />)}
      {btn('Deselect (Alt+A)', clearEditSelection, <SquareDashedIcon />)}
      {btn('Invert selection (Ctrl+I)', invertEditSelection, <RefreshCcw size={14} />)}
      {btn('Grow selection (])', growEditSelection, <Plus size={14} />)}
      {btn('Shrink selection ([)', shrinkEditSelection, <Minus size={14} />)}
      {btn('Separate by loose parts (P)', separateSelected, <Split size={14} />)}
    </div>
  );
};

const activeVertexCount = (selection: { vertices: number[]; edges: string[]; faces: number[] }) =>
  selection.vertices.length + selection.edges.length + selection.faces.length;

const Grid2x2Icon: React.FC = () => <Grid3X3 size={14} />;
const SquareDashedIcon: React.FC = () => <Square size={14} />;

const MenuBar = () => {
  const store = useAppStore();
  const gridVisible = store.viewportGridStates[store.activeViewportId];
  
  return (
    <div className="h-10 bg-gradient-to-b from-gray-750 to-gray-800 border-b border-gray-950 flex items-center px-4 gap-3 select-none">
      <div className="flex items-center gap-2 pr-3 border-r border-gray-600">
        <ModeSwitch />
        {store.editorMode === 'edit' && <SubObjectModes />}
      </div>

      <div className="flex items-center gap-2 pr-3 border-r border-gray-600">
        <label className="text-gray-400 text-xs">Layout</label>
        <select 
          value={store.viewportLayout} 
          onChange={(e) => store.setViewportLayout(parseInt(e.target.value) as 1|2|4)}
          className="bg-gray-850 text-gray-300 text-xs border border-gray-600 rounded px-2 py-1 outline-none focus:border-accent-500"
        >
          <option value="1">Single</option>
          <option value="2">Dual</option>
          <option value="4">Quad</option>
        </select>
      </div>

      <div className="flex items-center gap-2 pr-4 border-r border-gray-600">
         <div className="flex items-center gap-1 text-gray-400"><Ruler size={14} /></div>
         <select 
            value={store.unit} 
            onChange={(e) => store.setUnit(e.target.value as UnitType)}
            className="bg-gray-850 text-gray-300 text-xs border border-gray-600 rounded px-2 py-1 outline-none focus:border-accent-500 w-16"
          >
            <option value="mm">mm</option>
            <option value="cm">cm</option>
            <option value="m">m</option>
            <option value="in">in</option>
          </select>
      </div>

      <div className="flex items-center gap-1 pr-4 border-r border-gray-600">
        <HeaderButton active={gridVisible} onClick={store.toggleGrid} title="Toggle Grid (G)">
          <Grid3X3 size={14} />
        </HeaderButton>
        {/* Snap Controls */}
        <div className="flex items-center ml-2 bg-gray-850 border border-gray-700 rounded h-[26px]">
            <button 
                onClick={store.toggleSnapEnabled} 
                title="Toggle Snaps (S)"
                className={`px-2 h-full rounded-l flex items-center gap-1 text-xs transition-colors ${store.snapSettings.enabled ? 'bg-accent-500 text-white' : 'text-gray-400 hover:text-white'}`}
            >
                <Magnet size={14} className={store.snapSettings.enabled ? "fill-current" : ""} />
            </button>
            <SnapDropdown />
        </div>
      </div>
      
      {/* Creation Tools (object mode) / Modelling Tools (edit mode) */}
      {store.editorMode === 'edit' ? (
        <div className="flex items-center pr-3 border-r border-gray-600">
          <EditToolbar />
        </div>
      ) : (
        <div className="flex items-center gap-1 pr-3 border-r border-gray-600">
           <HeaderButton active={store.interactionMode === 'select'} onClick={() => store.setInteractionMode('select')} title="Select Object">
             <Move size={14} />
           </HeaderButton>
           <HeaderButton active={store.interactionMode === 'create_cube'} onClick={() => store.setInteractionMode('create_cube')} title="Create Cube">
             <Box size={14} />
           </HeaderButton>
           <HeaderButton active={store.interactionMode === 'create_sphere'} onClick={() => store.setInteractionMode('create_sphere')} title="Create Sphere">
             <Circle size={14} />
           </HeaderButton>
           <HeaderButton active={store.interactionMode === 'create_plane'} onClick={() => store.setInteractionMode('create_plane')} title="Create Plane">
             <Square size={14} />
           </HeaderButton>
           <HeaderButton active={store.interactionMode === 'create_cylinder'} onClick={() => store.setInteractionMode('create_cylinder')} title="Create Cylinder">
             <Disc size={14} />
           </HeaderButton>
           <HeaderButton active={store.interactionMode === 'create_cone'} onClick={() => store.setInteractionMode('create_cone')} title="Create Cone">
             <Triangle size={14} />
           </HeaderButton>
           <HeaderButton active={store.interactionMode === 'create_torus'} onClick={() => store.setInteractionMode('create_torus')} title="Create Torus">
             <CircleDashed size={14} />
           </HeaderButton>
           <div className="w-px h-4 bg-gray-700 mx-1"></div>
           <HeaderButton onClick={store.joinSelected} title="Join selected objects into one editable mesh (Ctrl+J)">
             <Combine size={14} />
           </HeaderButton>
        </div>
      )}

      <div className="flex items-center gap-1">
        <HeaderButton active={store.transformMode === 'translate'} onClick={() => store.setTransformMode('translate')} title="Translate (W)">
          <Component size={14} />
        </HeaderButton>
        <HeaderButton active={store.transformMode === 'rotate'} onClick={() => store.setTransformMode('rotate')} title="Rotate (E)">
          <RotateCw size={14} />
        </HeaderButton>
        <HeaderButton active={store.transformMode === 'scale'} onClick={() => store.setTransformMode('scale')} title="Scale (R)">
          <Scaling size={14} />
        </HeaderButton>
      </div>

      <div className="flex items-center gap-2 pl-4 border-l border-gray-600">
         <select 
          value={store.transformSpace} 
          onChange={(e) => store.setTransformSpace(e.target.value as 'local' | 'world')}
          className="bg-gray-850 text-gray-300 text-xs border border-gray-600 rounded px-2 py-1 outline-none focus:border-accent-500"
        >
          <option value="local">Local</option>
          <option value="world">World</option>
        </select>
        
        {/* Pivot Mode Toggle */}
        <div className="flex items-center gap-1 bg-gray-850 border border-gray-700 rounded p-0.5">
            <button 
                onClick={() => store.setPivotMode('selection')} 
                title="Use Selection Center (Group Transform)"
                className={`p-1 rounded ${store.pivotMode === 'selection' ? 'bg-accent-500 text-white' : 'text-gray-400 hover:text-white'}`}
            >
                <Target size={12} />
            </button>
            <button 
                onClick={() => store.setPivotMode('individual')} 
                title="Use Individual Pivot Points"
                className={`p-1 rounded ${store.pivotMode === 'individual' ? 'bg-accent-500 text-white' : 'text-gray-400 hover:text-white'}`}
            >
                <CircleDashed size={12} />
            </button>
        </div>
      </div>
      
      {store.isGizmoEditMode && (
         <div className="ml-4 px-2 py-1 bg-amber-600/20 text-amber-500 border border-amber-600/50 rounded text-xs font-bold animate-pulse flex items-center gap-2">
            <Anchor size={12} /> EDITING GIZMO
         </div>
      )}
      
      {/* Creation Status */}
      {store.interactionMode !== 'select' && (
         <div className="ml-4 px-2 py-1 bg-blue-600/20 text-blue-500 border border-blue-600/50 rounded text-xs font-bold flex items-center gap-2">
            CREATING: {store.interactionMode.replace('create_', '').toUpperCase()}
         </div>
      )}

      <div className="flex items-center gap-1 ml-auto">
        <HeaderButton onClick={store.copy} title="Copy (Ctrl+C)" active={false}><Copy size={14} /></HeaderButton>
        <HeaderButton onClick={() => store.setRequestPaste(true)} title="Paste (Ctrl+V)" active={false}><Clipboard size={14} /></HeaderButton>
        <HeaderButton onClick={store.deleteSelected} title="Delete (Del)" active={false}><Trash2 size={14} /></HeaderButton>
        <div className="w-px h-3 bg-gray-600 mx-1"></div>
        <HeaderButton onClick={store.undo} title="Undo (Ctrl+Z)" active={false}><Undo size={14} /></HeaderButton>
        <HeaderButton onClick={store.redo} title="Redo (Ctrl+Y)" active={false}><Redo size={14} /></HeaderButton>
      </div>
    </div>
  );
};

const SceneExplorer = () => {
  const { objects, selectedIds, selectObject, toggleVisibility } = useAppStore();

  return (
    <div className="flex-1 flex flex-col border-b border-gray-950 min-h-[40%]">
      <div className="bg-gradient-to-b from-gray-750 to-gray-800 p-2 text-[11px] font-bold text-gray-400 uppercase tracking-wider border-b border-gray-950 flex gap-2 items-center">
        <FolderOpen size={12} /> Scene Explorer
      </div>
      <div className="flex-1 overflow-y-auto p-1 bg-gray-850">
        <div className="pl-2 py-1 text-gray-400 text-xs flex items-center gap-2">
            <Globe size={12} /> Scene Root
        </div>
        <div className="pl-4">
            {objects.map(obj => {
                const isSelected = selectedIds.includes(obj.id);
                return (
                    <div 
                        key={obj.id}
                        onClick={(e) => {
                             e.stopPropagation(); 
                             selectObject(obj.id, e.ctrlKey || e.shiftKey); 
                        }}
                        className={`
                            group flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer text-xs mb-0.5
                            ${isSelected ? 'bg-accent-600 text-white' : 'text-gray-300 hover:bg-gray-750'}
                        `}
                    >
                        <Box size={12} className={isSelected ? 'text-white' : 'text-accent-500'} />
                        <span className="flex-1">{obj.name}</span>
                        <button 
                            onClick={(e) => { e.stopPropagation(); toggleVisibility(obj.id); }}
                            className={`hover:bg-black/20 p-0.5 rounded ${isSelected ? 'text-white' : 'text-gray-500'}`}
                        >
                            {obj.visible ? <Eye size={12} /> : <EyeOff size={12} />}
                        </button>
                    </div>
                );
            })}
        </div>
      </div>
    </div>
  );
};

const PropertiesPanel = () => {
  const store = useAppStore();
  const { objects, selectedIds, updateObject, setPivotCommand, unit, enterEditMode, convertToMesh } = store;
  
  if (selectedIds.length === 0) {
    return (
      <div className="flex-1 bg-gray-850 p-4 text-gray-500 text-xs text-center flex flex-col items-center justify-center">
        <BoxSelect size={32} className="mb-2 opacity-50"/>
        No object selected
      </div>
    );
  }

  // If multiple selected, we could show "Multiple" or edit the last selected
  const isMulti = selectedIds.length > 1;
  const selectedObject = objects.find(o => o.id === selectedIds[selectedIds.length - 1]);

  if (!selectedObject) return null;

  const toDeg = (rad: number) => Math.round(rad * (180 / Math.PI) * 10) / 10;
  const toRad = (deg: number) => deg * (Math.PI / 180);

  const getUnitFactor = (u: UnitType) => {
      switch(u) {
          case 'mm': return 1000;
          case 'cm': return 100;
          case 'in': return 39.3701;
          case 'm': return 1;
          default: return 1;
      }
  };

  const factor = getUnitFactor(unit);

  return (
    <div className="flex-1 flex flex-col bg-gray-850 overflow-y-auto">
       <div className="bg-gradient-to-b from-gray-750 to-gray-800 p-2 text-[11px] font-bold text-gray-400 uppercase tracking-wider border-b border-gray-950 flex gap-2 items-center">
        <BoxSelect size={12} /> Properties
      </div>
      
      {isMulti && (
          <div className="px-3 py-2 bg-accent-600/20 border-b border-accent-600/30 text-accent-400 text-xs flex items-center gap-2">
              <Layers size={14} />
              <span>{selectedIds.length} Objects Selected</span>
              <span className="text-[10px] opacity-60 ml-auto">Editing Primary</span>
          </div>
      )}
      
      <div className="p-3 space-y-4">
        {/* Mesh data / edit mode entry point */}
        <div className="space-y-2">
            <div className="text-[10px] font-bold text-gray-500 uppercase bg-gray-950/50 px-2 py-1 rounded">Geometry</div>
            {selectedObject.mesh ? (
                <>
                    <div className="grid grid-cols-3 gap-1 text-center">
                        <div className="bg-gray-950 border border-gray-700 rounded p-1">
                            <div className="text-[9px] text-gray-500 uppercase">Verts</div>
                            <div className="text-xs text-gray-200">{selectedObject.mesh.vertices.length}</div>
                        </div>
                        <div className="bg-gray-950 border border-gray-700 rounded p-1">
                            <div className="text-[9px] text-gray-500 uppercase">Edges</div>
                            <div className="text-xs text-gray-200">
                                {new Set([
                                    ...selectedObject.mesh.faces.flatMap(f => f.map((v, i) => (v < f[(i + 1) % f.length] ? `${v}-${f[(i + 1) % f.length]}` : `${f[(i + 1) % f.length]}-${v}`))),
                                    ...selectedObject.mesh.edges.map(([a, b]) => (a < b ? `${a}-${b}` : `${b}-${a}`)),
                                ]).size}
                            </div>
                        </div>
                        <div className="bg-gray-950 border border-gray-700 rounded p-1">
                            <div className="text-[9px] text-gray-500 uppercase">Faces</div>
                            <div className="text-xs text-gray-200">{selectedObject.mesh.faces.length}</div>
                        </div>
                    </div>
                    <button
                        onClick={() => enterEditMode(selectedObject.id)}
                        className="w-full bg-orange-600/20 hover:bg-orange-600/40 border border-orange-600/50 text-orange-300 text-xs py-1.5 rounded flex items-center justify-center gap-2"
                    >
                        <PenTool size={12} /> {store.editorMode === 'edit' && store.editObjectId === selectedObject.id ? 'Editing this mesh' : 'Enter Edit Mode (Tab)'}
                    </button>
                </>
            ) : (
                <button
                    onClick={() => { convertToMesh(selectedObject.id); enterEditMode(selectedObject.id); }}
                    className="w-full bg-gray-750 hover:bg-gray-700 border border-gray-700 text-gray-300 text-xs py-1.5 rounded flex items-center justify-center gap-2"
                    title="Converts the primitive into an editable polygon mesh"
                >
                    <Boxes size={12} /> Make Editable &amp; Edit (Tab)
                </button>
            )}
        </div>

        {/* Identity Group */}
        <div className="space-y-2">
            <div className="text-[10px] font-bold text-gray-500 uppercase bg-gray-950/50 px-2 py-1 rounded">Object</div>
            <div className="flex items-center gap-2 text-xs">
                <label className="w-16 text-gray-500">Name</label>
                <input 
                    type="text" 
                    value={selectedObject.name}
                    disabled={isMulti}
                    onChange={(e) => updateObject(selectedObject.id, { name: e.target.value })}
                    className={`flex-1 bg-gray-950 border border-gray-700 rounded px-2 py-1 text-gray-300 focus:outline-none focus:border-accent-500 ${isMulti ? 'opacity-50' : ''}`}
                />
            </div>
            <div className="flex items-center gap-2 text-xs">
                <label className="w-16 text-gray-500">Visible</label>
                <input 
                    type="checkbox" 
                    checked={selectedObject.visible}
                    onChange={(e) => updateObject(selectedObject.id, { visible: e.target.checked })}
                />
            </div>
            <div className="flex items-center gap-2 text-xs">
                <label className="w-16 text-gray-500">Color</label>
                <input
                    type="color"
                    value={selectedObject.color || '#4a90d9'}
                    onChange={(e) => updateObject(selectedObject.id, { color: e.target.value })}
                    className="h-6 w-10 bg-transparent border border-gray-600 rounded cursor-pointer"
                />
                <span className="text-[10px] text-gray-500 uppercase">{selectedObject.color || '#4a90d9'}</span>
            </div>
        </div>

        {/* Transform Group */}
        <div className="space-y-3">
            <div className="text-[10px] font-bold text-gray-500 uppercase bg-gray-950/50 px-2 py-1 rounded">Transform</div>
            
            <div className="space-y-1">
                <label className="text-[10px] text-gray-500">Position ({unit})</label>
                <div className="flex gap-1">
                    <PropertyInput label="X" color="text-red-500" value={selectedObject.position.x} conversionFactor={factor} onChange={(v) => updateObject(selectedObject.id, { position: { ...selectedObject.position, x: v } })} />
                    <PropertyInput label="Y" color="text-green-500" value={selectedObject.position.y} conversionFactor={factor} onChange={(v) => updateObject(selectedObject.id, { position: { ...selectedObject.position, y: v } })} />
                    <PropertyInput label="Z" color="text-blue-500" value={selectedObject.position.z} conversionFactor={factor} onChange={(v) => updateObject(selectedObject.id, { position: { ...selectedObject.position, z: v } })} />
                </div>
            </div>

            <div className="space-y-1">
                <label className="text-[10px] text-gray-500">Rotation (Deg)</label>
                <div className="flex gap-1">
                    <PropertyInput label="X" color="text-red-500" value={toDeg(selectedObject.rotation.x)} step={1} onChange={(v) => updateObject(selectedObject.id, { rotation: { ...selectedObject.rotation, x: toRad(v) } })} />
                    <PropertyInput label="Y" color="text-green-500" value={toDeg(selectedObject.rotation.y)} step={1} onChange={(v) => updateObject(selectedObject.id, { rotation: { ...selectedObject.rotation, y: toRad(v) } })} />
                    <PropertyInput label="Z" color="text-blue-500" value={toDeg(selectedObject.rotation.z)} step={1} onChange={(v) => updateObject(selectedObject.id, { rotation: { ...selectedObject.rotation, z: toRad(v) } })} />
                </div>
            </div>

            <div className="space-y-1">
                <label className="text-[10px] text-gray-500">Scale (Factor)</label>
                <div className="flex gap-1">
                    <PropertyInput label="X" color="text-red-500" value={selectedObject.scale.x} conversionFactor={1} onChange={(v) => updateObject(selectedObject.id, { scale: { ...selectedObject.scale, x: v } })} />
                    <PropertyInput label="Y" color="text-green-500" value={selectedObject.scale.y} conversionFactor={1} onChange={(v) => updateObject(selectedObject.id, { scale: { ...selectedObject.scale, y: v } })} />
                    <PropertyInput label="Z" color="text-blue-500" value={selectedObject.scale.z} conversionFactor={1} onChange={(v) => updateObject(selectedObject.id, { scale: { ...selectedObject.scale, z: v } })} />
                </div>
            </div>

             {/* Dimensions / Parameters based on geometry */}
             {!selectedObject.mesh && <div className="space-y-1">
                <label className="text-[10px] text-gray-500">
                    {selectedObject.geometry === 'sphere' ? `Radius (${unit})` : `Dimensions (${unit})`}
                </label>
                
                {selectedObject.geometry === 'sphere' ? (
                     <div className="flex gap-1">
                         <PropertyInput label="R" color="text-orange-400" value={selectedObject.radius || 0.1} conversionFactor={factor} onChange={(v) => updateObject(selectedObject.id, { radius: v })} />
                     </div>
                ) : (
                    <div className="flex gap-1">
                        <PropertyInput label="X" color="text-gray-400" value={selectedObject.dimensions ? selectedObject.dimensions.x : 0.1} conversionFactor={factor} onChange={(v) => updateObject(selectedObject.id, { dimensions: { ...selectedObject.dimensions, x: v } })} />
                        {selectedObject.geometry !== 'plane' && (
                             <PropertyInput label="Y" color="text-gray-400" value={selectedObject.dimensions ? selectedObject.dimensions.y : 0.1} conversionFactor={factor} onChange={(v) => updateObject(selectedObject.id, { dimensions: { ...selectedObject.dimensions, y: v } })} />
                        )}
                        <PropertyInput label="Z" color="text-gray-400" value={selectedObject.dimensions ? selectedObject.dimensions.z : 0.1} conversionFactor={factor} onChange={(v) => updateObject(selectedObject.id, { dimensions: { ...selectedObject.dimensions, z: v } })} />
                    </div>
                )}
            </div>}
            {selectedObject.mesh && (
                <div className="text-[10px] text-gray-500 bg-gray-950/60 border border-gray-800 rounded px-2 py-1.5">
                    Editable mesh: primitive parameters are baked. Size is now driven by the
                    vertices ({(meshBounds(selectedObject.mesh).size.x * factor).toFixed(1)} × {(meshBounds(selectedObject.mesh).size.y * factor).toFixed(1)} × {(meshBounds(selectedObject.mesh).size.z * factor).toFixed(1)} {unit}).
                </div>
            )}
        </div>
        
        {/* Geometry Offset (Advanced) */}
         <div className="space-y-3 pt-2 border-t border-gray-700/50">
            <div className="text-[10px] font-bold text-gray-500 uppercase bg-gray-950/50 px-2 py-1 rounded flex justify-between items-center">
                <span>Pivot Offset (Local)</span>
                <span className="text-[9px] text-gray-600">Advanced</span>
            </div>
             <div className="grid grid-cols-3 gap-1 mb-2">
                 <button onClick={() => setPivotCommand('center')} className="bg-gray-750 hover:bg-gray-700 text-gray-400 hover:text-white p-1 rounded border border-gray-700 flex flex-col items-center justify-center gap-1 h-12" title="Center Pivot to Object">
                    <AlignCenter size={14} /><span className="text-[9px]">Center</span>
                 </button>
                 <button onClick={() => setPivotCommand('bottom')} className="bg-gray-750 hover:bg-gray-700 text-gray-400 hover:text-white p-1 rounded border border-gray-700 flex flex-col items-center justify-center gap-1 h-12" title="Pivot to Bottom Center">
                    <ArrowDownToLine size={14} /><span className="text-[9px]">Bottom</span>
                 </button>
                 <button onClick={() => setPivotCommand('reset')} className="bg-gray-750 hover:bg-gray-700 text-gray-400 hover:text-white p-1 rounded border border-gray-700 flex flex-col items-center justify-center gap-1 h-12" title="Reset Pivot to World (0,0,0)">
                    <RefreshCcw size={14} /><span className="text-[9px]">Reset</span>
                 </button>
             </div>
             <div className="space-y-1">
                <label className="text-[10px] text-gray-500">Offset Position ({unit})</label>
                <div className="flex gap-1">
                    <PropertyInput label="X" color="text-gray-500" value={selectedObject.geometryOffset.x} conversionFactor={factor} onChange={(v) => updateObject(selectedObject.id, { geometryOffset: { ...selectedObject.geometryOffset, x: v } })} />
                    <PropertyInput label="Y" color="text-gray-500" value={selectedObject.geometryOffset.y} conversionFactor={factor} onChange={(v) => updateObject(selectedObject.id, { geometryOffset: { ...selectedObject.geometryOffset, y: v } })} />
                    <PropertyInput label="Z" color="text-gray-500" value={selectedObject.geometryOffset.z} conversionFactor={factor} onChange={(v) => updateObject(selectedObject.id, { geometryOffset: { ...selectedObject.geometryOffset, z: v } })} />
                </div>
            </div>
             <div className="space-y-1">
                <label className="text-[10px] text-gray-500">Offset Rotation (Deg)</label>
                <div className="flex gap-1">
                    <PropertyInput label="X" color="text-gray-500" value={toDeg(selectedObject.geometryRotation ? selectedObject.geometryRotation.x : 0)} onChange={(v) => updateObject(selectedObject.id, { geometryRotation: { ...selectedObject.geometryRotation, x: toRad(v) } })} />
                    <PropertyInput label="Y" color="text-gray-500" value={toDeg(selectedObject.geometryRotation ? selectedObject.geometryRotation.y : 0)} onChange={(v) => updateObject(selectedObject.id, { geometryRotation: { ...selectedObject.geometryRotation, y: toRad(v) } })} />
                    <PropertyInput label="Z" color="text-gray-500" value={toDeg(selectedObject.geometryRotation ? selectedObject.geometryRotation.z : 0)} onChange={(v) => updateObject(selectedObject.id, { geometryRotation: { ...selectedObject.geometryRotation, z: toRad(v) } })} />
                </div>
            </div>
        </div>
      </div>
    </div>
  );
};

// Helper component to render viewport based on ID and store configuration
const ViewportRenderer: React.FC<{ id: number }> = ({ id }) => {
  const { viewportConfigs } = useAppStore();
  const type = viewportConfigs[id] || 'perspective';
  
  const getLabel = (t: ViewportType) => {
    switch(t) {
      case 'perspective': return 'Perspective';
      case 'top': return 'Top';
      case 'front': return 'Front';
      case 'side': return 'Side (Right)';
      case 'left': return 'Left';
      default: return t;
    }
  };

  return <Viewport3D id={id} type={type} label={getLabel(type)} />;
};

export default function App() {
  const store = useAppStore();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in inputs
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable) return;

      const key = e.key.toLowerCase();
      const isCtrl = e.ctrlKey || e.metaKey; // Support Cmd on Mac

      // --- Tab switches between Object Mode and Edit Mode ---
      if (e.key === 'Tab') {
        e.preventDefault();
        store.toggleEditorMode();
        return;
      }

      // --- Edit mode shortcuts (Blender style) ---
      if (store.editorMode === 'edit') {
        const st = useAppStore.getState();
        const hasSelection =
          st.editSelection.vertices.length + st.editSelection.edges.length + st.editSelection.faces.length > 0;
        const startModal = (type: 'move' | 'rotate' | 'scale') => {
          if (!st.editObjectId || !hasSelection) return;
          e.preventDefault();
          st.setModalTransform({ type, axis: 'free', objectId: st.editObjectId, sourceVertex: null, amount: 0, snapped: false });
        };

        if (isCtrl && key === 'z') { e.preventDefault(); st.undo(); return; }
        if (isCtrl && key === 'y') { e.preventDefault(); st.redo(); return; }
        if (isCtrl && key === 'r') { e.preventDefault(); st.runEditOp({ type: 'subdivide', iterations: 1 }); return; }
        if (isCtrl && key === 't') { e.preventDefault(); st.runEditOp({ type: 'triangulate' }); return; }
        if (isCtrl && key === 'i') { e.preventDefault(); st.invertEditSelection(); return; }
        if (e.altKey && key === 'a') { e.preventDefault(); st.clearEditSelection(); return; }
        if (e.altKey && key === 'm') { e.preventDefault(); st.runEditOp({ type: 'merge', mode: 'center' }); return; }

        switch (key) {
          case '1': st.setSubObjectMode('vertex'); break;
          case '2': st.setSubObjectMode('edge'); break;
          case '3': st.setSubObjectMode('face'); break;
          case 'g': startModal('move'); break;
          case 'r': startModal('rotate'); break;
          case 's': startModal('scale'); break;
          case 'e':
            if (!hasSelection) break;
            e.preventDefault();
            st.runEditOp({ type: 'extrude' });
            if (st.editObjectId) {
              useAppStore.getState().setModalTransform({ type: 'move', axis: 'free', objectId: st.editObjectId, sourceVertex: null, amount: 0, snapped: false });
            }
            break;
          case 'f': st.runEditOp({ type: 'create-face' }); break;
          case 'x':
          case 'delete':
          case 'backspace': e.preventDefault(); st.runEditOp({ type: 'delete' }); break;
          case 'a': e.preventDefault(); st.selectAllElements(); break;
          case 'l': st.selectLinked(); break;
          case 'v': st.runEditOp({ type: 'weld', threshold: st.snapSettings.threshold }); break;
          case 'p': e.preventDefault(); st.separateSelected(); break;
          case '[': st.shrinkEditSelection(); break;
          case ']': st.growEditSelection(); break;
          case 'n': if (e.shiftKey) st.runEditOp({ type: 'flip-normals' }); break;
          case 'escape': e.preventDefault(); st.clearEditSelection(); break;
        }
        if (e.key === 'Shift' && key === 'n') st.runEditOp({ type: 'flip-normals' });
        return;
      }

      if (isCtrl && key === 'j') {
        e.preventDefault();
        store.joinSelected();
        return;
      }

      if (isCtrl && key === 'z') {
        e.preventDefault();
        store.undo();
      } else if (isCtrl && key === 'y') {
        e.preventDefault();
        store.redo();
      } else if (isCtrl && key === 'c') {
        e.preventDefault();
        store.copy();
      } else if (isCtrl && key === 'v') {
        e.preventDefault();
        store.setRequestPaste(true); // Trigger paste request instead of direct paste
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        store.deleteSelected();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        if (store.drawingPhase !== 'idle') store.cancelDrawing();
        else store.setInteractionMode('select');
      } else if (isCtrl && key === 'd') {
        e.preventDefault();
        store.duplicateSelected();
      } else {
        switch(key) {
          case 'a':
            if (e.altKey) store.deselectAll();
            else store.selectAll();
            break;
          case 'g': store.toggleGrid(); break;
          case 'w': store.setTransformMode('translate'); break;
          case 'e': store.setTransformMode('rotate'); break;
          case 'r': store.setTransformMode('scale'); break;
          case 'd': store.toggleGizmoEditMode(); break; // Toggle Gizmo Mode
          case 'h': 
            if(store.selectedIds.length > 0) store.selectedIds.forEach(id => store.toggleVisibility(id)); 
            break;
          // Viewport shortcuts
          case 't': store.setViewportType(store.activeViewportId, 'top'); break;
          case 'f': store.setViewportType(store.activeViewportId, 'front'); break;
          case 'l': store.setViewportType(store.activeViewportId, 'left'); break;
          case 'p': store.setViewportType(store.activeViewportId, 'perspective'); break;
          // Snap
          case 's': store.toggleSnapEnabled(); break;
          // Gizmo Size
          case '+': 
          case '=':
            store.updateGizmoSize(0.2); 
            break;
          case '-': 
          case '_':
            store.updateGizmoSize(-0.2); 
            break;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [store]);

  return (
    <div className="w-screen h-screen flex flex-col bg-gray-950 text-gray-300 font-sans overflow-hidden">
      <MenuBar />
      
      <div className="flex-1 flex overflow-hidden">
        {/* Viewport Area */}
        <div className="flex-1 bg-[#1a1a1a] relative">
          <div className={`
            w-full h-full grid gap-0.5 bg-gray-750
            ${store.viewportLayout === 1 ? 'grid-cols-1' : ''}
            ${store.viewportLayout === 2 ? 'grid-cols-2' : ''}
            ${store.viewportLayout === 4 ? 'grid-cols-2 grid-rows-2' : ''}
          `}>
             {store.viewportLayout === 1 && (
                <ViewportRenderer id={0} />
             )}
             {store.viewportLayout === 2 && (
                <>
                  <ViewportRenderer id={0} />
                  <ViewportRenderer id={1} />
                </>
             )}
             {store.viewportLayout === 4 && (
                <>
                  <ViewportRenderer id={0} />
                  <ViewportRenderer id={1} />
                  <ViewportRenderer id={2} />
                  <ViewportRenderer id={3} />
                </>
             )}
          </div>
        </div>

        {/* Right Sidebar */}
        <div className="w-[280px] bg-gray-850 border-l border-gray-950 flex flex-col">
          <SceneExplorer />
          <PropertiesPanel />
        </div>
      </div>

      {/* Status Bar */}
      <div className="h-8 bg-gray-850 border-t border-gray-950 flex items-center px-4 gap-4 text-[10px] text-gray-500 justify-between">
        {store.editorMode === 'edit' ? (
          <div className="flex items-center gap-3">
            <span className="text-orange-400 font-bold uppercase">Edit Mode</span>
            <span className="flex items-center gap-1"><kbd className="bg-gray-700 px-1 rounded text-gray-300">Tab</kbd> Object</span>
            <span className="flex items-center gap-1"><kbd className="bg-gray-700 px-1 rounded text-gray-300">1/2/3</kbd> Vert/Edge/Face</span>
            <span className="flex items-center gap-1"><kbd className="bg-gray-700 px-1 rounded text-gray-300">G/R/S</kbd> +<kbd className="bg-gray-700 px-1 rounded text-gray-300">X/Y/Z</kbd> Move/Rotate/Scale</span>
            <span className="flex items-center gap-1"><kbd className="bg-gray-700 px-1 rounded text-gray-300">E</kbd> Extrude</span>
            <span className="flex items-center gap-1"><kbd className="bg-gray-700 px-1 rounded text-gray-300">F</kbd> Face</span>
            <span className="flex items-center gap-1"><kbd className="bg-gray-700 px-1 rounded text-gray-300">Alt+M</kbd> Merge</span>
            <span className="flex items-center gap-1"><kbd className="bg-gray-700 px-1 rounded text-gray-300">V</kbd> Weld</span>
            <span className="flex items-center gap-1"><kbd className="bg-gray-700 px-1 rounded text-gray-300">X</kbd> Delete</span>
            <span className="flex items-center gap-1"><kbd className="bg-gray-700 px-1 rounded text-gray-300">LMB</kbd> Confirm</span>
            <span className="flex items-center gap-1"><kbd className="bg-gray-700 px-1 rounded text-gray-300">Esc</kbd> Cancel</span>
          </div>
        ) : (
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1"><kbd className="bg-gray-700 px-1 rounded text-gray-300">LMB</kbd> Select</span>
            <span className="flex items-center gap-1"><kbd className="bg-gray-700 px-1 rounded text-gray-300">RMB</kbd> Orbit</span>
            <div className="w-px h-3 bg-gray-700 mx-1"></div>
            <span className="flex items-center gap-1"><kbd className="bg-gray-700 px-1 rounded text-gray-300">Tab</kbd> Edit Mode</span>
            <span className="flex items-center gap-1"><kbd className="bg-gray-700 px-1 rounded text-gray-300">W/E/R</kbd> Transform</span>
            <span className="flex items-center gap-1"><kbd className="bg-gray-700 px-1 rounded text-gray-300">Ctrl+J</kbd> Join</span>
            <span className="flex items-center gap-1"><kbd className="bg-gray-700 px-1 rounded text-gray-300">Ctrl+D</kbd> Duplicate</span>
          </div>
        )}

        {/* Live readout while a modal transform is running */}
        {store.modalTransform && (
          <div className="px-2 py-0.5 bg-orange-600/20 border border-orange-600/50 rounded text-orange-400 font-mono">
            {store.modalTransform.type.toUpperCase()}
            {store.modalTransform.axis !== 'free' ? ` ${store.modalTransform.axis.toUpperCase()}` : ''}
            {store.modalReadout
              ? store.modalTransform.type === 'rotate'
                ? ` ${store.modalReadout.amount.toFixed(1)}°`
                : store.modalTransform.type === 'scale'
                ? ` ×${store.modalReadout.amount.toFixed(3)}`
                : ` ${((store.modalReadout.amount * getUnitFactor(store.unit)) | 0) / 1000} ${store.unit}`
              : ''}
            {store.modalReadout?.snapped ? ' · SNAPPED' : ''}
          </div>
        )}
        
        {/* Coordinate Input Bar */}
        <div className="flex-1 flex justify-center h-full py-0.5">
            {store.editorMode === 'object' && <CoordinateInputBar />}
        </div>
      </div>
    </div>
  );
}
