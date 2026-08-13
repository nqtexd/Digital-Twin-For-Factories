import { useMemo, useRef } from 'react'
import { useLoader, useFrame } from '@react-three/fiber'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'

export interface MachineAnimState {
  temperatureAlert: boolean   // temperature out of range → red
  highVibration: boolean      // vibration rms > threshold → fast shake
  normalOp: boolean           // all good → green glow
  simulationActive: boolean   // simulation scenario playing
  simulationProgress: number  // 0‒1
}

interface LoadedMachineGeometryProps {
  type: string
  tone: string
  targetHeight?: number
  animState?: MachineAnimState
}

// ---------------------------------------------------------------------------
// Status colour resolver — GREEN normal / RED temp / AMBER vibration
// ---------------------------------------------------------------------------
export function resolveStatusColor(
  tone: string,
  anim?: MachineAnimState,
): string {
  if (!anim) return tone
  if (anim.temperatureAlert) return '#ff3d3d'
  if (anim.highVibration) return '#f5a623'
  if (anim.normalOp) return '#22dd88'
  return tone
}

// ---------------------------------------------------------------------------
// Per-type PBR colour palette
// ---------------------------------------------------------------------------
const TYPE_COLOR: Record<string, { color: string; metalness: number; roughness: number }> = {
  hydraulic_press:  { color: '#4a6a7c', metalness: 0.72, roughness: 0.28 },
  coolant_pump:     { color: '#2e6e7a', metalness: 0.68, roughness: 0.32 },
  cnc_lathe:        { color: '#3d6875', metalness: 0.65, roughness: 0.30 },
  surface_grinder:  { color: '#3d6875', metalness: 0.65, roughness: 0.30 },
  cnc_mill:         { color: '#4a6a7c', metalness: 0.62, roughness: 0.36 },
  default:          { color: '#2b4d57', metalness: 0.60, roughness: 0.35 },
}

// ---------------------------------------------------------------------------
// Animated group — handles vibration shake
// ---------------------------------------------------------------------------
function AnimatedGroup({
  anim,
  statusColor,
  children,
}: {
  anim?: MachineAnimState
  statusColor: string
  children: React.ReactNode
}) {
  const ref = useRef<THREE.Group>(null)
  useFrame(({ clock }) => {
    if (!ref.current) return
    const t = clock.elapsedTime
    if (anim?.highVibration) {
      const speed = anim.simulationActive ? 28 : 18
      ref.current.position.x = Math.sin(t * speed) * 0.022
      ref.current.position.z = Math.cos(t * speed * 1.37) * 0.014
    } else if (anim?.temperatureAlert) {
      ref.current.position.x = Math.sin(t * 3.2) * 0.008
    } else {
      ref.current.position.x = 0
      ref.current.position.z = 0
    }
    void statusColor
  })
  return <group ref={ref}>{children}</group>
}

