import type { PresetColor, ThemeColor } from './types'

export const colorPresets = [
  { value: 'docker', label: '蓝色' },
  { value: 'linux', label: '绿色' },
  { value: 'mysql', label: '金色' },
  { value: 'concurrency', label: '紫色' },
  { value: 'neutral', label: '灰色' },
] as const

const presets = {
  docker: { light: '#f0f8ff', middle: '#bedcff', dark: '#74aff0', stroke: '#4b90e2' },
  linux: { light: '#f0fbf4', middle: '#c5e9cf', dark: '#8dcca2', stroke: '#62a87c' },
  mysql: { light: '#fffaf0', middle: '#ffe4af', dark: '#ebbc60', stroke: '#c59538' },
  concurrency: { light: '#f8f3ff', middle: '#decdf6', dark: '#b290df', stroke: '#9771c9' },
  neutral: { light: '#ffffff', middle: '#e8e8e8', dark: '#bfbfbf', stroke: '#8b8b8b' },
} satisfies Record<PresetColor, { light: string; middle: string; dark: string; stroke: string }>

export function isPresetColor(color: string): color is PresetColor {
  return Object.hasOwn(presets, color)
}

export function isPointColor(color: string): color is ThemeColor {
  return isPresetColor(color) || /^#[0-9a-f]{6}$/i.test(color)
}

export function colorPalette(color: ThemeColor) {
  if (isPresetColor(color)) return presets[color]
  if (!isPointColor(color)) return presets.neutral
  const rgb = [1, 3, 5].map(offset => Number.parseInt(color.slice(offset, offset + 2), 16))
  const tint = (amount: number) => '#' + rgb.map(channel =>
    Math.round(channel + (255 - channel) * amount).toString(16).padStart(2, '0'),
  ).join('')
  return { light: tint(.94), middle: tint(.70), dark: tint(.25), stroke: color.toLowerCase() }
}
