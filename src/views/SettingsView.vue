<template>
  <div class="settings-view">
    <n-card title="Настройки приложения" class="settings-card">
      <n-space vertical size="large">
        <n-alert type="info" title="LMStudio">
          Убедитесь, что LMStudio запущен и vision модель загружена перед началом работы.
        </n-alert>

        <n-form
          ref="formRef"
          :model="appStore.settings"
          :rules="rules"
          label-placement="top"
          label-width="120"
        >
          <n-form-item label="VK Token" path="vkToken">
            <n-input
              v-model:value="appStore.settings.vkToken"
              type="password"
              placeholder="vk1.a..."
              show-password-on="click"
            />
          </n-form-item>

          <n-form-item label="VK Album ID" path="vkAlbumId">
            <n-input
              v-model:value="appStore.settings.vkAlbumId"
              placeholder="100"
            />
          </n-form-item>

          <n-form-item label="VK Owner ID" path="vkOwnerId">
            <n-input
              v-model:value="appStore.settings.vkOwnerId"
              placeholder="Опционально"
            />
            <template #feedback>
              ID владельца, если альбом не ваш. Оставьте пустым для своих альбомов.
            </template>
          </n-form-item>

          <n-form-item label="LMStudio Model" path="lmstudioModel">
            <n-auto-complete
              v-model:value="appStore.settings.lmstudioModel"
              :options="modelOptions"
              :loading="loadingModels"
              placeholder="google/gemma-3-12b"
              clearable
              @focus="handleModelsFetch"
            />
            <template #feedback>
              Модель должна поддерживать vision (распознавание изображений)
            </template>
          </n-form-item>

          <n-form-item label="Режим обработки">
            <n-radio-group v-model:value="appStore.settings.processingMode">
              <n-radio value="auto">Автоматический</n-radio>
              <n-radio value="manual">Ручной</n-radio>
            </n-radio-group>
            <template #feedback>
              Ручной режим показывает модальное окно перед каждым сохранением
            </template>
          </n-form-item>

          <n-form-item label="Загрузка фото">
            <n-space vertical>
              <n-checkbox v-model:checked="appStore.settings.processPhotosWithCaption">
                Обрабатывать фото с уже заполненным описанием
              </n-checkbox>
              <n-checkbox v-model:checked="appStore.settings.revOrder">
                Обратный порядок (сначала новые)
              </n-checkbox>
            </n-space>
          </n-form-item>

          <n-form-item label="Температура (креативность)" path="temperature">
            <div style="display: flex; align-items: center; width: 100%; gap: 16px;">
              <n-slider v-model:value="appStore.settings.temperature" :min="0.0" :max="2.0" :step="0.05" style="flex: 1;" />
              <n-input-number v-model:value="appStore.settings.temperature" :min="0.0" :max="2.0" :step="0.05" size="small" style="width: 100px" />
            </div>
            <template #feedback>
              Влияет на креативность ответов. Значение по умолчанию: 1.1
            </template>
          </n-form-item>

          <n-form-item label="Системный промпт для нейросети" path="systemPrompt">
            <n-input
              v-model:value="systemPromptDraft"
              type="textarea"
              :autosize="{ minRows: 5, maxRows: 12 }"
              placeholder="Оставьте пустым для сброса к стандартному промпту"
            />
            <template #feedback>
              Инструкция для модели. Если очистить и сохранить — вернётся стандартный промпт.
            </template>
          </n-form-item>

          <n-space justify="end">
            <n-button @click="handleReset">
              Сбросить
            </n-button>
            <n-button type="primary" :loading="saving" @click="handleSave">
              Сохранить
            </n-button>
          </n-space>
        </n-form>

        <n-divider />

        <!-- Информация -->
        <n-space vertical>
          <h3>Как получить VK Token</h3>
          <ol>
            <li>Перейдите на <n-a href="https://vkhost.github.io/" target="_blank">vkhost.github.io</n-a></li>
            <li>Выберите <strong>VK Admin</strong> (или другое приложение)</li>
            <li>Нажмите <strong>Разрешить</strong> и скопируйте токен из адресной строки</li>
          </ol>

          <h3>Требования к модели</h3>
          <ul>
            <li>Модель должна поддерживать vision (распознавание изображений)</li>
            <li>Рекомендуемая модель: <strong>zai-org/glm-4.6v-flash</strong></li>
            <li>LMStudio должен быть запущен на порту 1234</li>
          </ul>
        </n-space>
      </n-space>
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import type { FormInst, FormRules } from 'naive-ui';
import {
  NCard,
  NSpace,
  NForm,
  NFormItem,
  NInput,
  NInputNumber,
  NSlider,
  NButton,
  NAlert,
  NDivider,
  NA,
  NRadioGroup,
  NRadio,
  NCheckbox,
  NAutoComplete,
  useMessage,
} from 'naive-ui';
import { invoke } from '@tauri-apps/api/core';
import { useAppStore, DEFAULT_SYSTEM_PROMPT } from '@/stores/app';

