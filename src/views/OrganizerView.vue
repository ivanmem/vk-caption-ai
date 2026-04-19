<template>
  <div class="organizer-view">
    <div class="organizer-layout">
      <!-- ── Левая часть: форма ── -->
      <n-card :title="cardTitle" class="form-card">
        <template #header-extra>
          <n-space align="center">
            <n-tag v-if="activeTask" :type="taskStatusType(activeTask.status)" size="small">
              {{ taskStatusLabel(activeTask.status) }}
            </n-tag>
            <n-tag :type="isProcessing ? 'info' : 'default'">
              {{ globalStatusLabel }}
            </n-tag>
          </n-space>
        </template>

        <n-space vertical size="large">
          <n-alert type="info" :show-icon="true">
            Локальная сортировка: модель LMStudio (vision) смотрит на каждый файл и
            сама раскладывает его по подпапкам. Задачи в очереди справа выполняются
            <strong>последовательно</strong>: следующая <em>idle</em>-задача стартует автоматически.
          </n-alert>

          <!-- Шаблон -->
          <n-form-item :show-feedback="false">
            <template #label>
              Шаблон настроек
              <n-text depth="3" style="font-size: 12px">
                <template v-if="activeTask">
                  (форма ниже принадлежит открытой задаче; выбор шаблона задаёт пресет для следующей задачи)
                </template>
                <template v-else>
                  (используется как пресет для новых задач; правки шаблона сохраняются автоматически)
                </template>
              </n-text>
            </template>
            <n-space align="center" :size="8" :wrap-item="false" style="width: 100%">
              <n-select
                v-model:value="organizerStore.activeTemplateName"
                :options="templateSelectOptions"
                style="min-width: 220px; max-width: 320px"
              />
              <n-input
                v-model:value="newTemplateName"
                placeholder="Имя нового шаблона"
                style="width: 220px"
                @keydown.enter="handleAddTemplate(false)"
              />
              <n-button
                :disabled="!newTemplateName.trim()"
                @click="handleAddTemplate(false)"
              >
                <template #icon><n-icon :component="AddIcon" /></template>
                Создать
              </n-button>
              <n-button
                :disabled="!newTemplateName.trim()"
                @click="handleAddTemplate(true)"
              >
                Создать как копию
              </n-button>
              <n-popconfirm @positive-click="handleDeleteTemplate">
                <template #trigger>
                  <n-button
                    type="error"
                    ghost
                    :disabled="!canDeleteCurrentTemplate"
                  >
                    <template #icon><n-icon :component="TrashIcon" /></template>
                    Удалить шаблон
                  </n-button>
                </template>
                Удалить шаблон «{{ activeTemplateName }}»? Действие нельзя отменить.
                <template v-if="tasksUsingActiveTemplate > 0">
                  <br>
                  <n-text type="warning" style="font-size: 12px">
                    На него ссылаются {{ tasksUsingActiveTemplate }} {{ pluralizeTasks(tasksUsingActiveTemplate) }} в очереди — конфиг задач не изменится, останется только метка.
                  </n-text>
                </template>
              </n-popconfirm>
            </n-space>
          </n-form-item>

          <!-- Папка-источник -->
          <n-form-item label="Папка с фото (источник)" :show-feedback="false">
            <n-input-group>
              <n-input
                v-model:value="settings.sourceFolder"
                placeholder="Например: D:\Фото\Разобрать"
                :disabled="formDisabled"
              />
              <n-button
                :disabled="formDisabled"
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
                :disabled="formDisabled"
              />
              <n-button
                :disabled="formDisabled"
                @click="pickDestinationFolder"
              >
                <template #icon><n-icon :component="FolderIcon" /></template>
                Выбрать
              </n-button>
            </n-input-group>
          </n-form-item>

          <!-- Сворачиваемые блоки: целевые папки + правила -->
          <n-collapse :default-expanded-names="['folders', 'rules']">
            <n-collapse-item name="folders">
              <template #header>
                Целевые папки
                <n-text depth="3" style="font-size: 12px">
                  · {{ nonEmptyFoldersCount }} {{ pluralizeFolders(nonEmptyFoldersCount) }}
                </n-text>
              </template>
              <n-space vertical :size="8" style="width: 100%">
                <n-text depth="3" style="font-size: 12px">
                  Введите имя и нажмите Enter; модель выберет одну из этих папок.
                </n-text>
                <n-dynamic-tags
                  v-model:value="settings.folders"
                  :disabled="formDisabled"
                />
                <n-space :size="8">
                  <n-button
                    :loading="isGeneratingFolders"
                    :disabled="formDisabled || !settings.userPrompt.trim()"
                    @click="handleGenerateFolders('merge')"
                  >
                    <template #icon><n-icon :component="SparklesIcon" /></template>
                    Сгенерировать (дополнить)
                  </n-button>
                  <n-popconfirm @positive-click="handleGenerateFolders('replace')">
                    <template #trigger>
                      <n-button
                        :loading="isGeneratingFolders"
                        :disabled="formDisabled || !settings.userPrompt.trim()"
                      >
                        <template #icon><n-icon :component="SparklesIcon" /></template>
                        Сгенерировать (заменить)
                      </n-button>
                    </template>
                    Заменить текущий список папок предложениями модели?
                  </n-popconfirm>
                  <n-text depth="3" style="font-size: 12px; align-self: center">
                    Использует те же правила, но со специальным системным промптом.
                  </n-text>
                </n-space>
              </n-space>
            </n-collapse-item>

            <n-collapse-item name="rules">
              <template #header>
                Правила классификации (промпт)
                <n-text v-if="settings.userPrompt.trim()" depth="3" style="font-size: 12px">
                  · {{ settings.userPrompt.trim().length }} симв.
                </n-text>
              </template>
              <n-input
                v-model:value="settings.userPrompt"
                type="textarea"
                placeholder="Например: «Селфи и портреты — в Люди. Природа и пейзажи — в Природа. Скриншоты, мемы и стикеры — в Прочее.»"
                :autosize="{ minRows: 4, maxRows: 12 }"
                :disabled="formDisabled"
              />
            </n-collapse-item>
          </n-collapse>

          <!-- Доп. настройки модели -->
          <n-collapse>
            <n-collapse-item title="Параметры модели" name="model">
              <n-space vertical>
                <n-form-item label="Модель LMStudio (переопределить)" :show-feedback="false">
                  <n-input
                    v-model:value="settings.modelOverride"
                    placeholder="Пусто — используется модель из общих настроек"
                    :disabled="formDisabled"
                  />
                </n-form-item>

                <n-form-item label="Температура (переопределить)" :show-feedback="false">
                  <n-space align="center" style="width: 100%">
                    <n-checkbox
                      :checked="settings.temperatureOverride !== null"
                      :disabled="formDisabled"
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
                      :disabled="formDisabled || settings.temperatureOverride === null"
                    />
                    <n-input-number
                      v-model:value="temperatureValue"
                      :min="0"
                      :max="2"
                      :step="0.05"
                      size="small"
                      style="width: 100px"
                      :disabled="formDisabled || settings.temperatureOverride === null"
                    />
                  </n-space>
                </n-form-item>

                <n-form-item :show-feedback="false">
                  <n-checkbox
                    v-model:checked="settings.moveSkippedToUnsorted"
                    :disabled="formDisabled"
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
                    :disabled="formDisabled"
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
            :status="progressStatus"
            :show-indicator="true"
          />

          <!-- Управление -->
          <n-space justify="center" :size="8" :wrap="false" style="flex-wrap: wrap">
            <n-button
              type="primary"
              size="large"
              :loading="isRunningActive"
              :disabled="!canStart"
              @click="handleStart"
            >
              <template #icon><n-icon :component="PlayIcon" /></template>
              {{ startButtonLabel }}
            </n-button>

            <n-button
              v-if="isRunningActive"
              size="large"
              type="error"
              @click="organizerStore.stopProcessing()"
            >
              <template #icon><n-icon :component="StopIcon" /></template>
              Остановить
            </n-button>

            <n-button
              size="large"
              :disabled="!canQueue"
              @click="handleAddToQueue"
            >
              <template #icon><n-icon :component="QueueIcon" /></template>
              Добавить в очередь
            </n-button>

            <n-button
              v-if="activeTask"
              size="large"
              :disabled="isRunningActive"
              @click="handleResetActiveTask"
            >
              Сбросить результаты
            </n-button>

            <n-button
              v-if="activeTask"
              size="large"
              :disabled="isRunningActive"
              @click="handleCloseTask"
            >
              <template #icon><n-icon :component="CloseIcon" /></template>
              Закрыть задачу
            </n-button>
          </n-space>

          <!-- Текущий файл (только если открыта именно та задача, что выполняется) -->
          <div v-if="activeImage && isRunningActive" class="current-photo">
            <n-divider>Текущий файл</n-divider>
            <n-space vertical>
              <n-text>
                <strong>{{ activeImage.name }}</strong>
                <n-text depth="3"> — {{ currentIndex + 1 }} из {{ stats.total }}</n-text>
              </n-text>
              <n-tag :type="imageStatusType(activeImage.status)">
                {{ imageStatusLabel(activeImage.status) }}
              </n-tag>
            </n-space>
          </div>

          <!-- Список -->
          <div v-if="images.length > 0" class="images-list">
            <n-divider>Файлы ({{ images.length }})</n-divider>
            <n-virtual-list
              :items="images"
              :item-size="76"
              style="max-height: 480px"
            >
              <template #default="{ item }">
                <div class="image-item">
                  <div class="image-item-thumb">
                    <img
                      v-if="canPreview(item)"
                      :src="thumbnailUrl(item.path)"
                      :alt="item.name"
                      loading="lazy"
                      @error="onThumbError(item.path)"
                    />
                    <n-icon v-else :component="FileImageIcon" size="32" />
                  </div>
                  <div class="image-item-info">
                    <n-button
                      text
                      tag="a"
                      type="primary"
                      class="image-item-name"
                      :title="`Открыть файл: ${item.path}`"
                      @click="handleOpenFile(item)"
                    >
                      {{ item.name }}
                    </n-button>
                    <div class="image-item-sub">
                      <template v-if="item.error">
                        <n-text type="error" depth="3" style="font-size: 12px">
                          {{ item.error }}
                        </n-text>
                      </template>
                      <template v-else-if="item.targetFolder">
                        <n-text depth="3" style="font-size: 12px">→ {{ item.targetFolder }}</n-text>
                        <template v-if="item.movedTo">
                          <n-text depth="3" style="font-size: 12px"> · </n-text>
                          <n-button
                            text
                            tag="a"
                            type="primary"
                            class="image-item-path"
                            :title="`Показать в проводнике: ${item.movedTo}`"
                            @click="handleRevealMoved(item)"
                          >
                            {{ item.movedTo }}
                          </n-button>
                        </template>
                      </template>
                      <template v-else>
                        <n-text depth="3" style="font-size: 12px">Ожидание...</n-text>
                      </template>
                    </div>
                  </div>
                  <n-tag size="small" :type="imageStatusType(item.status)">
                    {{ imageStatusLabel(item.status) }}
                  </n-tag>
                </div>
              </template>
            </n-virtual-list>
          </div>
        </n-space>
      </n-card>

      <!-- ── Правая часть: очередь задач ── -->
      <n-card title="Очередь задач" class="queue-card">
        <template #header-extra>
          <n-tag size="small" :type="isProcessing ? 'info' : 'default'">
            {{ tasks.length }} {{ pluralizeTasks(tasks.length) }}
          </n-tag>
        </template>

        <n-space vertical :size="12">
          <n-button
            block
            type="primary"
            ghost
            :disabled="!canCreateTask"
            @click="handleCreateTask"
          >
            <template #icon><n-icon :component="AddIcon" /></template>
            Новая задача из «{{ activeTemplateName }}»
          </n-button>

          <n-empty v-if="tasks.length === 0" description="Очередь пуста" size="small" />

          <div v-else class="queue-list">
            <div
              v-for="task in tasks"
              :key="task.id"
              class="queue-item"
              :class="{
                'queue-item--active': task.id === activeTaskId,
                'queue-item--running': task.id === runningTaskId,
              }"
              @click="handleSelectTask(task.id)"
            >
              <div class="queue-item-header">
                <n-icon :component="taskStatusIcon(task.status)" :color="taskStatusColor(task.status)" size="18" />
                <n-text strong class="queue-item-label" :title="task.label">
                  {{ task.label }}
                </n-text>
                <n-popconfirm @positive-click.stop="handleDeleteTask(task.id)">
                  <template #trigger>
                    <n-button
                      text
                      size="tiny"
                      class="queue-item-delete"
                      :disabled="task.id === runningTaskId"
                      @click.stop
                    >
                      <template #icon><n-icon :component="TrashIcon" /></template>
                    </n-button>
                  </template>
                  Удалить задачу «{{ task.label }}»?
                </n-popconfirm>
              </div>

              <div class="queue-item-meta">
                <n-tag size="tiny" :type="taskStatusType(task.status)">
                  {{ taskStatusLabel(task.status) }}
                </n-tag>
                <n-text v-if="task.templateName" depth="3" style="font-size: 11px">
                  из «{{ task.templateName }}»
                </n-text>
              </div>

              <div v-if="task.stats.total > 0" class="queue-item-progress">
                <n-progress
                  type="line"
                  :percentage="taskProgress(task)"
                  :status="taskProgressStatus(task)"
                  :show-indicator="false"
                  :height="6"
                />
                <n-text depth="3" style="font-size: 11px">
                  {{ task.stats.moved + task.stats.skipped + task.stats.failed }} / {{ task.stats.total }}
                  · ✓{{ task.stats.moved }} · ⤼{{ task.stats.skipped }} · ✗{{ task.stats.failed }}
                </n-text>
              </div>

              <n-text v-if="task.errorMessage" type="error" depth="3" style="font-size: 11px">
                {{ task.errorMessage }}
              </n-text>
            </div>
          </div>
        </n-space>
      </n-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, type Component } from 'vue';
