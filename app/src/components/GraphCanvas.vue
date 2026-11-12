<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { select } from 'd3-selection'
import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from 'd3-zoom'
import type { KnowledgePoint, Point, ThemeColor } from '../domain/types'
import { completePositions } from '../graph/layout'

interface ViewportInsets { left: number; right: number; top: number; bottom: number }

const props = withDefaults(defineProps<{
  points: KnowledgePoint[]
  positions: Record<string, Point>
  selectedId: string | null
  graphState: 'ready' | 'updating' | 'unavailable'
  focusRequest: { id: string; seq: number } | null
  viewportInsets?: Partial<ViewportInsets>
}>(), {
  viewportInsets: () => ({ left: 0, right: 0, top: 0, bottom: 0 }),
})

const emit = defineEmits<{
  select: [id: string]
  move: [id: string, position: Point]
  edit: [id: string]
  delete: [id: string]
  restore: []
}>()

const canvasElement = ref<HTMLDivElement | null>(null)
const svgElement = ref<SVGSVGElement | null>(null)
const menuElement = ref<HTMLDivElement | null>(null)
const size = ref({ width: 1000, height: 600 })
const coordinates = ref<Record<string, Point>>({})
const camera = ref<ZoomTransform>(zoomIdentity)
const fitScale = ref(1)
const cameraInitialized = ref(false)
const isOverview = ref(true)
const draggedId = ref<string | null>(null)
const menu = ref<{ id: string; x: number; y: number } | null>(null)
let zoomBehavior: ZoomBehavior<SVGSVGElement, unknown> | null = null
let resizeObserver: ResizeObserver | null = null
let cameraAnimation = 0
let focusFrame = 0
let focusSettleTimer: ReturnType<typeof setTimeout> | null = null
let pendingFocusId: string | null = null
let disposed = false
let drag: {
  id: string
  pointerId: number
  element: SVGGElement
  startX: number
  startY: number
  original: Point
  scale: number
  moved: boolean
} | null = null

const colors: Record<ThemeColor, { light: string; middle: string; dark: string; stroke: string }> = {
  docker: { light: '#f0f8ff', middle: '#bedcff', dark: '#74aff0', stroke: '#4b90e2' },
  linux: { light: '#f0fbf4', middle: '#c5e9cf', dark: '#8dcca2', stroke: '#62a87c' },
  mysql: { light: '#fffaf0', middle: '#ffe4af', dark: '#ebbc60', stroke: '#c59538' },
  concurrency: { light: '#f8f3ff', middle: '#decdf6', dark: '#b290df', stroke: '#9771c9' },
  neutral: { light: '#ffffff', middle: '#e8e8e8', dark: '#bfbfbf', stroke: '#8b8b8b' },
}

const pointMap = computed(() => new Map(props.points.map((point) => [point.id, point])))
const rootFamilies: Record<string, ThemeColor> = {
  docker: 'docker', linux: 'linux', mysql: 'mysql', concurrency: 'concurrency',
}
const displayFamilies = computed(() => {
  function findRoot(id: string, visited: Set<string>): ThemeColor | undefined {
    if (rootFamilies[id]) return rootFamilies[id]
    if (visited.has(id)) return undefined
    visited.add(id)
    const point = pointMap.value.get(id)
    if (!point) return undefined
    for (const topicId of point.topicIds) {
      const family = findRoot(topicId, visited)
      if (family) return family
    }
    return undefined
  }
  return new Map(props.points.map((point) => [point.id, findRoot(point.id, new Set()) ?? point.color]))
})
const ready = computed(() => props.graphState === 'ready')
const cameraString = computed(() => 'translate(' + camera.value.x + ' ' + camera.value.y + ') scale(' + camera.value.k + ')')
const zoomPercentage = computed(() => Math.round(camera.value.k / fitScale.value * 100))
const menuPoint = computed(() => menu.value ? pointMap.value.get(menu.value.id) : undefined)
const labelFont = computed(() => Math.max(16, 13 / camera.value.k))
const normalizedInsets = computed<ViewportInsets>(() => {
  const value = (side: keyof ViewportInsets) => {
    const inset = props.viewportInsets[side] ?? 0
    return Number.isFinite(inset) ? Math.max(0, inset) : 0
  }
  return { left: value('left'), right: value('right'), top: value('top'), bottom: value('bottom') }
})
const safeViewport = computed(() => usableViewport())
const messagePosition = computed(() => {
  const view = safeViewport.value
  return {
    left: (view.left + view.right) / 2 + 'px',
    top: (view.top + view.bottom) / 2 + 'px',
    width: Math.max(120, Math.min(350, view.right - view.left - 24)) + 'px',
  }
})