// ---------------------------------------------------------------------------
// DETAILED 2-axis CNC procedural model (mirrors 2_axis_CNC.SAT concept)
// ---------------------------------------------------------------------------
function CncSatModel({ tone, anim }: { tone: string; anim?: MachineAnimState }) {
  const statusColor = resolveStatusColor(tone, anim)

  const spindleRef = useRef<THREE.Group>(null)
  const tableRef = useRef<THREE.Group>(null)
  const xAxisRef = useRef<THREE.Group>(null)

  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    const speed = anim?.highVibration ? 12 : anim?.simulationActive ? 6 : 3
    if (spindleRef.current) spindleRef.current.rotation.y = t * speed
    if (tableRef.current) tableRef.current.position.x = Math.sin(t * 0.6) * 0.22
    if (xAxisRef.current) xAxisRef.current.position.z = Math.sin(t * 0.45 + 0.9) * 0.15
  })

  return (
    <AnimatedGroup anim={anim} statusColor={statusColor}>
      {/* Cast iron bed */}
      <mesh position={[0, 0.14, 0]} scale={[2.2, 0.28, 1.4]}>
        <boxGeometry />
        <meshStandardMaterial color="#3a5f6e" metalness={0.7} roughness={0.28} emissive={statusColor} emissiveIntensity={0.18} />
      </mesh>
      {/* Left column */}
      <mesh position={[-0.82, 1.05, 0]} scale={[0.28, 1.6, 0.38]}>
        <boxGeometry />
        <meshStandardMaterial color="#3a5f6e" metalness={0.7} roughness={0.28} emissive={statusColor} emissiveIntensity={0.18} />
      </mesh>
      {/* Right column */}
      <mesh position={[0.82, 1.05, 0]} scale={[0.28, 1.6, 0.38]}>
        <boxGeometry />
        <meshStandardMaterial color="#3a5f6e" metalness={0.7} roughness={0.28} emissive={statusColor} emissiveIntensity={0.18} />
      </mesh>
      {/* Gantry cross-beam */}
      <mesh position={[0, 1.86, 0]} scale={[2.0, 0.2, 0.34]}>
        <boxGeometry />
        <meshStandardMaterial color="#243c47" metalness={0.82} roughness={0.2} emissive={statusColor} emissiveIntensity={0.28} />
      </mesh>
      {/* Back enclosure wall */}
      <mesh position={[0, 1.0, -0.62]} scale={[2.2, 1.8, 0.08]}>
        <boxGeometry />
        <meshStandardMaterial color="#1a2d35" metalness={0.35} roughness={0.55} emissive={statusColor} emissiveIntensity={0.12} />
      </mesh>

      {/* X-axis saddle carriage */}
      <group ref={xAxisRef} position={[0, 1.6, 0.06]}>
        <mesh scale={[0.48, 0.22, 0.32]}>
          <boxGeometry />
          <meshStandardMaterial color="#243c47" metalness={0.82} roughness={0.2} emissive={statusColor} emissiveIntensity={0.28} />
        </mesh>
        {/* Z-axis quill housing */}
        <mesh position={[0, -0.28, 0.02]} scale={[0.3, 0.46, 0.3]}>
          <boxGeometry />
          <meshStandardMaterial color="#3a5f6e" metalness={0.7} roughness={0.28} emissive={statusColor} emissiveIntensity={0.18} />
        </mesh>
        {/* Spinning spindle */}
        <group ref={spindleRef} position={[0, -0.62, 0.02]}>
          <mesh>
            <cylinderGeometry args={[0.055, 0.055, 0.52, 18]} />
            <meshStandardMaterial color="#7ab8c8" metalness={0.9} roughness={0.12} emissive={statusColor} emissiveIntensity={0.3} />
          </mesh>
          {/* Collet chuck */}
          <mesh position={[0, -0.3, 0]}>
            <cylinderGeometry args={[0.085, 0.045, 0.18, 16]} />
            <meshStandardMaterial color="#9ecfdf" metalness={0.88} roughness={0.14} />
          </mesh>
          {/* Tool bit */}
          <mesh position={[0, -0.42, 0]}>
            <cylinderGeometry args={[0.018, 0.009, 0.12, 10]} />
            <meshStandardMaterial color="#c8e8f0" metalness={0.95} roughness={0.08} />
          </mesh>
        </group>
        {/* Linear rail guides */}
        {([-0.18, 0.18] as number[]).map((z) => (
          <mesh key={z} position={[0, 0, z]} scale={[0.44, 0.06, 0.04]}>
            <boxGeometry />
            <meshStandardMaterial color="#567d8a" metalness={0.85} roughness={0.15} />
          </mesh>
        ))}
      </group>

      {/* Work table (X-axis slide) */}
      <group ref={tableRef} position={[0, 0.38, 0.12]}>
        <mesh scale={[1.4, 0.09, 0.85]}>
          <boxGeometry />
          <meshStandardMaterial color="#2d5060" metalness={0.7} roughness={0.24} emissive={statusColor} emissiveIntensity={0.08} />
        </mesh>
        {/* T-slots */}
        {([-0.38, -0.12, 0.12, 0.38] as number[]).map((x) => (
          <mesh key={x} position={[x, 0.052, 0]} scale={[0.05, 0.02, 0.82]}>
            <boxGeometry />
            <meshStandardMaterial color="#1a3540" metalness={0.5} roughness={0.5} />
          </mesh>
        ))}
        {/* Workpiece */}
        <mesh position={[0, 0.095, 0]} scale={[0.36, 0.12, 0.28]}>
          <boxGeometry />
          <meshStandardMaterial color="#e8c870" metalness={0.4} roughness={0.5} />
        </mesh>
      </group>

      {/* Operator control panel */}
      <mesh position={[1.2, 0.85, 0.4]} rotation={[0, -0.45, 0]} scale={[0.38, 0.56, 0.07]}>
        <boxGeometry />
        <meshStandardMaterial color="#1a2d35" metalness={0.35} roughness={0.55} emissive={statusColor} emissiveIntensity={0.22} />
      </mesh>
      {/* Screen glow */}
      <mesh position={[1.19, 0.9, 0.44]} rotation={[0, -0.45, 0]} scale={[0.28, 0.34, 0.01]}>
        <boxGeometry />
        <meshStandardMaterial color={statusColor} emissive={statusColor} emissiveIntensity={0.7} metalness={0} roughness={1} />
      </mesh>

      {/* Column guide rails */}
      {([-0.7, 0.7] as number[]).map((x) => (
        <mesh key={x} position={[x, 1.05, 0.2]} scale={[0.06, 1.5, 0.04]}>
          <boxGeometry />
          <meshStandardMaterial color="#567d8a" metalness={0.85} roughness={0.15} />
        </mesh>
      ))}

      {/* Chip/coolant tray */}
      <mesh position={[0, -0.01, 0.22]} scale={[1.85, 0.06, 0.95]}>
        <boxGeometry />
        <meshStandardMaterial color="#1e3a42" metalness={0.5} roughness={0.6} />
      </mesh>

      {/* Glowing status strip at top */}
      <mesh position={[0, 2.02, 0]} scale={[1.8, 0.06, 0.06]}>
        <boxGeometry />
        <meshStandardMaterial color={statusColor} emissive={statusColor} emissiveIntensity={1.0} />
      </mesh>
    </AnimatedGroup>
  )
}

