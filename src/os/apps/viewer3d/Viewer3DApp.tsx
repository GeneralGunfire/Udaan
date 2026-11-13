import { useCallback, useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { convertFileSrc } from '@tauri-apps/api/core'
import { Select } from '@/shared/components/ui/select'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog'
import { writeFile } from '@tauri-apps/plugin-fs'
import { readFileBytes } from '@/integrations/file-explorer/client'
import { cn } from '@/shared/lib/cn'
import { toastError } from '@/os/ui/toasts'

const FORMATS = ['glb', 'gltf', 'obj', 'stl', 'fbx', 'ply']

interface ModelInfo {
  name: string
  vertices: number
  triangles: number
  meshes: number
  materials: number
  size: THREE.Vector3
  animations: string[]
}

type Background = 'studio' | 'dark' | 'light'

const BACKGROUNDS: Record<Background, string> = { studio: '#2a2c31', dark: '#0d0e10', light: '#e9eaee' }

async function loadModel(path: string): Promise<{ object: THREE.Object3D; clips: THREE.AnimationClip[] }> {
  const ext = path.split('.').pop()!.toLowerCase()
  if (ext === 'gltf') {
    // Loaded by URL so its external .bin/texture files resolve beside it.
    const gltf = await new GLTFLoader().loadAsync(convertFileSrc(path))
    return { object: gltf.scene, clips: gltf.animations }
  }
  const bytes = await readFileBytes(path)
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  const dir = path.replace(/[^\\/]+$/, '')
  const material = new THREE.MeshStandardMaterial({ color: 0xb8bcc6, metalness: 0.15, roughness: 0.55 })
  switch (ext) {
    case 'glb': {
      const gltf = await new GLTFLoader().parseAsync(buffer, convertFileSrc(dir))
      return { object: gltf.scene, clips: gltf.animations }
    }
    case 'obj':
      return { object: new OBJLoader().parse(new TextDecoder().decode(bytes)), clips: [] }
    case 'stl': {
      const geo = new STLLoader().parse(buffer)
      geo.computeVertexNormals()
      return { object: new THREE.Mesh(geo, material), clips: [] }
    }
    case 'ply': {
      const geo = new PLYLoader().parse(buffer)
      geo.computeVertexNormals()
      const mat = geo.hasAttribute('color') ? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }) : material
      return { object: new THREE.Mesh(geo, mat), clips: [] }
    }
    case 'fbx': {
      const fbx = new FBXLoader().parse(buffer, convertFileSrc(dir))
      return { object: fbx, clips: fbx.animations }
    }
    default:
      throw new Error(`.${ext} isn't a supported 3D format (${FORMATS.join(', ')}).`)
  }
}

function inspect(object: THREE.Object3D, name: string, clips: THREE.AnimationClip[]): ModelInfo {
  let vertices = 0
  let triangles = 0
  let meshes = 0
  const materials = new Set<string>()
  object.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    meshes++
    const g = mesh.geometry
    const count = g.attributes.position?.count ?? 0
    vertices += count
    triangles += g.index ? g.index.count / 3 : count / 3
    ;(Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((m) => materials.add(m.uuid))
  })
  const size = new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3())
  return { name, vertices, triangles: Math.round(triangles), meshes, materials: materials.size, size, animations: clips.map((c, i) => c.name || `Clip ${i + 1}`) }
}

