import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRenderer, type App } from 'vue'
import { useNoterion, type Snapshot } from './useNoterion'

const apps: App[] = []
function mountStore() {
  const renderer = createRenderer<object, object>({ patchProp() {}, insert() {}, remove() {}, createElement: () => ({}), createText: () => ({}), createComment: () => ({}), setText() {}, setElementText() {}, parentNode: () => null, nextSibling: () => null })
  let store!: ReturnType<typeof useNoterion>
  const app = renderer.createApp({ setup() { store = useNoterion(); return () => null } })
  app.mount({}); apps.push(app); return store
}
const snapshot = (spaceId: string, epoch: number): Snapshot => ({ root: 'test-data', revision: 1, spaceId, epoch, spaces: [{ id: 'a', name: '学习' }, { id: 'b', name: '项目' }], points: [], resources: [], positions: {} })
afterEach(() => { apps.splice(0).forEach(app => app.unmount()); vi.unstubAllGlobals() })

describe('space storage interaction', () => {
  it('binds a write to its starting space and refuses a late snapshot from another space', async () => {
    let finish!: (value: Snapshot) => void
    const native = vi.fn(() => new Promise<Snapshot>(resolve => { finish = resolve }))
    vi.stubGlobal('window', { __TAURI__: { core: { invoke: native } } })
    const store = mountStore(); store.accept(snapshot('a', 1))
    const saving = store.run('point_move', { id: 'one', position: { x: 10, y: 20 } })
    expect(native).toHaveBeenCalledWith('point_move', expect.objectContaining({ spaceId: 'a', epoch: 1 }))
    store.accept(snapshot('b', 2), true)
    finish(snapshot('a', 1)); await saving
    expect(store.data.value.spaceId).toBe('b')
    expect(store.data.value.epoch).toBe(2)
  })

  it('clears local knowledge and search state after a successful switch', async () => {
    vi.stubGlobal('window', { __TAURI__: { core: { invoke: vi.fn(async () => snapshot('b', 2)) } } })
    const store = mountStore(); store.accept(snapshot('a', 1)); store.query.value = '旧空间'; store.keywords.value = ['旧主题']; store.beginCreate()
    expect(await store.spaceSwitch('b')).toBe(true)
    expect(store.data.value.spaceId).toBe('b'); expect(store.query.value).toBe(''); expect(store.keywords.value).toEqual([]); expect(store.editingPoint.value).toBeNull()
  })
})
