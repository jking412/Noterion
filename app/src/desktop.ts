export async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const tauri = (window as unknown as { __TAURI__?: { core: { invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> } } }).__TAURI__
  if (!tauri) throw new Error('请从 Noterion 桌面程序启动，本页无法连接本地存储。')
  return tauri.core.invoke<T>(command, args)
}
export function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error) }

/** The native channel is serialized by Tauri's invoke implementation. */
export function channel<T>(onmessage: (message: T) => void): unknown {
  const core = (window as unknown as { __TAURI__?: { core: { Channel: new <T>() => { onmessage: (message: T) => void } } } }).__TAURI__?.core
  if (!core?.Channel) throw new Error('无法连接桌面任务通道，请重新打开 Noterion。')
  const result = new core.Channel<T>()
  result.onmessage = onmessage
  return result
}