import { useMessage } from 'naive-ui';
import {
  NCard, NSpace, NTag, NText, NButton, NIcon, NAlert,
  NFormItem, NInput, NInputGroup, NInputNumber, NSlider, NCheckbox,
  NDynamicTags, NCollapse, NCollapseItem, NSelect, NPopconfirm,
  NGrid, NGi, NStatistic, NProgress, NDivider, NVirtualList, NEmpty,
} from 'naive-ui';
import {
  FolderOpenOutline as FolderIcon,
  ImagesOutline as ImagesIcon,
  ImageOutline as FileImageIcon,
  CheckmarkCircleOutline as MoveIcon,
  CloseCircleOutline as CloseIcon,
  PlaySkipForwardOutline as SkipIcon,
  PlayOutline as PlayIcon,
  StopOutline as StopIcon,
  AddCircleOutline as AddIcon,
  TrashOutline as TrashIcon,
  SparklesOutline as SparklesIcon,
  ListOutline as QueueIcon,
  TimeOutline as IdleIcon,
  RefreshOutline as ProcessingIcon,
  CheckmarkDoneOutline as DoneIcon,
  AlertCircleOutline as ErrorIcon,
  PauseCircleOutline as CancelledIcon,
} from '@vicons/ionicons5';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { storeToRefs } from 'pinia';
import { useOrganizerStore, type OrganizerImage, type OrganizerTask, type OrganizerTaskStatus } from '@/stores/organizer';

