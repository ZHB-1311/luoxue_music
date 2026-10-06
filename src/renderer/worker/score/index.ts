import { exposeWorker } from '../utils/worker'

import { analyzeDrum } from './dsp'

const api = {
  analyzeDrum,
}

exposeWorker(api)

export type workerScoreTypes = typeof api
