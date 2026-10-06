declare namespace LX {
  namespace Score {
    type Instrument = 'piano' | 'drum' | 'guzheng' | 'guitar'
    type Layout = 'aligned' | 'full'
    type Quality = 'fast' | 'standard' | 'fine'
    type SegmentType = 'intro' | 'interlude' | 'line' | 'full'
    type DrumPiece = 'kick' | 'snare' | 'hihat' | 'hihatOpen' | 'tom' | 'crash' | 'ride'

    interface ScoreNote {
      midi: number
      onsetMs: number
      durMs: number
      /** 1/16 网格刻度（量化后），tick = 四分音符 ms / 4 */
      onsetTick: number
      durTick: number
      vel: number
      drumPiece: DrumPiece | null
      /** 弱击（ghost note，谱面括号音符），鼓谱用 */
      ghost?: boolean
    }

    interface ScoreLine {
      startMs: number
      endMs: number
      text: string
      type: SegmentType
    }

    interface ScoreSegment {
      lineIndex: number
      startMs: number
      endMs: number
      type: SegmentType
      notes: ScoreNote[]
    }

      interface ScoreCacheData {
        v: number
        songKey: string
        instrument: Instrument
        quality: Quality
        createdAt: number
        audio: { source: 'stream' | 'local'; durationMs: number; isTrial: boolean }
        bpm: number
        timeSignature: string
        offsetMs: number
        lines: ScoreLine[]
        notes: ScoreNote[]
        segments: ScoreSegment[]
        meta: { engine: string; modelVer: string; quantizer: number }
      }

      interface AnalyzeProgress {
        phase: 'stft' | 'onset' | 'quantize'
        percent: number
      }

      interface DrumAnalyzeResult {
        notes: ScoreNote[]
        bpm: number
        offsetMs: number
        durationMs: number
      }

      interface ActionBase<A> {
        action: A
      }
      interface ActionData<A, D> extends ActionBase<A> {
        data: D
      }
      type Action<A, D = undefined> = D extends undefined ? ActionBase<A> : ActionData<A, D>

      // renderer -> main
      type ServiceActions = Action<'get_audio', { source: 'local' | 'stream'; filePath?: string; url?: string }>
        | Action<'save_cache', { key: string; data: ScoreCacheData }>
        | Action<'load_cache', { key: string }>
  }
}
