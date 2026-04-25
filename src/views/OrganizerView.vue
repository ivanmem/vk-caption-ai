<template>
  <div class="organizer-view" :class="{ 'organizer-view--running': isProcessing }">
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
                  (задача и шаблон редактируются независимо: используйте вкладки ниже)
                </template>
                <template v-else>
                  (используется как пресет для новых задач; правки шаблона сохраняются автоматически,
                  сохранять вручную не нужно)
                </template>
              </n-text>
            </template>
            <n-space v-if="activeTask" vertical>
              <n-space>
                <n-checkbox v-model:checked="useTemplateMode">
                  Использовать шаблон
                </n-checkbox>
                <n-text depth="3" style="font-size: 12px">
                  Когда включено — задача берёт значения из шаблона, а правки в задаче становятся локальными
                  переопределениями.
                </n-text>
              </n-space>

              <n-space>
                <n-select
                    v-model:value="organizerStore.activeTemplateName"
                    :options="templateSelectOptions"
                    style="min-width: 220px; max-width: 320px"
                />
                <n-button
                    :disabled="!activeTask || formDisabled"
                    @click="handleRefreshActiveTaskFromTemplate"
                >
                  Обновить по шаблону
                </n-button>
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
                  <template #icon>
                    <n-icon :component="AddIcon"/>
                  </template>
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
                      <template #icon>
                        <n-icon :component="TrashIcon"/>
                      </template>
                      Удалить шаблон
                    </n-button>
                  </template>
                  Удалить шаблон «{{ activeTemplateName }}»? Действие нельзя отменить.
                  <template v-if="tasksUsingActiveTemplate > 0">
                    <br>
                    <n-text type="warning" style="font-size: 12px">
                      На него ссылаются {{ tasksUsingActiveTemplate }} {{ pluralizeTasks(tasksUsingActiveTemplate) }} в
                      очереди — конфиг задач не изменится, останется только метка.
                    </n-text>
                  </template>
                </n-popconfirm>
              </n-space>
            </n-space>

          </n-form-item>
          <n-tabs v-model:value="editorTab" type="segment">
            <n-tab-pane name="task" tab="Задача">
              <n-space vertical size="large">
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
                      <template #icon>
                        <n-icon :component="FolderIcon"/>
                      </template>
                      Выбрать
                    </n-button>
                    <n-button
                        :disabled="formDisabled || !settings.sourceFolder.trim()"
                        @click="openSourceFolder"
                    >
                      <template #icon>
                        <n-icon :component="FolderIcon"/>
                      </template>
                      Открыть
                    </n-button>
                  </n-input-group>
                </n-form-item>

                <n-alert
                    v-if="activeTask?.useTemplate"
                    type="info"
                    :show-icon="true"
                >
                  Для этой задачи база берётся из шаблона «{{ activeTask.templateName || activeTemplateName }}».
                  Изменения полей во вкладке «Задача» сохраняются как локальные переопределения.
                </n-alert>

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
                      <template #icon>
                        <n-icon :component="FolderIcon"/>
                      </template>
                      Выбрать
                    </n-button>
                  </n-input-group>
                </n-form-item>

                <n-collapse :default-expanded-names="['folders', 'rules']">
                  <n-collapse-item name="folders">
                    <template #header>
                      Целевые папки
                      <n-text depth="3" style="font-size: 12px">
                        · {{ taskNonEmptyFoldersCount }} {{ pluralizeFolders(taskNonEmptyFoldersCount) }}
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
                          <template #icon>
                            <n-icon :component="SparklesIcon"/>
                          </template>
                          Сгенерировать (дополнить)
                        </n-button>
                        <n-popconfirm @positive-click="handleGenerateFolders('replace')">
                          <template #trigger>
                            <n-button
                                :loading="isGeneratingFolders"
                                :disabled="formDisabled || !settings.userPrompt.trim()"
                            >
                              <template #icon>
                                <n-icon :component="SparklesIcon"/>
                              </template>
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

                      <n-form-item :show-feedback="false">
                        <n-checkbox
                            v-model:checked="settings.disableThinking"
                            :disabled="formDisabled"
                        >
                          Отключать thinking (reasoning), если модель поддерживает
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
              </n-space>
            </n-tab-pane>

            <n-tab-pane name="template" tab="Шаблон">
              <n-space vertical size="large">
                <n-alert type="info" :show-icon="true">
                  Вы редактируете выбранный шаблон «{{ activeTemplateName }}». Изменения сохраняются автоматически.
                </n-alert>

                <n-form-item :show-feedback="false">
                  <template #label>
                    Папка для подкаталогов
                    <n-text depth="3" style="font-size: 12px">
                      (необязательно; пусто = та же, что источник)
                    </n-text>
                  </template>
                  <n-input
                      v-model:value="templateSettings.destinationFolder"
                      placeholder="По умолчанию — папка-источник"
                      :disabled="formDisabled"
                  />
                </n-form-item>

                <n-collapse :default-expanded-names="['folders', 'rules']">
                  <n-collapse-item name="folders">
                    <template #header>
                      Целевые папки (шаблон)
                      <n-text depth="3" style="font-size: 12px">
                        · {{ templateNonEmptyFoldersCount }} {{ pluralizeFolders(templateNonEmptyFoldersCount) }}
                      </n-text>
                    </template>
                    <n-space vertical :size="8" style="width: 100%">
                      <n-dynamic-tags
                          v-model:value="templateSettings.folders"
                          :disabled="formDisabled"
                      />
                      <n-space :size="8">
                        <n-button
                            :loading="isGeneratingFolders"
                            :disabled="formDisabled || !templateSettings.userPrompt.trim()"
                            @click="handleGenerateFoldersForTemplate('merge')"
                        >
                          <template #icon>
                            <n-icon :component="SparklesIcon"/>
                          </template>
                          Сгенерировать (дополнить)
                        </n-button>
                        <n-popconfirm @positive-click="handleGenerateFoldersForTemplate('replace')">
                          <template #trigger>
                            <n-button
                                :loading="isGeneratingFolders"
                                :disabled="formDisabled || !templateSettings.userPrompt.trim()"
                            >
                              <template #icon>
                                <n-icon :component="SparklesIcon"/>
                              </template>
                              Сгенерировать (заменить)
                            </n-button>
                          </template>
                          Заменить список папок шаблона предложениями модели?
                        </n-popconfirm>
                      </n-space>
                    </n-space>
                  </n-collapse-item>

                  <n-collapse-item name="rules">
                    <template #header>
                      Правила классификации (шаблон)
                    </template>
                    <n-input
                        v-model:value="templateSettings.userPrompt"
                        type="textarea"
                        placeholder="Правила, которые будут применяться в новых задачах."
                        :autosize="{ minRows: 4, maxRows: 12 }"
                        :disabled="formDisabled"
                    />
                  </n-collapse-item>
                </n-collapse>

                <n-collapse>
                  <n-collapse-item title="Параметры модели (шаблон)" name="template-model">
                    <n-space vertical>
                      <n-form-item label="Модель LMStudio (переопределить)" :show-feedback="false">
                        <n-input
                            v-model:value="templateSettings.modelOverride"
                            placeholder="Пусто — используется модель из общих настроек"
                            :disabled="formDisabled"
                        />
                      </n-form-item>

                      <n-form-item label="Температура (переопределить)" :show-feedback="false">
                        <n-space align="center" style="width: 100%">
                          <n-checkbox
                              :checked="templateSettings.temperatureOverride !== null"
                              :disabled="formDisabled"
                              @update:checked="onTemplateToggleTemperature"
                          >
                            Своя температура
                          </n-checkbox>
                          <n-slider
                              v-model:value="templateTemperatureValue"
                              :min="0"
                              :max="2"
                              :step="0.05"
                              style="flex: 1; min-width: 200px"
                              :disabled="formDisabled || templateSettings.temperatureOverride === null"
                          />
                          <n-input-number
                              v-model:value="templateTemperatureValue"
                              :min="0"
                              :max="2"
                              :step="0.05"
                              size="small"
                              style="width: 100px"
                              :disabled="formDisabled || templateSettings.temperatureOverride === null"
                          />
                        </n-space>
                      </n-form-item>

                      <n-form-item :show-feedback="false">
                        <n-checkbox
                            v-model:checked="templateSettings.moveSkippedToUnsorted"
                            :disabled="formDisabled"
                        >
                          Перемещать нераспознанные/SKIP в отдельную папку
                        </n-checkbox>
                      </n-form-item>

                      <n-form-item :show-feedback="false">
                        <n-checkbox
                            v-model:checked="templateSettings.disableThinking"
                            :disabled="formDisabled"
                        >
                          Отключать thinking (reasoning), если модель поддерживает
                        </n-checkbox>
                      </n-form-item>

                      <n-form-item
                          v-if="templateSettings.moveSkippedToUnsorted"
                          label="Имя папки для нераспознанных"
                          :show-feedback="false"
                      >
                        <n-input
                            v-model:value="templateSettings.unsortedFolderName"
                            placeholder="_unsorted"
                            :disabled="formDisabled"
                        />
                      </n-form-item>
                    </n-space>
                  </n-collapse-item>
                </n-collapse>
              </n-space>
            </n-tab-pane>
          </n-tabs>

          <!-- Статистика -->
          <n-grid :cols="4" :x-gap="16">
            <n-gi>
              <n-statistic label="Всего">
                <template #prefix>
                  <n-icon :component="ImagesIcon"/>
                </template>
                {{ stats.total }}
              </n-statistic>
            </n-gi>
            <n-gi>
              <n-statistic label="Перемещено">
                <template #prefix>
                  <n-icon :component="MoveIcon" color="#18a058"/>
                </template>
                <n-text type="success">{{ stats.moved }}</n-text>
              </n-statistic>
            </n-gi>
            <n-gi>
              <n-statistic label="Пропущено">
                <template #prefix>
                  <n-icon :component="SkipIcon" color="#f0a020"/>
                </template>
                <n-text type="warning">{{ stats.skipped }}</n-text>
              </n-statistic>
            </n-gi>
            <n-gi>
              <n-statistic label="Ошибки">
                <template #prefix>
                  <n-icon :component="CloseIcon" color="#d03050"/>
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
              <template #icon>
                <n-icon :component="PlayIcon"/>
              </template>
              {{ startButtonLabel }}
            </n-button>

            <n-button
                v-if="isRunningActive"
                size="large"
                type="error"
                @click="organizerStore.stopProcessing()"
            >
              <template #icon>
                <n-icon :component="StopIcon"/>
              </template>
              Остановить
            </n-button>

            <n-button
                size="large"
                :disabled="!canQueue"
                @click="handleAddToQueue"
            >
              <template #icon>
                <n-icon :component="QueueIcon"/>
              </template>
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
              <template #icon>
                <n-icon :component="CloseIcon"/>
              </template>
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
            <n-space align="center" :size="8" style="margin-bottom: 8px; flex-wrap: wrap">
              <n-checkbox v-model:checked="showImagesList">
                Показывать список файлов
              </n-checkbox>
              <n-checkbox v-model:checked="showThumbnails" :disabled="!showImagesList">
                Показывать миниатюры
              </n-checkbox>
              <n-text depth="3" style="font-size: 12px">
                На больших папках виртуальный список и WebView2-декодирование
                картинок ощутимо нагружают главный поток — выключите, если лагает.
              </n-text>
            </n-space>
            <n-virtual-list
                v-if="showImagesList"
                :items="images"
                :item-size="76"
                key-field="path"
                style="max-height: 480px"
            >
              <template #default="{ item }">
                <organizer-image-item
                    :item="item"
                    :show-thumbnail="showThumbnails"
                    :status-label="imageStatusLabel(item.status)"
                    :status-type="imageStatusType(item.status)"
                    @open="handleOpenFile"
                    @reveal="handleRevealMoved"
                />
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
            <template #icon>
              <n-icon :component="AddIcon"/>
            </template>
            Новая задача из «{{ activeTemplateName }}»
          </n-button>

          <n-empty v-if="tasks.length === 0" description="Очередь пуста" size="small"/>

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
                <n-icon :component="taskStatusIcon(task.status)" :color="taskStatusColor(task.status)" size="18"/>
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
                      <template #icon>
                        <n-icon :component="TrashIcon"/>
                      </template>
                    </n-button>
                  </template>
                  Удалить задачу «{{ task.label }}»?
                </n-popconfirm>
              </div>

              <div class="queue-item-meta">
                <n-tag size="tiny" :type="taskStatusType(task.status)">
                  {{ taskStatusLabel(task.status) }}
                </n-tag>
                <n-tag v-if="task.useTemplate" size="tiny" type="info">
                  по шаблону
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
import { type Component, computed, ref, watch } from 'vue';
import {
  NAlert,
  NButton,
  NCard,
  NCheckbox,
  NCollapse,
  NCollapseItem,
  NDivider,
  NDynamicTags,
  NEmpty,
  NFormItem,
  NGi,
  NGrid,
  NIcon,
  NInput,
  NInputGroup,
  NInputNumber,
  NPopconfirm,
  NProgress,
  NSelect,
  NSlider,
  NSpace,
  NStatistic,
  NTabPane,
  NTabs,
  NTag,
  NText,
  NVirtualList,
  useMessage
} from 'naive-ui';
import {
  AddCircleOutline as AddIcon,
  AlertCircleOutline as ErrorIcon,
  CheckmarkCircleOutline as MoveIcon,
  CheckmarkDoneOutline as DoneIcon,
  CloseCircleOutline as CloseIcon,
  FolderOpenOutline as FolderIcon,
  ImagesOutline as ImagesIcon,
  ListOutline as QueueIcon,
  PauseCircleOutline as CancelledIcon,
  PlayOutline as PlayIcon,
  PlaySkipForwardOutline as SkipIcon,
  RefreshOutline as ProcessingIcon,
  SparklesOutline as SparklesIcon,
  StopOutline as StopIcon,
  TimeOutline as IdleIcon,
  TrashOutline as TrashIcon,
} from '@vicons/ionicons5';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { storeToRefs } from 'pinia';
import {
  type OrganizerImage,
  type OrganizerTask,
  type OrganizerTaskStatus,
  useOrganizerStore
} from '@/stores/organizer';
import OrganizerImageItem from './OrganizerImageItem.vue';

