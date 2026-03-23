<template>
  <div class="home-view">
    <n-card title="Генерация описаний для фото VK" class="main-card">
      <template #header-extra>
        <n-space align="center">
          <n-tag size="small" :type="settings.processingMode === 'auto' ? 'success' : 'warning'">
            {{ settings.processingMode === 'auto' ? 'Авто' : 'Ручной' }}
          </n-tag>
          <n-tag :type="isProcessing ? 'info' : 'default'">
            {{ isProcessing ? 'Обработка...' : 'Готов к работе' }}
          </n-tag>
        </n-space>
      </template>

      <n-space vertical size="large">
        <!-- Статистика -->
        <n-grid :cols="4" :x-gap="16">
          <n-gi>
            <n-statistic label="Всего">
              <template #prefix><n-icon :component="ImagesIcon" /></template>
              {{ stats.total }}
            </n-statistic>
          </n-gi>
          <n-gi>
            <n-statistic label="Обработано">
              <template #prefix><n-icon :component="CheckmarkIcon" color="#18a058" /></template>
              <n-text type="success">{{ stats.processed }}</n-text>
            </n-statistic>
          </n-gi>
          <n-gi>
            <n-statistic label="Пропущено">
              <template #prefix><n-icon :component="SkipIcon" color="#f0a020" /></template>
              <n-text type="warning">{{ stats.skipped }}</n-text>
            </n-statistic>
          </n-gi>
          <n-gi>
            <n-statistic label="Ошибки">
              <template #prefix><n-icon :component="CloseIcon" color="#d03050" /></template>
              <n-text type="error">{{ stats.failed }}</n-text>
            </n-statistic>
          </n-gi>
        </n-grid>

        <!-- Прогресс бар -->
        <n-progress
          type="line"
          :percentage="progress"
          :status="isProcessing ? 'info' : stats.failed > 0 ? 'error' : 'success'"
          :show-indicator="true"
        />

        <!-- Кнопки управления -->
        <n-space justify="center">
          <n-button
            type="primary"
            size="large"
            :loading="isProcessing"
            :disabled="!settings.vkToken || !settings.vkAlbumId"
            @click="handleStart"
          >
            <template #icon><n-icon :component="PlayIcon" /></template>
            {{ isProcessing ? 'Обработка...' : 'Запустить' }}
          </n-button>
          <n-button
            v-if="isProcessing"
            size="large"
            type="error"
            @click="appStore.stopProcessing()"
          >
            Остановить
          </n-button>
          <n-button
            size="large"
            :disabled="isProcessing"
            @click="$router.push('/settings')"
          >
            <template #icon><n-icon :component="SettingsIcon" /></template>
            Настройки
          </n-button>
        </n-space>

        <!-- Предупреждение о настройках -->
        <n-alert
          v-if="!settings.vkToken || !settings.vkAlbumId"
          type="warning"
          title="Требуется настройка"
        >
          Заполните VK Token и ID альбома в
          <n-button text type="primary" @click="$router.push('/settings')">Настройках</n-button>
        </n-alert>

        <!-- Автоматический режим: последнее обработанное фото -->
        <div v-if="settings.processingMode === 'auto' && lastProcessedPhoto" class="last-photo-block">
          <n-divider>Последнее обработанное фото</n-divider>
          <n-card
            size="small"
            class="last-photo-card"
            :class="{ 'is-clickable': !isProcessing }"
            @click="handlePhotoClick(lastProcessedPhoto)"
          >
            <n-space>
              <img :src="lastProcessedPhoto.image_url" alt="Photo" class="last-photo-img" />
              <n-space vertical justify="space-between" style="flex: 1">
                <div>
                  <n-a
                    :href="`https://vk.com/photo${lastProcessedPhoto.owner_id}_${lastProcessedPhoto.id}`"
                    target="_blank"
                    class="vk-link"
                    @click.stop
                  >
                    <n-icon :component="LinkIcon" size="14" />
                    vk.com/photo{{ lastProcessedPhoto.owner_id }}_{{ lastProcessedPhoto.id }}
                  </n-a>
                  <n-text depth="3" style="display: block; margin-top: 8px; font-size: 13px">
                    Сохранённое описание:
                  </n-text>
                  <n-text>{{ lastProcessedPhoto.caption }}</n-text>
                </div>
                <n-button
                  size="small"
                  type="warning"
                  :loading="undoing"
                  @click.stop="handleUndo"
                >
                  <template #icon><n-icon :component="UndoIcon" /></template>
                  Отменить
                </n-button>
              </n-space>
            </n-space>
          </n-card>
        </div>

        <!-- Текущее фото во время обработки -->
        <div v-if="activePhoto && isProcessing" class="current-photo">
          <n-divider>Текущее фото</n-divider>
          <n-space vertical>
            <div class="photo-preview">
              <img :src="activePhoto.image_url" alt="Photo" />
            </div>
            <n-space justify="space-between" align="center">
              <n-text depth="3">{{ currentPhotoIndex + 1 }} из {{ stats.total }}</n-text>
              <n-tag :type="activePhoto.status === 'completed' ? 'success' : activePhoto.status === 'error' ? 'error' : 'info'">
                {{ getStatusLabel(activePhoto.status) }}
              </n-tag>
            </n-space>
            <n-text v-if="activePhoto.caption" type="success">{{ activePhoto.caption }}</n-text>
            <n-text v-if="activePhoto.error" type="error">{{ activePhoto.error }}</n-text>
          </n-space>
        </div>

        <!-- Список фото -->
        <div v-if="photos.length > 0" class="photos-list">
          <n-divider>Список фото ({{ photos.length }})</n-divider>
          <n-virtual-list
            :items="photos"
            :item-size="64"
            style="max-height: 400px"
          >
            <template #default="{ item }">
              <div
                class="photo-item"
                :class="{ 'is-clickable': !isProcessing }"
                @click="handlePhotoClick(item)"
              >
                <img :src="item.image_url" alt="Photo" class="photo-item-image" />
                <div class="photo-item-info">
                  <n-text strong>Фото #{{ item.id }}</n-text>
                  <n-text depth="3" style="font-size: 12px">
                    {{ item.caption || item.error || 'Ожидание...' }}
                  </n-text>
                </div>
                <n-tag
                  :type="item.status === 'completed' ? 'success' : item.status === 'error' ? 'error' : item.status === 'skipped' ? 'warning' : 'info'"
                  size="small"
                >
                  {{ getStatusLabel(item.status) }}
                </n-tag>
              </div>
            </template>
          </n-virtual-list>
        </div>
      </n-space>
    </n-card>

    <!-- Модальное окно ручного режима -->
    <ManualReviewModal />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useMessage } from 'naive-ui';
