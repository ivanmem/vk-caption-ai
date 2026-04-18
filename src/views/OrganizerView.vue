<template>
  <div class="organizer-view">
    <n-card title="Распределение фото по папкам" class="main-card">
      <template #header-extra>
        <n-tag :type="isProcessing ? 'info' : 'default'">
          {{ isProcessing ? 'Обработка...' : 'Готов к работе' }}
        </n-tag>
      </template>

      <n-space vertical size="large">
        <n-alert type="info" :show-icon="true">
          Локальная сортировка: модель LMStudio (vision) смотрит на каждый файл и
          сама раскладывает его по подпапкам. Папки задаются ниже — модель выбирает
          ровно одну из них (либо <strong>SKIP</strong>, если ничего не подходит).
        </n-alert>

        <!-- Папка-источник -->
        <n-form-item label="Папка с фото (источник)" :show-feedback="false">
          <n-input-group>
            <n-input
              v-model:value="settings.sourceFolder"
              placeholder="Например: D:\Фото\Разобрать"
              :disabled="isProcessing"
            />
            <n-button
              :disabled="isProcessing"
              @click="pickSourceFolder"
            >
              <template #icon><n-icon :component="FolderIcon" /></template>
              Выбрать
            </n-button>
          </n-input-group>
        </n-form-item>

        <!-- Папка-назначение -->
        <n-form-item :show-feedback="false">
          <template #label>
            Папка для подкаталогов
            <n-text depth="3" style="font-size: 12px">
              (необязательно; пусто = та же, что источник)
            </n-text>
          </template>
          <n-input-group>
            <n-input
              v-model:value="settings.destinationFolder"
              placeholder="По умолчанию — папка-источник"
              :disabled="isProcessing"
            />
            <n-button
              :disabled="isProcessing"
              @click="pickDestinationFolder"
            >
              <template #icon><n-icon :component="FolderIcon" /></template>
              Выбрать
            </n-button>
          </n-input-group>
        </n-form-item>

        <!-- Список папок -->
        <n-form-item :show-feedback="false">
          <template #label>
            Целевые папки
            <n-text depth="3" style="font-size: 12px">
              (введите имя и нажмите Enter; модель выберет одну из этих)
            </n-text>
          </template>
          <n-dynamic-tags
            v-model:value="settings.folders"
            :disabled="isProcessing"
          />
        </n-form-item>

        <!-- Промпт -->
        <n-form-item :show-feedback="false">
          <template #label>
            Правила классификации (промпт)
          </template>
          <n-input
            v-model:value="settings.userPrompt"
            type="textarea"
            placeholder="Например: «Селфи и портреты — в Люди. Природа и пейзажи — в Природа. Скриншоты, мемы и стикеры — в Прочее.»"
            :autosize="{ minRows: 4, maxRows: 12 }"
            :disabled="isProcessing"
          />
        </n-form-item>

        <!-- Доп. настройки модели -->
        <n-collapse>
          <n-collapse-item title="Параметры модели" name="model">
            <n-space vertical>
              <n-form-item label="Модель LMStudio (переопределить)" :show-feedback="false">
                <n-input
                  v-model:value="settings.modelOverride"
                  placeholder="Пусто — используется модель из общих настроек"
                  :disabled="isProcessing"
                />
              </n-form-item>

              <n-form-item label="Температура (переопределить)" :show-feedback="false">
                <n-space align="center" style="width: 100%">
                  <n-checkbox
                    :checked="settings.temperatureOverride !== null"
                    :disabled="isProcessing"
                    @update:checked="onToggleTemperature"
                  >
                    Своя температура
                  </n-checkbox>
                  <n-slider
                    v-model:value="temperatureValue"
                    :min="0"
                    :max="2"
                    :step="0.05"
                    style="flex: 1; min-width: 200px"
                    :disabled="isProcessing || settings.temperatureOverride === null"
                  />
                  <n-input-number
                    v-model:value="temperatureValue"
                    :min="0"
                    :max="2"
                    :step="0.05"
                    size="small"
                    style="width: 100px"
                    :disabled="isProcessing || settings.temperatureOverride === null"
                  />
                </n-space>
              </n-form-item>

              <n-form-item :show-feedback="false">
                <n-checkbox
                  v-model:checked="settings.moveSkippedToUnsorted"
                  :disabled="isProcessing"
                >
                  Перемещать нераспознанные/SKIP в отдельную папку
                </n-checkbox>
              </n-form-item>

              <n-form-item
                v-if="settings.moveSkippedToUnsorted"
                label="Имя папки для нераспознанных"
                :show-feedback="false"
              >
                <n-input
                  v-model:value="settings.unsortedFolderName"
                  placeholder="_unsorted"
                  :disabled="isProcessing"
                />
              </n-form-item>
            </n-space>
          </n-collapse-item>
        </n-collapse>

        <!-- Статистика -->
        <n-grid :cols="4" :x-gap="16">
          <n-gi>
            <n-statistic label="Всего">
              <template #prefix><n-icon :component="ImagesIcon" /></template>
              {{ stats.total }}
            </n-statistic>
          </n-gi>
          <n-gi>
            <n-statistic label="Перемещено">
              <template #prefix>
                <n-icon :component="MoveIcon" color="#18a058" />
              </template>
              <n-text type="success">{{ stats.moved }}</n-text>
            </n-statistic>
          </n-gi>
          <n-gi>
            <n-statistic label="Пропущено">
              <template #prefix>
                <n-icon :component="SkipIcon" color="#f0a020" />
              </template>
              <n-text type="warning">{{ stats.skipped }}</n-text>
            </n-statistic>
          </n-gi>
          <n-gi>
            <n-statistic label="Ошибки">
              <template #prefix>
                <n-icon :component="CloseIcon" color="#d03050" />
              </template>
              <n-text type="error">{{ stats.failed }}</n-text>
            </n-statistic>
          </n-gi>
        </n-grid>

        <n-progress
          type="line"
          :percentage="progress"
          :status="isProcessing ? 'info' : stats.failed > 0 ? 'error' : 'success'"
          :show-indicator="true"
        />

        <!-- Управление -->
        <n-space justify="center">
          <n-button
            type="primary"
            size="large"
            :loading="isProcessing"
            :disabled="!canStart"
            @click="handleStart"
          >
            <template #icon><n-icon :component="PlayIcon" /></template>
            {{ isProcessing ? 'Обработка...' : 'Запустить' }}
          </n-button>
          <n-button
            v-if="isProcessing"
            size="large"
            type="error"
            @click="organizerStore.stopProcessing()"
          >
            Остановить
          </n-button>
          <n-button
            size="large"
            :disabled="isProcessing || images.length === 0"
            @click="organizerStore.reset()"
          >
            Очистить список
          </n-button>
        </n-space>

        <!-- Текущий файл -->
        <div v-if="activeImage && isProcessing" class="current-photo">
          <n-divider>Текущий файл</n-divider>
          <n-space vertical>
            <n-text>
              <strong>{{ activeImage.name }}</strong>
              <n-text depth="3"> — {{ currentIndex + 1 }} из {{ stats.total }}</n-text>
            </n-text>
            <n-tag :type="statusType(activeImage.status)">
              {{ statusLabel(activeImage.status) }}
            </n-tag>
          </n-space>
        </div>

        <!-- Список -->
        <div v-if="images.length > 0" class="images-list">
          <n-divider>Файлы ({{ images.length }})</n-divider>
          <n-virtual-list
            :items="images"
            :item-size="56"
            style="max-height: 400px"
          >
            <template #default="{ item }">
              <div class="image-item">
                <n-icon :component="FileImageIcon" size="20" />
                <div class="image-item-info">
                  <n-text strong :depth="item.status === 'pending' ? 3 : 1">
                    {{ item.name }}
                  </n-text>
                  <n-text depth="3" style="font-size: 12px">
                    {{ describeItem(item) }}
                  </n-text>
                </div>
                <n-tag size="small" :type="statusType(item.status)">
                  {{ statusLabel(item.status) }}
                </n-tag>
              </div>
            </template>
          </n-virtual-list>
        </div>
      </n-space>
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useMessage } from 'naive-ui';
import {
  NCard, NSpace, NTag, NText, NButton, NIcon, NAlert,
  NFormItem, NInput, NInputGroup, NInputNumber, NSlider, NCheckbox,
  NDynamicTags, NCollapse, NCollapseItem,
  NGrid, NGi, NStatistic, NProgress, NDivider, NVirtualList,
} from 'naive-ui';
import {
  FolderOpenOutline as FolderIcon,
  ImagesOutline as ImagesIcon,
  ImageOutline as FileImageIcon,
  CheckmarkCircleOutline as MoveIcon,
  CloseCircleOutline as CloseIcon,
  PlaySkipForwardOutline as SkipIcon,
  PlayOutline as PlayIcon,
} from '@vicons/ionicons5';
import { open } from '@tauri-apps/plugin-dialog';
import { storeToRefs } from 'pinia';
import { useOrganizerStore, type OrganizerImage } from '@/stores/organizer';