const message = useMessage();
const appStore = useAppStore();
const formRef = ref<FormInst | null>(null);
const saving = ref(false);
const loadingModels = ref(false);
const availableModels = ref<string[]>([]);

// Локальное поле для редактирования — не трогает store напрямую
const systemPromptDraft = ref(appStore.settings.systemPrompt || DEFAULT_SYSTEM_PROMPT);

const rules: FormRules = {
  vkToken: { required: true, message: 'Введите VK Token', trigger: 'blur' },
  vkAlbumId: { required: true, message: 'Введите ID альбома', trigger: 'blur' },
};

const modelOptions = computed(() => {
  return availableModels.value.map((m) => {
    return {
      label: m,
      value: m,
    };
  });
});

onMounted(() => {
  handleModelsFetch();
});

async function handleSave(): Promise<void> {
  saving.value = true;
  try {
    await formRef.value?.validate();
    const s = appStore.settings;
    const systemPrompt = systemPromptDraft.value.trim() || DEFAULT_SYSTEM_PROMPT;
    const systemPromptToStore = systemPrompt === DEFAULT_SYSTEM_PROMPT ? '' : systemPrompt;
    await invoke('save_settings', {
      settings: {
        vk_token: s.vkToken,
        vk_album_id: s.vkAlbumId,
        vk_owner_id: s.vkOwnerId,
        lmstudio_model: s.lmstudioModel,
        process_with_caption: !!s.processPhotosWithCaption,
        rev_order: !!s.revOrder,
        temperature: s.temperature ?? 1.1,
      },
    });
    appStore.saveSettings({ ...s, systemPrompt: systemPromptToStore });
    systemPromptDraft.value = systemPrompt;
    message.success('Настройки сохранены');
  } catch (e) {
    if (typeof e === 'string') {
      message.error(e);
    }
  } finally {
    saving.value = false;
  }
}

function handleReset(): void {
  appStore.settings = {
    vkToken: '',
    vkAlbumId: '',
    vkOwnerId: '',
    lmstudioModel: 'google/gemma-3-12b',
    processingMode: appStore.settings.processingMode,
    systemPrompt: '',
    processPhotosWithCaption: false,
    revOrder: true,
    temperature: 1.1,
  };
  systemPromptDraft.value = DEFAULT_SYSTEM_PROMPT;
}

async function handleModelsFetch(): Promise<void> {
  if (loadingModels.value) {
    return;
  }

  loadingModels.value = true;
  try {
    const models = await invoke<string[]>('list_lmstudio_models');
    availableModels.value = models;
  } catch (e) {
    console.warn('Failed to fetch models from LMStudio:', e);
  } finally {
    loadingModels.value = false;
  }
}
</script>

<style scoped lang="scss">
.settings-view {
  height: 100%;
  padding: $spacing-lg;
  overflow-y: auto;
}

.settings-card {
  max-width: 800px;
  margin: 0 auto;
}

h3 {
  margin-top: $spacing-md;
  margin-bottom: $spacing-sm;
  font-size: 16px;
  color: var(--n-text-color);
}

ol, ul {
  margin-left: $spacing-lg;
  color: var(--n-text-color);

  li {
    margin-bottom: $spacing-xs;
  }
}
</style>
