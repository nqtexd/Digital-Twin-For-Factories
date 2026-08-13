import { Cog, Droplets, Gauge, Hammer, ScanLine } from 'lucide-react'

const icons = {
  cnc_lathe: Cog,
  cnc_mill: ScanLine,
  hydraulic_press: Hammer,
  surface_grinder: Gauge,
  coolant_pump: Droplets,
}

export function MachineGlyph({ type, size = 18 }: { type: string; size?: number }) {
  const Icon = icons[type as keyof typeof icons] || Cog
  return <Icon size={size}/>
}