import {
  NCard, NTag, NGrid, NGi, NStatistic, NIcon, NText, NProgress,
  NSpace, NButton, NAlert, NDivider, NVirtualList, NA,
} from 'naive-ui';
import {
  ImagesOutline as ImagesIcon,
  CheckmarkCircleOutline as CheckmarkIcon,
  CloseCircleOutline as CloseIcon,
  PlayOutline as PlayIcon,
  SettingsOutline as SettingsIcon,
  ArrowUndoOutline as UndoIcon,
  LinkOutline as LinkIcon,
  PlaySkipForwardOutline as SkipIcon,
} from '@vicons/ionicons5';
import { useAppStore, type PhotoTask } from '@/stores/app';
import { storeToRefs } from 'pinia';
import ManualReviewModal from '@/components/ManualReviewModal.vue';

const message = useMessage();
const appStore = useAppStore();
const { settings, photos, isProcessing, stats, progress, activePhoto, currentPhotoIndex, lastProcessedPhoto } = storeToRefs(appStore);

const undoing = ref(false);

const statusLabels: Record<PhotoTask['status'], string> = {
  pending: 'Ожидание',
  processing: 'Обработка',
  completed: 'Готово',
  error: 'Ошибка',
  skipped: 'Пропущено',
};

async function handleStart() {
  try {
    await appStore.startProcessing();
    message.success('Обработка завершена!');
  } catch (e) {
    message.error(String(e));
  }
}

async function handleUndo() {
  undoing.value = true;

  try {
    await appStore.undoLastCaption();
    message.success('Описание отменено');
  } catch (e) {
    message.error(String(e));
  } finally {
    undoing.value = false;
  }
}

function handlePhotoClick(photo: PhotoTask): void {
  if (isProcessing.value) {
    message.warning('Нельзя редактировать во время общей обработки');
    return;
  }

  appStore.manualEditPhoto(photo);
}

function getStatusLabel(status: PhotoTask['status'] | string): string {
  return statusLabels[status as PhotoTask['status']] || 'Ожидание';
}
</script>

<style scoped lang="scss">
.home-view {
  height: 100%;
  padding: $spacing-lg;
  overflow-y: auto;
}

.main-card {
  max-width: 1200px;
  margin: 0 auto;
}

.last-photo-block {
  margin-top: $spacing-md;
}

.last-photo-card {
  &.is-clickable {
    cursor: pointer;
    transition: background-color 0.2s ease;

    &:hover {
      background-color: var(--n-border-color);
    }
  }
}

.last-photo-img {
  width: 120px;
  height: 120px;
  object-fit: cover;
  border-radius: $radius-md;
  flex-shrink: 0;
}

.vk-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
}

.current-photo {
  margin-top: $spacing-md;
}

.photo-preview {
  display: flex;
  justify-content: center;
  padding: $spacing-md;
  background: var(--n-border-color);
  border-radius: $radius-md;

  img {
    max-width: 100%;
    max-height: 300px;
    border-radius: $radius-sm;
  }
}

.photos-list {
  margin-top: $spacing-md;
}

.photo-item {
  display: flex;
  align-items: center;
  gap: $spacing-md;
  padding: $spacing-sm $spacing-md;
  border-bottom: 1px solid var(--n-border-color);
  min-height: 64px;

  &:last-child { border-bottom: none; }

  &-image {
    width: 48px;
    height: 48px;
    object-fit: cover;
    border-radius: $radius-sm;
  }

  &-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  &.is-clickable {
    cursor: pointer;
    transition: background-color 0.2s ease;

    &:hover {
      background-color: var(--n-border-color);
    }
  }
}
</style>
