import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Activity, ArrowUpRight, Gauge, Layers3, Minus, Plus, RotateCcw, Thermometer, Trash2, Vibrate, Zap, X, Check } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import type { FleetItem } from '../types'
import { MachineGlyph } from './MachineGlyph'
import { api } from '../lib/api'

type Point = { x: number; y: number }
type LayoutPositions = Record<string, Point>
const layoutStorageKey = 'flowtwin:floor-layout:v2'
const cellsStorageKey = 'flowtwin:floor-cells:v2'

const fallbackPositions: Point[] = [{ x: 18, y: 27 }, { x: 61, y: 27 }, { x: 17, y: 70 }, { x: 49, y: 70 }, { x: 80, y: 70 }]
const pointFor = (item: FleetItem, index: number): Point => ({ x: item.machine.metadata?.layout_x ?? fallbackPositions[index % fallbackPositions.length].x, y: item.machine.metadata?.layout_y ?? fallbackPositions[index % fallbackPositions.length].y })

const arrangedPoints = (fleet: FleetItem[]): Point[] => {
  const productionSlots: Point[] = [{ x: 20, y: 22 }, { x: 50, y: 22 }, { x: 80, y: 22 }, { x: 20, y: 48 }, { x: 50, y: 48 }, { x: 80, y: 48 }]
  const utilitySlots: Point[] = [{ x: 50, y: 84 }, { x: 25, y: 84 }, { x: 75, y: 84 }]
  let productionIndex = 0, utilityIndex = 0
  return fleet.map((item, index) => {
    const utility = item.machine.line_name.toLowerCase().includes('utilit') || item.machine.metadata?.operation === 'circulation'
    if (utility) return utilitySlots[utilityIndex++ % utilitySlots.length]
    return productionSlots[productionIndex++ % productionSlots.length] || pointFor(item, index)
  })
}

interface Cell {
  id: string
  name: string
  subtitle: string
  left: number
  top: number
  width: number
  height: number
  borderStyle: 'solid' | 'dashed'
}

const defaultCells: Cell[] = [
  { id: 'cell-production', name: '01 / PRODUCTION CELL', subtitle: 'Machining & finishing', left: 3, top: 5, width: 94, height: 48, borderStyle: 'solid' },
  { id: 'cell-services', name: '02 / PLANT SERVICES', subtitle: 'Cooling, utility & support', left: 3, top: 57, width: 94, height: 38, borderStyle: 'dashed' }
]

function Connections({ fleet, points }: { fleet: FleetItem[]; points: Point[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = canvasRef.current
    const parent = canvas?.parentElement
    if (!canvas || !parent) return
    const context = canvas.getContext('2d')
    if (!context) return
    let animation = 0
    const draw = (time: number) => {
      const rect = parent.getBoundingClientRect(), scale = window.devicePixelRatio || 1
      if (canvas.width !== rect.width * scale || canvas.height !== rect.height * scale) { canvas.width = rect.width * scale; canvas.height = rect.height * scale; canvas.style.width = `${rect.width}px`; canvas.style.height = `${rect.height}px` }
      context.setTransform(scale, 0, 0, scale, 0, 0); context.clearRect(0, 0, rect.width, rect.height)
      const byLine = new Map<string, number[]>()
      fleet.forEach((item, index) => { const line = item.machine.line_name.split('·')[0].trim(); byLine.set(line, [...(byLine.get(line) || []), index]) })
      context.lineWidth = 1.2; context.setLineDash([6, 9]); context.lineDashOffset = -(time / 55)
      const connect = (a: number, b: number, utility = false) => { const start = points[a], end = points[b], x1 = rect.width * start.x / 100, y1 = rect.height * start.y / 100, x2 = rect.width * end.x / 100, y2 = rect.height * end.y / 100, midX = x1 + (x2 - x1) * .5; context.beginPath(); context.moveTo(x1, y1); context.bezierCurveTo(midX, y1, midX, y2, x2, y2); context.strokeStyle = utility ? 'rgba(100, 189, 213, .48)' : 'rgba(243, 167, 72, .55)'; context.stroke() }
      byLine.forEach((indices) => indices.sort((a, b) => points[a].x - points[b].x).forEach((index, position) => { if (position) connect(indices[position - 1], index) }))
      const utilities = fleet.map((item, index) => ({ item, index })).filter(({ item }) => item.machine.line_name.toLowerCase().includes('utilit'))
      utilities.forEach(({ index }) => fleet.forEach((item, target) => { if (target !== index && !item.machine.line_name.toLowerCase().includes('utilit')) connect(index, target, true) }))
      context.setLineDash([]); animation = requestAnimationFrame(draw)
    }
    animation = requestAnimationFrame(draw)
    const observer = new ResizeObserver(() => { cancelAnimationFrame(animation); animation = requestAnimationFrame(draw) })
    observer.observe(parent)
    return () => { cancelAnimationFrame(animation); observer.disconnect() }
  }, [fleet, points])
  return <canvas ref={canvasRef} className="factory-connections" aria-hidden="true"/>
}

