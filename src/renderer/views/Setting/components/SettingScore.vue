<template lang="pug">
dt#score {{ $t('setting__score') }}
dd
  h3#score_instrument {{ $t('score__instrument') }}
  div
    base-selection(:list="instrumentList" :model-value="appSetting['score.defaultInstrument']" item-key="id" item-name="label" @update:model-value="updateSetting({ 'score.defaultInstrument': $event })")
dd
  h3#score_layout {{ $t('score__layout') }}
  div
    base-checkbox.gap-left(id="setting_score_layout_aligned" :model-value="appSetting['score.scoreLayout']" need value="aligned" :label="$t('score__layout_aligned')" @update:model-value="updateSetting({ 'score.scoreLayout': $event })")
    base-checkbox.gap-left(id="setting_score_layout_full" :model-value="appSetting['score.scoreLayout']" need value="full" :label="$t('score__layout_full')" @update:model-value="updateSetting({ 'score.scoreLayout': $event })")
dd
  h3#score_quality {{ $t('score__quality') }}
  div
    base-checkbox.gap-left(id="setting_score_quality_fast" :model-value="appSetting['score.quality']" need value="fast" :label="$t('score__quality_fast')" @update:model-value="updateSetting({ 'score.quality': $event })")
    base-checkbox.gap-left(id="setting_score_quality_standard" :model-value="appSetting['score.quality']" need value="standard" :label="$t('score__quality_standard')" @update:model-value="updateSetting({ 'score.quality': $event })")
    base-checkbox.gap-left(id="setting_score_quality_fine" :model-value="appSetting['score.quality']" need value="fine" :label="$t('score__quality_fine')" @update:model-value="updateSetting({ 'score.quality': $event })")
dd
  h3#score_color {{ $t('score__color') }}
  div
    .p.gap-top
      div(:class="$style.groupContent")
        div(:class="$style.item")
          div(ref="note_color_ref" :class="$style.color")
          div(:class="$style.label") {{ $t('score__note_color') }}
        div(:class="$style.item")
          div(ref="note_played_color_ref" :class="$style.color")
          div(:class="$style.label") {{ $t('score__note_played_color') }}
        div(:class="$style.item")
          div(ref="grid_line_color_ref" :class="$style.color")
          div(:class="$style.label") {{ $t('score__grid_line_color') }}
        div(:class="$style.item")
          div(ref="bg_color_ref" :class="$style.color")
          div(:class="$style.label") {{ $t('score__bg_color') }}
    .p.gap-top
      base-btn.btn(min @click="resetColor") {{ $t('score__color_reset') }}
dd
  h3#score_font_scale {{ $t('score__font_scale') }}
  div
    base-selection(:list="fontScaleList" :model-value="appSetting['score.fontScale']" item-key="id" item-name="label" @update:model-value="updateSetting({ 'score.fontScale': $event })")
dd
  h3#score_show_note_name {{ $t('score__show_note_name') }}
  div
    base-checkbox(id="setting_score_show_note_name" :model-value="appSetting['score.showNoteName']" :label="$t('score__show_note_name')" @update:model-value="updateSetting({ 'score.showNoteName': $event })")
dd
  h3#score_auto_generate {{ $t('score__auto_generate') }}
  div
    base-checkbox(id="setting_score_auto_generate" :model-value="appSetting['score.autoGenerate']" :label="$t('score__auto_generate')" @update:model-value="updateSetting({ 'score.autoGenerate': $event })")
    .p {{ $t('score__auto_generate_tip') }}

</template>

<script>
import { ref, computed, onMounted, onBeforeUnmount } from '@common/utils/vueTools'
import { useI18n } from '@renderer/plugins/i18n'
import { appSetting, updateSetting } from '@renderer/store/setting'
import { pickrTools } from '@renderer/utils/pickrTools'