const PREVIEWABLE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp']);

const message = useMessage();
const organizerStore = useOrganizerStore();
const {
  settings, images, isProcessing, isRunningActive, isGeneratingFolders,
  stats, progress, activeImage, currentIndex,
  activeTemplateName, templateNames,
  tasks, activeTaskId, activeTask, runningTaskId,
} = storeToRefs(organizerStore);

const newTemplateName = ref('');
const brokenThumbs = ref(new Set<string>());

const templateSelectOptions = computed(() => {
  return templateNames.value.map((name) => ({ label: name, value: name }));
});

const canDeleteCurrentTemplate = computed(() => {
  return activeTemplateName.value !== 'default' && templateNames.value.length > 1;
});

const tasksUsingActiveTemplate = computed(() => {
  return tasks.value.filter((t) => t.templateName === activeTemplateName.value).length;
});

const nonEmptyFoldersCount = computed(() => {
  return settings.value.folders.filter((f) => f.trim().length > 0).length;
});

/** Поля формы блокируются, только если открыта задача и она именно сейчас выполняется. */
const formDisabled = computed(() => isRunningActive.value);

/** Можно ли создать новую задачу прямо сейчас. */
const canCreateTask = computed(() => true);

const canStart = computed(() => {
  if (isRunningActive.value) {
    return false;
  }

  return !!settings.value.sourceFolder
    && settings.value.folders.filter((f) => f.trim().length > 0).length > 0;
});