function radius(point: KnowledgePoint) { return point.isTheme ? 22 : 11.5 }
function displayColor(point: KnowledgePoint) { return displayFamilies.value.get(point.id) ?? point.color }
function palette(point: KnowledgePoint) { return colors[displayColor(point)] ?? colors.neutral }
function coord(id: string): Point { return coordinates.value[id] ?? { x: 600, y: 310 } }

function labelPlacement(point: KnowledgePoint) {
  const r = radius(point)
  if (['docker', 'mysql', 'concurrency'].includes(point.id)) return { x: -r - 12, y: 5.5, anchor: 'end' as const }
  if (point.id === 'linux') return { x: 0, y: r + 25, anchor: 'middle' as const }
  return { x: r + 10, y: 5.5, anchor: 'start' as const }
}

function textWidth(text: string) {
  return Array.from(text).reduce((sum, char) => sum + (/[^\u0000-\u007f]/.test(char) ? 16.5 : 8.8), 0)
}

function accessibleName(point: KnowledgePoint) {
  const topics = point.topicIds.map((id) => pointMap.value.get(id)?.name).filter(Boolean)
  return point.name + (topics.length ? '，所属主题 ' + topics.join('、') : point.isTheme ? '，主题' : '，独立知识点')
}

const edges = computed(() => props.points.flatMap((point) => point.topicIds.flatMap((topicId) => {
  const parent = pointMap.value.get(topicId)
  if (!parent) return []
  const from = coord(topicId)
  const to = coord(point.id)
  const dx = to.x - from.x
  const dy = to.y - from.y
  const distance = Math.max(1, Math.hypot(dx, dy))
  return [{
    id: topicId + ':' + point.id,
    x1: from.x + dx / distance * (radius(parent) + 1),
    y1: from.y + dy / distance * (radius(parent) + 1),
    x2: to.x - dx / distance * (radius(point) + 1),
    y2: to.y - dy / distance * (radius(point) + 1),
    related: props.selectedId === topicId || props.selectedId === point.id,
  }]
})))

function syncCoordinates() {
  const source: Record<string, Point> = { ...coordinates.value, ...props.positions }
  if (drag) source[drag.id] = coord(drag.id)
  coordinates.value = completePositions(props.points, source)
}
watch(() => props.positions, syncCoordinates, { deep: true, immediate: true })
watch(() => props.points.map((point) => point.id + ':' + point.name).join('|'), (value, previous) => {
  syncCoordinates()
  if (menu.value && !pointMap.value.has(menu.value.id)) menu.value = null
  if (cameraInitialized.value && value !== previous && (isOverview.value || !previous)) nextTick(() => fitAll(false))
})

function cancelCameraAnimation() {
  if (cameraAnimation) cancelAnimationFrame(cameraAnimation)
  cameraAnimation = 0
}

function applyCamera(transform: ZoomTransform) {
  if (svgElement.value && zoomBehavior) select(svgElement.value).call(zoomBehavior.transform, transform)
  else camera.value = transform
}

function animateCamera(target: ZoomTransform, duration = 280) {
  cancelCameraAnimation()
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (!duration || reducedMotion) { applyCamera(target); return }
  const start = camera.value
  const startTime = performance.now()
  const frame = (now: number) => {
    const progress = Math.min(1, (now - startTime) / duration)
    const eased = 1 - (1 - progress) ** 3
    applyCamera(zoomIdentity
      .translate(start.x + (target.x - start.x) * eased, start.y + (target.y - start.y) * eased)
      .scale(start.k + (target.k - start.k) * eased))
    if (progress < 1) cameraAnimation = requestAnimationFrame(frame)
    else cameraAnimation = 0
  }
  cameraAnimation = requestAnimationFrame(frame)
}

interface VisualBounds { minX: number; minY: number; maxX: number; maxY: number }

// These bounds are in scaled world space, before the camera translation.
// Measure the compensated 13px-minimum labels, not just their node centers.
function pointBounds(point: KnowledgePoint, scale: number): VisualBounds {
  const at = coord(point.id)
  const placement = labelPlacement(point)
  const fontPixels = Math.max(16 * scale, 13)
  const width = textWidth(point.name) * fontPixels / 16
  const labelX = (at.x + placement.x) * scale
  const labelY = (at.y + placement.y) * scale
  const left = placement.anchor === 'end' ? labelX - width : placement.anchor === 'middle' ? labelX - width / 2 : labelX
  const right = placement.anchor === 'end' ? labelX : placement.anchor === 'middle' ? labelX + width / 2 : labelX + width
  const r = Math.max((radius(point) + 12) * scale, 18)
  return {
    minX: Math.min(at.x * scale - r, left - 8),
    maxX: Math.max(at.x * scale + r, right + 8),
    minY: Math.min(at.y * scale - r, labelY - fontPixels * .98 - 3),
    maxY: Math.max(at.y * scale + r, labelY + fontPixels * .4 + 3),
  }
}

