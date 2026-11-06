<template>
  <div class="settings-view">
    <n-card title="Настройки приложения" class="settings-card">
      <n-space vertical size="large">
        <n-alert type="info" title="LMStudio">
          Убедитесь, что LMStudio запущен и vision модель загружена перед
          началом работы.
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

          <n-form-item label="VK Token" path="vkToken">
            <n-alert type="info" :bordered="false">
              <template #header>Как получить VK Token</template>
              <ol>
                <li>
                  Перейдите на
                  <n-a href="https://vkhost.github.io/" target="_blank"
                    >vkhost.github.io</n-a
                  >
                </li>
                <li>
                  Выберите <strong>VK Admin</strong> (или другое приложение)
                </li>
                <li>
                  Нажмите <strong>Разрешить</strong> и скопируйте токен из
                  адресной строки
                </li>
              </ol>
            </n-alert>
          </n-form-item>

          <n-form-item label="VK Album ID" path="vkAlbumId">
            <n-select
              v-model:value="appStore.settings.vkAlbumId"
              filterable
              tag
              :options="albumOptions"
              :loading="loadingAlbums"
              :render-label="renderAlbumLabel"
              placeholder="100 (или выберите)"
              @focus="handleAlbumsFetch"
            />
          </n-form-item>

          <n-form-item label="VK Owner ID" path="vkOwnerId">
            <n-input
              v-model:value="appStore.settings.vkOwnerId"
              placeholder="Опционально"
            />
            <template #feedback>
              ID владельца, если альбом не ваш. Оставьте пустым для своих
              альбомов.
            </template>
          </n-form-item>

          <n-form-item label="LMStudio Model" path="lmstudioModel">
            <n-auto-complete
              v-model:value="appStore.settings.lmstudioModel"
              :options="modelOptions"
              :loading="loadingModels"
              placeholder="google/gemma-3-12b"
              clearable
              :get-show="() => true"
              @focus="handleModelsFetch"
            />
            <template #feedback>
              Модель должна поддерживать vision (распознавание изображений)
            </template>
          </n-form-item>

          <n-form-item label="LM Studio Token (опционально)" path="lmstudioToken">
            <n-input
              v-model:value="appStore.settings.lmstudioToken"
              type="password"
              placeholder="sk-..."
              show-password-on="click"
              clearable
            />
            <template #feedback>
              Необходим для использования MCP инструментов в LM Studio
            </template>
          </n-form-item>

          <n-form-item label="Интеграции (JSON)" path="lmstudioIntegrations">
            <n-input
              v-model:value="appStore.settings.lmstudioIntegrations"
              type="textarea"
              :autosize="{ minRows: 3, maxRows: 10 }"
              placeholder='[
  {
    type: "plugin",
    id: "mcp/deepdanbooru",
    allowed_tools: ["tag_image"]
  }
]'
            />
            <template #feedback>
              JSON массив интеграций (например, MCP). Передаётся напрямую в поле `integrations` API LM Studio.
            </template>
          </n-form-item>

          <n-form-item label="Режим передачи изображения">
            <n-radio-group v-model:value="appStore.settings.imageTransmissionMode">
              <n-space>
                <n-radio value="direct">Прямая передача (Base64)</n-radio>
                <n-radio value="path">Передавать URL (путь) изображения</n-radio>
                <n-radio value="mixed">Смешанный (Base64 + URL)</n-radio>
              </n-space>
            </n-radio-group>
            <template #feedback>
              "Прямая передача" отправляет само изображение. "Передавать URL" отправляет ссылку (работает быстрее). "Смешанный" передает и само изображение, и ссылку.
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

          <n-form-item label="Пауза перед сохранением в VK">
            <n-space align="center">
              <span>от</span>
              <n-input-number
                v-model:value="appStore.settings.saveDelayMinSec"
                :min="0"
                :max="600"
                size="small"
                style="width: 110px"
              />
              <span>до</span>
              <n-input-number
                v-model:value="appStore.settings.saveDelayMaxSec"
                :min="0"
                :max="600"
                size="small"
                style="width: 110px"
              />
              <span>секунд</span>
            </n-space>
            <template #feedback>
              Случайная задержка перед каждой записью описания в VK, сверх
              времени генерации. Нужна, чтобы VK не принял поток правок за
              взлом. Ревью и ваши раздумья в ручном режиме идут в счёт этой
              паузы.
            </template>
          </n-form-item>

          <n-form-item label="Лимит сохранений за запуск">
            <n-input-number
              v-model:value="appStore.settings.maxSavesPerRun"
              :min="0"
              :max="10000"
              size="small"
              style="width: 140px"
            />
            <template #feedback>
              Сколько описаний разрешено записать в VK за один запуск. VK смотрит
              не только на частоту правок, но и на их количество за день, поэтому
              большой альбом лучше проходить за несколько заходов. 0 — без
              лимита.
            </template>
          </n-form-item>

          <n-form-item label="Предгенерация в ручном режиме">
            <n-input-number
              v-model:value="appStore.settings.prefetchCount"
              :min="0"
              :max="10"
              size="small"
              style="width: 110px"
            />
            <template #feedback>
              Сколько следующих описаний готовить в фоне, пока вы смотрите
              текущее. Ничего не сохраняется, только подготавливается. 0 —
              выключено.
            </template>
          </n-form-item>

          <n-form-item label="Авто-ревью описаний">
            <n-space vertical style="width: 100%">
              <n-checkbox v-model:checked="appStore.settings.autoReviewEnabled">
                Проверять готовое описание второй моделью и перегенерировать с
                замечанием
              </n-checkbox>
              <n-space v-if="appStore.settings.autoReviewEnabled" align="center">
                <span>Попыток перегенерации:</span>
                <n-input-number
                  v-model:value="appStore.settings.reviewMaxRetries"
                  :min="1"
                  :max="5"
                  size="small"
                  style="width: 110px"
                />
              </n-space>
              <div
                v-if="appStore.settings.autoReviewEnabled"
                style="display: flex; align-items: center; width: 100%; gap: 16px"
              >
                <span style="white-space: nowrap">Температура ревью:</span>
                <n-slider
                  v-model:value="appStore.settings.reviewTemperature"
                  :min="0.0"
                  :max="2.0"
                  :step="0.05"
                  style="flex: 1"
                />
                <n-input-number
                  v-model:value="appStore.settings.reviewTemperature"
                  :min="0.0"
                  :max="2.0"
                  :step="0.05"
                  size="small"
                  style="width: 100px"
                />
              </div>
            </n-space>
            <template #feedback>
              Ревьюеру креативность не нужна: чем ниже температура, тем
              стабильнее вердикт. По умолчанию 0.3.
            </template>
          </n-form-item>

          <n-form-item
            v-if="appStore.settings.autoReviewEnabled"
            label="Промпт ревью"
            path="reviewPrompt"
          >
            <n-input
              v-model:value="reviewPromptDraft"
              type="textarea"
              :autosize="{ minRows: 4, maxRows: 12 }"
              placeholder="Оставьте пустым для сброса к стандартному промпту ревью"
            />
            <template #feedback>
              Ревьюер видит картинку, правила из системного промпта и готовое
              описание. Отвечать он должен JSON-объектом с полями ok и comment.
            </template>
          </n-form-item>

          <n-form-item label="Загрузка фото">
            <n-space vertical>
              <n-checkbox
                v-model:checked="appStore.settings.processPhotosWithCaption"
              >
                Обрабатывать фото с уже заполненным описанием
              </n-checkbox>
              <n-checkbox v-model:checked="appStore.settings.revOrder">
                Обратный порядок (сначала новые)
              </n-checkbox>
            </n-space>
          </n-form-item>

          <n-form-item label="Температура (креативность)" path="temperature">
            <div
              style="display: flex; align-items: center; width: 100%; gap: 16px"
            >
              <n-slider
                v-model:value="appStore.settings.temperature"
                :min="0.0"
                :max="2.0"
                :step="0.05"
                style="flex: 1"
              />
              <n-input-number
                v-model:value="appStore.settings.temperature"
                :min="0.0"
                :max="2.0"
                :step="0.05"
                size="small"
                style="width: 100px"
              />
            </div>
            <template #feedback>
              Влияет на креативность ответов. Значение по умолчанию: 1.1
            </template>
          </n-form-item>

          <n-form-item
            label="Системный промпт для нейросети"
            path="systemPrompt"
          >
            <n-input
              v-model:value="systemPromptDraft"
              type="textarea"
              :autosize="{ minRows: 5, maxRows: 12 }"
              placeholder="Оставьте пустым для сброса к стандартному промпту"
            />
            <template #feedback>
              Инструкция для модели. Если очистить и сохранить — вернётся
              стандартный промпт.
            </template>
          </n-form-item>

          <n-space justify="end" align="center">
            <n-text v-if="isDirty" type="warning">
              Есть несохранённые изменения
            </n-text>
            <n-button @click="handleReset"> Сбросить </n-button>
            <n-button type="primary" :loading="saving" @click="handleSave">
              Сохранить
            </n-button>
          </n-space>
        </n-form>

        <n-divider />

        <!-- Требования к модели -->
        <n-space vertical>
          <h3>Требования к модели</h3>
          <ul>
            <li>
              Модель должна поддерживать vision (распознавание изображений)
            </li>
            <li>
              Рекомендуемая модель: <strong>google/gemma-4-31b</strong>
            </li>
            <li>LMStudio должен быть запущен на порту 1234</li>
          </ul>
        </n-space>
      </n-space>
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, h } from "vue";
import { onBeforeRouteLeave } from "vue-router";
import type { FormInst, FormRules } from "naive-ui";
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
  NSelect,
  NAvatar,
  NText,
  useMessage,
  useDialog,
} from "naive-ui";
import { invoke } from "@tauri-apps/api/core";
import type { AppSettings } from "@/stores/app";
import {
  useAppStore,
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_REVIEW_PROMPT,
  DEFAULT_REVIEW_RETRIES,
  DEFAULT_REVIEW_TEMPERATURE,
  DEFAULT_SAVE_DELAY_MIN_SEC,
  DEFAULT_SAVE_DELAY_MAX_SEC,
  DEFAULT_PREFETCH_COUNT,
  DEFAULT_MAX_SAVES_PER_RUN,
} from "@/stores/app";
import { useLmstudioModels } from "@/composables/useLmstudioModels";