/** Можно ли «закинуть» текущий конфиг как новую задачу-snapshot. */
const canQueue = computed(() => {
  return !!settings.value.sourceFolder
    && settings.value.folders.filter((f) => f.trim().length > 0).length > 0;
});

const startButtonLabel = computed(() => {
  if (isRunningActive.value) {
    return 'Обработка...';
  }

  if (!activeTask.value) {
    return 'В очередь и запустить';
  }

  if (activeTask.value.status === 'done' || activeTask.value.status === 'cancelled' || activeTask.value.status === 'error') {
    return 'Перезапустить';
  }

  return 'Запустить';
});

const cardTitle = computed(() => {
  if (activeTask.value) {
    const tpl = activeTask.value.templateName ? ` (из «${activeTask.value.templateName}»)` : '';
    return `Задача: ${activeTask.value.label}${tpl}`;
  }

  return `Шаблон: ${activeTemplateName.value}`;
});

const globalStatusLabel = computed(() => {
  if (!isProcessing.value) {
    return 'Готов к работе';
  }

  if (isRunningActive.value) {
    return 'Обработка текущей задачи...';
  }

  return 'Обработка другой задачи...';
});

const progressStatus = computed(() => {
  if (isRunningActive.value) {
    return 'info' as const;
  }

  if (stats.value.failed > 0) {
    return 'error' as const;
  }

  return 'success' as const;
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

const imageStatusLabels: Record<OrganizerImage['status'], string> = {
  pending: 'Ожидание',
  processing: 'Обработка',
  moved: 'Перемещено',
  skipped: 'Пропущено',
  error: 'Ошибка',
};

const imageStatusTypes: Record<OrganizerImage['status'], 'default' | 'info' | 'success' | 'warning' | 'error'> = {
  pending: 'default',
  processing: 'info',
  moved: 'success',
  skipped: 'warning',
  error: 'error',
};

const taskStatusLabels: Record<OrganizerTaskStatus, string> = {
  idle: 'Ожидает',
  processing: 'Выполняется',
  done: 'Готово',
  cancelled: 'Остановлена',
  error: 'Ошибка',
};

const taskStatusTypes: Record<OrganizerTaskStatus, 'default' | 'info' | 'success' | 'warning' | 'error'> = {
  idle: 'default',
  processing: 'info',
  done: 'success',
  cancelled: 'warning',
  error: 'error',
};

const taskStatusIcons: Record<OrganizerTaskStatus, Component> = {
  idle: IdleIcon,
  processing: ProcessingIcon,
  done: DoneIcon,
  cancelled: CancelledIcon,
  error: ErrorIcon,
};

const taskStatusColors: Record<OrganizerTaskStatus, string> = {
  idle: '#909399',
  processing: '#2080f0',
  done: '#18a058',
  cancelled: '#f0a020',
  error: '#d03050',
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
    await organizerStore.startActiveTask();
    message.success('Задача завершена');
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e));
  }
}

