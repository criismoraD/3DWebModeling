
import React, { useEffect, useState } from 'react';
import { useAppStore } from './store';
import { Viewport3D } from './components/Viewport3D';
import { ViewportType, UnitType, SceneObject } from './types';
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
  Triangle
} from 'lucide-react';

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
    const { snapSettings, setSnapMode } = useAppStore();
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
                    <div className="absolute top-full left-0 mt-1 bg-gray-850 border border-gray-700 shadow-xl rounded w-32 z-50 py-1 flex flex-col">
                        <label className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-700 cursor-pointer text-xs">
                            <input 
                                type="checkbox" 
                                checked={snapSettings.grid} 
                                onChange={(e) => setSnapMode('grid', e.target.checked)}
                            />
                            <Grid3X3 size={12} /> Grid Points
                        </label>
                        <label className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-700 cursor-pointer text-xs">
                            <input 
                                type="checkbox" 
                                checked={snapSettings.vertex} 
                                onChange={(e) => setSnapMode('vertex', e.target.checked)}
                            />
                            <Triangle size={12} /> Vertex
                        </label>
                    </div>
                 </>
             )}
        </div>
    );
};

const MenuBar = () => {
  const store = useAppStore();
  const gridVisible = store.viewportGridStates[store.activeViewportId];
  
  return (
    <div className="h-10 bg-gradient-to-b from-gray-750 to-gray-800 border-b border-gray-950 flex items-center px-4 gap-4 select-none">
      <div className="flex items-center gap-2 pr-4 border-r border-gray-600">
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
      
      {/* Creation Tools */}
      <div className="flex items-center gap-1 pr-4 border-r border-gray-600">
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
      </div>

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
  const { objects, selectedIds, updateObject, setPivotCommand, unit } = useAppStore();
  
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
             <div className="space-y-1">
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
            </div>
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
      if ((e.target as HTMLElement).tagName === 'INPUT') return;

      const key = e.key.toLowerCase();
      const isCtrl = e.ctrlKey || e.metaKey; // Support Cmd on Mac

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
      } else if (e.key === 'Delete') {
        e.preventDefault();
        store.deleteSelected();
      } else {
        switch(key) {
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
        <div className="flex items-center gap-4">
            <span className="flex items-center gap-1"><kbd className="bg-gray-700 px-1 rounded text-gray-300">LMB</kbd> Select</span>
            <span className="flex items-center gap-1"><kbd className="bg-gray-700 px-1 rounded text-gray-300">RMB</kbd> Orbit</span>
            <div className="w-px h-3 bg-gray-700 mx-1"></div>
            <span className="flex items-center gap-1"><kbd className="bg-gray-700 px-1 rounded text-gray-300">W/E/R</kbd> Transform</span>
        </div>
        
        {/* Coordinate Input Bar */}
        <div className="flex-1 flex justify-center h-full py-0.5">
            <CoordinateInputBar />
        </div>
      </div>
    </div>
  );
}
