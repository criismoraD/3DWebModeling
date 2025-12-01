import React, { useEffect } from 'react';
import { useAppStore } from './store';
import { Viewport3D } from './components/Viewport3D';
import { ViewportType } from './types';
import { 
  Box, 
  Eye, 
  EyeOff, 
  Grid3X3, 
  Maximize, 
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
  RefreshCcw
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
}> = ({ label, value, color, onChange, step = 0.1 }) => (
  <div className="flex items-center gap-1 flex-1 bg-gray-850 border border-gray-700 rounded-sm overflow-hidden">
    <div className={`w-4 text-[10px] flex items-center justify-center font-bold ${color}`}>
      {label}
    </div>
    <input 
      type="number" 
      step={step}
      value={Number(value).toFixed(2)}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      className="w-full bg-transparent text-gray-300 text-[11px] p-1 focus:outline-none"
    />
  </div>
);

const MenuBar = () => {
  const store = useAppStore();
  
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

      <div className="flex items-center gap-1 pr-4 border-r border-gray-600">
        <HeaderButton active={store.gridVisible} onClick={store.toggleGrid} title="Toggle Grid (G)">
          <Grid3X3 size={14} />
        </HeaderButton>
      </div>

      <div className="flex items-center gap-1">
        <HeaderButton active={store.transformMode === 'translate'} onClick={() => store.setTransformMode('translate')} title="Translate (W)">
          <Move size={14} />
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
      </div>
      
      {store.isGizmoEditMode && (
         <div className="ml-4 px-2 py-1 bg-amber-600/20 text-amber-500 border border-amber-600/50 rounded text-xs font-bold animate-pulse flex items-center gap-2">
            <Anchor size={12} /> EDITING GIZMO
         </div>
      )}

      <div className="flex items-center gap-1 ml-auto">
        <HeaderButton onClick={store.undo} title="Undo (Ctrl+Z)" active={false}>
          <Undo size={14} />
        </HeaderButton>
        <HeaderButton onClick={store.redo} title="Redo (Ctrl+Y)" active={false}>
          <Redo size={14} />
        </HeaderButton>
      </div>
    </div>
  );
};

const SceneExplorer = () => {
  const { objects, selectedId, selectObject, toggleVisibility } = useAppStore();

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
            {objects.map(obj => (
                <div 
                    key={obj.id}
                    onClick={() => selectObject(obj.id)}
                    className={`
                        group flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer text-xs mb-0.5
                        ${selectedId === obj.id ? 'bg-accent-600 text-white' : 'text-gray-300 hover:bg-gray-750'}
                    `}
                >
                    <Box size={12} className={selectedId === obj.id ? 'text-white' : 'text-accent-500'} />
                    <span className="flex-1">{obj.name}</span>
                    <button 
                        onClick={(e) => { e.stopPropagation(); toggleVisibility(obj.id); }}
                        className={`hover:bg-black/20 p-0.5 rounded ${selectedId === obj.id ? 'text-white' : 'text-gray-500'}`}
                    >
                        {obj.visible ? <Eye size={12} /> : <EyeOff size={12} />}
                    </button>
                </div>
            ))}
        </div>
      </div>
    </div>
  );
};

