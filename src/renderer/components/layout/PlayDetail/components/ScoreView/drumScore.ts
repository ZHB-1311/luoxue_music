// P2 鼓谱渲染：notes → alphaTex 打击乐谱（GTP 风格记谱，方案 §6.2）
// 当前数据源为内置示例节奏型，循环填充整曲时长；DSP 识别接入后由真实
// note events（drumPiece + onsetTick）生成同格式 alphaTex。
export const DRUM_BPM = 106
const TICKS_PER_BAR = 16 // 4/4 的 1/16 刻度数

// 单小节示例节奏型（参考图风格）：8 分踩镲铺底，1/3 拍底鼓-军鼓 backbeat，
// 偶数小节末尾开镲（⊗）。piece 名即 alphaTex articulation（GM 部件）。
const BAR_A: Array<[number, string[]]> = [
  [0, ['KickHit', 'HiHatclosed']],
  [2, ['HiHatclosed']],
  [4, ['SnareHit', 'HiHatclosed']],
  [6, ['HiHatclosed']],
  [8, ['KickHit', 'HiHatclosed']],
  [10, ['HiHatclosed']],
  [12, ['SnareHit', 'HiHatclosed']],
  [14, ['HiHatclosed']],
]
const BAR_B: Array<[number, string[]]> = [
  ...BAR_A.slice(0, 7),
  [14, ['KickHit', 'HiHatopen']],
]

const slotTex = (hits: Array<[number, string[]]>, tick: number): string => {
  const pieces = hits.filter(([t]) => t === tick).flatMap(([, p]) => p)
  if (!pieces.length) return 'r.8'
  return pieces.length === 1 ? `${pieces[0]}.8` : `(${pieces.join(' ')}).8`
}

export const buildDrumAlphaTex = (durationMs: number, songName: string): string => {
  const barMs = (60000 / DRUM_BPM) * 4
  const barCount = Math.max(2, Math.min(96, Math.ceil(durationMs / barMs) || 2))
  const title = songName.replace(/["\\\n\r]/g, '') || 'Drums'
  const header = [
    `\\title "${title}"`,
    `\\tempo ${DRUM_BPM}`,
    '\\track "Drums"',
    '\\instrument percussion',
    '\\clef neutral',
    '\\articulation defaults',
    '\\ts 4 4',
  ].join('\n')
  const bars: string[] = []
  for (let i = 0; i < barCount; i++) {
    const hits = i % 2 === 0 ? BAR_A : BAR_B
    const slots: string[] = []
    for (let tick = 0; tick < TICKS_PER_BAR; tick += 2) slots.push(slotTex(hits, tick))
    bars.push(slots.join(' ') + ' |')
  }
  return `${header}\n${bars.join('\n')}`
}

const ARTICULATION: Record<string, string> = {
  kick: 'KickHit',
  snare: 'SnareHit',
  hihat: 'HiHatclosed',
  hihatOpen: 'HiHatopen',
  tom: 'MidTom',
  crash: 'Crashhighhit',
  ride: 'Ridemiddle',
}

// 时值贪心合并：ticks(1/16 数) → "r.2 r.8" 形式
const restTex = (ticks: number): string => {
  const table: Array<[number, string]> = [[16, 'r.1'], [8, 'r.2'], [4, 'r.4'], [2, 'r.8'], [1, 'r.16']]
  const parts: string[] = []
  let rem = ticks
  for (const [n, tex] of table) {
    while (rem >= n) {
      parts.push(tex)
      rem -= n
    }
  }
  return parts.join(' ')
}

const texHeader = (title: string, bpm: number): string => [
  `\\title "${title.replace(/["\\\n\r]/g, '') || 'Drums'}"`,
  `\\tempo ${bpm}`,
  '\\track "Drums"',
  '\\instrument percussion',
  '\\clef neutral',
  '\\articulation defaults',
  '\\ts 4 4',
].join('\n')

/**
 * 真实转录 notes → alphaTex 打击乐谱。
 * 每小节独立选槽位：全部 hit 落在偶数 1/16 → 8 分槽（更接近常规鼓谱视觉），
 * 否则 16 分槽；连续空槽合并为长休止时值。
 */
export const buildDrumAlphaTexFromNotes = (notes: LX.Score.ScoreNote[], durationMs: number, songName: string, bpm: number): string => {
  if (!notes.length) return buildDrumAlphaTex(durationMs, songName)
  const barMs = (60000 / (bpm || DRUM_BPM)) * 4
  const maxTick = notes.reduce((m, n) => Math.max(m, n.onsetTick), 0)
  const barCount = Math.max(2, Math.min(96, Math.max(Math.ceil(durationMs / barMs), Math.ceil(((maxTick + 1) * (barMs / 16)) / barMs)) || 2))

  const barHits: Array<Map<number, string[]>> = []
  for (let i = 0; i < barCount; i++) barHits.push(new Map())
  for (const n of notes) {
    const art = ARTICULATION[n.drumPiece ?? '']
    if (!art) continue
    const bar = Math.min(Math.floor(n.onsetTick / 16), barCount - 1)
    const tick = n.onsetTick % 16
    const list = barHits[bar].get(tick) ?? []
    if (!list.includes(art)) list.push(art)
    barHits[bar].set(tick, list)
  }

  const bars = barHits.map(hits => {
    const mode8 = [...hits.keys()].every(t => t % 2 === 0)
    const unitTicks = mode8 ? 2 : 1
    const dur = mode8 ? '.8' : '.16'
    const slots: Array<string | null> = []
    for (let t = 0; t < 16; t += unitTicks) {
      const pieces = hits.get(t)
      slots.push(pieces?.length ? (pieces.length > 1 ? `(${pieces.join(' ')})` : pieces[0]) + dur : null)
    }
    const out: string[] = []
    let run = 0
    for (const s of slots) {
      if (s === null) {
        run += unitTicks
        continue
      }
      if (run) {
        out.push(restTex(run))
        run = 0
      }
      out.push(s)
    }
    if (run) out.push(restTex(run))
    return `${out.join(' ')} |`
  })

  return `${texHeader(songName, bpm)}\n${bars.join('\n')}`
}
