<template>
  <n-config-provider :theme="theme" class="app-config">
    <n-message-provider>
      <n-dialog-provider>
        <n-layout class="app-layout">
          <n-layout-header class="app-header" bordered>
            <div class="header-content">
              <div class="logo" @click="$router.push('/')">
                <img src="@/assets/app-icon.svg" alt="VK Caption AI" class="app-logo" />
                <span class="title">VK Caption AI</span>
              </div>
              <n-space>
                <n-button
                  :type="route.name === 'home' ? 'primary' : 'default'"
                  @click="$router.push('/')"
                >
                  Главная
                </n-button>
                <n-button
                  :type="route.name === 'organizer' ? 'primary' : 'default'"
                  @click="$router.push('/organizer')"
                >
                  Распределение
                </n-button>
                <n-button
                  :type="route.name === 'settings' ? 'primary' : 'default'"
                  @click="$router.push('/settings')"
                >
                  Настройки
                </n-button>
                <n-button @click="toggleTheme">
                  <template #icon>
                    <n-icon :component="isDark ? SunIcon : MoonIcon" />
                  </template>
                </n-button>
              </n-space>
            </div>
          </n-layout-header>

          <n-layout-content class="app-content">
            <router-view />
          </n-layout-content>
        </n-layout>
      </n-dialog-provider>
    </n-message-provider>
  </n-config-provider>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import {
  NConfigProvider,
  NMessageProvider,
  NDialogProvider,
  NLayout,
  NLayoutHeader,
  NLayoutContent,
  NButton,
  NIcon,
  NSpace,
  darkTheme
} from 'naive-ui';
import { MoonOutline as MoonIcon, SunnyOutline as SunIcon } from '@vicons/ionicons5';
import { useThemeStore } from '@/stores/theme';
import { useAppStore } from '@/stores/app';
import { invoke } from '@tauri-apps/api/core';

const route = useRoute();
const themeStore = useThemeStore();
const isDark = computed(() => themeStore.isDark);
const theme = computed(() => (themeStore.isDark ? darkTheme : null));

// Синхронизируем настройки из Pinia (localStorage) в Rust AppState при старте
onMounted(async () => {
  const appStore = useAppStore();
  const s = appStore.settings;
  if (s.vkToken) {
    try {
      await invoke('save_settings', {
        settings: {
          vk_token: s.vkToken,
          vk_album_id: s.vkAlbumId,
          vk_owner_id: s.vkOwnerId,
          lmstudio_model: s.lmstudioModel,
          process_with_caption: !!s.processPhotosWithCaption,
          rev_order: s.revOrder !== false,
          temperature: s.temperature ?? 1.1,
        },
      });
    } catch (e) {
      console.error('Failed to sync settings to Rust:', e);
    }
  }
});

function toggleTheme(): void {
  themeStore.toggleTheme();
}
</script>

<style lang="scss">
#app,
.app-config {
  width: 100%;
  height: 100%;
}

.app-layout {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.app-header {
  height: 64px;
  display: flex;
  align-items: center;
  padding: 0 24px;
  background: var(--n-color);
  flex-shrink: 0;
}

.header-content {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.logo {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;

  .app-logo {
    width: 36px;
    height: 36px;
    border-radius: 8px;
  }

  .title {
    font-size: 20px;
    font-weight: 600;
    color: var(--n-text-color);
  }
}

.app-content {
  flex: 1;
  overflow-y: auto;
}
</style>