const message = useMessage();
const dialog = useDialog();
const appStore = useAppStore();
const { loadingModels, modelOptions, handleModelsFetch } = useLmstudioModels();
const formRef = ref<FormInst | null>(null);
const saving = ref(false);
const loadingAlbums = ref(false);
const albumOptions = ref<
  Array<{ label: string; value: string; thumb?: string; size?: number }>
>([]);

// Локальные поля для редактирования — не трогают store напрямую
const systemPromptDraft = ref(
  appStore.settings.systemPrompt || DEFAULT_SYSTEM_PROMPT,
);
const reviewPromptDraft = ref(
  appStore.settings.reviewPrompt || DEFAULT_REVIEW_PROMPT,
);

// Снимок того, что реально отправлено в Rust: с ним сравниваем поля формы
const savedSettings = ref<AppSettings>({ ...appStore.settings });
const savedPrompt = ref(systemPromptDraft.value);
const savedReviewPrompt = ref(reviewPromptDraft.value);

const isDirty = computed(
  () =>
    snapshotOf(
      appStore.settings,
      systemPromptDraft.value,
      reviewPromptDraft.value,
    ) !==
    snapshotOf(savedSettings.value, savedPrompt.value, savedReviewPrompt.value),
);

const rules: FormRules = {
  vkToken: { required: true, message: "Введите VK Token", trigger: "blur" },
  vkAlbumId: { required: true, message: "Введите ID альбома", trigger: "blur" },
};