function DeleteConfirmModal({ machine, onConfirm, onCancel, busy }: {
  machine: FleetItem
  onConfirm: () => void
  onCancel: () => void
  busy: boolean
}) {
  return (
    <motion.div
      className="machine-wizard-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseDown={onCancel}
      style={{ zIndex: 1000 }}
    >
      <motion.section
        className="machine-wizard panel"
        initial={{ opacity: 0, y: 18, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10 }}
        onMouseDown={(e) => e.stopPropagation()}
        style={{ maxWidth: 420 }}
      >
        <header>
          <div>
            <span className="eyebrow" style={{ color: '#ff6b70' }}>Destructive action</span>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Trash2 size={18} style={{ color: '#ff6b70' }} />
              Remove from factory
            </h2>
            <p>
              This will permanently remove <strong>{machine.machine.display_name}</strong> ({machine.machine.machine_id}) from the live factory model, telemetry stream and digital twin. This cannot be undone.
            </p>
          </div>
        </header>
        <footer>
          <button className="secondary-button" onClick={onCancel} disabled={busy}>Cancel</button>
          <button
            onClick={onConfirm}
            disabled={busy}
            style={{
              background: busy ? '#3a2020' : 'linear-gradient(135deg, #c0392b, #e74c3c)',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              padding: '9px 18px',
              fontWeight: 600,
              cursor: busy ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              opacity: busy ? 0.65 : 1,
            }}
          >
            <Trash2 size={14} />
            {busy ? 'Removing…' : 'Remove asset'}
          </button>
        </footer>
      </motion.section>
    </motion.div>
  )
}