const message = useMessage();
const organizerStore = useOrganizerStore();
const { settings, images, isProcessing, stats, progress, activeImage, currentIndex } = storeToRefs(organizerStore);

const canStart = computed(() => {
  return !!settings.value.sourceFolder
    && settings.value.folders.filter((f) => f.trim().length > 0).length > 0;
});

const temperatureValue = computed<number>({
  get() {
    return settings.value.temperatureOverride ?? 0.2;
  },
  set(value) {
    if (settings.value.temperatureOverride !== null) {
      settings.value.temperatureOverride = value;
    }
  },
});

const statusLabels: Record<OrganizerImage['status'], string> = {
  pending: 'Ожидание',
  processing: 'Обработка',
  moved: 'Перемещено',
  skipped: 'Пропущено',
  error: 'Ошибка',
};

const statusTypes: Record<OrganizerImage['status'], 'default' | 'info' | 'success' | 'warning' | 'error'> = {
  pending: 'default',
  processing: 'info',
  moved: 'success',
  skipped: 'warning',
  error: 'error',
};

async function pickSourceFolder(): Promise<void> {
  const selected = await open({
    directory: true,
    multiple: false,
    title: 'Выберите папку с фото для распределения',
    defaultPath: settings.value.sourceFolder || undefined,
  });

  if (typeof selected === 'string' && selected.length > 0) {
    settings.value.sourceFolder = selected;
  }
}

