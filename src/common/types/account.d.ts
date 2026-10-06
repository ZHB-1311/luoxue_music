declare namespace LX {
  namespace Account {

    // 预留多平台账号：kg 酷狗 / wy 网易云 / qishui 汽水
    type Source = 'kg' | 'wy' | 'qishui'

    interface ActionBase<A> {
      action: A
    }
    interface ActionData<A, D> extends ActionBase<A> {
      data: D
    }
    type Action<A, D = undefined> = D extends undefined ? ActionBase<A> : ActionData<A, D>

    interface DeviceInfo {
      guid: string
      // 注册设备返回的 dfid，酷狗 token 绑定设备，必须持久化复用
      dfid?: string
    }

    interface KugouCredentials {
      token: string
      userid: string
      nickname?: string
      pic?: string
      loginAt: number
    }

    // 各平台凭证字段不一，预留索引签名
    type ProviderCredentials = KugouCredentials & Record<string, any>

    interface Status {
      device: DeviceInfo
      providers: Partial<Record<Source, ProviderCredentials>>
    }

    interface UserPlaylist {
      // 用户歌单为 listid（v4/get_list_all_file 使用），公开歌单为 global_collection_id
      id: string
      gcid?: string
      name: string
      pic?: string
      count: number
    }

    // renderer -> main（kg_* 动作在主进程执行酷狗 API，渲染进程环境不可用）
    type ServiceActions = Action<'get_status'>
      | Action<'save_dfid', { source: Source, dfid: string }>
      | Action<'save_credentials', { source: Source, credentials: ProviderCredentials }>
      | Action<'logout', { source: Source }>
      | Action<'kg_prepare_device', { force?: boolean }>
      | Action<'kg_qr_key'>
      | Action<'kg_qr_check', { key: string }>
      | Action<'kg_playlists', { page: number }>
      | Action<'kg_playlist_tracks', { listid: string, page: number }>

    // main -> renderer
    type MainWindowActions = Action<'status', Status>
  }
}
