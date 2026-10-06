import { type workerMainTypes } from '@renderer/worker/main/index'
import { type workerDownloadTypes } from '@renderer/worker/download/index'
import { type workerScoreTypes } from '@renderer/worker/score/index'


declare global {
  namespace LX {
    type WorkerMainTypes = workerMainTypes
    type WorkerDownloadTypes = workerDownloadTypes
    type WorkerScoreTypes = workerScoreTypes
  }
}