const message = useMessage();
const organizerStore = useOrganizerStore();
const {
  settings, templateSettings, effectiveSettings, images, isProcessing, isRunningActive, isGeneratingFolders,
  stats, progress, activeImage, currentIndex,
  activeTemplateName, templateNames,
  tasks, activeTaskId, activeTask, runningTaskId,
  showThumbnails, showImagesList,
} = storeToRefs(organizerStore);

const newTemplateName = ref('');
const editorTab = ref<'task' | 'template'>('task');
const useTemplateMode = computed<boolean>({
  get() {
    if (!activeTask.value) {
      return true;
    }

    return Boolean(activeTask.value.useTemplate);
  },
  set(value) {
    try {
      organizerStore.setActiveTaskUseTemplate(value);
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    }
  },
});

watch(activeTemplateName, (name) => {
  if (!activeTask.value || !activeTask.value.useTemplate) {
    return;
  }

  organizerStore.setActiveTaskTemplate(name);
});

watch(
    () => settings.value.sourceFolder,
    () => {
      if (!activeTaskId.value) {
        return;
      }

      organizerStore.syncTaskLabelWithSource(activeTaskId.value);
    },
);

const templateSelectOptions = computed(() => {
  return templateNames.value.map((name) => ({label: name, value: name}));
});