function graphBounds(scale: number): VisualBounds {
  return props.points.reduce<VisualBounds>((bounds, point) => {
    const next = pointBounds(point, scale)
    return {
      minX: Math.min(bounds.minX, next.minX), minY: Math.min(bounds.minY, next.minY),
      maxX: Math.max(bounds.maxX, next.maxX), maxY: Math.max(bounds.maxY, next.maxY),
    }
  }, { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity })
}

function usableViewport(insets = normalizedInsets.value, dimensions = size.value) {
  // Insets describe foreground panels; the additional gutter keeps text off
  // their rims. Reserve the lower control strip even without supplied insets.
  const left = insets.left + 12
  const right = dimensions.width - insets.right - 12
  const top = insets.top + 12
  const bottom = dimensions.height - Math.max(60, insets.bottom) - 12
  return { left, right: Math.max(left + 1, right), top, bottom: Math.max(top + 1, bottom) }
}

function calculateFit(): ZoomTransform | null {
  if (!props.points.length || size.value.width < 1 || size.value.height < 1) return null
  const view = usableViewport()
  const width = Math.max(1, view.right - view.left)
  const height = Math.max(1, view.bottom - view.top)
  let low = .06, high = 1.2
  for (let step = 0; step < 28; step++) {
    const trial = (low + high) / 2
    const bounds = graphBounds(trial)
    if (bounds.maxX - bounds.minX <= width && bounds.maxY - bounds.minY <= height) low = trial
    else high = trial
  }
  const bounds = graphBounds(low)
  const x = view.left + (width - (bounds.maxX - bounds.minX)) / 2 - bounds.minX
  const y = view.top + (height - (bounds.maxY - bounds.minY)) / 2 - bounds.minY
  return zoomIdentity.translate(x, y).scale(low)
}

function fitAll(animate = true) {
  const target = calculateFit()
  if (!target) return
  isOverview.value = true
  fitScale.value = target.k
  cameraInitialized.value = true
  const unchanged = Math.abs(target.k - camera.value.k) < .0002
    && Math.abs(target.x - camera.value.x) < .25 && Math.abs(target.y - camera.value.y) < .25
  if (unchanged) cancelCameraAnimation()
  else animateCamera(target, animate ? 260 : 0)
}

function focusNode(id: string) {
  const point = pointMap.value.get(id)
  if (!ready.value || !point) return
  if (isOverview.value) {
    // Selection changes the highlight; overview retains the map's full context.
    fitAll(true)
    return
  }
  const k = camera.value.k
  const bounds = pointBounds(point, k)
  const view = usableViewport()
  const screen = {
    left: bounds.minX + camera.value.x, right: bounds.maxX + camera.value.x,
    top: bounds.minY + camera.value.y, bottom: bounds.maxY + camera.value.y,
  }
  const host = canvasElement.value?.getBoundingClientRect()
  const controls = canvasElement.value?.querySelector('.graph-controls')?.getBoundingClientRect()
  const underControls = host && controls
    ? screen.right > controls.left - host.left - 8 && screen.left < controls.right - host.left + 8
      && screen.bottom > controls.top - host.top - 8 && screen.top < controls.bottom - host.top + 8
    : false
  const alreadyVisible = screen.left >= view.left && screen.right <= view.right
    && screen.top >= view.top && screen.bottom <= view.bottom && !underControls
  if (alreadyVisible) return
  // The user left overview deliberately. Reveal an offscreen selection without
  // changing that user's chosen zoom level.
  animateCamera(zoomIdentity
    .translate((view.left + view.right - bounds.minX - bounds.maxX) / 2,
      (view.top + view.bottom - bounds.minY - bounds.maxY) / 2)
    .scale(k), 280)
}

function queueFocus(id: string) {
  cancelPendingFocus()
  pendingFocusId = id
  nextTick(() => {
    if (disposed) return
    focusFrame = requestAnimationFrame(() => {
      focusFrame = requestAnimationFrame(() => {
        focusFrame = 0
        schedulePendingFocus()
      })
    })
  })
}

