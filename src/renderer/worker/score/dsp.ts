// 鼓谱 DSP 识别（方案 §6.2，纯启发式零模型）：
// STFT → 三频带 novelty（Kick 40-120Hz / Snare 150-300Hz / HiHat 5k-10kHz）
// → 自适应阈值峰值拾取 → 同刻合并为击打和弦 → Kick/Snare/HiHat(±open)/ghost 判别
// → onset 包络自相关估 BPM + 相位对齐 → 1/16 网格吸附
export interface AnalyzeProgress {
  phase: 'stft' | 'onset' | 'quantize'
  percent: number
}

export interface DrumAnalyzeResult {
  notes: LX.Score.ScoreNote[]
  bpm: number
  offsetMs: number
  durationMs: number
}

const FFT_SIZE = 2048
const HOP = 512

type BandName = 'kick' | 'snare' | 'hihat'
const BANDS: Array<{ name: BandName; f1: number; f2: number }> = [
  { name: 'kick', f1: 40, f2: 120 },
  { name: 'snare', f1: 150, f2: 300 },
  { name: 'hihat', f1: 5000, f2: 10000 },
]
const N_BANDS = BANDS.length

const makeFFT = (size: number) => {
  const levels = Math.log2(size) | 0
  const cos = new Float32Array(size / 2)
  const sin = new Float32Array(size / 2)
  for (let i = 0; i < size / 2; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / size)
    sin[i] = Math.sin((2 * Math.PI * i) / size)
  }
  const rev = new Uint32Array(size)
  for (let i = 0; i < size; i++) {
    let x = i
    let r = 0
    for (let j = 0; j < levels; j++) {
      r = (r << 1) | (x & 1)
      x >>= 1
    }
    rev[i] = r
  }
  return (re: Float32Array, im: Float32Array) => {
    for (let i = 0; i < size; i++) {
      const j = rev[i]
      if (j > i) {
        let t = re[i]
        re[i] = re[j]
        re[j] = t
        t = im[i]
        im[i] = im[j]
        im[j] = t
      }
    }
    for (let half = 2; half <= size; half <<= 1) {
      const step = size / half
      for (let i = 0; i < size; i += half) {
        for (let j = i, k = 0; j < i + half / 2; j++, k += step) {
          const l = j + half / 2
          const tre = re[l] * cos[k] + im[l] * sin[k]
          const tim = im[l] * cos[k] - re[l] * sin[k]
          re[l] = re[j] - tre
          im[l] = im[j] - tim
          re[j] += tre
          im[j] += tim
        }
      }
    }
  }
}

interface BandOnset {
  frame: number
  strength: number
}

/** 单频带 novelty 峰值拾取：滑动均值去基线 + 全局阈值 + 局部极大 + 最小间隔 */
const detectBandOnsets = (raw: Float32Array, frameSec: number): BandOnset[] => {
  const n = raw.length
  const win = Math.max(3, Math.round(0.7 / frameSec) | 1)
  const prefix = new Float64Array(n + 1)
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + raw[i]
  const novelty = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - win)
    const b = Math.min(n, i + win + 1)
    const mean = (prefix[b] - prefix[a]) / (b - a)
    novelty[i] = Math.max(0, raw[i] - mean)
  }
  let mean = 0
  for (let i = 0; i < n; i++) mean += novelty[i]
  mean /= Math.max(n, 1)
  let std = 0
  for (let i = 0; i < n; i++) std += (novelty[i] - mean) ** 2
  std = Math.sqrt(std / Math.max(n, 1))
  const thr = mean + 1.4 * std

  const minGapFrames = Math.max(1, Math.round(0.045 / frameSec))
  const onsets: BandOnset[] = []
  let lastPeak = -minGapFrames
  for (let i = 1; i < n - 1; i++) {
    const v = novelty[i]
    if (v < thr) continue
    if (v < novelty[i - 1] || v < novelty[i + 1]) continue
    if (i - lastPeak < minGapFrames) {
      // 更强的峰可替换刚记录的近邻峰
      if (onsets.length && v > onsets[onsets.length - 1].strength) {
        onsets[onsets.length - 1] = { frame: i, strength: v }
        lastPeak = i
      }
      continue
    }
    onsets.push({ frame: i, strength: v })
    lastPeak = i
  }
  return onsets
}

const median = (arr: number[]): number => {
  if (!arr.length) return 0
  const s = [...arr].sort((a, b) => a - b)
  return s[s.length >> 1]
}