// ---------------------------------------------------------------------------
// Animated hydraulic press model
// ---------------------------------------------------------------------------
function HydraulicPressAnimated({ tone, anim, targetHeight = 3.2 }: { tone: string; anim?: MachineAnimState; targetHeight?: number }) {
  const statusColor = resolveStatusColor(tone, anim)
  const pistonRef = useRef<THREE.Mesh>(null)
  void targetHeight
  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    if (pistonRef.current) {
      const speed = anim?.highVibration ? 4 : anim?.simulationActive ? 2.5 : 1.2
      pistonRef.current.position.y = 0.94 - Math.max(0, Math.sin(t * speed)) * 0.55
    }
  })
  return (
    <AnimatedGroup anim={anim} statusColor={statusColor}>
      <mesh position={[0, 0.15, 0]} scale={[1.5, 0.28, 0.9]}>
        <boxGeometry />
        <meshStandardMaterial color="#4a6a7c" metalness={0.72} roughness={0.28} emissive={statusColor} emissiveIntensity={0.14} />
      </mesh>
      {([-0.55, 0.55] as number[]).map((x) => (
        <mesh key={x} position={[x, 0.95, 0]} scale={[0.22, 1.5, 0.32]}>
          <boxGeometry />
          <meshStandardMaterial color="#3d5f6e" metalness={0.75} roughness={0.25} emissive={statusColor} emissiveIntensity={0.12} />
        </mesh>
      ))}
      <mesh position={[0, 1.62, 0]} scale={[1.5, 0.28, 0.8]}>
        <boxGeometry />
        <meshStandardMaterial color="#4a6a7c" metalness={0.72} roughness={0.28} emissive={statusColor} emissiveIntensity={0.14} />
      </mesh>
      <mesh ref={pistonRef} position={[0, 0.94, 0]} scale={[0.75, 0.22, 0.7]}>
        <boxGeometry />
        <meshStandardMaterial color="#8ab8c8" metalness={0.88} roughness={0.12} emissive={statusColor} emissiveIntensity={0.22} />
      </mesh>
      <mesh position={[0, 0.3, 0]} scale={[1.1, 0.08, 0.72]}>
        <boxGeometry />
        <meshStandardMaterial color="#243c47" metalness={0.7} roughness={0.28} />
      </mesh>
      {/* Status strip */}
      <mesh position={[0, 1.82, 0]} scale={[1.4, 0.05, 0.05]}>
        <boxGeometry />
        <meshStandardMaterial color={statusColor} emissive={statusColor} emissiveIntensity={1.0} />
      </mesh>
    </AnimatedGroup>
  )
}