function handleAddTemplate(copy: boolean = false): void {
  const name = newTemplateName.value.trim();
  if (!name) {
    return;
  }

  try {
    organizerStore.addTemplate(name, copy);
    newTemplateName.value = '';
    message.success(`Шаблон «${name}» создан`);
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e));
  }
}

function handleDeleteTemplate(): void {
  const name = activeTemplateName.value;
  try {
    organizerStore.deleteTemplate(name);
    message.success(`Шаблон «${name}» удалён`);
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e));
  }
}

async function handleGenerateFolders(mode: 'replace' | 'merge'): Promise<void> {
  try {
    const generated = await organizerStore.generateFolders(mode);
    if (generated.length === 0) {
      message.warning('Модель не вернула ни одной папки.');
      return;
    }

    message.success(`Получено папок: ${generated.length}`);
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e));
  }
}

function handleCreateTask(): void {
  const id = organizerStore.createTaskFromCurrent({ activate: true });
  message.success('Задача добавлена в очередь');
  console.log('[OrganizerView] Created task', id);
}

function handleAddToQueue(): void {
  const id = organizerStore.createTaskFromCurrent({ activate: true });
  message.success('Текущий конфиг добавлен в очередь как новая задача');
  console.log('[OrganizerView] Snapshot added to queue', id);
}