const canDeleteCurrentTemplate = computed(() => {
  return activeTemplateName.value !== 'default' && templateNames.value.length > 1;
});

const tasksUsingActiveTemplate = computed(() => {
  return tasks.value.filter((t) => t.templateName === activeTemplateName.value).length;
});

const taskNonEmptyFoldersCount = computed(() => {
  return settings.value.folders.filter((f) => f.trim().length > 0).length;
});

const templateNonEmptyFoldersCount = computed(() => {
  return templateSettings.value.folders.filter((f) => f.trim().length > 0).length;
});

/** Поля формы блокируются, только если открыта задача и она именно сейчас выполняется. */
const formDisabled = computed(() => isRunningActive.value);

/** Можно ли создать новую задачу прямо сейчас. */
const canCreateTask = computed(() => true);

const canStart = computed(() => {
  if (isRunningActive.value) {
    return false;
  }

  return !!effectiveSettings.value.sourceFolder
      && effectiveSettings.value.folders.filter((f) => f.trim().length > 0).length > 0;
});

/** Можно ли «закинуть» текущий конфиг как новую задачу-snapshot. */
const canQueue = computed(() => {
  return !!effectiveSettings.value.sourceFolder
      && effectiveSettings.value.folders.filter((f) => f.trim().length > 0).length > 0;
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

const templateTemperatureValue = computed<number>({
  get() {
    return templateSettings.value.temperatureOverride ?? 0.2;
  },
  set(value) {
    if (templateSettings.value.temperatureOverride !== null) {
      templateSettings.value.temperatureOverride = value;
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

async function openSourceFolder(): Promise<void> {
  const path = settings.value.sourceFolder.trim();
  if (!path) {
    return;
  }

  console.log('[Organizer] Open source folder:', path);
  try {
    await invoke('plugin:opener|open_path', {path});
  } catch (e) {
    console.error('[Organizer] Failed to open source folder:', e);
    message.error(`Не удалось открыть папку: ${e instanceof Error ? e.message : String(e)}`);
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

function onTemplateToggleTemperature(checked: boolean): void {
  templateSettings.value.temperatureOverride = checked ? 0.2 : null;
}

async function handleStart(): Promise<void> {
  try {
    await organizerStore.startActiveTask({useTemplate: useTemplateMode.value});
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

function handleRefreshActiveTaskFromTemplate(): void {
  try {
    organizerStore.refreshActiveTaskFromTemplate();
    message.success(`Задача обновлена по шаблону «${activeTemplateName.value}»`);
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

async function handleGenerateFoldersForTemplate(mode: 'replace' | 'merge'): Promise<void> {
  try {
    const generated = await organizerStore.generateFoldersForSettings(templateSettings.value, mode);
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
  const id = organizerStore.createTaskFromCurrent({activate: true, useTemplate: useTemplateMode.value});
  message.success('Задача добавлена в очередь');
  console.log('[OrganizerView] Created task', id);
}

function handleAddToQueue(): void {
  const id = organizerStore.createTaskFromCurrent({activate: true, useTemplate: useTemplateMode.value});
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
    await invoke('plugin:opener|open_path', {path});
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
    // С версии tauri-plugin-opener 2.5 команда принимает массив `paths`
    // (старый ключ `path` ловит invalid args). См. plugins-workspace#3111.
    await invoke('plugin:opener|reveal_item_in_dir', {paths: [item.movedTo]});
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

</script>

<style scoped lang="scss">
.organizer-view {
  height: 100%;
  padding: $spacing-lg;
  overflow-y: auto;

  // Когда модель занята обработкой, GPU расходуется LMStudio.
  // Чтобы не воровать у компоновщика последние крохи кадров,
  // глушим все CSS-переходы и анимации внутри страницы.
  // Это не отменяет реактивные обновления Vue — только их визуальное «приплытие».
  &--running,
  &--running :deep(*) {
    transition: none !important;
    animation: none !important;
  }
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
  // Изолируем перерасчёт раскладки/отрисовки в пределах карточки —
  // изменения в правой колонке не дёргают левую и наоборот.
  contain: layout paint style;
}

.queue-card {
  position: sticky;
  top: $spacing-lg;
  max-height: calc(100vh - #{$spacing-lg} * 2 - 64px);
  overflow: hidden;
  contain: layout paint style;

  :deep(.n-card__content) {
    overflow-y: auto;
    max-height: calc(100vh - #{$spacing-lg} * 2 - 64px - 56px);
  }
}

.current-photo {
  margin-top: $spacing-md;
  contain: layout paint style;
}

.images-list {
  margin-top: $spacing-md;
  // Виртуализированный список — отдельная зона перерасчёта.
  contain: layout paint style;
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
  // Каждая «карточка задачи» в очереди — отдельный остров для компоновщика.
  contain: layout paint style;

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
