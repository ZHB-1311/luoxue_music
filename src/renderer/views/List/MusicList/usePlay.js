import { addTempPlayList } from '@renderer/store/player/action'
import { playList } from '@renderer/core/player'

export default ({ props, selectedList, list, removeAllSelect }) => {
  const handlePlayMusic = (index) => {
    playList(props.listId, index)
  }

  const handlePlayMusicLater = (index, single) => {
    if (selectedList.value.length && !single) {
      addTempPlayList(selectedList.value.map(s => ({ listId: props.listId, musicInfo: s })))
      removeAllSelect()
    } else {
      addTempPlayList([{ listId: props.listId, musicInfo: list.value[index] }])
    }
  }

  // 单击歌曲即播放
  const clickPlay = index => {
    handlePlayMusic(index, true)
  }

  return {
    handlePlayMusic,
    handlePlayMusicLater,
    clickPlay,
  }
}
