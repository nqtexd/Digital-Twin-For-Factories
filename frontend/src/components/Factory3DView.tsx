import { Component, type ReactNode, Suspense, useMemo, useRef, useState } from 'react'
import { Canvas, type ThreeEvent, useFrame } from '@react-three/fiber'
import { ContactShadows, Grid, Html, Line, OrbitControls } from '@react-three/drei'
import type { Group, Mesh } from 'three'
import { Box, Download, Layers, Focus, Maximize2, MousePointer2, Rotate3D, X } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import type { FleetItem } from '../types'
import { MachineGlyph } from './MachineGlyph'
import { LoadedMachineGeometry, MachineGeometryProcedural, type MachineAnimState } from './LoadedMachineGeometry'

const VIBRATION_THRESHOLD = 6.5
const TEMP_LIMITS_FACTORY: Record<string, number> = {
  cnc_lathe: 72, cnc_mill: 72, cnc_sat: 72,
  hydraulic_press: 85, coolant_pump: 65, surface_grinder: 78, default: 80,
}
function buildFactoryAnimState(item: FleetItem): MachineAnimState {
  const t = item.telemetry
  if (!t) return { temperatureAlert: false, highVibration: false, normalOp: false, simulationActive: false, simulationProgress: 0 }
  const limit = TEMP_LIMITS_FACTORY[item.machine.machine_type] ?? TEMP_LIMITS_FACTORY.default
  return {
    temperatureAlert: t.temperature_c > limit,
    highVibration: t.vibration_rms_velocity_mm_s > VIBRATION_THRESHOLD,
    normalOp: !t.simulation_scenario && t.risk_level === 'low',
    simulationActive: Boolean(t.simulation_scenario),
    simulationProgress: t.simulation_progress ?? 0,
  }
}

type Position3D = [number, number, number]
const toWorld = (item: FleetItem, index: number): Position3D => {
  const fallback = [[18,27],[61,27],[17,70],[49,70],[80,70]][index % 5]
  const x = item.machine.metadata?.layout_x ?? fallback[0]
  const y = item.machine.metadata?.layout_y ?? fallback[1]
  return [(x - 50) / 4.25, 0, (y - 50) / 5]
}

const toneFor = (item: FleetItem) => {
  const risk = item.telemetry?.risk_level
  return risk === 'high' || risk === 'critical' ? '#ff6b70' : risk === 'medium' ? '#f5c15e' : '#ff8a3d'
}

class ThreeErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false }
  static getDerivedStateFromError() { return { hasError: true } }
  componentDidCatch(error: unknown) { console.warn('3D Model load fallback triggered:', error) }
  render() {
    if (this.state.hasError) return this.props.fallback
    return this.props.children
  }
}

function MachineModel({ item, position, selected, onSelect, useCad }: { item: FleetItem; position: Position3D; selected: boolean; onSelect: () => void; useCad: boolean }) {
  const group = useRef<Group>(null)
  const beacon = useRef<Mesh>(null)
  const [hovered, setHovered] = useState(false)
  const tone = toneFor(item)
  useFrame(({ clock }) => {
    if (group.current) group.current.position.y = (selected ? .13 : .04) + Math.sin(clock.elapsedTime * 1.7 + position[0]) * .018
    if (beacon.current) beacon.current.scale.setScalar(.8 + Math.sin(clock.elapsedTime * 3.2) * .18)
  })
  const animState = buildFactoryAnimState(item)
  const click = (event: ThreeEvent<MouseEvent>) => { event.stopPropagation(); onSelect() }
  return <group ref={group} position={position} onClick={click} onPointerOver={(event) => { event.stopPropagation(); setHovered(true); document.body.style.cursor='pointer' }} onPointerOut={() => { setHovered(false); document.body.style.cursor='default' }}>
    {useCad ? (
      <ThreeErrorBoundary fallback={<MachineGeometryProcedural type={item.machine.machine_type} tone={tone} anim={animState} />}>
        <Suspense fallback={<MachineGeometryProcedural type={item.machine.machine_type} tone={tone} anim={animState} />}>
          <LoadedMachineGeometry type={item.machine.machine_type} tone={tone} animState={animState} />
        </Suspense>
      </ThreeErrorBoundary>
    ) : (
      <MachineGeometryProcedural type={item.machine.machine_type} tone={tone} anim={animState} />
    )}
    <mesh ref={beacon} position={[0,1.85,0]}><sphereGeometry args={[.08,16,16]}/><meshBasicMaterial color={tone}/></mesh>
    <pointLight position={[0,1.8,0]} color={tone} intensity={selected ? 1.6 : .45} distance={4}/>
    {(selected || hovered) && <Html position={[0,2.15,0]} center distanceFactor={10} zIndexRange={[20,0]}><div className={`scene-machine-label ${selected ? 'selected' : ''}`}><div><span><MachineGlyph type={item.machine.machine_type} size={12}/></span><div><strong>{item.machine.display_name}</strong><small>{item.machine.metadata?.operation || item.machine.machine_type.replaceAll('_',' ')}</small></div></div><p>{item.machine.metadata?.description}</p><footer><b style={{color:tone}}>{item.telemetry ? `${Math.round(item.telemetry.health_score)} health` : 'Offline'}</b><span>{item.machine.line_name}</span></footer></div></Html>}
    {selected && <mesh position={[0,.03,0]} rotation={[-Math.PI/2,0,0]}><ringGeometry args={[1.2,1.28,48]}/><meshBasicMaterial color={tone} transparent opacity={.75}/></mesh>}
  </group>
}

