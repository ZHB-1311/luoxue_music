<template lang="pug">
material-modal(:show="show" bg-close teleport="#view" @close="handleClose")
  main(:class="$style.main")
    h2 {{ $t('account__login_qr_title') }}
    div(:class="$style.qrWrap")
      img(v-if="qrImg && status != 'expired'" :src="qrImg" :class="$style.qrImg" alt="QR Code")
      div(v-else-if="status == 'expired'" :class="$style.qrExpired")
        p {{ $t('account__login_qr_expired') }}
        base-btn(min @click="startLogin(0)") {{ $t('account__login_qr_refresh') }}
      div(v-else :class="$style.qrTip") {{ $t('account__login_qr_loading') }}
    p(:class="$style.tip") {{ tipText }}
    p(v-if="errorMsg" :class="$style.error") {{ errorMsg }}
</template>

<script lang="ts">
import { ref, computed, watch, onBeforeUnmount } from '@common/utils/vueTools'
import { useI18n } from '@renderer/plugins/i18n'
import { saveKugouCredentials, prepareKugouDevice, kgGetQrKey, kgCheckQr } from '@renderer/store/account'
import QRCode from 'qrcode'

export default {
  name: 'KugouLoginModal',
  props: {
    show: {
      type: Boolean,
      default: false,
    },
  },
  emits: ['update:show', 'success'],
  setup(props: { show: boolean }, { emit }: { emit: (event: 'update:show' | 'success', show?: boolean) => void }) {
    const t = useI18n()

    const qrImg = ref('')
    const status = ref<'loading' | 'waiting' | 'scanned' | 'success' | 'expired'>('loading')
    const nickname = ref('')
    const errorMsg = ref('')
    const extraTip = ref('')

    let pollTimer: ReturnType<typeof setInterval> | null = null

    const tipText = computed(() => {
      switch (status.value) {
        case 'scanned':
          return t('account__login_qr_scanned', { name: nickname.value })
        case 'expired':
          return t('account__login_qr_expired')
        case 'success':
          return t('account__login_success')
        default:
          return extraTip.value || t('account__login_qr_tip')
      }
    })

    const clearPoll = () => {
      if (pollTimer) {
        clearInterval(pollTimer)
        pollTimer = null
      }
    }

    // 扫码成功后：保存凭证；若本次扫码用的是匿名设备（首次登录），
    // 用新 token 注册受信设备后自动重扫一次（新 token 需绑定受信 dfid 才能访问歌单接口）
    const handleLoginSuccess = async(data: { token: string, userid: number | string, nickname?: string, pic?: string }, trusted: boolean, loop: number) => {
      clearPoll()
      status.value = 'success'
      await saveKugouCredentials({
        token: data.token,
        userid: String(data.userid),
        nickname: data.nickname,
        pic: data.pic,
        loginAt: Date.now(),
      })
      if (trusted || loop >= 1) {
        setTimeout(() => {
          emit('update:show', false)
          emit('success')
        }, 800)
        return
      }
      extraTip.value = t('account__login_qr_twice')
      try {
        // 匿名设备签发的 token 无法访问歌单接口：用新 token 强制重注册受信 dfid，再扫一次换绑
        await prepareKugouDevice(true)
      } catch {}
      setTimeout(() => {
        void startLogin(loop + 1)
      }, 600)
    }

    const startLogin = async(loop = 0) => {
      clearPoll()
      qrImg.value = ''
      errorMsg.value = ''
      nickname.value = ''
      extraTip.value = ''
      status.value = 'loading'
      try {
        // 首次进入登录流程：强制用当前已存 token 注册新受信 dfid 并在其上扫码（debug4 验证路径）；
        // 二次扫码（loop>0）复用匿名登录后重注册的 dfid
        const { trusted } = await prepareKugouDevice(loop === 0)
        const { key, img } = await kgGetQrKey()
        qrImg.value = img || await QRCode.toDataURL(`https://h5.kugou.com/apps/loginQRCode/html/index.html?qrcode=${key}`, { width: 220, margin: 1 })
        status.value = 'waiting'
        pollTimer = setInterval(async() => {
          if (document.hidden) return
          try {
            const data = await kgCheckQr(key)
            switch (data.status) {
              case 2:
                nickname.value = data.nickname ?? ''
                status.value = 'scanned'
                break
              case 4:
                void handleLoginSuccess(data, trusted, loop)
                break
              case 0:
                clearPoll()
                status.value = 'expired'
                break
              default:
                break
            }
          } catch (err) {
            clearPoll()
            status.value = 'expired'
            errorMsg.value = t('account__login_failed', { message: (err as Error).message })
          }
        }, 2000)
      } catch (err) {
        status.value = 'expired'
        errorMsg.value = t('account__login_failed', { message: (err as Error).message })
      }
    }

    watch(() => props.show, show => {
      if (show) {
        void startLogin(0)
      } else {
        clearPoll()
      }
    })

    onBeforeUnmount(() => {
      clearPoll()
    })

    const handleClose = () => {
      emit('update:show', false)
    }

    return {
      qrImg,
      status,
      nickname,
      errorMsg,
      tipText,
      startLogin,
      handleClose,
    }
  },
}
</script>


<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.main {
  padding: 15px 8px;
  max-width: 320px;
  min-width: 280px;
  display: flex;
  flex-flow: column nowrap;
  align-items: center;

  h2 {
    flex: none;
    text-align: center;
    font-size: 16px;
    padding: 10px 0;
  }
}
.qrWrap {
  position: relative;
  width: 220px;
  height: 220px;
  flex: none;
}
.qrImg {
  width: 100%;
  height: 100%;
}
.qrTip {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-font-label);
}
.qrExpired {
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  border: 1px dashed var(--color-primary);
  display: flex;
  flex-flow: column nowrap;
  align-items: center;
  justify-content: center;
  gap: 10px;

  p {
    color: var(--color-font);
  }
}
.tip {
  padding: 10px 5px 0;
  text-align: center;
  font-size: 13px;
  color: var(--color-font-label);
  min-height: 2em;
}
.error {
  padding: 5px;
  text-align: center;
  font-size: 12px;
  color: var(--color-danger);
  word-break: break-all;
}

</style>