function handleSelectTask(id: string): void {
  organizerStore.setActiveTask(id);
}

function handleCloseTask(): void {
  organizerStore.setActiveTask(null);
}

function handleResetActiveTask(): void {
  if (!activeTaskId.value) {
    return;
  }

  try {
    organizerStore.resetTask(activeTaskId.value);
    message.success('Результаты задачи сброшены');
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e));
  }
}

function handleDeleteTask(id: string): void {
  try {
    organizerStore.deleteTask(id);
    message.success('Задача удалена');
  } catch (e) {
    message.error(e instanceof Error ? e.message : String(e));
  }
}

async function handleOpenFile(item: OrganizerImage): Promise<void> {
  const path = item.movedTo || item.path;
  console.log('[Organizer] Open file:', path);
  try {
    await invoke('plugin:opener|open_path', { path });
  } catch (e) {
    console.error('[Organizer] Failed to open file:', e);
    message.error(`Не удалось открыть файл: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function handleRevealMoved(item: OrganizerImage): Promise<void> {
  if (!item.movedTo) {
    return;
  }

  console.log('[Organizer] Reveal in dir:', item.movedTo);
  try {
    await invoke('plugin:opener|reveal_item_in_dir', { path: item.movedTo });
  } catch (e) {
    console.error('[Organizer] Failed to reveal in dir:', e);
    message.error(`Не удалось открыть папку: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function imageStatusLabel(status: OrganizerImage['status']): string {
  return imageStatusLabels[status] ?? 'Ожидание';
}

function imageStatusType(status: OrganizerImage['status']) {
  return imageStatusTypes[status] ?? 'default';
}

function taskStatusLabel(status: OrganizerTaskStatus): string {
  return taskStatusLabels[status] ?? 'Ожидает';
}

function taskStatusType(status: OrganizerTaskStatus) {
  return taskStatusTypes[status] ?? 'default';
}

function taskStatusIcon(status: OrganizerTaskStatus): Component {
  return taskStatusIcons[status] ?? IdleIcon;
}

function taskStatusColor(status: OrganizerTaskStatus): string {
  return taskStatusColors[status] ?? '#909399';
}

function taskProgress(task: OrganizerTask): number {
  if (task.stats.total === 0) {
    return 0;
  }

  const done = task.stats.moved + task.stats.skipped + task.stats.failed;
  return Math.round((done / task.stats.total) * 100);
}

function taskProgressStatus(task: OrganizerTask) {
  if (task.status === 'processing') {
    return 'info' as const;
  }

  if (task.status === 'error' || task.stats.failed > 0) {
    return 'error' as const;
  }

  return 'success' as const;
}

function pluralizeFolders(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) {
    return 'папка';
  }

  if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) {
    return 'папки';
  }

  return 'папок';
}

function pluralizeTasks(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) {
    return 'задача';
  }

  if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) {
    return 'задачи';
  }

  return 'задач';
}

