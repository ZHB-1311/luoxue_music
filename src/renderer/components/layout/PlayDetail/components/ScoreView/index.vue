<template lang="pug">
div.score(:class="$style.scoreView")
  div(:class="$style.header")
    div(:class="$style.tabs")
      button(v-for="ins in instruments" :key="ins.id" type="button" :class="[$style.tab, { [$style.active]: selectedInstrument == ins.id }]" @click="selectedInstrument = ins.id") {{ ins.label }}
    div(:class="$style.headerBtn" :aria-label="$t('score__close')" @click="$emit('close')")
      svg(version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" viewBox="0 0 24 24" space="preserve")
        use(xlink:href="#icon-close")
  div.scroll(:class="$style.body")
    ScoreFull(v-if="selectedInstrument == 'drum'")
    template(v-else-if="appSetting['score.scoreLayout'] == 'aligned'")
      ScoreAligned(:score="score")
    div(v-else :class="$style.tip") {{ $t('score__layout_full_todo') }}
  div(:class="$style.footer") {{ selectedInstrument == 'drum' ? $t('score__drum_tip') : $t('score__placeholder_tip') }}

</template>

<script>
import { ref, computed } from '@common/utils/vueTools'
import { useI18n } from '@renderer/plugins/i18n'
import { appSetting } from '@renderer/store/setting'
import { EXAMPLE_SCORE } from './useScore'
import ScoreAligned from './ScoreAligned.vue'
import ScoreFull from './ScoreFull.vue'

export default {
  name: 'ScoreView',
  components: { ScoreAligned, ScoreFull },
  emits: ['close'],
  setup() {
    const t = useI18n()

    const instruments = computed(() => [
      { id: 'piano', label: t('score__instrument_piano') },
      { id: 'drum', label: t('score__instrument_drum') },
      { id: 'guzheng', label: t('score__instrument_guzheng') },
      { id: 'guitar', label: t('score__instrument_guitar') },
    ])

    const selectedInstrument = ref(appSetting['score.defaultInstrument'])

    // P0：渲染内置示例谱；P1 由 useScore().generate() 驱动真实管线后替换数据源
    const score = computed(() => EXAMPLE_SCORE)

    return {
      appSetting,
      instruments,
      selectedInstrument,
      score,
    }
  },
}
</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.scoreView {
  display: flex;
  flex-flow: column nowrap;
  width: 100%;
  height: 100%;
  background-color: var(--color-main-background);
  border-radius: @radius-border;
  box-shadow: 0 0 6px var(--color-primary-alpha-500);
  overflow: hidden;
}
.header {
  flex: none;
  display: flex;
  flex-flow: row nowrap;
  justify-content: space-between;
  align-items: center;
  padding: 8px 10px;
}
.tabs {
  display: flex;
  flex-flow: row nowrap;
  gap: 6px;
}
.tab {
  border: none;
  background-color: transparent;
  color: var(--color-font);
  font-size: 13px;
  padding: 4px 10px;
  border-radius: @radius-border;
  cursor: pointer;
  transition: @transition-fast;

  &:hover {
    background-color: var(--color-button-background-hover);
  }

  &.active {
    color: var(--color-primary);
    background-color: var(--color-primary-alpha-100);
  }
}
.headerBtn {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  opacity: .7;
  transition: opacity @transition-fast;

  &:hover {
    opacity: 1;
  }

  svg {
    width: 100%;
    height: 100%;
  }
}
.body {
  flex: auto;
  min-height: 0;
  padding: 10px;
}
.footer {
  flex: none;
  padding: 6px 12px;
  font-size: 12px;
  opacity: .6;
}
.tip {
  padding: 20px 0;
  text-align: center;
  opacity: .6;
}
</style>
