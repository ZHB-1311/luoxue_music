import { reactive } from '@common/utils/vueTools'
import { dateFormat } from '@common/utils/common'
import { log } from '@common/utils'
import { toNewMusicInfo, filterMusicList } from '@common/utils/tools'
import { sendAccountAction, onAccountAction } from '@renderer/utils/ipc'
import { toMD5 } from '@renderer/utils'
import { setListUpdateTime } from '@renderer/utils/data'
import songList from '@renderer/utils/musicSdk/kg/songList'
import { userLists } from '@renderer/store/list/state'
import { createUserList, overwriteListMusics, setUpdateTime } from '@renderer/store/list/action'

// 酷狗 API 全部在主进程执行（渲染进程环境下风控接口行为异常），渲染层仅通过 IPC 调用

export const account = reactive<{
  status: LX.Account.Status | null
  isVisibleLoginModal: boolean
  playlists: LX.Account.UserPlaylist[]
  playlistsLoading: boolean
  isSyncing: boolean
  syncingName: string
}>({
  status: null,
  isVisibleLoginModal: false,
  playlists: [],
  playlistsLoading: false,
  isSyncing: false,
  syncingName: '',
})

export const getCredentials = (source: LX.Account.Source = 'kg') => {
  return account.status?.providers?.[source]
}

const applyStatus = (status: LX.Account.Status) => {
  account.status = status
}

let inited = false
export const initAccount = () => {
  if (inited) return
  inited = true
  onAccountAction(({ params }) => {
    if (params.action === 'status') applyStatus(params.data)
  })
  void sendAccountAction({ action: 'get_status' }).then(status => {
    if (status) applyStatus(status)
  }).catch(err => {
    log.error(err)
  })
}

export const saveKugouCredentials = async(credentials: LX.Account.KugouCredentials) => {
  await sendAccountAction({ action: 'save_credentials', data: { source: 'kg', credentials } })
}

export const logoutAccount = async(source: LX.Account.Source = 'kg') => {
  account.playlists = []
  await sendAccountAction({ action: 'logout', data: { source } })
}

const translateKgError = (err: any): Error => {
  const msg = (err as Error)?.message ?? ''
  if (msg.includes('__STALE_LOGIN__') || msg.includes('__NOT_LOGIN__')) {
    return new Error(window.i18n.t('account__stale_login'))
  }
  return err instanceof Error ? err : new Error(String(err))
}

// 登录流程：注册设备（有 token→受信，无→匿名，匿名登录后需二次扫码）
// force=true 时强制用当前 token 重新注册（匿名扫码成功后换绑受信设备用）
export const prepareKugouDevice = async(force = false): Promise<{ dfid: string, trusted: boolean }> => {
  return await sendAccountAction({ action: 'kg_prepare_device', data: { force } }) as unknown as { dfid: string, trusted: boolean }
}

export const kgGetQrKey = async(): Promise<{ key: string, img: string }> => {
  return await sendAccountAction({ action: 'kg_qr_key' }) as unknown as { key: string, img: string }
}

export const kgCheckQr = async(key: string): Promise<any> => {
  return await sendAccountAction({ action: 'kg_qr_check', data: { key } })
}

// 拉取酷狗“我的歌单”全部分页
export const fetchUserPlaylists = async() => {
  if (!getCredentials('kg')) return
  account.playlistsLoading = true
  try {
    const playlists: LX.Account.UserPlaylist[] = []
    let page = 1
    try {
      for (;;) {
        const resp = await sendAccountAction({ action: 'kg_playlists', data: { page } }) as unknown as { list: LX.Account.UserPlaylist[], allPage: number }
        playlists.push(...resp.list)
        if (page >= resp.allPage || !resp.list.length) break
        page++
      }
    } catch (err) {
      throw translateKgError(err)
    }
    account.playlists = playlists
  } finally {
    account.playlistsLoading = false
  }
}

const findImportedList = (gcid: string) => {
  return userLists.find(l => l.source == 'kg' && l.sourceListId == gcid)
}

// 拉取歌单全部歌曲：主进程取 hash 列表，渲染层转换为 lx 歌曲信息
const fetchPlaylistMusics = async(pl: LX.Account.UserPlaylist, onPage?: (fetched: number, total: number) => void) => {
  const hashes: Array<{ hash: string }> = []
  let total = Infinity
  let page = 1
  try {
    while (hashes.length < total) {
      const resp = await sendAccountAction({ action: 'kg_playlist_tracks', data: { listid: pl.id, page } }) as unknown as { hashes: Array<{ hash: string }>, total: number }
      total = resp.total
      if (!resp.hashes.length) break
      hashes.push(...resp.hashes)
      onPage?.(hashes.length, total)
      page++
    }
  } catch (err) {
    throw translateKgError(err)
  }
  // musicSdk 产出为旧格式，需转成带 id 的新格式才能入库
  const rawMusics = await songList.getMusicInfos(hashes)
  return filterMusicList(rawMusics.map(m => toNewMusicInfo(m))) as LX.Music.MusicInfoOnline[]
}

// 导入酷狗歌单到“我的列表”（已导入过则转为刷新）
export const importKugouPlaylist = async(pl: LX.Account.UserPlaylist): Promise<void> => {
  if (findImportedList(pl.id)) return refreshKugouPlaylist(pl)
  const list = await fetchPlaylistMusics(pl)
  await createUserList({
    name: pl.name,
    id: `kg_${toMD5(`kg__${pl.id}`)}`,
    list,
    source: 'kg',
    sourceListId: pl.id,
  })
}

// 从酷狗云端刷新已导入的歌单
export const refreshKugouPlaylist = async(pl: LX.Account.UserPlaylist): Promise<void> => {
  const existing = findImportedList(pl.id)
  if (!existing) return importKugouPlaylist(pl)
  const list = await fetchPlaylistMusics(pl)
  await overwriteListMusics({ listId: existing.id, musicInfos: list })
  const now = Date.now()
  void setListUpdateTime(existing.id, now)
  setUpdateTime(existing.id, dateFormat(now))
}

// 全部同步：新增的导入，已导入的刷新
export const syncAllKugouPlaylists = async(): Promise<{ imported: number, refreshed: number, failed: number }> => {
  account.isSyncing = true
  account.syncingName = ''
  try {
    if (!account.playlists.length) await fetchUserPlaylists()
    let imported = 0
    let refreshed = 0
    let failed = 0
    for (const pl of account.playlists) {
      account.syncingName = pl.name
      try {
        const existed = !!findImportedList(pl.id)
        await importKugouPlaylist(pl)
        if (existed) refreshed++
        else imported++
      } catch (err) {
        log.error(err)
        failed++
      }
    }
    return { imported, refreshed, failed }
  } finally {
    account.isSyncing = false
    account.syncingName = ''
  }
}