function canPreview(item: OrganizerImage): boolean {
  if (brokenThumbs.value.has(item.path)) {
    return false;
  }

  const dot = item.name.lastIndexOf('.');
  if (dot < 0) {
    return false;
  }

  const ext = item.name.slice(dot + 1).toLowerCase();
  return PREVIEWABLE_EXTS.has(ext);
}

function thumbnailUrl(path: string): string {
  return convertFileSrc(path);
}

function onThumbError(path: string): void {
  console.warn('[Organizer] Thumbnail load failed:', path);
  brokenThumbs.value.add(path);
}
</script>

<style scoped lang="scss">
.organizer-view {
  height: 100%;
  padding: $spacing-lg;
  overflow-y: auto;
}

.organizer-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: $spacing-lg;
  align-items: start;
  max-width: 1480px;
  margin: 0 auto;

  @media (max-width: 1100px) {
    grid-template-columns: 1fr;
  }
}

.form-card {
  min-width: 0;
}

.queue-card {
  position: sticky;
  top: $spacing-lg;
  max-height: calc(100vh - #{$spacing-lg} * 2 - 64px);
  overflow: hidden;

  :deep(.n-card__content) {
    overflow-y: auto;
    max-height: calc(100vh - #{$spacing-lg} * 2 - 64px - 56px);
  }
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
  min-height: 76px;

  &:last-child {
    border-bottom: none;
  }

  &-thumb {
    flex-shrink: 0;
    width: 56px;
    height: 56px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: $radius-sm;
    background: var(--n-action-color, rgba(128, 128, 128, 0.08));
    overflow: hidden;

    > img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
  }

  &-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    overflow: hidden;
  }

  &-name {
    font-weight: 600;
    text-align: left;
    justify-content: flex-start;
    max-width: 100%;

    :deep(.n-button__content) {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      display: block;
      max-width: 100%;
    }
  }

  &-sub {
    display: flex;
    align-items: center;
    gap: 4px;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  &-path {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;

    :deep(.n-button__content) {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      display: block;
      max-width: 100%;
    }
  }
}

.queue-list {
  display: flex;
  flex-direction: column;
  gap: $spacing-xs;
}

.queue-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: $spacing-sm;
  border-radius: $radius-md;
  border: 1px solid transparent;
  background: var(--n-action-color, rgba(128, 128, 128, 0.04));
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;

  &:hover {
    background: var(--n-action-color, rgba(128, 128, 128, 0.10));
  }

  &--active {
    border-color: var(--n-color-target, #2080f0);
  }

  &--running {
    background: rgba(32, 128, 240, 0.08);
  }

  &-header {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }

  &-label {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  &-delete {
    flex-shrink: 0;
  }

  &-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }

  &-progress {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
}
</style>