function AddCellWizard({ onClose, onAdded }: { onClose: () => void; onAdded: (cell: Cell) => void }) {
  const [name, setName] = useState('')
  const [subtitle, setSubtitle] = useState('')
  const [borderStyle, setBorderStyle] = useState<'solid' | 'dashed'>('solid')

  const create = () => {
    if (!name.trim()) return
    const cellId = `cell-${Date.now()}`
    const cell: Cell = {
      id: cellId,
      name: name.toUpperCase(),
      subtitle,
      left: 3,
      top: 0,
      width: 94,
      height: 0,
      borderStyle
    }
    onAdded(cell)
    onClose()
  }

  return (
    <motion.div className="machine-wizard-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={onClose}>
      <motion.section
        className="machine-wizard panel"
        initial={{ opacity: 0, y: 18, scale: .985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10 }}
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        style={{ maxWidth: 440 }}
      >
        <header>
          <div>
            <span className="eyebrow">Factory Architecture</span>
            <h2>Create Floor Cell</h2>
            <p>Establish a physical zone cell on the floor plan to group operational components. Cells distribute layout area vertically automatically.</p>
          </div>
          <button onClick={onClose} aria-label="Close"><X size={17} /></button>
        </header>

        <div className="machine-setup-grid" style={{ gridTemplateColumns: '1fr', gap: '16px', marginTop: '16px' }}>
          <div className="machine-fields" style={{ gap: '12px' }}>
            <label>
              Cell Label / Name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. 03 / ASSEMBLY CELL"
                style={{ height: '34px' }}
              />
            </label>
            <label>
              Operational Subtitle
              <input
                value={subtitle}
                onChange={(e) => setSubtitle(e.target.value)}
                placeholder="e.g. Quality inspection and batch packing"
                style={{ height: '34px' }}
              />
            </label>
            <label style={{ display: 'block', marginTop: '8px' }}>
              Border Style
              <select
                value={borderStyle}
                onChange={(e) => setBorderStyle(e.target.value as 'solid' | 'dashed')}
                style={{ height: '34px', marginTop: '5px' }}
              >
                <option value="solid">Solid Boundary (Strict Cell)</option>
                <option value="dashed">Dashed Boundary (General Area)</option>
              </select>
            </label>
          </div>
        </div>

        <footer>
          <button className="secondary-button" onClick={onClose}>Cancel</button>
          <button className="primary-button" onClick={create} disabled={!name.trim()} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Plus size={13} /> Create Cell
          </button>
        </footer>
      </motion.section>
    </motion.div>
  )
}