function FlowMarker({ from, to, color, offset }: { from: Position3D; to: Position3D; color: string; offset: number }) {
  const ref = useRef<Mesh>(null)
  useFrame(({ clock }) => {
    const progress = (clock.elapsedTime * .12 + offset) % 1
    if (ref.current) ref.current.position.set(from[0] + (to[0]-from[0])*progress, .13, from[2] + (to[2]-from[2])*progress)
  })
  return <mesh ref={ref}><sphereGeometry args={[.06,12,12]}/><meshBasicMaterial color={color}/></mesh>
}

function PlantScene({ fleet, selectedId, onSelect, useCad }: { fleet: FleetItem[]; selectedId: string; onSelect: (id: string) => void; useCad: boolean }) {
  const positions = useMemo(() => fleet.map(toWorld), [fleet])
  const connections = useMemo(() => {
    const rows: { from:number; to:number; utility:boolean }[] = []
    const byLine = new Map<string, number[]>()
    fleet.forEach((item,index) => { const line=item.machine.line_name.split('·')[0].trim(); byLine.set(line,[...(byLine.get(line)||[]),index]) })
    byLine.forEach((indices) => indices.sort((a,b)=>positions[a][0]-positions[b][0]).forEach((value,index)=>{if(index) rows.push({from:indices[index-1],to:value,utility:false})}))
    const utilities=fleet.map((item,index)=>({item,index})).filter(({item})=>item.machine.line_name.toLowerCase().includes('utilit'))
    utilities.forEach(({index})=>fleet.forEach((item,target)=>{if(index!==target&&!item.machine.line_name.toLowerCase().includes('utilit'))rows.push({from:index,to:target,utility:true})}))
    return rows
  },[fleet,positions])
  return <>
    <color attach="background" args={['#17110d']}/><fog attach="fog" args={['#17110d',20,36]}/>
    <ambientLight intensity={1.15}/><hemisphereLight args={['#c6edf3','#0b1920',2]}/><directionalLight position={[7,12,5]} intensity={3} castShadow shadow-mapSize={[1024,1024]}/>
    <Grid args={[24,16]} position={[0,-.04,0]} cellSize={1} cellThickness={.45} cellColor="#493426" sectionSize={4} sectionThickness={.8} sectionColor="#70503a" fadeDistance={26} fadeStrength={1.5}/>
    <mesh position={[0,-.12,0]} receiveShadow><boxGeometry args={[24,.18,16]}/><meshStandardMaterial color="#2a1e16" roughness={.78} metalness={.2}/></mesh>
    {connections.map((connection,index)=>{const from=positions[connection.from],to=positions[connection.to],color=connection.utility?'#62a7ff':'#54e7c0';return <group key={`${connection.from}-${connection.to}-${index}`}><Line points={[[from[0],.08,from[2]],[to[0],.08,to[2]]]} color={color} lineWidth={.65} transparent opacity={.38} dashed dashScale={8} dashSize={.45} gapSize={.3}/><FlowMarker from={from} to={to} color={color} offset={(index*.23)%1}/></group>})}
    {fleet.map((item,index)=><MachineModel key={item.machine.machine_id} item={item} position={positions[index]} selected={item.machine.machine_id===selectedId} onSelect={()=>onSelect(item.machine.machine_id)} useCad={useCad}/>)}
    <ContactShadows position={[0,.01,0]} opacity={.5} scale={24} blur={2.6} far={12}/>
    <OrbitControls makeDefault enableDamping dampingFactor={.08} minDistance={8} maxDistance={30} maxPolarAngle={Math.PI/2.12} target={[0,.5,0]}/>
  </>
}

