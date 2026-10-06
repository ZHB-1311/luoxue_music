import { reactive } from '@common/utils/vueTools'
import { playMusicInfo } from '@renderer/store/player/state'
import { createScoreWorker, proxyCallback } from '@renderer/worker/utils'
import { sendScoreAction } from '@renderer/utils/ipc'
import { getMusicUrl } from '@renderer/core/music/online'
import { getLocalFilePath } from '@renderer/utils/music'

export type ScoreGeneratePhase = 'idle' | 'fetch_audio' | 'decode' | 'analyze' | 'done' | 'error'

export interface ScoreGenerateState {
  phase: ScoreGeneratePhase
  progress: number
  errorMsg: string | null
}

const RESAMPLE_RATE = 22050
const MAX_DURATION_SEC = 15 * 60

// 示例谱（P0 占位，行对齐模式预览用）：bpm 100 → 1/16 tick = 150ms，C 大调
const mkNote = (midi: number, onsetMs: number, durMs: number): LX.Score.ScoreNote => ({
  midi,
  onsetMs,
  durMs,
  onsetTick: Math.round(onsetMs / 150),
  durTick: Math.round(durMs / 150),
  vel: 80,
  drumPiece: null,
})

const exampleSegments: LX.Score.ScoreSegment[] = [
  {
    lineIndex: 0, startMs: 0, endMs: 6000, type: 'intro',
    notes: [mkNote(64, 300, 600), mkNote(67, 1050, 450), mkNote(69, 1500, 600), mkNote(67, 2400, 900), mkNote(64, 3600, 1200)],
  },
  {
    lineIndex: 1, startMs: 6000, endMs: 14400, type: 'line',
    notes: [mkNote(60, 6150, 450), mkNote(62, 6750, 450), mkNote(64, 7200, 900), mkNote(67, 8400, 900), mkNote(64, 9600, 600), mkNote(62, 10500, 450), mkNote(60, 11100, 1350)],
  },
  {
    lineIndex: 2, startMs: 14400, endMs: 22800, type: 'line',
    notes: [mkNote(64, 14550, 600), mkNote(67, 15300, 600), mkNote(69, 16200, 600), mkNote(67, 17100, 600), mkNote(64, 18000, 900), mkNote(62, 19200, 900), mkNote(60, 20400, 1800)],
  },
  {
    lineIndex: 3, startMs: 22800, endMs: 27600, type: 'interlude',
    notes: [mkNote(48, 22950, 450), mkNote(52, 23400, 450), mkNote(55, 23850, 450), mkNote(60, 24300, 450), mkNote(55, 25200, 450), mkNote(52, 25800, 450), mkNote(48, 26400, 900)],
  },
  {
    lineIndex: 4, startMs: 27600, endMs: 36000, type: 'line',
    notes: [mkNote(57, 27750, 450), mkNote(60, 28200, 450), mkNote(62, 28650, 450), mkNote(64, 29100, 900), mkNote(62, 30300, 450), mkNote(60, 30900, 450), mkNote(57, 31500, 1350)],
  },
]

export const EXAMPLE_SCORE: LX.Score.ScoreCacheData = {
  v: 1,
  songKey: 'example',
  instrument: 'piano',
  quality: 'standard',
  createdAt: 0,
  audio: { source: 'local', durationMs: 36000, isTrial: false },
  bpm: 100,
  timeSignature: '4/4',
  offsetMs: 0,
  lines: [
    { startMs: 0, endMs: 6000, text: '', type: 'intro' },
    { startMs: 6000, endMs: 14400, text: '示例歌词第一行（占位）', type: 'line' },
    { startMs: 14400, endMs: 22800, text: '示例歌词第二行（占位）', type: 'line' },
    { startMs: 22800, endMs: 27600, text: '', type: 'interlude' },
    { startMs: 27600, endMs: 36000, text: '示例歌词第三行（占位）', type: 'line' },
  ],
  notes: exampleSegments.flatMap(seg => seg.notes),
  segments: exampleSegments,
  meta: { engine: 'example', modelVer: 'p0', quantizer: 1 },
}

const songKey = (): string => {
  const mi = playMusicInfo.musicInfo
  if (!mi) return ''
  const info = ('progress' in mi ? mi.metadata.musicInfo : mi) as LX.Music.MusicInfo
  return info.source === 'local'
    ? `local|${(info as LX.Music.MusicInfoLocal).meta.filePath}`
    : `${info.source}|${info.id}`
}

const parseIntervalSec = (s: string | null): number | null => {
  if (!s) return null
  const parts = s.split(':').map(Number)
  if (!parts.length || parts.some(Number.isNaN)) return null
  return parts.reduce((acc, v) => acc * 60 + v, 0)
}

type PlayableMusicInfo = NonNullable<typeof playMusicInfo.musicInfo>

