<template lang="pug">
div(:class="$style.aligned")
  div(v-for="(seg, segIndex) in segments" :key="segIndex" :class="[$style.row, { [$style.active]: activeSegIndex == segIndex }]")
    div(:class="$style.label")
      span(v-if="seg.type == 'line'") {{ lineText(seg) }}
      span(v-else-if="seg.type == 'intro'") {{ $t('score__intro') }}
      span(v-else-if="seg.type == 'interlude'") {{ $t('score__interlude') }}
    div(:class="$style.seg")
      svg(:viewBox="`0 0 ${segWidth(seg)} ${segHeight}`" :style="{ height: `${segHeight}px` }" preserveAspectRatio="none" :class="$style.svg")
        rect(x="0" y="0" :width="segWidth(seg)" :height="segHeight" :fill="colors.bg")
        line(v-for="x in gridLineXs(seg)" :key="x" :x1="x" :y1="2" :x2="x" :y2="segHeight - 2" :stroke="colors.grid" stroke-width="1")
        g(v-for="(note, i) in seg.notes" :key="i")
          circle(:cx="noteX(seg, note)" :cy="noteY(note)" :r="noteR" :fill="activeSegIndex == segIndex ? colors.notePlayed : colors.note")
          text(v-if="showNoteName" :x="noteX(seg, note)" :y="noteY(note) - noteR - 3" text-anchor="middle" :font-size="noteR + 4" :fill="colors.note") {{ noteName(note.midi) }}

</template>

<script>
import { computed } from '@common/utils/vueTools'
import { useI18n } from '@renderer/plugins/i18n'
import { appSetting } from '@renderer/store/setting'
import { playProgress } from '@renderer/store/player/playProgress'

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

const CELL_W = 12

export default {
  name: 'ScoreAligned',
  props: {
    score: { type: Object, required: true },
  },
  setup(props) {
    const t = useI18n()

    const scoreData = computed(() => props.score)
    const segments = computed(() => scoreData.value.segments)

    // 1/16 tick 时长由 bpm 推导（示例谱 bpm=100 → 150ms）
    const tickMs = computed(() => 60000 / (scoreData.value.bpm || 100) / 4)
    const fontScale = computed(() => (appSetting['score.fontScale'] || 100) / 100)
    const segHeight = computed(() => Math.round(56 * fontScale.value))
    const noteR = computed(() => Math.max(3, Math.round(5 * fontScale.value)))

    const midiRange = computed(() => {
      let min = 127
      let max = 0
      for (const note of scoreData.value.notes) {
        if (note.midi < min) min = note.midi
        if (note.midi > max) max = note.midi
      }
      if (min > max) {
        min = 60
        max = 72
      }
      if (max - min < 12) {
        min -= 6
        max += 6
      }
      return { min, max }
    })

    const segTicks = (seg) => Math.max(4, Math.ceil((seg.endMs - seg.startMs) / tickMs.value))
    const segWidth = (seg) => segTicks(seg) * CELL_W
    const gridLineXs = (seg) => {
      const xs = []
      for (let tick = 0; tick <= segTicks(seg); tick += 4) xs.push(tick * CELL_W)
      return xs
    }
    const noteX = (seg, note) => Math.min(segWidth(seg) - noteR.value, ((note.onsetMs - seg.startMs) / tickMs.value) * CELL_W)
    const noteY = (note) => {
      const { min, max } = midiRange.value
      const pad = noteR.value + 4
      const h = segHeight.value - (pad * 2)
      return segHeight.value - pad - ((note.midi - min) / (max - min)) * h
    }
    const noteName = (midi) => `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`
    const lineText = (seg) => seg.text || '· · ·'

    const activeSegIndex = computed(() => {
      const time = playProgress.nowPlayTime * 1000
      return segments.value.findIndex(seg => time >= seg.startMs && time < seg.endMs)
    })

    const colors = computed(() => ({
      note: appSetting['score.noteColor'],
      notePlayed: appSetting['score.notePlayedColor'],
      grid: appSetting['score.gridLineColor'],
      bg: appSetting['score.bgColor'],
    }))
    const showNoteName = computed(() => appSetting['score.showNoteName'])

    return {
      t,
      segments,
      segHeight,
      noteR,
      segWidth,
      gridLineXs,
      noteX,
      noteY,
      noteName,
      lineText,
      activeSegIndex,
      colors,
      showNoteName,
    }
  },
}
</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.aligned {
  display: flex;
  flex-flow: column nowrap;
}
.row {
  display: flex;
  flex-flow: row nowrap;
  align-items: center;
  padding: 4px 0;
  border-bottom: 1px solid rgba(128, 128, 128, .18);
  transition: background-color @transition-fast;

  &.active {
    background-color: var(--color-primary-alpha-100);
  }
}
.label {
  flex: 0 0 38%;
  padding: 0 8px;
  font-size: 13px;
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.seg {
  flex: auto;
  min-width: 0;
  overflow: hidden;
}
.svg {
  display: block;
  width: 100%;
}
</style>
