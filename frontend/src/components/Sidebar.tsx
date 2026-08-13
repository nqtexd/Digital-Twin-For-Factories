import { Bell, BrainCircuit, ChevronLeft, ChevronRight, Factory, Gauge, RadioTower } from 'lucide-react'
import { motion } from 'framer-motion'
import type { NavigationSection } from '../types'
import { FlowTwinLogo } from './FlowTwinLogo'

export function Sidebar({ page, onChange, collapsed, onToggle, connectedAssets }: { page: NavigationSection; onChange: (page: NavigationSection) => void; collapsed: boolean; onToggle: () => void; connectedAssets: number }) {
  const items = [
    { id: 'overview' as const, label: 'Overview', hint: 'Plant condition', icon: Gauge },
    { id: 'factory' as const, label: 'Factory', hint: 'Spatial twin', icon: Factory },
    { id: 'incidents' as const, label: 'Incidents', hint: 'Event response', icon: Bell },
    { id: 'brain' as const, label: 'Company Brain', hint: 'Knowledge & guidance', icon: BrainCircuit },
  ]
  return <aside className={`sidebar navigation-rail ${collapsed ? 'collapsed' : ''}`} aria-label="Primary navigation">
    <header className="sidebar-brand">
      <FlowTwinLogo size={38}/>
      <div className="brand-copy"><strong>FlowTwin</strong><small>Plant intelligence</small></div>
    </header>

    <div className="sidebar-section-head">
      <span>Workspace</span>
      <button className="sidebar-toggle" onClick={onToggle} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
        {collapsed ? <ChevronRight size={17}/> : <><ChevronLeft size={17}/><span>Collapse</span></>}
      </button>
    </div>

    <nav aria-label="Workspace sections">
      {items.map(({id,label,hint,icon:Icon}) => <button key={id} className={`nav-item ${page===id?'active':''}`} onClick={()=>onChange(id)} aria-current={page===id?'page':undefined} title={collapsed?label:undefined}>
        <span className="nav-icon"><Icon size={19}/>{page===id&&<motion.i layoutId="active-nav" transition={{type:'spring',stiffness:420,damping:36}}/>}</span>
        <span className="nav-copy"><strong>{label}</strong><small>{hint}</small></span>
        <ChevronRight className="nav-chevron" size={15}/>
      </button>)}
    </nav>

    <div className="sidebar-spacer"/>
    <section className="sidebar-network" title={collapsed?`${connectedAssets} assets connected`:undefined}>
      <span className="network-icon"><RadioTower size={17}/><i/></span>
      <div><strong>Edge network</strong><small>{connectedAssets} asset{connectedAssets===1?'':'s'} connected</small></div>
      <b>Live</b>
    </section>
  </aside>
}