const cameras = { perspective: [11,12,15] as Position3D, top: [0,22,.01] as Position3D, floor: [16,5,13] as Position3D }

const MODEL_ASSETS = [
  { name: '2-Axis CNC SAT Model', path: '/models/2_axis_CNC.SAT', size: '29 MB', type: 'ACIS SAT (.sat)', tag: '2-Axis CNC Machine' },
  { name: 'Hydro-Press 3D GLB', path: '/models/hydraulic_press.glb', size: '5.4 MB', type: '3D CAD Mesh (.glb)', tag: 'Hydraulic Press' },
  { name: 'Universal Pump 3D OBJ', path: '/models/pump.obj', size: '15.3 MB', type: 'Wavefront OBJ (.obj)', tag: 'Coolant Pump & Grinder' },
  { name: 'CNC Lathe Blender Base', path: '/models/CNC_Lathe_Universal_Turning_Center_blender_base.blend', size: '5.4 MB', type: 'Blender 3D (.blend)', tag: 'CNC Turning Center' },
  { name: 'SolidWorks Renderings Package', path: '/models/Renderings(793).zip', size: '2.8 MB', type: 'CAD Assembly (.zip)', tag: 'Full Plant CAD' },
  { name: 'CNC Machine Render 01', path: '/models/cncmachine.jpg', size: '320 KB', type: 'Rendering (.jpg)', tag: 'High-Res Preview' },
  { name: 'CNC Machine Render 02', path: '/models/cncmachine01.jpg', size: '280 KB', type: 'Rendering (.jpg)', tag: 'High-Res Preview' },
]