export function Factory2DView({
  fleet,
  selectedId,
  onSelect,
  onMachineDeleted,
}: {
  fleet: FleetItem[]
  selectedId: string
  onSelect: (id: string) => void
  onMachineDeleted?: (id: string) => void
}) {
  const [zoom, setZoom] = useState(1)
  const floorCanvasRef = useRef<HTMLDivElement>(null)
  
  // Custom machine coordinates
  const [customPositions, setCustomPositions] = useState<LayoutPositions>(() => {
    try { return JSON.parse(window.localStorage.getItem(layoutStorageKey) || '{}') as LayoutPositions } catch { return {} }
  })
  
  // Custom cells list
  const [cells, setCells] = useState<Cell[]>(() => {
    try {
      const stored = window.localStorage.getItem(cellsStorageKey)
      return stored ? (JSON.parse(stored) as Cell[]) : defaultCells
    } catch {
      return defaultCells
    }
  })

  const [deleteTarget, setDeleteTarget] = useState<FleetItem | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [showAddCellWizard, setShowAddCellWizard] = useState(false)

  const defaultPoints = useMemo(() => arrangedPoints(fleet), [fleet])
  const points = useMemo(
    () => fleet.map((item, index) => customPositions[item.machine.machine_id] || defaultPoints[index]),
    [customPositions, defaultPoints, fleet]
  )

  const pointsRef = useRef(points)
  pointsRef.current = points

  const resetLayout = () => {
    setCustomPositions({})
    window.localStorage.removeItem(layoutStorageKey)
    setCells(defaultCells)
    window.localStorage.setItem(cellsStorageKey, JSON.stringify(defaultCells))
  }

  // ── Drag & Drop ──────────────────────────────────────────────────────────────
  const setupDrag = useCallback(() => {
    const canvas = floorCanvasRef.current
    if (!canvas) return

    const nodes = Array.from(canvas.querySelectorAll<HTMLElement>('.spatial-machine-node'))

    const cleanups = nodes.map((node) => {
      const machineId = node.dataset.machineId
      if (!machineId) return () => undefined

      const handlePointerDown = (downEvent: PointerEvent) => {
        if (downEvent.button !== 0) return
        const target = downEvent.target as HTMLElement
        if (target.closest('.node-delete-btn')) return

        downEvent.preventDefault()

        const bounds = canvas.getBoundingClientRect()
        const startClientX = downEvent.clientX
        const startClientY = downEvent.clientY

        const fleetIndex = fleet.findIndex((f) => f.machine.machine_id === machineId)
        const currentPoint = pointsRef.current[fleetIndex] ?? { x: 50, y: 50 }
        let nextPoint = { ...currentPoint }

        node.setPointerCapture(downEvent.pointerId)
        node.style.zIndex = '50'
        node.style.transition = 'none'

        const handlePointerMove = (moveEvent: PointerEvent) => {
          const dx = (moveEvent.clientX - startClientX) / bounds.width * 100
          const dy = (moveEvent.clientY - startClientY) / bounds.height * 100
          nextPoint = {
            x: Math.min(91, Math.max(9, currentPoint.x + dx)),
            y: Math.min(90, Math.max(10, currentPoint.y + dy)),
          }
          node.style.left = `${nextPoint.x}%`
          node.style.top = `${nextPoint.y}%`
        }

        const handlePointerUp = (upEvent: PointerEvent) => {
          node.releasePointerCapture(upEvent.pointerId)
          node.removeEventListener('pointermove', handlePointerMove)
          node.removeEventListener('pointerup', handlePointerUp)
          node.removeEventListener('pointercancel', handlePointerUp)
          node.style.zIndex = ''
          node.style.transition = ''

          setCustomPositions((current) => {
            const updated = { ...current, [machineId]: nextPoint }
            window.localStorage.setItem(layoutStorageKey, JSON.stringify(updated))
            return updated
          })
        }

        node.addEventListener('pointermove', handlePointerMove)
        node.addEventListener('pointerup', handlePointerUp)
        node.addEventListener('pointercancel', handlePointerUp)
      }

      node.addEventListener('pointerdown', handlePointerDown)
      return () => node.removeEventListener('pointerdown', handlePointerDown)
    })

    return () => cleanups.forEach((fn) => fn())
  }, [fleet])

  useEffect(() => {
    const cleanup = setupDrag()
    return cleanup
  }, [setupDrag])

  // ── Delete Machine ───────────────────────────────────────────────────────────
  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return
    setDeleteBusy(true)
    setDeleteError('')
    try {
      await api.deleteMachine(deleteTarget.machine.machine_id)
      setCustomPositions((current) => {
        const updated = { ...current }
        delete updated[deleteTarget.machine.machine_id]
        window.localStorage.setItem(layoutStorageKey, JSON.stringify(updated))
        return updated
      })
      onMachineDeleted?.(deleteTarget.machine.machine_id)
      setDeleteTarget(null)
    } catch (reason) {
      setDeleteError(reason instanceof Error ? reason.message : 'Failed to remove machine')
    } finally {
      setDeleteBusy(false)
    }
  }

  // ── Custom Cells Actions ─────────────────────────────────────────────────────
  const handleAddCell = (newCell: Cell) => {
    setCells((current) => {
      const updated = [...current, newCell]
      window.localStorage.setItem(cellsStorageKey, JSON.stringify(updated))
      return updated
    })
  }

  const handleDeleteCell = (cellId: string) => {
    setCells((current) => {
      const updated = current.filter((c) => c.id !== cellId)
      window.localStorage.setItem(cellsStorageKey, JSON.stringify(updated))
      return updated
    })
  }

  const selected = fleet.find((item) => item.machine.machine_id === selectedId) || fleet[0]
  const telemetry = selected?.telemetry

  return (
    <motion.div className="spatial-2d-view" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="spatial-map-toolbar">
        <span><Layers3 size={13}/>Operational floor plan <i>LIVE</i></span>
        <div style={{ display: 'flex', gap: 6, border: 'none', background: 'none' }}>
          <button
            onClick={() => setShowAddCellWizard(true)}
            title="Create new zone cell"
            style={{
              width: 'auto',
              padding: '0 10px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              borderRadius: '6px',
              border: '1px solid var(--border)',
              background: '#10232c',
              color: '#9eb0b8',
              fontSize: '7px',
              fontWeight: 700,
              height: '24px'
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = '#e4ecee'; e.currentTarget.style.borderColor = '#36515c'; e.currentTarget.style.background = '#142a34' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = '#9eb0b8'; e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = '#10232c' }}
          >
            <Plus size={10}/> Add Cell
          </button>
          
          <div style={{ display: 'flex', alignItems: 'center', border: '1px solid var(--border)', borderRadius: '6px', overflow: 'hidden' }}>
            <button onClick={resetLayout} aria-label="Reset floor design" title="Reset floor design"><RotateCcw size={12}/></button>
            <button onClick={() => setZoom((value) => Math.max(.78, value - .1))} aria-label="Zoom out"><Minus size={12}/></button>
            <b style={{ minWidth: '38px', textAlign: 'center', color: '#708690', font: '500 6px "DM Mono", monospace' }}>{Math.round(zoom * 100)}%</b>
            <button onClick={() => setZoom((value) => Math.min(1.22, value + .1))} aria-label="Zoom in"><Plus size={12}/></button>
          </div>
        </div>
      </div>

      <div className="spatial-2d-viewport">
        <div ref={floorCanvasRef} className="spatial-2d-canvas" style={{ transform: `scale(${zoom})` }}>
          {/* Render Dynamic Cells in an Auto-Distributing Flex Column (Never Overlaps) */}
          <div style={{
            position: 'absolute',
            left: '3%',
            right: '3%',
            top: '4%',
            bottom: '4%',
            display: 'flex',
            flexDirection: 'column',
            gap: '20px',
            pointerEvents: 'none'
          }}>
            {cells.map((cell) => (
              <div
                key={cell.id}
                className="floor-area"
                style={{
                  flex: 1,
                  position: 'relative',
                  borderStyle: cell.borderStyle,
                  width: '100%',
                  height: '100%',
                }}
              >
                <span>{cell.name}</span>
                <small style={{ position: 'absolute', left: 10, top: 22, color: '#435d67', fontSize: '5px' }}>{cell.subtitle}</small>
                
                {/* Delete Custom Cell Button */}
                <button
                  className="cell-delete-btn"
                  onClick={() => handleDeleteCell(cell.id)}
                  title={`Remove ${cell.name} zone`}
                  style={{
                    position: 'absolute',
                    top: 6,
                    right: 8,
                    background: 'none',
                    border: 'none',
                    color: '#ff6b70',
                    opacity: 0.35,
                    cursor: 'pointer',
                    pointerEvents: 'auto',
                    padding: '2px 4px',
                    borderRadius: '4px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'opacity 0.2s, background 0.2s'
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.background = 'rgba(255,107,112,0.12)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.35'; e.currentTarget.style.background = 'none' }}
                >
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>

          <Connections fleet={fleet} points={points}/>

          {/* Render Machine Nodes */}
          {fleet.map((item, index) => {
            const point = points[index]
            const itemTelemetry = item.telemetry
            const isSelected = item.machine.machine_id === selectedId
            const risk = itemTelemetry?.risk_level || 'offline'

            return (
              <motion.div
                key={item.machine.machine_id}
                className={`spatial-machine-node risk-${risk} ${isSelected ? 'selected' : ''}`}
                data-machine-id={item.machine.machine_id}
                style={{ left: `${point.x}%`, top: `${point.y}%` }}
                onClick={(e) => {
                  if (!(e.target as HTMLElement).closest('.node-delete-btn')) {
                    onSelect(item.machine.machine_id)
                  }
                }}
              >
                <div className="spatial-node-head">
                  <span className="machine-type-icon"><MachineGlyph type={item.machine.machine_type}/></span>
                  <div>
                    <small>{item.machine.machine_id}</small>
                    <strong>{item.machine.display_name}</strong>
                  </div>
                  <i className="node-live-state"><Activity size={9}/>{itemTelemetry?.state.replaceAll('_', ' ') || 'offline'}</i>
                </div>
                <div className="spatial-node-stats">
                  <span><Thermometer size={11}/><b>{itemTelemetry ? `${itemTelemetry.temperature_c.toFixed(1)}°` : '—'}</b></span>
                  <span><Vibrate size={11}/><b>{itemTelemetry ? itemTelemetry.vibration_rms_velocity_mm_s.toFixed(2) : '—'}</b></span>
                  <span><Gauge size={11}/><b>{itemTelemetry ? `${Math.round(itemTelemetry.health_score)}` : '—'}</b></span>
                </div>

                {/* Redesigned Sleek Delete Icon Button in top-right corner */}
                <button
                  className="node-delete-btn"
                  aria-label={`Remove ${item.machine.display_name}`}
                  title={`Remove ${item.machine.display_name} from factory`}
                  onClick={(e) => {
                    e.stopPropagation()
                    setDeleteTarget(item)
                  }}
                >
                  <Trash2 size={10}/>
                </button>
              </motion.div>
            )
          })}
        </div>

        {selected && (
          <aside className={`floor-inspector risk-${telemetry?.risk_level || 'offline'}`}>
            <div className="inspector-kicker">
              <span><i/>Selected equipment</span>
              <div style={{ display: 'flex', gap: 4 }}>
                <button
                  onClick={() => setDeleteTarget(selected)}
                  aria-label="Remove selected equipment"
                  title="Remove from factory"
                  style={{ color: '#ff6b70', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', borderRadius: 4, display: 'flex', alignItems: 'center' }}
                >
                  <Trash2 size={13}/>
                </button>
                <button onClick={() => onSelect(selected.machine.machine_id)} aria-label="Open selected equipment">
                  <ArrowUpRight size={15}/>
                </button>
              </div>
            </div>
            <div className="inspector-title">
              <span><MachineGlyph type={selected.machine.machine_type} size={21}/></span>
              <div>
                <small>{selected.machine.machine_id} · {selected.machine.line_name}</small>
                <strong>{selected.machine.display_name}</strong>
              </div>
            </div>
            <p>{selected.machine.metadata?.description || 'Live machine telemetry is being synchronized from the factory edge.'}</p>
            <div className="inspector-readings">
              <span><small>Condition</small><b>{telemetry ? `${Math.round(telemetry.health_score)}%` : '—'}</b></span>
              <span><small>Load</small><b>{telemetry ? `${Math.round(telemetry.load_pct)}%` : '—'}</b></span>
              <span><small>Risk</small><b>{telemetry ? `${Math.round(telemetry.risk_score * 100)}%` : '—'}</b></span>
            </div>
            <footer><Zap size={12}/>{telemetry?.top_risk_factors?.[0]?.name || 'No active risk contributor'}</footer>
          </aside>
        )}

        <div className="map-coordinate-key">
          <span><i className="flow"/>Production flow</span>
          <span><i className="utility"/>Utility feed</span>
          <b>{fleet.length} assets online</b>
        </div>
      </div>

      {/* Delete Machine Confirmation Modal */}
      <AnimatePresence>
        {deleteTarget && (
          <DeleteConfirmModal
            machine={deleteTarget}
            onConfirm={handleDeleteConfirm}
            onCancel={() => { setDeleteTarget(null); setDeleteError('') }}
            busy={deleteBusy}
          />
        )}
      </AnimatePresence>

      {/* Add Custom Cell Wizard Modal */}
      <AnimatePresence>
        {showAddCellWizard && (
          <AddCellWizard
            onClose={() => setShowAddCellWizard(false)}
            onAdded={handleAddCell}
          />
        )}
      </AnimatePresence>

      {deleteError && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          background: '#3a1010', color: '#ff6b70', padding: '10px 18px', borderRadius: 8,
          fontSize: 13, zIndex: 2000, border: '1px solid rgba(255,107,112,0.3)',
        }}>
          {deleteError}
        </div>
      )}
    </motion.div>
  )
}
