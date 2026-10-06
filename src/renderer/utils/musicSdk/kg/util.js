import { toMD5 } from '../utils'
import { httpFetch } from '../../request'

// s.content[0].lyricContent.forEach(([str]) => {
//   console.log(str)
// })

/**
 * 签名
 * @param {*} params
 * @param {*} apiver
 */
export const signatureParams = (params, platform = 'android', body = '') => {
  let keyparam = 'OIlwieks28dk2k092lksi2UIkp'
  if (platform === 'web') keyparam = 'NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt'
  let param_list = params.split('&')
  param_list.sort()
  let sign_params = `${keyparam}${param_list.join('')}${body}${keyparam}`
  return toMD5(sign_params)
}

/**
 * 对象参数签名（账号相关接口使用，算法与 signatureParams 一致，支持 POST body 参与签名）
 * @param {*} params 参数对象
 * @param {*} platform android / web
 * @param {*} body POST body 的 JSON 字符串
 */
export const signatureKgParams = (params, platform = 'android', body = '') => {
  let keyparam = platform === 'web' ? 'NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt' : 'OIlwieks28dk2k092lksi2UIkp'
  let param_list = Object.keys(params).map(key => `${key}=${typeof params[key] === 'object' ? JSON.stringify(params[key]) : params[key]}`).sort()
  return toMD5(`${keyparam}${param_list.join('')}${body}${keyparam}`)
}

/**
 * 创建一个适用于KG的Http请求
 * @param {*} url
 * @param {*} options
 * @param {*} retryNum
 */
export const createHttpFetch = async(url, options, retryNum = 0) => {
  if (retryNum > 2) throw new Error('try max num')
  let result
  try {
    result = await httpFetch(url, options).promise
  } catch (err) {
    console.log(err)
    return createHttpFetch(url, options, ++retryNum)
  }
  // console.log(result.statusCode, result.body)
  if (result.statusCode !== 200 ||
    (
      result.body.error_code ??
      result.body.errcode ??
      result.body.err_code) != 0
  ) return createHttpFetch(url, options, ++retryNum)
  if (result.body.data) return result.body.data
  if (Array.isArray(result.body.info)) return result.body
  return result.body.info
}