interface VkAlbum {
  id: number;
  title: string;
  size: number;
  thumb_src?: string;
}

const renderAlbumLabel = (option: {
  label: string;
  value: string;
  thumb?: string;
  size?: number;
}) => {
  return h(
    "div",
    { style: { display: "flex", alignItems: "center", gap: "8px" } },
    [
      option.thumb
        ? h(NAvatar, {
            src: option.thumb,
            size: "small",
            style: { flexShrink: 0 },
          })
        : h(NAvatar, { size: "small", style: { flexShrink: 0 } }),
      h("div", null, [
        h("div", null, option.label),
        option.size !== undefined
          ? h(
              "div",
              { style: { fontSize: "12px", color: "#888" } },
              `Фото: ${option.size}`,
            )
          : null,
      ]),
    ],
  );
};

onMounted(handleModelsFetch);

onBeforeRouteLeave(async () => {
  if (!isDirty.value) {
    return true;
  }

  console.log("[Settings] Выход со страницы с несохранёнными настройками");

  return await confirmLeave();
});

async function handleSave(): Promise<boolean> {
  saving.value = true;
  try {
    await formRef.value?.validate();
    const s = appStore.settings;
    const systemPrompt =
      systemPromptDraft.value.trim() || DEFAULT_SYSTEM_PROMPT;
    const systemPromptToStore =
      systemPrompt === DEFAULT_SYSTEM_PROMPT ? "" : systemPrompt;
    const reviewPrompt =
      reviewPromptDraft.value.trim() || DEFAULT_REVIEW_PROMPT;
    const reviewPromptToStore =
      reviewPrompt === DEFAULT_REVIEW_PROMPT ? "" : reviewPrompt;
    await invoke("save_settings", {
      settings: {
        vk_token: s.vkToken,
        vk_album_id: s.vkAlbumId,
        vk_owner_id: s.vkOwnerId,
        lmstudio_model: s.lmstudioModel,
        lmstudio_token: s.lmstudioToken || "",
        process_with_caption: !!s.processPhotosWithCaption,
        rev_order: !!s.revOrder,
        temperature: s.temperature ?? 1.1,
        image_transmission_mode: s.imageTransmissionMode ?? "direct",
        lmstudio_integrations: s.lmstudioIntegrations ?? "",
      },
    });
    appStore.saveSettings({
      ...s,
      systemPrompt: systemPromptToStore,
      reviewPrompt: reviewPromptToStore,
    });
    systemPromptDraft.value = systemPrompt;
    reviewPromptDraft.value = reviewPrompt;
    savedSettings.value = { ...appStore.settings };
    savedPrompt.value = systemPrompt;
    savedReviewPrompt.value = reviewPrompt;
    message.success("Настройки сохранены");

    return true;
  } catch (e) {
    console.error("[Settings] Не удалось сохранить настройки", e);
    if (typeof e === "string") {
      message.error(e);
    }

    return false;
  } finally {
    saving.value = false;
  }
}

