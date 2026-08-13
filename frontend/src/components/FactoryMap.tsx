import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { Box, Check, LayoutGrid, MapPin, Plus, X } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { api } from '../lib/api'
import type { FactoryViewMode, FleetItem, MachineCreateInput, MachineTypePreset } from '../types'
import { Factory2DView } from './Factory2DView'
import { MachineGlyph } from './MachineGlyph'

const Factory3DView = lazy(() => import('./Factory3DView').then((module) => ({ default: module.Factory3DView })))

function AddMachineWizard({ catalog, fleet, onClose, onAdded }: { catalog: MachineTypePreset[]; fleet: FleetItem[]; onClose: () => void; onAdded: (id: string) => Promise<void> | void }) {
  const [step, setStep] = useState(1)
  const [selectedType, setSelectedType] = useState(catalog[0]?.machine_type || '')
  const [form, setForm] = useState<MachineCreateInput>({ machine_id: '', machine_type: catalog[0]?.machine_type || '', display_name: '', line_name: 'Machining · A', layout_x: 50, layout_y: 50 })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const preset = catalog.find((item) => item.machine_type === selectedType)

  useEffect(() => {
    if (!preset) return
    const number = fleet.filter((item) => item.machine.machine_type === preset.machine_type).length + 1
    const prefix = preset.machine_type.split('_').map((part)=>part[0]).join('').toUpperCase()
    const x = 15 + ((fleet.length * 19) % 70)
    const y = fleet.length % 2 ? 68 : 30
    setForm({ machine_id: `${prefix}-${String(fleet.length + 1).padStart(3,'0')}`, machine_type: preset.machine_type, display_name: `${preset.label} ${String(number).padStart(2,'0')}`, line_name: preset.operation === 'circulation' ? 'Utilities · U1' : 'Machining · A', layout_x: x, layout_y: y })
  }, [selectedType, preset, fleet.length])

  const create = async () => {
    setBusy(true); setError('')
    try { const created = await api.createMachine(form); await onAdded(created.machine.machine_id); onClose() }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not add this machine.') }
    finally { setBusy(false) }
  }

  return <motion.div className="machine-wizard-backdrop" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} onMouseDown={onClose}>
    <motion.section className="machine-wizard panel" initial={{opacity:0,y:18,scale:.985}} animate={{opacity:1,y:0,scale:1}} exit={{opacity:0,y:10}} onMouseDown={(event)=>event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="machine-wizard-title">
      <header><div><span className="eyebrow">Factory model</span><h2 id="machine-wizard-title">Add a machine</h2><p>The same asset and floor position will be used in the 2D plan, 3D model, telemetry and Company Brain.</p></div><button onClick={onClose} aria-label="Close"><X size={17}/></button></header>
      <div className="wizard-steps"><span className={step>=1?'active':''}><i>{step>1?<Check size={10}/>:1}</i>Machine type</span><b/><span className={step>=2?'active':''}><i>2</i>Identity & placement</span></div>
      {step===1?<div className="machine-type-grid">{catalog.map((type)=><button key={type.machine_type} className={selectedType===type.machine_type?'active':''} onClick={()=>setSelectedType(type.machine_type)}><span><MachineGlyph type={type.machine_type} size={21}/></span><div><strong>{type.label}</strong><p>{type.description}</p><small>{type.operation} · {type.rated_power_kw} kW · {type.rated_rpm.toLocaleString()} rpm</small></div><i>{selectedType===type.machine_type&&<Check size={11}/>}</i></button>)}</div>:
      <div className="machine-setup-grid"><div className="machine-fields"><label>Machine ID<input value={form.machine_id} onChange={(event)=>setForm({...form,machine_id:event.target.value.toUpperCase().replace(/[^A-Z0-9-]/g,'')})}/><small>Unique equipment identifier</small></label><label>Display name<input value={form.display_name} onChange={(event)=>setForm({...form,display_name:event.target.value})}/></label><label>Production area<select value={form.line_name} onChange={(event)=>setForm({...form,line_name:event.target.value})}><option>Machining · A</option><option>Forming · B</option><option>Finishing · C</option><option>Utilities · U1</option><option>Inspection · Q1</option></select></label><div className="selected-type-summary"><span><MachineGlyph type={form.machine_type} size={19}/></span><div><strong>{preset?.label}</strong><p>{preset?.description}</p></div></div></div><div className="placement-editor"><div><span className="eyebrow">Floor position</span><p>Place the machine once; both map views use these coordinates.</p></div><div className="placement-floor" onPointerDown={(event)=>{const rect=event.currentTarget.getBoundingClientRect();setForm({...form,layout_x:Math.round(Math.max(7,Math.min(93,(event.clientX-rect.left)/rect.width*100))),layout_y:Math.round(Math.max(12,Math.min(88,(event.clientY-rect.top)/rect.height*100)))})}}><div className="placement-zone production">Production</div><div className="placement-zone services">Services</div><motion.span animate={{left:`${form.layout_x}%`,top:`${form.layout_y}%`}}><MapPin size={17}/><b>{form.display_name||'New machine'}</b></motion.span>{fleet.map((item,index)=><i key={item.machine.machine_id} style={{left:`${item.machine.metadata?.layout_x??15+index*15}%`,top:`${item.machine.metadata?.layout_y??50}%`}} title={item.machine.display_name}/>)}</div><div className="placement-coordinates"><span>X <b>{form.layout_x}</b></span><span>Y <b>{form.layout_y}</b></span><small>Click the floor to reposition</small></div></div></div>}
      {error&&<div className="wizard-error">{error}</div>}
      <footer><button className="secondary-button" onClick={step===1?onClose:()=>setStep(1)}>{step===1?'Cancel':'Back'}</button>{step===1?<button className="primary-button" onClick={()=>setStep(2)} disabled={!selectedType}>Continue</button>:<button className="primary-button" onClick={create} disabled={busy||!form.machine_id||!form.display_name}>{busy?'Adding machine…':<><Plus size={14}/>Add to factory</>}</button>}</footer>
    </motion.section>
  </motion.div>
}

