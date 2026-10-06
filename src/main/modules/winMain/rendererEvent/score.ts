import { mainHandle } from '@common/mainIpc'
import { WIN_MAIN_RENDERER_EVENT_NAME } from '@common/ipcNames'
import { toMD5 } from '@common/utils/nodejs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import axios from 'axios'
import { net } from 'electron'

const MAX_AUDIO_BYTES = 160 * 1024 * 1024
const AUDIO_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'

const getCacheFile = (key: string) => path.join(global.lxDataPath, 'score-cache', `${toMD5(key)}.json`)

/**
 * 拉取在线音频。首选 electron net.fetch（走 Chromium 网络栈，请求特征与播放器
 * 的 audio 元素一致，避免 CDN 对 Node 客户端特征的 403 防盗链），axios 多头组合兜底。
 */
const fetchStream = async(url: string): Promise<Uint8Array> => {
  try {
    const resp = await net.fetch(url, { headers: { 'User-Agent': AUDIO_UA } as any })
    if (!resp.ok) throw new Error(`score: stream status ${resp.status}`)
    const ab = await resp.arrayBuffer()
    if (ab.byteLength === 0) throw new Error('score: empty stream body')
    return new Uint8Array(ab)
  } catch (e: any) {
    console.warn('score: net.fetch failed, fallback to axios:', e?.message ?? e)
  }
  let lastErr: unknown = null
  for (const headers of [{ 'User-Agent': AUDIO_UA }, {}]) {
    try {
      const resp = await axios.get<ArrayBuffer>(url, {
        responseType: 'arraybuffer',
        timeout: 90_000,
        maxContentLength: MAX_AUDIO_BYTES,
        headers,
      })
      if (!resp.data || resp.data.byteLength === 0) throw new Error(`score: empty stream (status ${resp.status})`)
      return new Uint8Array(resp.data)
    } catch (err) {
      lastErr = err
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('score: stream fetch failed')
}

export default () => {
  mainHandle<LX.Score.ServiceActions, any>(WIN_MAIN_RENDERER_EVENT_NAME.score_action, async({ params: data }) => {
    switch (data.action) {
      case 'get_audio': {
        const { source, filePath, url } = data.data
        if (source === 'local') {
          if (!filePath) throw new Error('score: local file path missing')
          const buf = await fsp.readFile(filePath)
          return buf
        }
        if (!url) throw new Error('score: audio url missing')
        return await fetchStream(url)
      }
      case 'save_cache': {
        const file = getCacheFile(data.data.key)
        await fsp.mkdir(path.dirname(file), { recursive: true })
        await fsp.writeFile(file, JSON.stringify(data.data.data))
        return
      }
      case 'load_cache': {
        try {
          return JSON.parse(await fsp.readFile(getCacheFile(data.data.key), 'utf8')) as LX.Score.ScoreCacheData
        } catch {
          return null
        }
      }
    }
  })
}