// ---------------------------------------------------------------------------
// Generic animated fallback
// ---------------------------------------------------------------------------
export function MachineGeometryProcedural({ type, tone, anim }: { type: string; tone: string; anim?: MachineAnimState }) {
  const statusColor = resolveStatusColor(tone, anim)

  if (type === 'cnc_sat' || type === 'cnc_lathe' || type === 'cnc_mill') {
    return <CncSatModel tone={tone} anim={anim} />
  }
  if (type === 'hydraulic_press') {
    return <HydraulicPressAnimated tone={tone} anim={anim} />
  }

  const common = (
    <meshStandardMaterial
      color="#315963"
      metalness={0.52}
      roughness={0.34}
      emissive={statusColor}
      emissiveIntensity={0.12}
    />
  )

  if (type === 'surface_grinder')
    return (
      <AnimatedGroup anim={anim} statusColor={statusColor}>
        <mesh position={[0, 0.22, 0]} scale={[1.5, 0.38, 0.78]}>
          <boxGeometry />{common}
        </mesh>
        <mesh position={[0.25, 0.83, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.48, 0.48, 0.22, 30]} />
          <meshStandardMaterial color="#24414a" metalness={0.65} roughness={0.32} emissive={statusColor} emissiveIntensity={0.08} />
        </mesh>
        <mesh position={[-0.45, 0.62, 0]} scale={[0.25, 0.68, 0.25]}>
          <boxGeometry />{common}
        </mesh>
        <mesh position={[0, 1.05, 0]} scale={[1.4, 0.04, 0.04]}>
          <boxGeometry />
          <meshStandardMaterial color={statusColor} emissive={statusColor} emissiveIntensity={1.0} />
        </mesh>
      </AnimatedGroup>
    )

  if (type === 'coolant_pump')
    return (
      <AnimatedGroup anim={anim} statusColor={statusColor}>
        <mesh position={[-0.15, 0.55, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.52, 0.52, 0.62, 32]} />{common}
        </mesh>
        <mesh position={[0.62, 0.52, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.28, 0.32, 1.1, 24]} />{common}
        </mesh>
        <mesh position={[0.2, 0.1, 0]} scale={[1.3, 0.18, 0.72]}>
          <boxGeometry />{common}
        </mesh>
        <mesh position={[-0.15, 0.85, 0]} scale={[1.2, 0.04, 0.04]}>
          <boxGeometry />
          <meshStandardMaterial color={statusColor} emissive={statusColor} emissiveIntensity={1.0} />
        </mesh>
      </AnimatedGroup>
    )

  return (
    <AnimatedGroup anim={anim} statusColor={statusColor}>
      <mesh position={[-0.25, 0.55, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.55, 0.55, 0.65, 28]} />{common}
      </mesh>
      <mesh position={[0.58, 0.55, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.28, 0.35, 1.1, 24]} />{common}
      </mesh>
      <mesh position={[-0.25, 0.12, 0]} scale={[1.15, 0.2, 0.72]}>
        <boxGeometry />{common}
      </mesh>
    </AnimatedGroup>
  )
}