function schedulePendingFocus() {
  if (focusSettleTimer) clearTimeout(focusSettleTimer)
  focusSettleTimer = setTimeout(() => {
    focusSettleTimer = null
    const id = pendingFocusId
    pendingFocusId = null
    if (id && !disposed) focusNode(id)
  }, 60)
}

function cancelPendingFocus() {
  if (focusFrame) cancelAnimationFrame(focusFrame)
  if (focusSettleTimer) clearTimeout(focusSettleTimer)
  focusFrame = 0
  focusSettleTimer = null
  pendingFocusId = null
}

watch(() => props.focusRequest?.seq, () => {
  if (props.focusRequest) queueFocus(props.focusRequest.id)
})
watch(() => props.graphState, (state, previous) => {
  if (state !== 'ready') { menu.value = null; cancelDrag(); cancelCameraAnimation(); cancelPendingFocus() }
  else if (previous !== 'ready' && props.selectedId) queueFocus(props.selectedId)
})

function changeZoom(factor: number) {
  if (!ready.value) return
  isOverview.value = false
  const view = usableViewport()
  const centerX = (view.left + view.right) / 2
  const centerY = (view.top + view.bottom) / 2
  const middle = camera.value.invert([centerX, centerY])
  const k = Math.max(0.06, Math.min(3.2, camera.value.k * factor))
  animateCamera(zoomIdentity
    .translate(centerX - middle[0] * k, centerY - middle[1] * k)
    .scale(k), 160)
}

function startDrag(event: PointerEvent, point: KnowledgePoint) {
  if (!ready.value || event.button !== 0) return
  event.stopPropagation()
  event.preventDefault()
  menu.value = null
  cancelPendingFocus()
  cancelCameraAnimation()
  const element = event.currentTarget as SVGGElement
  element.focus({ preventScroll: true })
  element.setPointerCapture(event.pointerId)
  drag = {
    id: point.id, pointerId: event.pointerId, element,
    startX: event.clientX, startY: event.clientY, original: { ...coord(point.id) },
    scale: camera.value.k, moved: false,
  }
}

function moveDrag(event: PointerEvent) {
  if (!drag || event.pointerId !== drag.pointerId || !ready.value) return
  const dx = event.clientX - drag.startX
  const dy = event.clientY - drag.startY
  if (!drag.moved && Math.hypot(dx, dy) < 4) return
  drag.moved = true
  draggedId.value = drag.id
  coordinates.value = {
    ...coordinates.value,
    [drag.id]: { x: drag.original.x + dx / drag.scale, y: drag.original.y + dy / drag.scale },
  }
}

function endDrag(event: PointerEvent) {
  if (!drag || event.pointerId !== drag.pointerId) return
  const finished = drag
  const at = { ...coord(finished.id) }
  drag = null
  draggedId.value = null
  if (finished.element.hasPointerCapture(event.pointerId)) finished.element.releasePointerCapture(event.pointerId)
  if (!ready.value) return
  if (finished.moved) emit('move', finished.id, at)
  emit('select', finished.id)
}

function cancelDrag() {
  if (!drag) return
  const previous = drag
  coordinates.value = { ...coordinates.value, [previous.id]: previous.original }
  if (previous.element.hasPointerCapture(previous.pointerId)) previous.element.releasePointerCapture(previous.pointerId)
  drag = null
  draggedId.value = null
}

function selectFromKeyboard(event: KeyboardEvent, point: KnowledgePoint) {
  if (!ready.value) return
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    emit('select', point.id)
  } else if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
    event.preventDefault()
    const transformed = camera.value.apply([coord(point.id).x, coord(point.id).y])
    showMenu(point.id, transformed[0] + 18, transformed[1] + 10, true)
  }
}

function showMenu(id: string, x: number, y: number, focus = false) {
  if (!ready.value) return
  emit('select', id)
  nextTick(() => {
    if (disposed) return
    menu.value = { id, ...clampMenuPosition(x, y) }
    if (focus) nextTick(() => menuElement.value?.querySelector<HTMLButtonElement>('button')?.focus())
  })
}

function clampMenuPosition(x: number, y: number) {
  const view = usableViewport()
  return {
    x: Math.max(view.left, Math.min(x, view.right - 190)),
    y: Math.max(view.top, Math.min(y, view.bottom - 155)),
  }
}