export function Factory3DView({ fleet, selectedId, onSelect }: { fleet: FleetItem[]; selectedId: string; onSelect: (id: string) => void }) {
  const [camera, setCamera] = useState<keyof typeof cameras>('perspective')
  const [reset, setReset] = useState(0)
  const [useCad, setUseCad] = useState(true)
  const [showAssetsModal, setShowAssetsModal] = useState(false)
  const selected = fleet.find((item)=>item.machine.machine_id===selectedId)

  return <motion.div className="real-3d-view" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}>
    <div className="real-3d-toolbar">
      <span><Box size={13}/>Live spatial model</span>
      <div className="camera-presets">
        <button className={camera==='perspective'?'active':''} onClick={()=>setCamera('perspective')}><Rotate3D size={11}/>Orbit</button>
        <button className={camera==='top'?'active':''} onClick={()=>setCamera('top')}><Maximize2 size={11}/>Top</button>
        <button className={camera==='floor'?'active':''} onClick={()=>setCamera('floor')}><Focus size={11}/>Floor</button>
      </div>
      <button className={`reset-camera ${useCad ? 'active' : ''}`} onClick={()=>setUseCad(!useCad)} title="Toggle High-Detail CAD Mesh rendering">
        <Layers size={11}/>{useCad ? 'CAD Meshes Active' : 'Schematic Mode'}
      </button>
      <button className="reset-camera" onClick={()=>setShowAssetsModal(true)} title="View & Download 3D Model Assets">
        <Download size={11}/>3D Assets
      </button>
      <button className="reset-camera" onClick={()=>setReset((value)=>value+1)}>Reset camera</button>
    </div>

    <div className="real-3d-canvas">
      <Canvas key={`${camera}-${reset}-${useCad}`} shadows dpr={[1,1.7]} camera={{position:cameras[camera],fov:45,near:.1,far:100}} onPointerMissed={()=>{}}>
        <Suspense fallback={null}>
          <PlantScene fleet={fleet} selectedId={selectedId} onSelect={onSelect} useCad={useCad}/>
        </Suspense>
      </Canvas>
      <div className="scene-help">
        <MousePointer2 size={11}/>
        <span>Drag to orbit · Scroll to zoom · Right-drag to pan · Select a machine</span>
      </div>
      {selected&&<div className="scene-selection">
        <span><MachineGlyph type={selected.machine.machine_type} size={14}/></span>
        <div><small>Selected asset</small><strong>{selected.machine.display_name}</strong></div>
        <b style={{color:toneFor(selected)}}>{selected.telemetry?`${Math.round(selected.telemetry.risk_score*100)}% risk`:'offline'}</b>
      </div>}
    </div>

    <AnimatePresence>
      {showAssetsModal && (
        <motion.div
          className="assets-modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(10, 15, 20, 0.82)',
            backdropFilter: 'blur(8px)',
            zIndex: 999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
          }}
          onClick={() => setShowAssetsModal(false)}
        >
          <motion.div
            className="assets-modal-card"
            initial={{ scale: 0.94, opacity: 0, y: 12 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.94, opacity: 0, y: 12 }}
            style={{
              backgroundColor: 'var(--card-bg, #182229)',
              border: '1px solid rgba(120, 200, 220, 0.2)',
              borderRadius: '16px',
              padding: '24px',
              maxWidth: '640px',
              width: '100%',
              boxShadow: '0 24px 64px rgba(0, 0, 0, 0.6)',
              color: 'var(--text-color, #e2f1f5)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Box size={18} style={{ color: '#54e7c0' }} /> Plant 3D CAD Models & Assets
                </h3>
                <p style={{ margin: '4px 0 0 0', fontSize: '12px', opacity: 0.7 }}>
                  Native 3D models integrated into FlowTwin interactive digital twin environment
                </p>
              </div>
              <button
                onClick={() => setShowAssetsModal(false)}
                style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', opacity: 0.7 }}
              >
                <X size={18} />
              </button>
            </div>

            <div style={{ display: 'grid', gap: '10px', maxHeight: '360px', overflowY: 'auto', paddingRight: '4px' }}>
              {MODEL_ASSETS.map((asset) => (
                <div
                  key={asset.path}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px 14px',
                    borderRadius: '10px',
                    backgroundColor: 'rgba(255, 255, 255, 0.04)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                  }}
                >
                  <div>
                    <strong style={{ fontSize: '14px', display: 'block', marginBottom: '2px' }}>{asset.name}</strong>
                    <div style={{ display: 'flex', gap: '8px', fontSize: '11px', opacity: 0.65 }}>
                      <span>{asset.type}</span>
                      <span>·</span>
                      <span>{asset.size}</span>
                      <span>·</span>
                      <span style={{ color: '#54e7c0' }}>{asset.tag}</span>
                    </div>
                  </div>
                  <a
                    href={asset.path}
                    download
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '6px 12px',
                      borderRadius: '8px',
                      backgroundColor: 'rgba(84, 231, 192, 0.15)',
                      color: '#54e7c0',
                      border: '1px solid rgba(84, 231, 192, 0.3)',
                      fontSize: '12px',
                      fontWeight: 500,
                      textDecoration: 'none',
                    }}
                  >
                    <Download size={13} /> Download
                  </a>
                </div>
              ))}
            </div>

            <div style={{ marginTop: '20px', paddingTop: '14px', borderTop: '1px solid rgba(255, 255, 255, 0.1)', fontSize: '12px', opacity: 0.75, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Loaded dynamically via Three.js / React Three Fiber</span>
              <button
                onClick={() => setShowAssetsModal(false)}
                style={{
                  padding: '6px 16px',
                  borderRadius: '8px',
                  backgroundColor: '#54e7c0',
                  color: '#0e181c',
                  border: 'none',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Done
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  </motion.div>
}