// ---------------------------------------------------------------------------
// Material builder
// ---------------------------------------------------------------------------
function buildMaterial(type: string, statusColor: string): THREE.MeshStandardMaterial {
  const palette = TYPE_COLOR[type] ?? TYPE_COLOR.default
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(palette.color),
    metalness: palette.metalness,
    roughness: palette.roughness,
    emissive: new THREE.Color(statusColor),
    emissiveIntensity: 0.22,
  })
}

function applyMaterials(root: THREE.Object3D, type: string, statusColor: string) {
  const mat = buildMaterial(type, statusColor)
  root.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh
      mesh.castShadow = true
      mesh.receiveShadow = true
      if (Array.isArray(mesh.material)) {
        mesh.material = mesh.material.map(() => mat.clone())
      } else {
        mesh.material = mat.clone()
      }
    }
  })
}

function normalizeObject(root: THREE.Object3D, targetHeight: number) {
  const box = new THREE.Box3().setFromObject(root)
  const size = box.getSize(new THREE.Vector3())
  const scaleFactor = targetHeight / (size.y || 1)
  root.scale.setScalar(scaleFactor)
  const scaledBox = new THREE.Box3().setFromObject(root)
  const scaledMin = scaledBox.min
  const scaledCenter = scaledBox.getCenter(new THREE.Vector3())
  root.position.set(-scaledCenter.x, -scaledMin.y, -scaledCenter.z)
}

function GlbModel({ url, type, tone, targetHeight = 1.5, anim }: { url: string; type: string; tone: string; targetHeight?: number; anim?: MachineAnimState }) {
  const { scene } = useGLTF(url)
  const statusColor = resolveStatusColor(tone, anim)
  const prepared = useMemo(() => {
    const cloned = scene.clone(true)
    applyMaterials(cloned, type, statusColor)
    normalizeObject(cloned, targetHeight)
    return cloned
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, type, statusColor, targetHeight])

  return (
    <AnimatedGroup anim={anim} statusColor={statusColor}>
      <primitive object={prepared} />
      <mesh position={[0, targetHeight + 0.06, 0]} scale={[1.5, 0.06, 0.06]}>
        <boxGeometry />
        <meshStandardMaterial color={statusColor} emissive={statusColor} emissiveIntensity={1.2} />
      </mesh>
    </AnimatedGroup>
  )
}

function ObjModel({ url, type, tone, targetHeight = 1.5, anim }: { url: string; type: string; tone: string; targetHeight?: number; anim?: MachineAnimState }) {
  const obj = useLoader(OBJLoader, url)
  const statusColor = resolveStatusColor(tone, anim)
  const prepared = useMemo(() => {
    const cloned = obj.clone(true)
    applyMaterials(cloned, type, statusColor)
    normalizeObject(cloned, targetHeight)
    return cloned
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [obj, type, statusColor, targetHeight])

  return (
    <AnimatedGroup anim={anim} statusColor={statusColor}>
      <primitive object={prepared} />
      <mesh position={[0, targetHeight + 0.06, 0]} scale={[1.5, 0.06, 0.06]}>
        <boxGeometry />
        <meshStandardMaterial color={statusColor} emissive={statusColor} emissiveIntensity={1.2} />
      </mesh>
    </AnimatedGroup>
  )
}

// ---------------------------------------------------------------------------
// Public export
// ---------------------------------------------------------------------------
export function LoadedMachineGeometry({ type, tone, targetHeight = 1.5, animState }: LoadedMachineGeometryProps) {
  if (type === 'cnc_sat' || type === 'cnc_lathe' || type === 'cnc_mill') {
    return <CncSatModel tone={tone} anim={animState} />
  }
  if (type === 'hydraulic_press') {
    return <GlbModel url="/models/hydraulic_press.glb" type={type} tone={tone} targetHeight={targetHeight} anim={animState} />
  }
  if (type === 'coolant_pump' || type === 'surface_grinder') {
    return <ObjModel url="/models/pump.obj" type={type} tone={tone} targetHeight={targetHeight} anim={animState} />
  }
  return <MachineGeometryProcedural type={type} tone={tone} anim={animState} />
}