function reconcileViewport(previous: ReturnType<typeof usableViewport>) {
  const fitted = calculateFit()
  if (fitted) fitScale.value = fitted.k
  if (!cameraInitialized.value || isOverview.value) fitAll(false)
  else if (!drag) {
    const view = usableViewport()
    cancelCameraAnimation()
    applyCamera(zoomIdentity
      .translate(camera.value.x + (view.left + view.right - previous.left - previous.right) / 2,
        camera.value.y + (view.top + view.bottom - previous.top - previous.bottom) / 2)
      .scale(camera.value.k))
  }
  if (menu.value) menu.value = { id: menu.value.id, ...clampMenuPosition(menu.value.x, menu.value.y) }
  if (pendingFocusId) schedulePendingFocus()
}

watch(() => [normalizedInsets.value.left, normalizedInsets.value.right, normalizedInsets.value.top, normalizedInsets.value.bottom],
  (next, previous) => {
    const oldInsets = { left: previous[0] ?? 0, right: previous[1] ?? 0, top: previous[2] ?? 0, bottom: previous[3] ?? 0 }
    const detailsOpened = cameraInitialized.value && oldInsets.right <= 80 && (next[1] ?? 0) > 240
    if (detailsOpened) {
      // The detail panel consumes canvas width, not the user's chosen zoom.
      // Keep the pre-opening scale and move the selected point into the new
      // safe area rather than squeezing all nodes into the narrow corridor.
      cancelCameraAnimation()
      cancelPendingFocus()
      isOverview.value = false
    }
    reconcileViewport(usableViewport(oldInsets))
    if (ready.value && !isOverview.value && props.selectedId) queueFocus(props.selectedId)
  }, { flush: 'post' })

function openContextMenu(event: MouseEvent, point: KnowledgePoint) {
  event.preventDefault()
  event.stopPropagation()
  const bounds = canvasElement.value?.getBoundingClientRect()
  if (bounds) showMenu(point.id, event.clientX - bounds.left, event.clientY - bounds.top)
}

function menuAction(action: 'edit' | 'delete') {
  if (!menu.value || !ready.value) return
  const id = menu.value.id
  menu.value = null
  if (action === 'edit') emit('edit', id)
  else emit('delete', id)
}

function closeMenuFromOutside(event: PointerEvent) {
  if (menu.value && !menuElement.value?.contains(event.target as Node)) menu.value = null
}
function globalKey(event: KeyboardEvent) {
  if (event.key === 'Escape') { menu.value = null; cancelDrag() }
}

onMounted(() => {
  const svg = svgElement.value
  const host = canvasElement.value
  if (!svg || !host) return
  zoomBehavior = zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.06, 3.2])
    .clickDistance(4)
    .filter((event: Event) => {
      if (!ready.value || drag) return false
      if (event.type === 'wheel') return true
      const pointer = event as MouseEvent
      return !pointer.button && !(event.target as Element | null)?.closest('[data-node-id]')
    })
    .on('start', (event) => {
      if (event.sourceEvent) {
        isOverview.value = false
        cancelCameraAnimation(); cancelPendingFocus(); menu.value = null
      }
    })
    .on('zoom', (event) => { camera.value = event.transform })
  select(svg).call(zoomBehavior)

  resizeObserver = new ResizeObserver((entries) => {
    const entry = entries[0]
    if (!entry) return
    const width = entry.contentRect.width
    const height = entry.contentRect.height
    if (width < 1 || height < 1) return
    const oldView = usableViewport()
    size.value = { width, height }
    reconcileViewport(oldView)
  })
  resizeObserver.observe(host)
  document.addEventListener('pointerdown', closeMenuFromOutside)
  document.addEventListener('keydown', globalKey)
})

onBeforeUnmount(() => {
  disposed = true
  cancelCameraAnimation()
  cancelPendingFocus()
  resizeObserver?.disconnect()
  if (svgElement.value) select(svgElement.value).on('.zoom', null)
  document.removeEventListener('pointerdown', closeMenuFromOutside)
  document.removeEventListener('keydown', globalKey)
})

defineExpose({ fitAll, focusNode })
</script>

