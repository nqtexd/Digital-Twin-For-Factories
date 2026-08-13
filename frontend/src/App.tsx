import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ArrowRight, CalendarDays, Menu, Moon, RefreshCw, ShieldCheck, Sun } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Sidebar } from './components/Sidebar'
import { FactoryMap } from './components/FactoryMap'
import { TelemetryChart } from './components/TelemetryChart'
import { RiskPanel } from './components/RiskPanel'
import { FailureSimulator } from './components/FailureSimulator'
import { OperatorInput } from './components/OperatorInput'
import { DigitalBrain } from './components/DigitalBrain'
import { AlertsPanel } from './components/AlertsPanel'
import { MachineGlyph } from './components/MachineGlyph'
import { FlowTwinLogo } from './components/FlowTwinLogo'
import { api } from './lib/api'
import { supabase } from './lib/supabase'
import type { AlertItem, FactoryViewMode, FleetItem, HealthStatus, NavigationSection, Telemetry, ThemeMode } from './types'

const pathToPage = (): NavigationSection => {
  const value = location.pathname.split('/')[1]
  return value === 'factory' || value === 'incidents' || value === 'brain' ? value : 'overview'
}

function App() {
  const reduceMotion = useReducedMotion()
  const [page, setPage] = useState<NavigationSection>(pathToPage)
  const [fleet, setFleet] = useState<FleetItem[]>([])
  const [selectedId, setSelectedId] = useState(() => new URLSearchParams(location.search).get('asset') || '')
  const [telemetryHistory, setHistory] = useState<Telemetry[]>([])
  const [health, setHealth] = useState<HealthStatus | null>(null)
  const [alerts, setAlerts] = useState<AlertItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('flowtwin-sidebar-collapsed') === 'true')
  const [theme, setTheme] = useState<ThemeMode>(() => (localStorage.getItem('flowtwin-theme') as ThemeMode) || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'))
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdated, setLastUpdated] = useState(new Date())

  const selected = useMemo(() => fleet.find((x) => x.machine.machine_id === selectedId) || fleet[0], [fleet, selectedId])
  const loadFleet = useCallback(async () => {
    setRefreshing(true)
    try {
      const [fleetData, healthData, alertData] = await Promise.all([api.fleet(), api.health(), api.alerts()])
      setFleet(fleetData); setHealth(healthData); setAlerts(alertData)
      if (!selectedId && fleetData[0]) setSelectedId(fleetData[0].machine.machine_id)
      setError(''); setLastUpdated(new Date())
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not connect to the plant intelligence service.') }
    finally { setLoading(false); setRefreshing(false) }
  }, [selectedId])

  useEffect(() => { loadFleet() }, [loadFleet])
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('flowtwin-theme', theme) }, [theme])
  useEffect(() => {
    const onPop = () => setPage(pathToPage())
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setSidebarOpen(false) }
    addEventListener('popstate', onPop); addEventListener('keydown', onKey)
    return () => { removeEventListener('popstate', onPop); removeEventListener('keydown', onKey) }
  }, [])
  useEffect(() => { if (selected?.machine.machine_id) api.history(selected.machine.machine_id).then(setHistory).catch(() => setHistory([])) }, [selected?.machine.machine_id])
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 4500); return () => clearTimeout(timer) }, [notice])
  useEffect(() => {
    const realtime = supabase
    if (!realtime) { const timer = setInterval(loadFleet, 5000); return () => clearInterval(timer) }
    const telemetry = realtime.channel('flowtwin-live-telemetry').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'machine_telemetry' }, (payload) => {
      const incoming = payload.new as Telemetry
      setFleet((rows) => rows.map((item) => item.machine.machine_id === incoming.machine_id ? { ...item, telemetry: incoming } : item))
      if (incoming.machine_id === selectedId) setHistory((rows) => [...rows.slice(-119), incoming])
    }).subscribe()
    const alertFeed = realtime.channel('flowtwin-live-alerts').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'alerts' }, (payload) => setAlerts((rows) => [payload.new as AlertItem, ...rows].slice(0, 50))).subscribe()
    return () => { realtime.removeChannel(telemetry); realtime.removeChannel(alertFeed) }
  }, [loadFleet, selectedId])

  const metrics = useMemo(() => {
    const rows = fleet.map((item) => item.telemetry).filter(Boolean) as Telemetry[]
    return {
      health: rows.length ? rows.reduce((sum, row) => sum + row.health_score, 0) / rows.length : 0,
      utilization: rows.length ? rows.reduce((sum, row) => sum + row.utilization_pct, 0) / rows.length : 0,
      risk: rows.filter((row) => row.risk_level === 'high' || row.risk_level === 'critical').length,
      peak: rows.length ? Math.max(...rows.map((row) => row.risk_score)) : 0,
    }
  }, [fleet])

  const navigate = (next: NavigationSection, asset?: string) => {
    const query = asset ? `?asset=${encodeURIComponent(asset)}` : ''
    history.pushState({}, '', `/${next}${query}`); setPage(next); setSidebarOpen(false)
    if (asset) setSelectedId(asset)
  }
  const selectAsset = (id: string) => {
    setSelectedId(id)
    const query = new URLSearchParams(location.search); query.set('asset', id)
    history.replaceState({}, '', `${location.pathname}?${query}`)
  }
  const setFactoryView = (mode: FactoryViewMode) => { const query = new URLSearchParams(location.search); query.set('view', mode); history.replaceState({}, '', `${location.pathname}?${query}`) }
  const acknowledge = async (id: string) => {
    const previous = alerts
    setAlerts((rows) => rows.map((item) => item.id === id ? { ...item, acknowledged: true } : item))
    try { await api.acknowledgeAlert(id); setNotice('Incident acknowledged') }
    catch (reason) { setAlerts(previous); setNotice(reason instanceof Error ? reason.message : 'Acknowledgement failed') }
  }
  const toggleSidebar = () => setSidebarCollapsed((current) => { localStorage.setItem('flowtwin-sidebar-collapsed', String(!current)); return !current })
  if (loading) return <div className="app-loading premium-loader"><FlowTwinLogo size={52}/><strong>Preparing your plant</strong><span>Synchronizing operational context</span><div className="loading-line"><i/></div></div>

  const pageTitle = { overview: 'Overview', factory: 'Factory', incidents: 'Incidents', brain: 'Company Brain' }[page]
  const transition = reduceMotion ? { duration: 0 } : { duration: .42, ease: [0.22, 1, 0.36, 1] as [number,number,number,number] }
  return <div className={`app-shell premium-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
    <button className={`sidebar-scrim ${sidebarOpen ? 'visible' : ''}`} onClick={() => setSidebarOpen(false)} aria-label="Close navigation"/>
    <div className={`sidebar-drawer ${sidebarOpen ? 'open' : ''}`}><Sidebar page={page} onChange={navigate} collapsed={sidebarCollapsed} onToggle={toggleSidebar} connectedAssets={fleet.length}/></div>
    <main className="main-shell">
      <header className="topbar premium-topbar">
        <div className="topbar-left"><button className="mobile-menu" onClick={() => setSidebarOpen(!sidebarOpen)} aria-label="Open navigation"><Menu size={19}/></button><div className="breadcrumb"><span>FlowTwin</span><i>/</i><strong>{pageTitle}</strong></div></div>
        <div className="topbar-right">
          <button className="icon-button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label={`Use ${theme === 'dark' ? 'light' : 'dark'} theme`}>{theme === 'dark' ? <Sun size={16}/> : <Moon size={16}/>}</button>
          <button className={`icon-button ${refreshing ? 'spinning' : ''}`} onClick={loadFleet} aria-label="Refresh"><RefreshCw size={15}/></button>
        </div>
      </header>
      {error && <div className="error-banner"><AlertTriangle size={16}/><span><strong>Live data unavailable.</strong> Showing the latest available operational state.</span><button onClick={loadFleet}>Reconnect</button></div>}
      <AnimatePresence mode="wait">
        {page === 'overview' && <motion.div key="overview" className="page-wrap premium-page" initial={{opacity:0,y:reduceMotion?0:14}} animate={{opacity:1,y:0}} exit={{opacity:0,y:reduceMotion?0:-8}} transition={transition}>
          <section className="hero-command"><div><div className="header-kicker"><span className="eyebrow">Plant command · Shift 02</span><span><CalendarDays size={12}/>{lastUpdated.toLocaleDateString([], { month:'short', day:'numeric' })}</span></div><h1>Good morning.<br/><em>The plant is {metrics.risk ? 'asking for attention.' : 'running within range.'}</em></h1><p>A focused view of production health, emerging risk, and the decisions that matter now.</p></div><div className={`plant-verdict ${metrics.risk ? 'attention' : ''}`}><div>{metrics.risk ? <AlertTriangle/> : <ShieldCheck/>}</div><span><small>Plant condition</small><strong>{metrics.risk ? `${metrics.risk} asset${metrics.risk > 1 ? 's' : ''} require review` : 'All systems nominal'}</strong><p>Updated {lastUpdated.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</p></span></div></section>
          <section className="metric-ledger">{[
            ['Fleet health', Math.round(metrics.health), '/100', 'Composite condition'], ['Utilization', Math.round(metrics.utilization), '%', 'Across active assets'], ['Assets at risk', metrics.risk, '', 'High or critical'], ['Peak exposure', Math.round(metrics.peak*100), '%', 'Highest current risk']
          ].map(([label,value,suffix,note], index) => <motion.article key={String(label)} initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} transition={{delay:index*.055}}><span>{label}</span><div><strong>{value}</strong><small>{suffix}</small></div><p>{note}</p><i style={{'--metric': `${index === 0 ? metrics.health : index === 1 ? metrics.utilization : index === 2 ? metrics.risk*20 : metrics.peak*100}%`} as React.CSSProperties}/></motion.article>)}</section>
          <div className="overview-grid">
            <section className="panel production-brief"><header><div><span className="eyebrow">Live production</span><h2>Factory pulse</h2></div><button onClick={() => navigate('factory')}>Open spatial view <ArrowRight size={14}/></button></header><div className="production-flow">{fleet.slice(0,5).map((item,index) => <button key={item.machine.machine_id} onClick={() => navigate('factory',item.machine.machine_id)}><span className={`machine-orb risk-${item.telemetry?.risk_level || 'offline'}`}><MachineGlyph type={item.machine.machine_type}/></span><div><small>{item.machine.machine_id}</small><strong>{item.machine.display_name}</strong><p>{item.telemetry ? `${Math.round(item.telemetry.health_score)} health · ${Math.round(item.telemetry.utilization_pct)}% utilization` : 'Awaiting telemetry'}</p></div>{index < Math.min(fleet.length,5)-1 && <i/>}</button>)}</div></section>
            <section className="panel priority-brief"><header><div><span className="eyebrow">Priority queue</span><h2>Needs attention</h2></div><b>{metrics.risk}</b></header><div>{[...fleet].sort((a,b)=>(b.telemetry?.risk_score||0)-(a.telemetry?.risk_score||0)).slice(0,5).map((item,index)=><button key={item.machine.machine_id} onClick={()=>navigate('factory',item.machine.machine_id)}><small>{String(index+1).padStart(2,'0')}</small><i className={`risk-${item.telemetry?.risk_level||'offline'}`}/><span><strong>{item.machine.display_name}</strong><p>{item.telemetry?.top_risk_factors?.[0]?.name || 'No active contributor'}</p></span><b>{item.telemetry?`${Math.round(item.telemetry.risk_score*100)}%`:'—'}</b></button>)}</div><button className="section-link" onClick={()=>navigate('incidents')}>Review incident timeline <ArrowRight size={14}/></button></section>
          </div>
        </motion.div>}
        {page === 'factory' && <motion.div key="factory" className="page-wrap premium-page factory-page" initial={{opacity:0,y:14}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-8}} transition={transition}>
          <FactoryMap fleet={fleet} selectedId={selected?.machine.machine_id||''} onSelect={selectAsset} initialView={new URLSearchParams(location.search).get('view') === '3d' ? '3d' : '2d'} onViewChange={setFactoryView} onMachineAdded={async(id)=>{selectAsset(id);await loadFleet();setNotice('Machine added to the live factory model')}} onMachineDeleted={async(id)=>{await loadFleet();setNotice(`Machine ${id} removed from factory`)}}/>
          {selected?.telemetry && <section className="asset-workbench"><header><div><span className="eyebrow">Selected asset · {selected.machine.line_name}</span><h2>{selected.machine.display_name}</h2><p>{selected.machine.metadata?.description || selected.machine.machine_type.replaceAll('_',' ')}</p></div><span className={`asset-state risk-${selected.telemetry.risk_level}`}><i/>{selected.telemetry.state.replaceAll('_',' ')}</span></header><div className="live-metric-strip">{[['Spindle',`${Math.round(selected.telemetry.spindle_rpm).toLocaleString()} rpm`],['Temperature',`${selected.telemetry.temperature_c.toFixed(1)}°C`],['Vibration',`${selected.telemetry.vibration_rms_velocity_mm_s.toFixed(2)} mm/s`],['Load',`${Math.round(selected.telemetry.load_pct)}%`],['Cycle',`${selected.telemetry.cycle_time_s.toFixed(1)} s`],['Latency',`${selected.telemetry.telemetry_latency_ms} ms`]].map(([key,value])=><div key={key}><span>{key}</span><strong>{value}</strong></div>)}</div><div className="detail-grid main-detail-grid"><TelemetryChart history={telemetryHistory}/><RiskPanel telemetry={selected.telemetry}/></div><div className="detail-grid bottom-detail-grid"><FailureSimulator machine={selected.machine} telemetry={selected.telemetry} onDone={setNotice}/><OperatorInput machineId={selected.machine.machine_id} onDone={setNotice}/></div></section>}
        </motion.div>}
        {page === 'incidents' && <motion.div key="incidents" className="page-wrap premium-page" initial={{opacity:0,y:14}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-8}} transition={transition}><AlertsPanel alerts={alerts} onAcknowledge={acknowledge} onInspect={(id)=>navigate('factory',id)}/></motion.div>}
        {page === 'brain' && <motion.div key="brain" className="page-wrap premium-page" initial={{opacity:0,y:14}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-8}} transition={transition}><DigitalBrain fleet={fleet}/></motion.div>}
      </AnimatePresence>
    </main>
    <AnimatePresence>{notice && <motion.div role="status" className="toast" initial={{opacity:0,y:12}} animate={{opacity:1,y:0}} exit={{opacity:0,y:8}}>{notice}</motion.div>}</AnimatePresence>
  </div>
}

export default App
