<template lang="pug">
div(:class="$style.full")
  template(v-if="state.phase == 'error'")
    div(:class="$style.tip")
      div {{ $t('score__generate_error') }}
      div(:class="$style.errDetail") {{ state.errorMsg }}
      base-btn.btn(min @click="generate") {{ $t('score__retry') }}
  template(v-else-if="!scoreData")
    div(:class="$style.tip")
      div {{ $t('score__generating') }} {{ state.progress }}%
  template(v-else)
    div.scroll(ref="dom_wrap_ref" :class="$style.wrap")
      div(:class="$style.sheetInner")
        div(ref="dom_sheet_ref" :class="$style.sheet")
        div(v-if="cursorBar" :class="$style.cursorBar" :style="cursorBarStyle")
        div(v-if="cursorBeat" :class="$style.cursorLine" :style="cursorBeatStyle")
    div(v-if="scoreData.audio.isTrial" :class="$style.trialTip") {{ $t('score__trial_tip') }}

</template>

<script>
import { ref, computed, nextTick, watch, onMounted, onBeforeUnmount } from '@common/utils/vueTools'
import { appSetting } from '@renderer/store/setting'
import { playProgress } from '@renderer/store/player/playProgress'
import { playMusicInfo } from '@renderer/store/player/state'
import { buildDrumAlphaTexFromNotes } from './drumScore'
import { useScore } from './useScore'
import * as alphaTab from '@coderline/alphatab'

