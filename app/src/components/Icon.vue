<script setup lang="ts">
defineProps<{ name: string; size?: number }>()
const paths: Record<string, string> = {
  search: 'm20 20-4.5-4.5 M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13',
  clock: 'M12 8v4l3 2 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  close: 'm6 6 12 12 M6 18 18 6', plus: 'M12 5v14 M5 12h14',
  check: 'm5 12 4 4 10-10', chevron: 'm6 9 6 6 6-6',
  circleCheck: 'M22 11.1V12a10 10 0 1 1-5.93-9.14 M22 4 12 14l-3-3',
  edit: 'm16 3 5 5 M4 20l4-1L21 6a2.1 2.1 0 0 0-3-3L5 16l-1 4',
  trash: 'M3 6h18 M9 6V3h6v3 M5 6l1 15h12l1-15 M10 10v7 M14 10v7',
  file: 'M14 2H5v20h14V7l-5-5 M14 2v6h5 M8 12h8 M8 16h8',
  external: 'M14 3h7v7 M21 3 11 13 M10 3H3v18h18v-7',
  copy: 'M8 8h12v13H8z M16 8V3H3v13h5',
  refresh: 'M20 7v5h-5 M20 12a8 8 0 1 0-2 6',
  alert: 'm12 3 10 18H2L12 3 M12 9v4 M12 17h.01',
  plug: 'm9 3 1 5 M15 3l-1 5 M7 8h10v3a5 5 0 0 1-10 0V8 M12 16v6',
  book: 'M12 5v16 M12 5C8 2 3 3 3 3v16s5-1 9 2 M12 5c4-3 9-2 9-2v16s-5-1-9 2',
  arrow: 'M19 12H5 m6-6-6 6 6 6',
  layers: 'm12 3 10 5-10 5L2 8l10-5 M2 12l10 5 10-5 M2 16l10 5 10-5',
}
</script>
<template>
  <svg :width="size || 18" :height="size || 18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="ui-icon">
    <circle v-if="name === 'more'" cx="5" cy="12" r="1" fill="currentColor"/><circle v-if="name === 'more'" cx="12" cy="12" r="1" fill="currentColor"/><circle v-if="name === 'more'" cx="19" cy="12" r="1" fill="currentColor"/>
    <path v-else :d="paths[name] || paths.file" />
  </svg>
</template>