function handleReset(): void {
  appStore.settings = {
    vkToken: "",
    vkAlbumId: "",
    vkOwnerId: "",
    lmstudioModel: "google/gemma-3-12b",
    lmstudioToken: "",
    imageTransmissionMode: "direct",
    processingMode: appStore.settings.processingMode,
    systemPrompt: "",
    processPhotosWithCaption: false,
    revOrder: true,
    temperature: 1.1,
    lmstudioIntegrations: "",
    autoReviewEnabled: false,
    reviewPrompt: "",
    reviewMaxRetries: DEFAULT_REVIEW_RETRIES,
    reviewTemperature: DEFAULT_REVIEW_TEMPERATURE,
    saveDelayMinSec: DEFAULT_SAVE_DELAY_MIN_SEC,
    saveDelayMaxSec: DEFAULT_SAVE_DELAY_MAX_SEC,
    prefetchCount: DEFAULT_PREFETCH_COUNT,
    maxSavesPerRun: DEFAULT_MAX_SAVES_PER_RUN,
  };
  systemPromptDraft.value = DEFAULT_SYSTEM_PROMPT;
  reviewPromptDraft.value = DEFAULT_REVIEW_PROMPT;
}

// Строковый слепок формы с фиксированным порядком полей — сравнивать объекты напрямую нельзя,
// потому что handleReset пересоздаёт настройки с другим порядком ключей
function snapshotOf(
  settings: AppSettings,
  prompt: string,
  reviewPrompt: string,
): string {
  return JSON.stringify([
    settings.vkToken,
    settings.vkAlbumId,
    settings.vkOwnerId,
    settings.lmstudioModel,
    settings.lmstudioToken ?? "",
    settings.lmstudioIntegrations ?? "",
    settings.imageTransmissionMode ?? "direct",
    settings.processingMode,
    !!settings.processPhotosWithCaption,
    settings.revOrder !== false,
    settings.temperature ?? 1.1,
    !!settings.autoReviewEnabled,
    settings.reviewMaxRetries ?? DEFAULT_REVIEW_RETRIES,
    settings.reviewTemperature ?? DEFAULT_REVIEW_TEMPERATURE,
    settings.saveDelayMinSec ?? DEFAULT_SAVE_DELAY_MIN_SEC,
    settings.saveDelayMaxSec ?? DEFAULT_SAVE_DELAY_MAX_SEC,
    settings.prefetchCount ?? DEFAULT_PREFETCH_COUNT,
    settings.maxSavesPerRun ?? DEFAULT_MAX_SAVES_PER_RUN,
    prompt.trim() || DEFAULT_SYSTEM_PROMPT,
    reviewPrompt.trim() || DEFAULT_REVIEW_PROMPT,
  ]);
}