const defaultNoteColors = ['rgba(57, 203, 255, 1)', 'rgba(7, 197, 86, 1)', 'rgba(255, 226, 32, 1)', 'rgba(217, 57, 255, 1)', 'rgba(255, 57, 71, 1)', 'rgba(255, 255, 255, 1)']
const defaultPlayedColors = ['rgba(7, 197, 86, 1)', 'rgba(32, 255, 132, 1)', 'rgba(255, 236, 144, 1)', 'rgba(57, 203, 255, 1)', 'rgba(25, 181, 254, 1)', 'rgba(255, 57, 71, 1)']
const defaultGridColors = ['rgba(128, 128, 128, 0.35)', 'rgba(128, 128, 128, 0.6)', 'rgba(255, 255, 255, 0.35)', 'rgba(0, 0, 0, 0.45)']
const defaultBgColors = ['rgba(0, 0, 0, 0)', 'rgba(255, 255, 255, 1)', 'rgba(0, 0, 0, 0.6)', 'rgba(24, 24, 24, 0.9)']

const useScoreColor = (settingKey, swatches) => {
  const dom_ref = ref(null)
  let tools = null

  const init = () => {
    if (!dom_ref.value) return
    tools = pickrTools.create(dom_ref.value, appSetting[settingKey], swatches, (color) => {
      updateSetting({ [settingKey]: color })
    })
  }
  const destroy = () => {
    if (!tools) return
    tools.destroy()
    tools = null
  }
  const setColor = (color) => {
    tools?.setColor(color)
  }

  return { dom_ref, init, destroy, setColor }
}

export default {
  name: 'SettingScore',
  setup() {
    const t = useI18n()

    const instrumentList = computed(() => [
      { id: 'piano', label: t('score__instrument_piano') },
      { id: 'drum', label: t('score__instrument_drum') },
      { id: 'guzheng', label: t('score__instrument_guzheng') },
      { id: 'guitar', label: t('score__instrument_guitar') },
    ])

    const fontScaleList = [80, 90, 100, 110, 120, 140, 160].map(size => ({ id: size, label: `${size}%` }))

    const noteColor = useScoreColor('score.noteColor', defaultNoteColors)
    const notePlayedColor = useScoreColor('score.notePlayedColor', defaultPlayedColors)
    const gridLineColor = useScoreColor('score.gridLineColor', defaultGridColors)
    const bgColor = useScoreColor('score.bgColor', defaultBgColors)

    const resetColor = () => {
      const defaults = {
        'score.noteColor': 'rgba(57, 203, 255, 1)',
        'score.notePlayedColor': 'rgba(7, 197, 86, 1)',
        'score.gridLineColor': 'rgba(128, 128, 128, 0.35)',
        'score.bgColor': 'rgba(0, 0, 0, 0)',
      }
      updateSetting(defaults)
      noteColor.setColor(defaults['score.noteColor'])
      notePlayedColor.setColor(defaults['score.notePlayedColor'])
      gridLineColor.setColor(defaults['score.gridLineColor'])
      bgColor.setColor(defaults['score.bgColor'])
    }

    onMounted(() => {
      noteColor.init()
      notePlayedColor.init()
      gridLineColor.init()
      bgColor.init()
    })
    onBeforeUnmount(() => {
      noteColor.destroy()
      notePlayedColor.destroy()
      gridLineColor.destroy()
      bgColor.destroy()
    })

    return {
      appSetting,
      updateSetting,
      instrumentList,
      fontScaleList,
      note_color_ref: noteColor.dom_ref,
      note_played_color_ref: notePlayedColor.dom_ref,
      grid_line_color_ref: gridLineColor.dom_ref,
      bg_color_ref: bgColor.dom_ref,
      resetColor,
    }
  },
}
</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.groupContent {
  display: flex;
  flex-flow: row wrap;
}
.item {
  padding-right: 40px;
  width: 70px;
  display: flex;
  flex-flow: column nowrap;
  align-items: center;
}
.color {
  width: 80%;
  aspect-ratio: 1 / 1;
  background-color: var(--pcr-color);
  border-radius: @radius-border;
  cursor: pointer;
  transition: @transition-fast !important;
  transition-property: background-color, opacity !important;
  box-shadow: 0 0 3px var(--color-primary-light-100-alpha-300);
  &:hover {
    opacity: .7;
  }
}
.label {
  .mixin-ellipsis-2();
  padding-top: 10px;
  text-align: center;
}
</style>