export const analyzeDrum = (pcm: Float32Array, sampleRate: number, onProgress?: (p: AnalyzeProgress) => void): DrumAnalyzeResult => {
  if (pcm.length < FFT_SIZE * 8) throw new Error('audio too short')

  const fft = makeFFT(FFT_SIZE)
  const binHz = sampleRate / FFT_SIZE
  const frameSec = HOP / sampleRate

  const win = new Float32Array(FFT_SIZE)
  for (let i = 0; i < FFT_SIZE; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1))

  // bin → 频带映射（0=不属于任何频带）
  const bandOfBin = new Uint8Array(FFT_SIZE / 2)
  BANDS.forEach((band, bi) => {
    const k1 = Math.max(1, Math.round(band.f1 / binHz))
    const k2 = Math.min(FFT_SIZE / 2 - 1, Math.round(band.f2 / binHz))
    for (let k = k1; k <= k2; k++) bandOfBin[k] = bi + 1
  })

  const frameCount = Math.max(2, Math.floor((pcm.length - FFT_SIZE) / HOP))
  const flux = new Float32Array(frameCount * N_BANDS)
  const hihatEnergy = new Float32Array(frameCount)
  const prevMag = new Float32Array(FFT_SIZE / 2)
  const re = new Float32Array(FFT_SIZE)
  const im = new Float32Array(FFT_SIZE)
  const HIHAT_BAND = N_BANDS - 1

  for (let f = 0; f < frameCount; f++) {
    const off = f * HOP
    for (let i = 0; i < FFT_SIZE; i++) {
      re[i] = (pcm[off + i] || 0) * win[i]
      im[i] = 0
    }
    fft(re, im)
    let eHi = 0
    for (let k = 1; k < FFT_SIZE / 2; k++) {
      const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k])
      const band = bandOfBin[k]
      if (band) {
        const d = Math.log1p(mag) - Math.log1p(prevMag[k])
        if (d > 0) flux[f * N_BANDS + band - 1] += d
      }
      prevMag[k] = mag
      if (band === HIHAT_BAND + 1) eHi += mag
    }
    hihatEnergy[f] = eHi
    if ((f & 511) === 0) onProgress?.({ phase: 'stft', percent: Math.round((f / frameCount) * 70) })
  }
  onProgress?.({ phase: 'onset', percent: 72 })

  // 各频带 onset
  const bandOnsets: BandOnset[][] = BANDS.map((_, b) => {
    const arr = new Float32Array(frameCount)
    for (let f = 0; f < frameCount; f++) arr[f] = flux[f * N_BANDS + b]
    return detectBandOnsets(arr, frameSec)
  })
  for (let b = 0; b < N_BANDS; b++) {
    if (!bandOnsets[b].length) continue
    onProgress?.({ phase: 'onset', percent: 72 + Math.round(((b + 1) / N_BANDS) * 12) })
  }

  // ghost 阈值：各频带峰强中位数
  const ghostThr = bandOnsets.map(list => median(list.map(o => o.strength)) * 0.45)
  // open 镲判定：峰后 80ms 内 hihat 能量均值仍高
  const openFrames = Math.max(1, Math.round(0.08 / frameSec))

  // 合并：同一时刻（±2 帧）各频带峰 → 一个击打（chord）
  type Hit = { frame: number; pieces: Array<{ band: BandName; strength: number; ghost: boolean }> }
  const hits: Hit[] = []
  const all: Array<{ frame: number; band: BandName; strength: number }> = []
  bandOnsets.forEach((list, b) => {
    for (const o of list) all.push({ frame: o.frame, band: BANDS[b].name, strength: o.strength })
  })
  all.sort((a, b) => a.frame - b.frame)
  for (const o of all) {
    const last = hits[hits.length - 1]
    if (last && o.frame - last.frame <= 2) {
      const has = last.pieces.find(p => p.band === o.band)
      if (!has && !(o.band === 'kick' && last.pieces.some(p => p.band === 'snare')) && !(o.band === 'snare' && last.pieces.some(p => p.band === 'kick'))) {
        last.pieces.push({ band: o.band, strength: o.strength, ghost: o.strength < ghostThr[BANDS.findIndex(x => x.name === o.band)] })
      } else if (has && o.strength > has.strength) {
        has.strength = o.strength
        has.ghost = o.strength < ghostThr[BANDS.findIndex(x => x.name === o.band)]
      }
      last.frame = Math.max(last.frame, o.frame)
    } else {
      hits.push({ frame: o.frame, pieces: [{ band: o.band, strength: o.strength, ghost: o.strength < ghostThr[BANDS.findIndex(x => x.name === o.band)] }] })
    }
  }
  if (!hits.length) throw new Error('no drum onsets found')
  onProgress?.({ phase: 'quantize', percent: 88 })

  // BPM：onset 包络自相关（60-180 BPM），相位对齐取 1/16 残差最小
  const env = new Float32Array(frameCount)
  let maxStrength = 0
  for (const h of hits) for (const p of h.pieces) maxStrength = Math.max(maxStrength, p.strength)
  for (const h of hits) {
    const w = h.pieces.reduce((s, p) => s + p.strength, 0) / maxStrength
    for (let d = -2; d <= 2; d++) {
      const i = h.frame + d
      if (i >= 0 && i < frameCount) env[i] = Math.max(env[i], w * (1 - Math.abs(d) * 0.3))
    }
  }
  const lagMin = Math.max(4, Math.round(60 / 180 / frameSec))
  const lagMax = Math.min(frameCount >> 1, Math.round(60 / 60 / frameSec))
  let bestLag = lagMin
  let bestAc = -1
  const ac = new Float32Array(lagMax + 1)
  for (let lag = lagMin; lag <= lagMax; lag++) {
    let s = 0
    for (let i = 0; i + lag < frameCount; i++) s += env[i] * env[i + lag]
    ac[lag] = s
    if (s > bestAc) {
      bestAc = s
      bestLag = lag
    }
  }
  // 倍频纠偏：若半 lag 处自相关仍很强且 bpm 不超上限，取更快的一档
  while (bestLag % 2 === 0 && bestLag / 2 >= lagMin && (60 / ((bestLag / 2) * frameSec)) <= 180 && ac[bestLag / 2] > bestAc * 0.85) {
    bestLag /= 2
    bestAc = ac[bestLag]
  }
  const beatSec = bestLag * frameSec
  const bpm = Math.round(60 / beatSec)
  const tickSec = beatSec / 4 // 1/16

  // 相位：枚举 offset，最小化 onset 落到 1/16 网格的环距残差
  let bestOffset = 0
  let bestResidual = Infinity
  for (let o = 0; o < bestLag * 2; o++) {
    const offSec = (o / 2) * frameSec
    let residual = 0
    for (const h of hits) {
      const t = h.frame * frameSec - offSec
      const m = ((t % tickSec) + tickSec) % tickSec
      residual += Math.min(m, tickSec - m)
    }
    if (residual < bestResidual) {
      bestResidual = residual
      bestOffset = offSec
    }
  }
  const offsetMs = Math.round(bestOffset * 1000)

  // 生成 notes（吸附到 1/16）
  const notes: LX.Score.ScoreNote[] = []
  for (const h of hits) {
    const tSec = h.frame * frameSec
    const tick = Math.round((tSec - bestOffset) / tickSec)
    // hihat open：峰后 80ms 能量均值仍高
    let hiEnd = h.frame
    let hiStart = h.frame
    for (const p of h.pieces) {
      if (p.band !== 'hihat') continue
      hiStart = h.frame
      hiEnd = Math.min(frameCount - 1, h.frame + openFrames)
      let sum = 0
      for (let i = hiStart; i <= hiEnd; i++) sum += hihatEnergy[i]
      const sustained = sum / (hiEnd - hiStart + 1)
      const peak = hihatEnergy[h.frame] || 1
      const piece: LX.Score.DrumPiece = sustained > peak * 0.45 ? 'hihatOpen' : 'hihat'
      notes.push({
        midi: 0,
        onsetMs: Math.round(tSec * 1000),
        durMs: 120,
        onsetTick: tick,
        durTick: 1,
        vel: Math.max(40, Math.min(127, Math.round(40 + 87 * (p.strength / maxStrength)))),
        drumPiece: piece,
        ghost: p.ghost,
      })
    }
    for (const p of h.pieces) {
      if (p.band === 'hihat') continue
      notes.push({
        midi: 0,
        onsetMs: Math.round(tSec * 1000),
        durMs: 120,
        onsetTick: tick,
        durTick: 1,
        vel: Math.max(40, Math.min(127, Math.round(40 + 87 * (p.strength / maxStrength)))),
        drumPiece: p.band,
        ghost: p.ghost,
      })
    }
  }
  notes.sort((a, b) => a.onsetTick - b.onsetTick || (a.drumPiece ?? '').localeCompare(b.drumPiece ?? ''))
  onProgress?.({ phase: 'quantize', percent: 100 })

  return {
    notes,
    bpm,
    offsetMs,
    durationMs: Math.round((pcm.length / sampleRate) * 1000),
  }
}