const PropertiesPanel = () => {
  const { objects, selectedId, updateObject, setPivotCommand } = useAppStore();
  const selectedObject = objects.find(o => o.id === selectedId);

  if (!selectedObject) {
    return (
      <div className="flex-1 bg-gray-850 p-4 text-gray-500 text-xs text-center flex flex-col items-center justify-center">
        <BoxSelect size={32} className="mb-2 opacity-50"/>
        No object selected
      </div>
    );
  }

  // Helper to convert rad to deg
  const toDeg = (rad: number) => Math.round(rad * (180 / Math.PI) * 10) / 10;
  const toRad = (deg: number) => deg * (Math.PI / 180);

  return (
    <div className="flex-1 flex flex-col bg-gray-850 overflow-y-auto">
       <div className="bg-gradient-to-b from-gray-750 to-gray-800 p-2 text-[11px] font-bold text-gray-400 uppercase tracking-wider border-b border-gray-950 flex gap-2 items-center">
        <BoxSelect size={12} /> Properties
      </div>
      
      <div className="p-3 space-y-4">
        {/* Identity Group */}
        <div className="space-y-2">
            <div className="text-[10px] font-bold text-gray-500 uppercase bg-gray-950/50 px-2 py-1 rounded">Object</div>
            <div className="flex items-center gap-2 text-xs">
                <label className="w-16 text-gray-500">Name</label>
                <input 
                    type="text" 
                    value={selectedObject.name}
                    onChange={(e) => updateObject(selectedObject.id, { name: e.target.value })}
                    className="flex-1 bg-gray-950 border border-gray-700 rounded px-2 py-1 text-gray-300 focus:outline-none focus:border-accent-500"
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
            
            {/* Position */}
            <div className="space-y-1">
                <label className="text-[10px] text-gray-500">Position</label>
                <div className="flex gap-1">
                    <PropertyInput 
                        label="X" color="text-red-500" value={selectedObject.position.x} 
                        onChange={(v) => updateObject(selectedObject.id, { position: { ...selectedObject.position, x: v } })} 
                    />
                    <PropertyInput 
                        label="Y" color="text-green-500" value={selectedObject.position.y} 
                        onChange={(v) => updateObject(selectedObject.id, { position: { ...selectedObject.position, y: v } })} 
                    />
                    <PropertyInput 
                        label="Z" color="text-blue-500" value={selectedObject.position.z} 
                        onChange={(v) => updateObject(selectedObject.id, { position: { ...selectedObject.position, z: v } })} 
                    />
                </div>
            </div>

            {/* Rotation */}
            <div className="space-y-1">
                <label className="text-[10px] text-gray-500">Rotation</label>
                <div className="flex gap-1">
                    <PropertyInput 
                        label="X" color="text-red-500" value={toDeg(selectedObject.rotation.x)} step={1}
                        onChange={(v) => updateObject(selectedObject.id, { rotation: { ...selectedObject.rotation, x: toRad(v) } })} 
                    />
                    <PropertyInput 
                        label="Y" color="text-green-500" value={toDeg(selectedObject.rotation.y)} step={1}
                        onChange={(v) => updateObject(selectedObject.id, { rotation: { ...selectedObject.rotation, y: toRad(v) } })} 
                    />
                    <PropertyInput 
                        label="Z" color="text-blue-500" value={toDeg(selectedObject.rotation.z)} step={1}
                        onChange={(v) => updateObject(selectedObject.id, { rotation: { ...selectedObject.rotation, z: toRad(v) } })} 
                    />
                </div>
            </div>

            {/* Scale */}
            <div className="space-y-1">
                <label className="text-[10px] text-gray-500">Scale</label>
                <div className="flex gap-1">
                    <PropertyInput 
                        label="X" color="text-red-500" value={selectedObject.scale.x} 
                        onChange={(v) => updateObject(selectedObject.id, { scale: { ...selectedObject.scale, x: v } })} 
                    />
                    <PropertyInput 
                        label="Y" color="text-green-500" value={selectedObject.scale.y} 
                        onChange={(v) => updateObject(selectedObject.id, { scale: { ...selectedObject.scale, y: v } })} 
                    />
                    <PropertyInput 
                        label="Z" color="text-blue-500" value={selectedObject.scale.z} 
                        onChange={(v) => updateObject(selectedObject.id, { scale: { ...selectedObject.scale, z: v } })} 
                    />
                </div>
            </div>
        </div>
        
        {/* Geometry Offset (Advanced) */}
         <div className="space-y-3 pt-2 border-t border-gray-700/50">
            <div className="text-[10px] font-bold text-gray-500 uppercase bg-gray-950/50 px-2 py-1 rounded flex justify-between items-center">
                <span>Pivot Offset (Local)</span>
                <span className="text-[9px] text-gray-600">Advanced</span>
            </div>

             {/* Tools */}
             <div className="grid grid-cols-3 gap-1 mb-2">
                 <button 
                    onClick={() => setPivotCommand('center')}
                    className="bg-gray-750 hover:bg-gray-700 text-gray-400 hover:text-white p-1 rounded border border-gray-700 flex flex-col items-center justify-center gap-1 h-12"
                    title="Center Pivot to Object"
                 >
                    <AlignCenter size={14} />
                    <span className="text-[9px]">Center</span>
                 </button>
                 <button 
                    onClick={() => setPivotCommand('bottom')}
                    className="bg-gray-750 hover:bg-gray-700 text-gray-400 hover:text-white p-1 rounded border border-gray-700 flex flex-col items-center justify-center gap-1 h-12"
                    title="Pivot to Bottom Center"
                 >
                    <ArrowDownToLine size={14} />
                    <span className="text-[9px]">Bottom</span>
                 </button>
                 <button 
                    onClick={() => setPivotCommand('reset')}
                    className="bg-gray-750 hover:bg-gray-700 text-gray-400 hover:text-white p-1 rounded border border-gray-700 flex flex-col items-center justify-center gap-1 h-12"
                    title="Reset Pivot to World (0,0,0)"
                 >
                    <RefreshCcw size={14} />
                    <span className="text-[9px]">Reset</span>
                 </button>
             </div>

             <div className="space-y-1">
                <label className="text-[10px] text-gray-500">Offset Position</label>
                <div className="flex gap-1">
                    <PropertyInput 
                        label="X" color="text-gray-500" value={selectedObject.geometryOffset.x} 
                        onChange={(v) => updateObject(selectedObject.id, { geometryOffset: { ...selectedObject.geometryOffset, x: v } })} 
                    />
                    <PropertyInput 
                        label="Y" color="text-gray-500" value={selectedObject.geometryOffset.y} 
                        onChange={(v) => updateObject(selectedObject.id, { geometryOffset: { ...selectedObject.geometryOffset, y: v } })} 
                    />
                    <PropertyInput 
                        label="Z" color="text-gray-500" value={selectedObject.geometryOffset.z} 
                        onChange={(v) => updateObject(selectedObject.id, { geometryOffset: { ...selectedObject.geometryOffset, z: v } })} 
                    />
                </div>
            </div>
            
             <div className="space-y-1">
                <label className="text-[10px] text-gray-500">Offset Rotation</label>
                <div className="flex gap-1">
                    <PropertyInput 
                        label="X" color="text-gray-500" value={toDeg(selectedObject.geometryRotation ? selectedObject.geometryRotation.x : 0)} 
                        onChange={(v) => updateObject(selectedObject.id, { geometryRotation: { ...selectedObject.geometryRotation, x: toRad(v) } })} 
                    />
                    <PropertyInput 
                        label="Y" color="text-gray-500" value={toDeg(selectedObject.geometryRotation ? selectedObject.geometryRotation.y : 0)} 
                        onChange={(v) => updateObject(selectedObject.id, { geometryRotation: { ...selectedObject.geometryRotation, y: toRad(v) } })} 
                    />
                    <PropertyInput 
                        label="Z" color="text-gray-500" value={toDeg(selectedObject.geometryRotation ? selectedObject.geometryRotation.z : 0)} 
                        onChange={(v) => updateObject(selectedObject.id, { geometryRotation: { ...selectedObject.geometryRotation, z: toRad(v) } })} 
                    />
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
  
  // Format label to look nice (e.g. 'top' -> 'Top', 'side' -> 'Side (Right)')
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

      if (e.ctrlKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        store.undo();
      } else if (e.ctrlKey && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        store.redo();
      } else {
        const key = e.key.toLowerCase();
        switch(key) {
          case 'g': store.toggleGrid(); break;
          case 'w': store.setTransformMode('translate'); break;
          case 'e': store.setTransformMode('rotate'); break;
          case 'r': store.setTransformMode('scale'); break;
          case 'd': store.toggleGizmoEditMode(); break; // Toggle Gizmo Mode
          case 'h': 
            if(store.selectedId) store.toggleVisibility(store.selectedId); 
            break;
          // Viewport shortcuts
          case 't': store.setViewportType(store.activeViewportId, 'top'); break;
          case 'f': store.setViewportType(store.activeViewportId, 'front'); break;
          case 'l': store.setViewportType(store.activeViewportId, 'left'); break;
          case 'p': store.setViewportType(store.activeViewportId, 'perspective'); break;
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
      <div className="h-6 bg-gray-850 border-t border-gray-950 flex items-center px-4 gap-4 text-[10px] text-gray-500">
        <span className="flex items-center gap-1"><kbd className="bg-gray-700 px-1 rounded text-gray-300">W</kbd> Move</span>
        <span className="flex items-center gap-1"><kbd className="bg-gray-700 px-1 rounded text-gray-300">E</kbd> Rotate</span>
        <span className="flex items-center gap-1"><kbd className="bg-gray-700 px-1 rounded text-gray-300">R</kbd> Scale</span>
        <span className="flex items-center gap-1"><kbd className="bg-gray-700 px-1 rounded text-gray-300">D</kbd> Edit Pivot</span>
        <span className="flex items-center gap-1"><kbd className="bg-gray-700 px-1 rounded text-gray-300">G</kbd> Grid</span>
        <div className="w-px h-3 bg-gray-700 mx-2"></div>
        <span className="flex items-center gap-1"><kbd className="bg-gray-700 px-1 rounded text-gray-300">T</kbd> Top</span>
        <span className="flex items-center gap-1"><kbd className="bg-gray-700 px-1 rounded text-gray-300">F</kbd> Front</span>
        <span className="flex items-center gap-1"><kbd className="bg-gray-700 px-1 rounded text-gray-300">L</kbd> Left</span>
        <span className="flex items-center gap-1"><kbd className="bg-gray-700 px-1 rounded text-gray-300">P</kbd> Persp</span>
        <div className="w-px h-3 bg-gray-700 mx-2"></div>
        <span className="flex items-center gap-1"><kbd className="bg-gray-700 px-1 rounded text-gray-300">+</kbd><kbd className="bg-gray-700 px-1 rounded text-gray-300">-</kbd> Gizmo Size</span>
        <div className="flex-1"></div>
        <span className="flex items-center gap-1"><kbd className="bg-gray-700 px-1 rounded text-gray-300">Ctrl+Z</kbd> Undo</span>
      </div>
    </div>
  );
}