// Возвращаем форму к последнему сохранённому состоянию, чтобы store не разъезжался с Rust
function discardChanges(): void {
  appStore.settings = { ...savedSettings.value };
  systemPromptDraft.value = savedPrompt.value;
  reviewPromptDraft.value = savedReviewPrompt.value;
}

function confirmLeave(): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (leave: boolean): void => {
      if (!settled) {
        settled = true;
        resolve(leave);
      }
    };

    dialog.warning({
      title: "Настройки не сохранены",
      content:
        "Изменения останутся только в форме: приложение обращается к VK и LM Studio с последними сохранёнными настройками.",
      positiveText: "Сохранить и выйти",
      negativeText: "Выйти без сохранения",
      onPositiveClick: async () => {
        const saved = await handleSave();
        settle(saved);

        // false оставляет диалог открытым, если сохранение не прошло валидацию
        return saved;
      },
      onNegativeClick: () => {
        discardChanges();
        settle(true);
      },
      onClose: () => settle(false),
      onMaskClick: () => settle(false),
      onEsc: () => settle(false),
    });
  });
}



function fetchJsonp<T>(url: string, callbackName: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");

    (window as unknown as Record<string, (data: T) => void>)[callbackName] = (
      data: T,
    ) => {
      resolve(data);
      document.body.removeChild(script);
      delete (window as unknown as Record<string, (data: T) => void>)[
        callbackName
      ];
    };

    script.src = url;
    script.onerror = () => {
      reject(new Error("JSONP failed"));
      document.body.removeChild(script);
      delete (window as unknown as Record<string, (data: T) => void>)[
        callbackName
      ];
    };

    document.body.appendChild(script);
  });
}

async function handleAlbumsFetch(): Promise<void> {
  if (loadingAlbums.value || !appStore.settings.vkToken) {
    return;
  }

  loadingAlbums.value = true;

  try {
    const fnName =
      "vk_cb_" +
      Date.now().toString() +
      Math.floor(Math.random() * 1000).toString();
    const token = appStore.settings.vkToken;
    let url = `https://api.vk.com/method/photos.getAlbums?v=5.199&need_covers=1&need_system=1&albums_ids=-15&access_token=${token}&callback=${fnName}`;

    if (appStore.settings.vkOwnerId) {
      url += `&owner_id=${appStore.settings.vkOwnerId}`;
    }

    interface VkResponse {
      response?: {
        items: VkAlbum[];
      };
      error?: {
        error_msg: string;
      };
    }

    const response = await fetchJsonp<VkResponse>(url, fnName);

    if (response.response && response.response.items) {
      albumOptions.value = response.response.items.map((album: VkAlbum) => {
        return {
          label: album.title,
          value: String(album.id),
          thumb: album.thumb_src,
          size: album.size,
        };
      });
    } else if (response.error) {
      console.warn("VK API error:", response.error);
      message.error(`Ошибка VK: ${response.error.error_msg}`);
    }
  } catch (e) {
    console.error("Failed to fetch albums:", e);
  } finally {
    loadingAlbums.value = false;
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

ol,
ul {
  margin-left: $spacing-lg;
  color: var(--n-text-color);

  li {
    margin-bottom: $spacing-xs;
  }
}
</style>
