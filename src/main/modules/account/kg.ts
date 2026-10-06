// 酷狗账号 API（主进程）
// 核心请求/签名/加密代码移植自 KuGouMusicApi（MIT，见 kugou-api/LICENSE），已内嵌于 kugou-api/ 目录，lx 自包含、不依赖外部项目。
// 注意：该套接口必须在真实 Node 环境运行（即主进程），渲染进程环境下酷狗风控行为异常。
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { createRequest } from './kugou-api/util/request'
import registerDev from './kugou-api/module/register_dev'
import loginQrKey from './kugou-api/module/login_qr_key'
import loginQrCheck from './kugou-api/module/login_qr_check'
import userPlaylist from './kugou-api/module/user_playlist'
import playlistTrackAllNew from './kugou-api/module/playlist_track_all_new'

const debugLog = (line: string) => {
  try {
    const dir = (global as any).lxDataPath as string | undefined
    if (!dir) return
    fs.appendFileSync(path.join(dir, 'kg-account-debug.log'), `${new Date().toISOString()} ${line}\n`)
  } catch {}
}

const useAxios = async(options: any) => createRequest(options)

interface KgDeviceSession {
  guid: string
  mid: string
  mac: string
  dev: string
  dfid: string
}

/**
 * 设备会话：酷狗风控按设备维度记链，guid/dfid 一经注册必须稳定复用，不可频繁重注册
 */
const buildSessionCookie = (session: KgDeviceSession, credentials?: { token?: string, userid?: string } | null) => {
  const cookie: Record<string, any> = {
    dfid: session.dfid,
    KUGOU_API_MID: session.mid,
    KUGOU_API_GUID: session.guid,
    KUGOU_API_MAC: session.mac,
    KUGOU_API_DEV: session.dev,
  }
  if (credentials?.token) cookie.token = credentials.token
  if (credentials?.userid) cookie.userid = credentials.userid
  return cookie
}

const callModule = async(moduleFn: (params: any, useAxios: any) => Promise<any>, params: any) => {
  let resp: any
  try {
    resp = await moduleFn(params, useAxios)
  } catch (answer: any) {
    // createRequest 失败时 reject 的是 { status, body } 形状的对象而非 Error
    const body = answer?.body
    const err: any = new Error(`kg api request failed (err_code ${body?.error_code ?? answer?.status ?? 'unknown'})`)
    err.code = body?.error_code
    throw err
  }
  const body = resp?.body
  debugLog(`<-- kg api body: ${JSON.stringify(body)?.slice(0, 300)}`)
  if (body == null || body.status === 0 || (body.error_code != null && body.error_code !== 0)) {
    const message = body?.message ?? (body?.error_code != null ? `err_code ${body.error_code}` : 'unknown')
    const err = new Error(`kg api request failed (${message})`)
    ;(err as any).code = body?.error_code
    throw err
  }
  return body
}

/**
 * 注册设备获取 dfid（guid 稳定复用；空 token 也可注册，但受信 dfid 需要有效 token）
 */
export const registerDevice = async({ credentials, guid }: { credentials?: { token?: string, userid?: string } | null, guid: string }) => {
  const mid = buildMid(guid)
  const mac = '02:00:00:00:00:00'
  const dev = 'A9YBDGZLC3PZX7'
  const cookie = {
    userid: credentials?.userid ? Number(credentials.userid) : 0,
    token: credentials?.token ?? '',
    KUGOU_API_MID: mid,
    KUGOU_API_GUID: guid,
    KUGOU_API_MAC: mac,
    KUGOU_API_DEV: dev,
    dfid: '-',
  }
  debugLog(`--> register_dev guid=${guid.slice(0, 8)}... token=${credentials?.token ? credentials.token.slice(0, 8) + '...' : '-'}`)
  const body = await callModule(registerDev, { cookie })
  const dfid = body?.data?.dfid
  if (!dfid) throw new Error('kg register device failed: no dfid')
  debugLog(`register_dev dfid=${dfid}`)
  const session: KgDeviceSession = { guid, mid, mac, dev, dfid }
  return { dfid, session }
}

export const buildMid = (guid: string): string => {
  return BigInt('0x' + crypto.createHash('md5').update(guid, 'utf8').digest('hex')).toString()
}

/**
 * 获取二维码 key（图片由渲染层本地生成）
 */
export const getQrKey = async(session: KgDeviceSession) => {
  const body = await callModule(loginQrKey, { cookie: buildSessionCookie(session) })
  const key = body?.data?.qrcode
  if (!key) throw new Error('kg get qr key failed')
  return { key, img: '' }
}

/**
 * 轮询二维码状态：0 过期，1 等待扫码，2 已扫码待确认，4 授权成功（含 token/userid/nickname/pic）
 */
export const checkQr = async(qrKey: string, session: KgDeviceSession) => {
  const body = await callModule(loginQrCheck, { key: qrKey, cookie: buildSessionCookie(session) })
  return body?.data ?? { status: 1 }
}

/**
 * 获取用户歌单列表（分页）
 */
export const getUserPlaylists = async({ credentials, session, page = 1 }: {
  credentials: { token: string, userid: string }
  session: KgDeviceSession
  page?: number
}) => {
  const body = await callModule(userPlaylist, {
    cookie: buildSessionCookie(session, credentials),
    page,
    pagesize: 30,
  })
  const rawList: any[] = body?.data?.info ?? body?.data?.lists ?? []
  const list = rawList.map((item: any) => ({
    // 用户歌单返回 listid（/playlist/track/all/new 使用），公开歌单为 global_collection_id
    id: String(item.listid ?? item.id ?? item.specialid ?? item.global_collection_id ?? item.gid ?? ''),
    gcid: item.global_collection_id ?? item.gcid ?? '',
    name: item.name ?? item.specialname ?? '',
    pic: item.img ?? item.imgurl ?? item.pic ?? item.simg ?? '',
    count: Number(item.count ?? item.songcount ?? 0),
  })).filter(item => item.id)
  const total = Number(body?.data?.total ?? list.length)
  return {
    list,
    total,
    page,
    allPage: Math.ceil(total / 30) || 1,
  }
}

/**
 * 获取歌单内歌曲（单页，返回原始 hash 列表；渲染层再用 musicSdk 转换为歌曲信息）
 */
export const getPlaylistTracksPage = async({ credentials, session, listid, page = 1 }: {
  credentials: { token: string, userid: string }
  session: KgDeviceSession
  listid: string
  page?: number
}) => {
  const body = await callModule(playlistTrackAllNew, {
    cookie: buildSessionCookie(session, credentials),
    listid,
    page,
    pagesize: 100,
  })
  const rawList: any[] = body?.data?.info ?? body?.data?.lists ?? []
  const total = Number(body?.data?.total ?? body?.data?.count ?? rawList.length)
  const hashes = rawList
    .map(item => item.hash ?? item.FileHash ?? item.fileHash)
    .filter(Boolean)
    .map(hash => ({ hash }))
  return { hashes, total }
}
