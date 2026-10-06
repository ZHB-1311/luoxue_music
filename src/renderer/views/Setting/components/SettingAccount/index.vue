<template lang="pug">
dt#account
  | {{ $t('setting__account') }}
dd
  p {{ $t('account__desc') }}

dd
  h3 {{ $t('account__provider_kugou') }}
  div(v-if="credentials" :class="$style.provider")
    div(:class="$style.userRow")
      img(v-if="credentials.pic" :src="credentials.pic" :class="$style.userPic")
      span(:class="$style.userName") {{ credentials.nickname || credentials.userid }}
      base-btn(min outline :aria-label="$t('account__logout')" @click="handleLogout") {{ $t('account__logout') }}
    div(:class="$style.playlistHeader")
      h3 {{ $t('account__my_playlists') }}
      base-btn(min :disabled="account.playlistsLoading || account.isSyncing" @click="handleFetchPlaylists") {{ account.playlistsLoading ? $t('account__loading') : $t('account__load_playlists') }}
    div(v-if="account.playlists.length" :class="$style.playlistArea")
      ul.scroll(:class="$style.playlistList")
        li(v-for="pl in account.playlists" :key="pl.id" :class="$style.playlistItem")
          img(v-if="pl.pic" :src="pl.pic" :class="$style.playlistPic")
          div(:class="$style.playlistInfo")
            span(:class="$style.playlistName") {{ pl.name }}
            span(:class="$style.playlistCount") {{ $t('account__play_count', { count: pl.count }) }}
          base-btn(min :disabled="busyId === pl.id" @click="handleImport(pl)") {{ busyId === pl.id ? $t('account__syncing') : (isImported(pl) ? $t('account__refresh') : $t('account__import')) }}
      div(:class="$style.syncAllRow")
        base-btn(:disabled="account.isSyncing || busyId != null" @click="handleSyncAll") {{ account.isSyncing ? $t('account__syncing') + (syncingName ? ` ${syncingName}` : '') : $t('account__sync_all') }}
    p(v-else-if="account.playlistsLoading" :class="$style.hint") {{ $t('account__loading') }}
    p(v-else :class="$style.hint") {{ $t('account__no_playlists') }}
  div(v-else)
    base-btn(:disabled="!accountReady" @click="account.isVisibleLoginModal = true") {{ $t('account__login') }}
    p(v-if="!accountReady" :class="$style.hint") {{ $t('account__loading') }}

dd
  h3 {{ $t('account__other_providers') }}
  p {{ $t('account__coming_soon') }}

LoginModal(v-model:show="account.isVisibleLoginModal" @success="handleLoginSuccess")
</template>

<script lang="ts">
import { ref, computed } from '@common/utils/vueTools'
import { useI18n } from '@renderer/plugins/i18n'
import { dialog } from '@renderer/plugins/Dialog'
import { account, getCredentials, logoutAccount, fetchUserPlaylists, importKugouPlaylist, syncAllKugouPlaylists } from '@renderer/store/account'
import { userLists } from '@renderer/store/list/state'
import LoginModal from './LoginModal.vue'

export default {
  name: 'SettingAccount',
  components: {
    LoginModal,
  },
  setup() {
    const t = useI18n()

    const busyId = ref<string | null>(null)

    const credentials = computed(() => getCredentials('kg'))
    const accountReady = computed(() => !!account.status?.device?.guid)

    const isImported = (pl: LX.Account.UserPlaylist) => {
      return userLists.some(l => l.source == 'kg' && l.sourceListId == pl.id)
    }

    const handleLoginSuccess = () => {
      void handleFetchPlaylists()
    }

    const handleLogout = () => {
      void logoutAccount('kg')
    }

    const handleFetchPlaylists = async() => {
      try {
        await fetchUserPlaylists()
        if (!account.playlists.length) void dialog({ message: t('account__no_playlists') })
      } catch (err) {
        void dialog({ message: t('account__fetch_playlists_failed', { message: (err as Error).message }) })
      }
    }

    const handleImport = async(pl: LX.Account.UserPlaylist) => {
      busyId.value = pl.id
      try {
        await importKugouPlaylist(pl)
      } catch (err) {
        void dialog({ message: t('account__import_failed', { name: pl.name, message: (err as Error).message }) })
      } finally {
        busyId.value = null
      }
    }

    const handleSyncAll = async() => {
      try {
        const { imported, refreshed, failed } = await syncAllKugouPlaylists()
        void dialog({ message: t('account__sync_done', { imported, refreshed, failed }) })
      } catch (err) {
        void dialog({ message: t('account__import_failed', { name: '', message: (err as Error).message }) })
      }
    }

    return {
      account,
      credentials,
      accountReady,
      busyId,
      isImported,
      handleLoginSuccess,
      handleLogout,
      handleFetchPlaylists,
      handleImport,
      handleSyncAll,
    }
  },
}
</script>


<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.provider {
  padding: 5px 0;
}
.userRow {
  display: flex;
  align-items: center;
  gap: 12px;

  .userPic {
    flex: none;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    object-fit: cover;
  }

  .userName {
    .mixin-ellipsis-1();
    font-size: 14px;
    font-weight: 600;
  }
}
.playlistHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 18px;

  h3 {
    margin: 0;
  }
}
.playlistArea {
  margin-top: 8px;
}
.playlistList {
  max-height: 300px;
  overflow-y: auto;
}
.playlistItem {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 4px;

  &:hover {
    background-color: var(--color-button-background-hover);
  }
}
.playlistPic {
  flex: none;
  width: 40px;
  height: 40px;
  border-radius: 3px;
  object-fit: cover;
}
.playlistInfo {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-flow: column nowrap;
}
.playlistName {
  .mixin-ellipsis-1();
  font-size: 13px;
}
.playlistCount {
  font-size: 11px;
  color: var(--color-font-label);
}
.syncAllRow {
  margin-top: 12px;
}
.hint {
  padding: 8px 0;
  font-size: 12px;
  color: var(--color-font-label);
}
</style>