export function FactoryMap({ fleet, selectedId, onSelect, onMachineAdded, onMachineDeleted, initialView = '2d', onViewChange }: { fleet: FleetItem[]; selectedId: string; onSelect: (id: string) => void; onMachineAdded: (id: string) => Promise<void> | void; onMachineDeleted?: (id: string) => void; initialView?: FactoryViewMode; onViewChange?: (view: FactoryViewMode) => void }) {
  const [view, setViewState] = useState<FactoryViewMode>(initialView)
  const setView = (next: FactoryViewMode) => { setViewState(next); onViewChange?.(next) }
  const [catalog, setCatalog] = useState<MachineTypePreset[]>([])
  const [wizardOpen, setWizardOpen] = useState(false)
  useEffect(()=>{api.machineTypes().then(setCatalog).catch(()=>setCatalog([]))},[])
  const activeCount = useMemo(()=>fleet.filter((item)=>item.telemetry&&Date.now()-new Date(item.telemetry.recorded_at).getTime()<=15000).length,[fleet])
  return <section className="factory-map panel" aria-labelledby="factory-map-title">
    <div className="factory-map-head"><div><span className="eyebrow">FlowTwin / spatial operations</span><h2 id="factory-map-title">Live factory</h2></div><div className="map-head-meta"><span className="stream-count"><i/>{activeCount} of {fleet.length} assets streaming</span><button className="add-machine-button" onClick={()=>setWizardOpen(true)}><Plus size={13}/>Add asset</button><div className="map-view-toggle" role="group" aria-label="Factory map view"><button className={view==='2d'?'active':''} onClick={()=>setView('2d')}><LayoutGrid size={12}/>Plan</button><button className={view==='3d'?'active':''} onClick={()=>setView('3d')}><Box size={12}/>3D</button></div></div></div>
    <AnimatePresence mode="wait">{view==='2d'?<Factory2DView key="2d" fleet={fleet} selectedId={selectedId} onSelect={onSelect} onMachineDeleted={onMachineDeleted}/>:<Suspense key="3d" fallback={<div className="scene-loading"><Box size={20}/><span>Preparing spatial model…</span></div>}><Factory3DView fleet={fleet} selectedId={selectedId} onSelect={onSelect}/></Suspense>}</AnimatePresence>
    <AnimatePresence>{wizardOpen&&<AddMachineWizard catalog={catalog} fleet={fleet} onClose={()=>setWizardOpen(false)} onAdded={onMachineAdded}/>}</AnimatePresence>
  </section>
}