export default {
  name: 'ScoreFull',
  setup() {
    const { state, generateDrum } = useScore()
    const dom_wrap_ref = ref(null)
    const dom_sheet_ref = ref(null)
    const scoreData = ref(null)
    // 自绘光标（避免依赖 alphaTab player 的 Worker，在打包环境不可靠）
    const cursorBar = ref(null)
    const cursorBeat = ref(null)
    let api = null
    let lastSystemTop = -1

    const updateCursor = (sec) => {
      const bl = api?.renderer?.boundsLookup
      if (!bl || !api?.score || !bl.staffSystems.length || !scoreData.value) return
      const bpm = api.score.tempo || scoreData.value.bpm
      const barSec = (60 / bpm) * 4
      const barCount = bl.staffSystems.reduce((n, s) => n + s.bars.length, 0)
      const barIndex = Math.max(0, Math.min(Math.floor(sec / barSec), barCount - 1))
      const mb = bl.findMasterBarByIndex(barIndex)
      if (!mb) return
      const frac = Math.max(0, Math.min((sec - barIndex * barSec) / barSec, 1))
      const beats = mb.bars[0]?.beats ?? []
      const beatIdx = beats.length ? Math.min(Math.floor(frac * beats.length), beats.length - 1) : -1
      const lineX = beatIdx >= 0 ? beats[beatIdx].visualBounds.x : mb.visualBounds.x + mb.visualBounds.w * frac

      const barStyle = mb.realBounds
      const sysStyle = mb.staffSystemBounds?.realBounds ?? barStyle
      cursorBar.value = { left: barStyle.x, top: sysStyle.y, width: barStyle.w, height: sysStyle.h }
      cursorBeat.value = { left: lineX, top: sysStyle.y, height: sysStyle.h }

      // 换行时自动滚动跟随
      if (sysStyle.y !== lastSystemTop && dom_wrap_ref.value) {
        lastSystemTop = sysStyle.y
        dom_wrap_ref.value.scrollTo({ top: Math.max(0, sysStyle.y - 48), behavior: 'smooth' })
      }
    }

    const applyScore = (data) => {
      scoreData.value = data
      cursorBar.value = null
      cursorBeat.value = null
      lastSystemTop = -1
      if (!api || !data.notes.length) return
      const name = playMusicInfo.musicInfo?.name ?? ''
      api.tex(buildDrumAlphaTexFromNotes(data.notes, data.audio.durationMs, name, data.bpm))
    }

    const render = () => {
      const el = dom_sheet_ref.value
      if (!el) return
      if (api) {
        api.destroy()
        api = null
      }
      cursorBar.value = null
      cursorBeat.value = null
      lastSystemTop = -1
      const fontDir = new URL('alphaTab/font/', window.location.href).href
      api = new alphaTab.AlphaTabApi(el, {
        core: {
          engine: 'svg',
          fontDirectory: fontDir,
          // 打包后 alphaTab 内部 Worker 以 importScripts 加载主脚本，须指向随包静态资源
          scriptFile: new URL('alphaTab/alphaTab.min.js', window.location.href).href,
        },
        // 光标自绘（boundsLookup），不启用 alphaTab player（其 Worker 在打包环境不可靠且我们不需要合成器出声）
        player: { enableCursor: false, enablePlayer: false },
        display: { systemsPerSystemGroup: 4 },
      })
      api.error.on(e => {
        console.warn('score alphatab:', e?.message ?? e)
      })
      api.renderFinished.on(() => {
        updateCursor(playProgress.nowPlayTime)
      })
      if (scoreData.value) applyScore(scoreData.value)
    }

    const generate = async() => {
      try {
        const data = await generateDrum()
        // v-if 切到谱面分支后 el 才存在，等 DOM 更新再挂 alphaTab
        // （不能用 rAF：窗口后台/遮挡时 rAF 不执行，渲染会被无限挂起）
        await nextTick()
        render()
        applyScore(data)
      } catch (err) {
        state.phase = 'error'
        state.errorMsg = err?.message ?? String(err)
      }
    }

    // 播放进度 → 自绘光标（timeupdate 频率 ~4Hz）
    watch(() => playProgress.nowPlayTime, sec => {
      updateCursor(sec)
    })

    // 切歌后重新生成（新歌时长/缓存）
    watch(() => playProgress.maxPlayTime, () => {
      scoreData.value = null
      if (api) {
        api.destroy()
        api = null
      }
      void generate()
    })

    onMounted(generate)
    onBeforeUnmount(() => {
      if (api) {
        api.destroy()
        api = null
      }
    })

    const cursorBarStyle = computed(() => {
      const b = cursorBar.value
      if (!b) return {}
      return {
        left: `${b.left}px`,
        top: `${b.top}px`,
        width: `${b.width}px`,
        height: `${b.height}px`,
        backgroundColor: `color-mix(in srgb, ${appSetting['score.notePlayedColor']} 22%, transparent)`,
      }
    })
    const cursorBeatStyle = computed(() => {
      const b = cursorBeat.value
      if (!b) return {}
      return {
        left: `${b.left}px`,
        top: `${b.top}px`,
        height: `${b.height}px`,
        backgroundColor: appSetting['score.notePlayedColor'],
      }
    })

    return {
      appSetting,
      state,
      scoreData,
      dom_wrap_ref,
      dom_sheet_ref,
      cursorBar,
      cursorBeat,
      cursorBarStyle,
      cursorBeatStyle,
      generate,
    }
  },
}
</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.full {
  display: flex;
  flex-flow: column nowrap;
  width: 100%;
  height: 100%;
}
.tip {
  flex: auto;
  display: flex;
  flex-flow: column nowrap;
  align-items: center;
  justify-content: center;
  gap: 10px;
  opacity: .75;
}
.errDetail {
  font-size: 12px;
  opacity: .7;
  max-width: 90%;
  overflow-wrap: break-word;
}
.trialTip {
  flex: none;
  padding: 4px 12px 6px;
  font-size: 12px;
  opacity: .65;
}
.wrap {
  flex: auto;
  min-height: 0;
  width: 100%;
}
.sheetInner {
  position: relative;
  min-height: 100%;
}
.sheet {
  min-height: 100%;
}
.cursorBar {
  position: absolute;
  z-index: 5;
  pointer-events: none;
  border-radius: 2px;
}
.cursorLine {
  position: absolute;
  z-index: 6;
  pointer-events: none;
  width: 3px;
  border-radius: 2px;
}
</style>