<template>
  <div
    ref="canvasElement"
    class="graph-canvas"
    :class="{ 'is-disabled': !ready, 'is-dragging-node': draggedId }"
    :data-overview="isOverview"
    :data-viewport-left="safeViewport.left"
    :data-viewport-right="safeViewport.right"
    :data-viewport-top="safeViewport.top"
    :data-viewport-bottom="safeViewport.bottom"
    data-testid="graph-canvas"
  >
    <svg
      ref="svgElement"
      class="graph-svg"
      :viewBox="'0 0 ' + size.width + ' ' + size.height"
      role="group"
      aria-label="知识图谱"
      :aria-busy="graphState === 'updating'"
      @contextmenu.prevent
    >
      <defs>
        <linearGradient
          v-for="(color, key) in colors"
          :id="'noterion-node-' + key"
          :key="key"
          x1="18%" y1="0%" x2="75%" y2="100%"
        >
          <stop offset="0%" :stop-color="color.light" />
          <stop offset="47%" :stop-color="color.middle" />
          <stop offset="100%" :stop-color="color.dark" />
        </linearGradient>
        <filter id="noterion-node-shadow" x="-60%" y="-60%" width="220%" height="240%">
          <feDropShadow dx="0" dy="1.5" stdDeviation="1.7" flood-color="#000000" flood-opacity=".09" />
        </filter>
      </defs>

      <g class="graph-world" :transform="cameraString" :aria-hidden="!ready">
        <g class="graph-edges" aria-hidden="true">
          <line
            v-for="edge in edges"
            :key="edge.id"
            :x1="edge.x1" :y1="edge.y1" :x2="edge.x2" :y2="edge.y2"
            class="graph-edge"
            :class="{ 'is-related': edge.related }"
            vector-effect="non-scaling-stroke"
          />
        </g>
        <g
          v-for="point in points"
          :key="point.id"
          class="graph-node"
          :class="{ 'is-selected': selectedId === point.id, 'is-theme': point.isTheme, 'is-dragging': draggedId === point.id }"
          :transform="'translate(' + coord(point.id).x + ' ' + coord(point.id).y + ')'"
          :data-node-id="point.id"
          :tabindex="ready ? 0 : -1"
          role="button"
          :aria-label="accessibleName(point)"
          :aria-pressed="selectedId === point.id"
          :aria-disabled="!ready"
          @pointerdown="startDrag($event, point)"
          @pointermove="moveDrag"
          @pointerup="endDrag"
          @pointercancel="cancelDrag"
          @contextmenu="openContextMenu($event, point)"
          @keydown="selectFromKeyboard($event, point)"
        >
          <title>{{ accessibleName(point) }}</title>
          <circle class="node-hit-area" :r="Math.max(22, 16 / camera.k, radius(point) + 9)" fill="transparent" />
          <circle v-if="selectedId !== point.id" class="node-focus-ring" :r="radius(point) + 7" />
          <g v-if="selectedId === point.id" class="node-selection" aria-hidden="true">
            <circle :r="radius(point) + 6.7" fill="none" stroke="#ffffff" stroke-width="7" />
            <circle :r="radius(point) + 4.6" fill="none" :stroke="palette(point).stroke" stroke-width="1.7" />
            <circle :r="radius(point) + 9" fill="none" :stroke="palette(point).stroke" stroke-width="2.3" />
          </g>
          <circle
            class="node-body"
            :r="radius(point)"
            :fill="'url(#noterion-node-' + displayColor(point) + ')'"
            :stroke="palette(point).stroke"
            stroke-width="1.15"
            filter="url(#noterion-node-shadow)"
          />
          <ellipse
            class="node-reflection"
            :cx="-radius(point) * .18"
            :cy="-radius(point) * .40"
            :rx="radius(point) * .60"
            :ry="radius(point) * .21"
            fill="#ffffff"
            opacity=".38"
            transform="rotate(-20)"
            aria-hidden="true"
          />
          <text
            class="node-label"
            :x="labelPlacement(point).x"
            :y="labelPlacement(point).y"
            :text-anchor="labelPlacement(point).anchor"
            :style="{ fontSize: labelFont + 'px' }"
          >{{ point.name }}</text>
        </g>
      </g>
    </svg>

    <div v-if="!points.length && ready" class="graph-empty" :style="messagePosition">
      <svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><circle cx="24" cy="14" r="5"/><circle cx="13" cy="33" r="5"/><circle cx="35" cy="33" r="5"/><path d="m21.5 18.3-6 10M26.5 18.3l6 10M18 33h12"/></svg>
      <p>图谱里还没有知识点</p>
      <span>点击顶部“导入知识”或“新建知识点”，开始建立图谱。</span>
    </div>

    <div class="graph-controls" aria-label="图谱视图操作" @pointerdown.stop>
      <div class="zoom-group">
        <button class="graph-control icon-control" type="button" aria-label="缩小图谱" title="缩小" :disabled="!ready || !points.length" @click="changeZoom(1 / 1.2)">
          <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M5 10h10" /></svg>
        </button>
        <span class="zoom-value" data-testid="zoom-value">{{ zoomPercentage }}%</span>
        <button class="graph-control icon-control" type="button" aria-label="放大图谱" title="放大" :disabled="!ready || !points.length" @click="changeZoom(1.2)">
          <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M5 10h10M10 5v10" /></svg>
        </button>
      </div>
      <button class="graph-control fit-control" type="button" :disabled="!ready || !points.length" @click="fitAll(true)">
        <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M7 3H3v4m10-4h4v4M3 13v4h4m10-4v4h-4" /></svg>
        适应全图
      </button>
    </div>

    <div
      v-if="menu && menuPoint"
      ref="menuElement"
      class="node-menu"
      :style="{ left: menu.x + 'px', top: menu.y + 'px' }"
      role="menu"
      :aria-label="menuPoint.name + '操作'"
      @pointerdown.stop
    >
      <div class="node-menu-title">{{ menuPoint.name }}</div>
      <button type="button" role="menuitem" @click="menuAction('edit')">
        <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m12.7 3.5 3.8 3.8M4 16l1-4L13.7 3.3a1.4 1.4 0 0 1 2 0l1 1a1.4 1.4 0 0 1 0 2L8 15l-4 1Z"/></svg>
        编辑知识点
      </button>
      <button type="button" role="menuitem" @click="menuAction('delete')">
        <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M3.5 5.5h13M8 3.5h4M5.5 5.5l.8 11h7.4l.8-11M8 8.5v5m4-5v5"/></svg>
        从图中删除
      </button>
    </div>

    <div v-if="graphState !== 'ready'" class="graph-state-overlay" role="status" aria-live="polite">
      <div class="graph-state-message" :style="messagePosition">
        <div v-if="graphState === 'updating'" class="graph-loader" aria-hidden="true"></div>
        <svg v-else class="graph-state-icon" viewBox="0 0 40 40" fill="none" aria-hidden="true">
          <path d="M11 27a8 8 0 0 1-1-15.6 11 11 0 0 1 20-1.1A7.5 7.5 0 0 1 31 25" />
          <path d="m13 23 14 14m0-14L13 37" />
        </svg>
        <h3>{{ graphState === 'updating' ? '图谱更新中' : '图服务不可用' }}</h3>
        <p>{{ graphState === 'updating' ? '正在更新已保存的知识，稍后恢复图操作。' : '搜索、描述和关联资料仍可使用。' }}</p>
        <button v-if="graphState === 'unavailable'" class="graph-restore" type="button" @click="emit('restore')">恢复连接</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.graph-canvas {
  position: relative;
  isolation: isolate;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border: 0;
  border-radius: 0;
  background:
    radial-gradient(ellipse at 40% 20%, rgba(255,255,255,.95), transparent 70%),
    linear-gradient(145deg, #fefefe, #f7f7f7);
  box-shadow: none;
}
.graph-svg { display: block; width: 100%; height: 100%; overflow: hidden; touch-action: none; cursor: grab; user-select: none; }
.graph-svg:active { cursor: grabbing; }
.graph-canvas.is-disabled .graph-svg { cursor: default; }
.graph-world { transition: opacity .2s ease, filter .2s ease; }
.graph-canvas.is-disabled .graph-world { opacity: .28; filter: grayscale(.8); pointer-events: none; }
.graph-edge { stroke: #a0a0a0; stroke-width: 1; }
.graph-edge.is-related { stroke: #666; stroke-width: 1.45; }
.graph-node { cursor: pointer; outline: none; }
.graph-node.is-dragging { cursor: grabbing; }
.node-body { transition: stroke-width .14s ease; }
.graph-node:hover .node-body { stroke-width: 1.9; }
.node-focus-ring { fill: none; stroke: #353535; stroke-width: 1.6; stroke-dasharray: 3 3; opacity: 0; }
.graph-node:focus-visible .node-focus-ring { opacity: 1; }
.node-reflection { pointer-events: none; }
.node-label {
  fill: var(--ink, #202020);
  font-family: inherit;
  font-weight: 500;
  stroke: rgba(252,252,252,.96);
  stroke-width: 5px;
  stroke-linecap: round;
  stroke-linejoin: round;
  paint-order: stroke;
}
.graph-node.is-theme .node-label { font-weight: 650; }
.graph-node.is-selected .node-label { font-weight: 650; }
.graph-controls { position: absolute; right: 18px; bottom: 17px; z-index: 3; display: flex; align-items: center; gap: 10px; }
.zoom-group, .graph-control {
  border: 1px solid rgba(210,210,210,.9);
  background: linear-gradient(155deg, rgba(255,255,255,.97), rgba(244,244,244,.86));
  box-shadow: inset 0 1px 0 white, 0 2px 5px rgba(0,0,0,.06);
  backdrop-filter: blur(15px);
}
.zoom-group { display: flex; align-items: center; height: 35px; border-radius: 9px; padding: 0 2px; }
.graph-control { font: inherit; font-size: 13px; color: var(--ink, #202020); cursor: pointer; transition: background .15s, box-shadow .15s; }
.graph-control:hover:not(:disabled) { background: linear-gradient(155deg, #fff, #eaeaea); box-shadow: inset 0 1px 0 white, 0 3px 7px rgba(0,0,0,.1); }
.graph-control:active:not(:disabled) { box-shadow: inset 0 1px 3px rgba(0,0,0,.1); }
.graph-control:focus-visible, .node-menu button:focus-visible, .graph-restore:focus-visible { outline: 2px solid #3d3d3d; outline-offset: 3px; }
.graph-control:disabled { opacity: .4; cursor: default; box-shadow: none; }
.icon-control { display: grid; place-items: center; width: 31px; height: 30px; padding: 0; background: transparent; box-shadow: none; border: 0; border-radius: 6px; }
.icon-control:hover:not(:disabled) { box-shadow: none; }
.graph-control svg, .node-menu svg { width: 17px; height: 17px; stroke: currentColor; stroke-width: 1.55; stroke-linecap: round; stroke-linejoin: round; }
.zoom-value { min-width: 49px; text-align: center; font-size: 12px; color: #454545; font-variant-numeric: tabular-nums; }
.fit-control { height: 35px; display: flex; align-items: center; justify-content: center; gap: 7px; border-radius: 9px; padding: 0 11px; }
.node-menu { position: absolute; z-index: 12; width: 176px; padding: 6px; background: rgba(255,255,255,.94); backdrop-filter: blur(18px); border: 1px solid rgba(255,255,255,.98); border-radius: 12px; box-shadow: 0 12px 38px rgba(0,0,0,.12), 0 0 0 1px rgba(0,0,0,.07); }
.node-menu-title { padding: 7px 9px 8px; font-size: 12px; color: #707070; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; border-bottom: 1px solid #ebebeb; margin-bottom: 4px; }
.node-menu button { display: flex; align-items: center; width: 100%; gap: 9px; min-height: 35px; padding: 6px 9px; font: inherit; font-size: 13px; color: #282828; background: none; border: 0; border-radius: 7px; text-align: left; cursor: pointer; }
.node-menu button:hover { background: #ededed; }
.graph-state-overlay { position: absolute; z-index: 20; inset: 0; display: grid; place-items: center; padding: 24px; background: rgba(250,250,250,.64); backdrop-filter: blur(5px); }
.graph-state-message { position: absolute; transform: translate(-50%, -50%); text-align: center; max-width: 350px; color: var(--ink, #202020); }
.graph-state-message h3 { margin: 15px 0 9px; font-size: 19px; font-weight: 600; }
.graph-state-message p { margin: 0; color: var(--muted, #646464); font-size: 13px; line-height: 1.7; }
.graph-state-icon { width: 39px; height: 39px; stroke: #666; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
.graph-restore { margin-top: 20px; min-height: 36px; padding: 0 19px; border: 1px solid #303030; border-radius: 9px; background: linear-gradient(140deg, #252525, #484848); color: white; font: inherit; font-size: 13px; cursor: pointer; box-shadow: 0 3px 9px rgba(0,0,0,.1); }
.graph-loader { width: 28px; height: 28px; margin: auto; border: 2px solid #d8d8d8; border-top-color: #444; border-radius: 50%; animation: graph-loading .85s linear infinite; }
.graph-empty { position: absolute; transform: translate(-50%, -50%); text-align: center; pointer-events: none; }
.graph-empty svg { width: 44px; height: 44px; stroke: #989898; stroke-width: 1.4; margin-bottom: 10px; }
.graph-empty p { color: #646464; font-size: 16px; margin: 0 0 8px; }
.graph-empty span { font-size: 12px; color: #858585; }
@keyframes graph-loading { to { transform: rotate(360deg); } }
@media (max-width: 1200px) {
  .graph-controls { right: 12px; bottom: 12px; gap: 7px; }
  .fit-control { padding: 0 9px; }
}
@media (prefers-reduced-motion: reduce) {
  .graph-world, .node-body, .graph-control { transition: none; }
  .graph-loader { animation-duration: 2.8s; }
}
</style>

