import store from '@main/utils/store'
import { STORE_NAMES } from '@common/constants'

const getStore = () => store(STORE_NAMES.ACCOUNT)

const getProviders = (): Partial<Record<LX.Account.Source, LX.Account.ProviderCredentials>> => {
  return getStore().get('providers') ?? {}
}

export const getKugouCredentials = () => {
  return getProviders().kg
}

// 设备标识：首次生成后持久化，酷狗接口签名需要稳定的设备标识
const getDeviceGuid = (): string => {
  const deviceStore = getStore()
  let guid = deviceStore.get<string>('device_guid')
  if (!guid) {
    guid = crypto.randomUUID()
    deviceStore.set('device_guid', guid)
  }
  return guid
}

export const getDeviceDfid = (): string | undefined => {
  return getStore().get<string>('device_dfid') || undefined
}

export const saveDeviceDfid = (dfid: string) => {
  getStore().set('device_dfid', dfid)
}

export const getDeviceCookie = (): string | undefined => {
  return getStore().get<string>('device_cookie') || undefined
}

export const saveDeviceCookie = (cookie: string) => {
  getStore().set('device_cookie', cookie)
}

export const getStatus = (): LX.Account.Status => {
  return {
    device: { guid: getDeviceGuid(), dfid: getDeviceDfid() },
    providers: getProviders(),
  }
}

export const saveCredentials = (source: LX.Account.Source, credentials: LX.Account.ProviderCredentials) => {
  const providers = getProviders()
  providers[source] = credentials
  getStore().set('providers', providers)
}

export const logout = (source: LX.Account.Source) => {
  const providers = getProviders()
  delete providers[source]
  getStore().set('providers', providers)
}