export function Viewer3DApp({ initialPath }: { onClose: () => void; initialPath?: string }) {
  const mountRef = useRef<HTMLDivElement>(null)
  const ctx = useRef<{
    renderer: THREE.WebGLRenderer
    scene: THREE.Scene
    camera: THREE.PerspectiveCamera
    controls: OrbitControls
    grid: THREE.GridHelper
    model: THREE.Object3D | null
    mixer: THREE.AnimationMixer | null
    clips: THREE.AnimationClip[]
  } | null>(null)
  const [info, setInfo] = useState<ModelInfo | null>(null)
  const [loading, setLoading] = useState(false)
  const [wireframe, setWireframe] = useState(false)
  const [autoRotate, setAutoRotate] = useState(false)
  const [showGrid, setShowGrid] = useState(true)
  const [background, setBackground] = useState<Background>('studio')
  const [clip, setClip] = useState<number | null>(null)
  const [dropping, setDropping] = useState(false)

  // Scene setup: PBR studio lighting from an environment map, soft shadows.
  useEffect(() => {
    const mount = mountRef.current!
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    mount.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const pmrem = new THREE.PMREMGenerator(renderer)
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    const key = new THREE.DirectionalLight(0xffffff, 1.6)
    key.position.set(5, 10, 7)
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    scene.add(key, new THREE.HemisphereLight(0xffffff, 0x444450, 0.4))
    const shadowCatcher = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.ShadowMaterial({ opacity: 0.25 }))
    shadowCatcher.rotation.x = -Math.PI / 2
    shadowCatcher.receiveShadow = true
    scene.add(shadowCatcher)
    const grid = new THREE.GridHelper(20, 40, 0x888888, 0x555555)
    ;(grid.material as THREE.Material).opacity = 0.35
    ;(grid.material as THREE.Material).transparent = true
    scene.add(grid)

    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 5000)
    camera.position.set(3, 2.2, 4)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08

    ctx.current = { renderer, scene, camera, controls, grid, model: null, mixer: null, clips: [] }

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = mount
      renderer.setSize(w, h)
      camera.aspect = w / Math.max(1, h)
      camera.updateProjectionMatrix()
    }
    const ro = new ResizeObserver(resize)
    ro.observe(mount)
    resize()

    const clock = new THREE.Clock()
    let raf = 0
    const loop = () => {
      raf = requestAnimationFrame(loop)
      const dt = clock.getDelta()
      ctx.current?.mixer?.update(dt)
      controls.update()
      renderer.render(scene, camera)
    }
    loop()
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      controls.dispose()
      pmrem.dispose()
      renderer.dispose()
      mount.removeChild(renderer.domElement)
      ctx.current = null
    }
  }, [])

  const frame = useCallback(() => {
    const c = ctx.current
    if (!c?.model) return
    const box = new THREE.Box3().setFromObject(c.model)
    const size = box.getSize(new THREE.Vector3()).length() || 1
    const center = box.getCenter(new THREE.Vector3())
    c.controls.target.copy(center)
    const dist = size / (2 * Math.tan((c.camera.fov * Math.PI) / 360))
    c.camera.position.copy(center).add(new THREE.Vector3(0.6, 0.45, 0.8).normalize().multiplyScalar(dist * 1.1))
    c.camera.near = size / 1000
    c.camera.far = size * 100
    c.camera.updateProjectionMatrix()
  }, [])

  const openPath = useCallback(
    async (path: string) => {
      const c = ctx.current
      if (!c) return
      setLoading(true)
      try {
        const { object, clips } = await loadModel(path)
        if (c.model) c.scene.remove(c.model)
        // Sit the model on the ground plane, whatever its original origin.
        const box = new THREE.Box3().setFromObject(object)
        object.position.y -= box.min.y
        object.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) {
            o.castShadow = true
            o.receiveShadow = true
          }
        })
        c.scene.add(object)
        c.model = object
        c.clips = clips
        c.mixer = clips.length ? new THREE.AnimationMixer(object) : null
        const size = new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3())
        const extent = Math.max(size.x, size.z, 1)
        c.grid.scale.setScalar(extent / 10)
        setInfo(inspect(object, path.split(/[\\/]/).pop()!, clips))
        setClip(null)
        setWireframe(false)
        frame()
      } catch (err) {
        toastError('Couldn’t open that model', err)
      } finally {
        setLoading(false)
      }
    },
    [frame],
  )

  useEffect(() => {
    if (initialPath) void openPath(initialPath)
  }, [initialPath, openPath])

  // Drop a model file onto the window to open it.
  useEffect(() => {
    const un = getCurrentWebview().onDragDropEvent((e) => {
      const p = e.payload
      if (p.type === 'over' || p.type === 'enter') setDropping(true)
      else if (p.type === 'leave') setDropping(false)
      else if (p.type === 'drop') {
        setDropping(false)
        const file = p.paths.find((x) => FORMATS.includes(x.split('.').pop()!.toLowerCase()))
        if (file) void openPath(file)
      }
    })
    return () => void un.then((fn) => fn())
  }, [openPath])

  useEffect(() => {
    const c = ctx.current
    if (!c) return
    c.controls.autoRotate = autoRotate
    c.grid.visible = showGrid
    c.scene.background = new THREE.Color(BACKGROUNDS[background])
    c.model?.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      ;(Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((m) => {
        if ('wireframe' in m) (m as THREE.MeshStandardMaterial).wireframe = wireframe
      })
    })
  }, [autoRotate, showGrid, background, wireframe, info])

  useEffect(() => {
    const c = ctx.current
    if (!c?.mixer) return
    c.mixer.stopAllAction()
    if (clip !== null && c.clips[clip]) c.mixer.clipAction(c.clips[clip]).play()
  }, [clip])

  async function browse() {
    const picked = await openDialog({ multiple: false, filters: [{ name: '3D models', extensions: FORMATS }] })
    if (typeof picked === 'string') void openPath(picked)
  }

  async function snapshot() {
    const c = ctx.current
    if (!c) return
    c.renderer.render(c.scene, c.camera)
    const blob = await new Promise<Blob | null>((r) => c.renderer.domElement.toBlob(r, 'image/png'))
    if (!blob) return
    const dest = await saveDialog({ defaultPath: `${info?.name.replace(/\.[^.]+$/, '') ?? 'model'}.png`, filters: [{ name: 'PNG image', extensions: ['png'] }] })
    if (!dest) return
    try {
      await writeFile(dest, new Uint8Array(await blob.arrayBuffer()))
    } catch (err) {
      toastError('Couldn’t save the snapshot', err)
    }
  }

  const toggle = (on: boolean) => cn('rounded-[7px] px-2.5 py-1 text-[12px] transition-colors', on ? 'bg-[var(--color-accent)] text-[var(--color-accent-contrast)]' : 'hover:bg-white/10')

  return (
    <div className="flex h-full flex-col bg-[var(--surface-base)] text-[var(--color-text-primary)]">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-[var(--border-hairline)] px-3 py-2">
        <button type="button" onClick={() => void browse()} className="rounded-[7px] bg-white/10 px-3 py-1 text-[12.5px] font-medium hover:bg-white/15">
          Open…
        </button>
        <span className="mx-1 h-5 w-px bg-[var(--border-hairline)]" />
        <button type="button" disabled={!info} onClick={frame} className="rounded-[7px] px-2.5 py-1 text-[12px] hover:bg-white/10 disabled:opacity-40">
          Frame
        </button>
        <button type="button" onClick={() => setWireframe((v) => !v)} className={toggle(wireframe)}>
          Wireframe
        </button>
        <button type="button" onClick={() => setAutoRotate((v) => !v)} className={toggle(autoRotate)}>
          Turntable
        </button>
        <button type="button" onClick={() => setShowGrid((v) => !v)} className={toggle(showGrid)}>
          Grid
        </button>
        <span className="mx-1 h-5 w-px bg-[var(--border-hairline)]" />
        {(Object.keys(BACKGROUNDS) as Background[]).map((b) => (
          <button key={b} type="button" onClick={() => setBackground(b)} className={cn(toggle(background === b), 'capitalize')}>
            {b}
          </button>
        ))}
        <div className="flex-1" />
        <button type="button" disabled={!info} onClick={() => void snapshot()} className="rounded-[7px] px-2.5 py-1 text-[12px] hover:bg-white/10 disabled:opacity-40">
          Save image…
        </button>
      </div>

      <div className="relative min-h-0 flex-1">
        <div ref={mountRef} className="absolute inset-0" />
        {!info && !loading && (
          <button type="button" onClick={() => void browse()} className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-[var(--color-text-secondary)]">
            <svg viewBox="0 0 48 48" width="56" height="56" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" opacity="0.7">
              <path d="M24 5 41 14v20L24 43 7 34V14z" />
              <path d="M7 14l17 9 17-9M24 23v20" />
            </svg>
            <span className="text-[14px] font-medium text-[var(--color-text-primary)]">Open or drop a 3D model</span>
            <span className="text-[12px]">glTF · GLB · OBJ · STL · FBX · PLY</span>
          </button>
        )}
        {loading && <div className="absolute inset-0 flex items-center justify-center bg-black/30 text-[13px]">Loading model…</div>}
        {dropping && <div className="pointer-events-none absolute inset-3 rounded-[12px] border-2 border-dashed border-[var(--color-accent)] bg-[var(--color-accent)]/10" />}

        {info && (
          <div className="os-acrylic absolute right-3 top-3 w-60 rounded-[12px] p-3 text-[12px]">
            <p className="mb-2 truncate text-[13px] font-semibold">{info.name}</p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[var(--os-menu-text-dim)]">
              <dt>Size</dt>
              <dd className="text-right tabular-nums text-[var(--os-menu-text)]">
                {info.size.x.toFixed(2)} × {info.size.y.toFixed(2)} × {info.size.z.toFixed(2)}
              </dd>
              <dt>Vertices</dt>
              <dd className="text-right tabular-nums text-[var(--os-menu-text)]">{info.vertices.toLocaleString()}</dd>
              <dt>Triangles</dt>
              <dd className="text-right tabular-nums text-[var(--os-menu-text)]">{info.triangles.toLocaleString()}</dd>
              <dt>Meshes</dt>
              <dd className="text-right tabular-nums text-[var(--os-menu-text)]">{info.meshes}</dd>
              <dt>Materials</dt>
              <dd className="text-right tabular-nums text-[var(--os-menu-text)]">{info.materials}</dd>
            </dl>
            {info.animations.length > 0 && (
              <label className="mt-3 block">
                <span className="mb-1 block text-[var(--os-menu-text-dim)]">Animation</span>
                <Select
                  value={clip === null ? '' : String(clip)}
                  onChange={(v) => setClip(v === '' ? null : Number(v))}
                  size="sm"
                  className="w-full"
                  options={[{ value: '', label: 'None' }, ...info.animations.map((a, i) => ({ value: String(i), label: a }))]}
                />
              </label>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
