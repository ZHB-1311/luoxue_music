import { mainHandle } from '@common/mainIpc'
import { WIN_MAIN_RENDERER_EVENT_NAME } from '@common/ipcNames'
import { getStatus, saveCredentials, logout, getDeviceDfid, saveDeviceDfid, getKugouCredentials } from '@main/modules/account'
import { registerDevice, getQrKey, checkQr, getUserPlaylists, getPlaylistTracksPage, buildMid } from '@main/modules/account/kg'
import { sendEvent } from '../main'

const AUTH_ERROR_CODES = [20010, 20017, 20018]

const getSession = () => {
  const status = getStatus()
  const dfid = getDeviceDfid()
  if (!dfid) throw new Error('kg device not registered')
  return {
    guid: status.device.guid,
    mid: buildMid(status.device.guid),
    mac: '02:00:00:00:00:00',
    dev: 'A9YBDGZLC3PZX7',
    dfid,
  }
}

const translateError = (err: any) => {
  if (AUTH_ERROR_CODES.includes(err?.code) && getKugouCredentials()) {
    logout('kg')
    sendAccountStatus()
    return new Error('__STALE_LOGIN__')
  }
  return err
}

export default () => {
  mainHandle<LX.Account.ServiceActions, any>(WIN_MAIN_RENDERER_EVENT_NAME.account_action, async({ params: data }) => {
    switch (data.action) {
      case 'get_status':
        return getStatus()
      case 'save_dfid':
        saveDeviceDfid(data.data.dfid)
        sendAccountStatus()
        return
      case 'save_credentials':
        saveCredentials(data.data.source, data.data.credentials)
        sendAccountStatus()
        return
      case 'logout':
        logout(data.data.source)
        sendAccountStatus()
        return
      case 'kg_prepare_device': {
        // 已有 dfid 直接复用（酷狗风控 dfid 需要时间入链，频繁重注册反而失效）；force 时重新注册
        const status = getStatus()
        const guid = status.device.guid
        const credentials = status.providers.kg
        const existing = getDeviceDfid()
        if (existing && !data.data?.force) {
          return { dfid: existing, trusted: !!credentials }
        }
        try {
          const { dfid } = await registerDevice({ credentials, guid })
          saveDeviceDfid(dfid)
          sendAccountStatus()
          return { dfid, trusted: !!credentials }
        } catch (err) {
          if (!credentials) throw err
          const { dfid } = await registerDevice({ credentials: null, guid })
          saveDeviceDfid(dfid)
          sendAccountStatus()
          return { dfid, trusted: false }
        }
      }
      case 'kg_qr_key': {
        return getQrKey(getSession())
      }
      case 'kg_qr_check': {
        return checkQr(data.data.key, getSession())
      }
      case 'kg_playlists': {
        const credentials = getKugouCredentials()
        if (!credentials) throw new Error('__STALE_LOGIN__')
        try {
          return await getUserPlaylists({ credentials, session: getSession(), page: data.data.page })
        } catch (err) {
          throw translateError(err)
        }
      }
      case 'kg_playlist_tracks': {
        const credentials = getKugouCredentials()
        if (!credentials) throw new Error('__STALE_LOGIN__')
        try {
          return await getPlaylistTracksPage({ credentials, session: getSession(), listid: data.data.listid, page: data.data.page })
        } catch (err) {
          throw translateError(err)
        }
      }
      default:
        break
    }
  })
}

export const sendAccountStatus = () => {
  sendEvent(WIN_MAIN_RENDERER_EVENT_NAME.account_action, {
    action: 'status',
    data: getStatus(),
  })
}