async function pickDestinationFolder(): Promise<void> {
  const selected = await open({
    directory: true,
    multiple: false,
    title: 'Выберите папку, в которой будут созданы подкаталоги',
    defaultPath: settings.value.destinationFolder || settings.value.sourceFolder || undefined,
  });

  if (typeof selected === 'string' && selected.length > 0) {
    settings.value.destinationFolder = selected;
  }
}

function onToggleTemperature(checked: boolean): void {
  settings.value.temperatureOverride = checked ? 0.2 : null;
}

async function handleStart(): Promise<void> {
  try {
    await organizerStore.startProcessing();
    message.success('Распределение завершено');
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e));
  }
}

function statusLabel(status: OrganizerImage['status']): string {
  return statusLabels[status] ?? 'Ожидание';
}

function statusType(status: OrganizerImage['status']) {
  return statusTypes[status] ?? 'default';
}

function describeItem(item: OrganizerImage): string {
  if (item.error) {
    return item.error;
  }

  if (item.targetFolder) {
    return item.movedTo
      ? `→ ${item.targetFolder}  ·  ${item.movedTo}`
      : `→ ${item.targetFolder}`;
  }

  return 'Ожидание...';
}
</script>

<style scoped lang="scss">
.organizer-view {
  height: 100%;
  padding: $spacing-lg;
  overflow-y: auto;
}

.main-card {
  max-width: 1200px;
  margin: 0 auto;
}

.current-photo {
  margin-top: $spacing-md;
}

.images-list {
  margin-top: $spacing-md;
}

.image-item {
  display: flex;
  align-items: center;
  gap: $spacing-md;
  padding: $spacing-sm $spacing-md;
  border-bottom: 1px solid var(--n-border-color);
  min-height: 56px;

  &:last-child {
    border-bottom: none;
  }

  &-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    overflow: hidden;

    > * {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  }
}
</style>