const getAudioBuffer = async(mi: PlayableMusicInfo): Promise<{ buffer: Uint8Array; source: 'local' | 'stream' }> => {
  const info = ('progress' in mi ? mi.metadata.musicInfo : mi) as LX.Music.MusicInfo
  if (info.source === 'local') {
    const filePath = await getLocalFilePath(info as LX.Music.MusicInfoLocal)
    if (!filePath) throw new Error('local file missing')
    const buffer = await sendScoreAction({ action: 'get_audio', data: { source: 'local', filePath } })
    return { buffer, source: 'local' }
  }
  // isRefresh: music_url 表的缓存直链有时效签名（过期即 403），转录时强制取新鲜链接；
  // CDN 偶发 403 时重取重试（每次 getMusicUrl 都会拿新签名，允许自动换源）
  let lastErr: unknown = null
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const url = await getMusicUrl({ musicInfo: info as LX.Music.MusicInfoOnline, quality: '128k', isRefresh: true })
      const buffer = await sendScoreAction({ action: 'get_audio', data: { source: 'stream', url } })
      return { buffer, source: 'stream' }
    } catch (err) {
      lastErr = err
      await new Promise(resolve => setTimeout(resolve, 1200))
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

/** 解码并重采样为 22050Hz 单声道 Float32（Worker 里没有 AudioContext，须在主线程完成） */
const decodeToPCM = async(audioBytes: Uint8Array): Promise<{ pcm: Float32Array; durationMs: number }> => {
  // IPC 传回的字节可能是切片视图，先归一成独立 ArrayBuffer
  const buffer = (audioBytes.byteOffset === 0 && audioBytes.byteLength === audioBytes.buffer.byteLength
    ? audioBytes.buffer
    : audioBytes.buffer.slice(audioBytes.byteOffset, audioBytes.byteOffset + audioBytes.byteLength)) as ArrayBuffer
  const decodeCtx = new OfflineAudioContext(1, 1, 44100)
  const audioBuf = await decodeCtx.decodeAudioData(buffer)
  if (audioBuf.duration > MAX_DURATION_SEC) throw new Error('audio too long')
  const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(audioBuf.duration * RESAMPLE_RATE)), RESAMPLE_RATE)
  const src = off.createBufferSource()
  src.buffer = audioBuf
  src.connect(off.destination)
  src.start()
  const rendered = await off.startRendering()
  return { pcm: rendered.getChannelData(0), durationMs: Math.round(audioBuf.duration * 1000) }
}

/**
 * 曲谱生成（P2 鼓谱管线）：
 * score_action(load_cache) → score_action(get_audio) → decodeAudioData + OfflineAudioContext
 * 重采样 22050Hz mono → Worker DSP（STFT/频带分类/量化）→ score-cache JSON（方案 §三/§6.2/§9.5）
 */
export const useScore = () => {
  const state = reactive<ScoreGenerateState>({ phase: 'idle', progress: 0, errorMsg: null })

  const generateDrum = async(): Promise<LX.Score.ScoreCacheData> => {
    const mi = playMusicInfo.musicInfo
    if (!mi) throw new Error('no playing music')
    const key = `${songKey()}|drum`

    state.phase = 'fetch_audio'
    state.progress = 0
    state.errorMsg = null

    const cached = await sendScoreAction({ action: 'load_cache', data: { key } }) as LX.Score.ScoreCacheData | null
    if (cached?.notes) {
      state.phase = 'done'
      state.progress = 100
      return cached
    }

    const { buffer, source } = await getAudioBuffer(mi)
    const audioBytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer as ArrayBuffer)
    if (!audioBytes.byteLength) throw new Error('empty audio')

    state.phase = 'decode'
    const { pcm, durationMs } = await decodeToPCM(buffer)

    state.phase = 'analyze'
    const worker = createScoreWorker()
    let result: LX.Score.DrumAnalyzeResult
    try {
      result = await worker.analyzeDrum(pcm, RESAMPLE_RATE, proxyCallback((p: LX.Score.AnalyzeProgress) => {
        state.progress = 70 + Math.round(p.percent * 0.3)
      }))
    } finally {
      void worker
    }

    const intervalSec = 'progress' in mi ? null : parseIntervalSec(mi.interval)
    const isTrial = intervalSec != null && durationMs < intervalSec * 0.8

    const cacheData: LX.Score.ScoreCacheData = {
      v: 1,
      songKey: key,
      instrument: 'drum',
      quality: 'standard',
      createdAt: Date.now(),
      audio: { source, durationMs, isTrial },
      bpm: result.bpm,
      timeSignature: '4/4',
      offsetMs: result.offsetMs,
      lines: [],
      notes: result.notes,
      segments: [],
      meta: { engine: 'dsp-drums', modelVer: '1', quantizer: 1 },
    }
    void sendScoreAction({ action: 'save_cache', data: { key, data: cacheData } }).catch(() => {})

    state.phase = 'done'
    state.progress = 100
    return cacheData
  }

  return { state, songKey, generateDrum }
}
