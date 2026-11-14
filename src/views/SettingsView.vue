<template>
  <div class="settings-view">
    <div class="settings-page">
      <!-- Панель действий закреплена сверху: до «Сохранить» не надо скроллить -->
      <div
        class="settings-bar"
        :style="{
          background: themeVars.bodyColor,
          borderColor: themeVars.dividerColor,
        }"
      >
        <div class="settings-bar__title">
          <h2>Настройки</h2>
          <n-text v-if="isDirty" type="warning" class="settings-bar__hint">
            Есть несохранённые изменения
          </n-text>
          <n-text v-else depth="3" class="settings-bar__hint">
            Всё сохранено
          </n-text>
        </div>

        <n-space align="center">
          <n-button quaternary @click="confirmReset">Сбросить</n-button>
          <n-tooltip>
            <template #trigger>
              <n-button type="primary" :loading="saving" @click="handleSave">
                <template #icon>
                  <n-icon :component="SaveIcon" />
                </template>
                Сохранить
              </n-button>
            </template>
            Ctrl + S
          </n-tooltip>
        </n-space>
      </div>

      <n-card class="settings-card">
        <n-form
          ref="formRef"
          :model="appStore.settings"
          :rules="rules"
          label-placement="top"
        >
          <!-- display-directive="show": скрытые вкладки остаются в форме,
               иначе их обязательные поля выпадают из валидации -->
          <n-tabs
            v-model:value="activeTab"
            type="line"
            animated
            display-directive="show"
          >
          <n-tab-pane name="vk" tab="ВКонтакте">
            <n-form-item label="Вход ВКонтакте">
              <n-input-group>
                <n-input
                  v-model:value="appStore.settings.vkAppId"
                  placeholder="ID приложения VK"
                />
                <n-button
                  type="primary"
                  :loading="loggingIn"
                  @click="handleVkLogin"
                >
                  Получить токен
                </n-button>
              </n-input-group>
              <template #feedback>
                Сначала откроется обычный vk.com: войдите, и окно само перейдёт
                к выдаче токена. Токен достаётся вебвью программы, от которого
                потом уходят запросы к API — VK видит один и тот же клиент.
                Не забудьте нажать «Сохранить».
              </template>
            </n-form-item>

            <n-form-item label="VK Token" path="vkToken">
              <n-space vertical style="width: 100%">
                <n-input-group>
                  <n-input
                    v-model:value="appStore.settings.vkToken"
                    type="password"
                    placeholder="vk1.a..."
                    show-password-on="click"
                  />
                  <n-button :loading="checkingToken" @click="handleCheckToken">
                    <template #icon>
                      <n-icon :component="CheckIcon" />
                    </template>
                    Проверить
                  </n-button>
                </n-input-group>
                <n-text
                  v-if="tokenStatus"
                  :type="tokenStatus.ok ? 'success' : 'error'"
                  style="font-size: 13px"
                >
                  {{ tokenStatus.text }}
                </n-text>
              </n-space>
            </n-form-item>

            <n-form-item label="Альбом" path="vkAlbumId">
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

            <n-form-item label="Owner ID" path="vkOwnerId">
              <n-input
                v-model:value="appStore.settings.vkOwnerId"
                placeholder="Опционально"
              />
              <template #feedback>
                ID владельца, если альбом не ваш. Оставьте пустым для своих
                альбомов.
              </template>
            </n-form-item>

            <n-form-item label="Какие фото брать">
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

            <n-collapse>
              <n-collapse-item title="Как получить VK Token" name="howto">
                <ol>
                  <li>
                    Создайте Standalone-приложение на
                    <n-a href="https://dev.vk.com/" target="_blank">dev.vk.com</n-a>
                    и возьмите его ID
                  </li>
                  <li>
                    Впишите ID в поле «Вход ВКонтакте» и нажмите
                    <strong>Получить токен</strong>
                  </li>
                  <li>
                    Войдите в открывшемся окне и нажмите
                    <strong>Разрешить</strong> — токен подставится сам
                  </li>
                </ol>
                <n-alert type="warning" :bordered="false">
                  Не берите токен официального клиента (из сессии vk.com) и
                  готовые токены вроде VK Admin: они дают доступ к сообщениям,
                  стене и группам, а запросы к API не из браузера с таким
                  токеном антифрод VK принимает за кражу сессии. Собственное
                  приложение со <code>scope=photos,offline</code> безопаснее.
                </n-alert>
              </n-collapse-item>
            </n-collapse>
          </n-tab-pane>

          <n-tab-pane name="model" tab="Модель">
            <n-alert type="info" title="LM Studio" style="margin-bottom: 16px">
              LM Studio должен быть запущен на порту 1234, а модель —
              поддерживать vision. Рекомендуемая:
              <strong>google/gemma-4-31b</strong>.
            </n-alert>

            <n-form-item label="Модель" path="lmstudioModel">
              <n-auto-complete
                v-model:value="appStore.settings.lmstudioModel"
                :options="modelOptions"
                :loading="loadingModels"
                placeholder="google/gemma-3-12b"
                clearable
                :get-show="() => true"
                @focus="handleModelsFetch"
              />
            </n-form-item>

            <n-form-item label="Температура генерации" path="temperature">
              <div class="slider-row">
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
                Влияет на креативность ответов. По умолчанию 1.1
              </template>
            </n-form-item>

            <n-form-item label="Режим передачи изображения">
              <n-radio-group
                v-model:value="appStore.settings.imageTransmissionMode"
              >
                <n-space>
                  <n-radio value="direct">Base64</n-radio>
                  <n-radio value="path">Только URL</n-radio>
                  <n-radio value="mixed">Base64 + URL</n-radio>
                </n-space>
              </n-radio-group>
              <template #feedback>
                Base64 отправляет само изображение, URL работает быстрее,
                смешанный режим передаёт и то и другое.
              </template>
            </n-form-item>

            <n-form-item
              label="Токен LM Studio (опционально)"
              path="lmstudioToken"
            >
              <n-input
                v-model:value="appStore.settings.lmstudioToken"
                type="password"
                placeholder="sk-..."
                show-password-on="click"
                clearable
              />
              <template #feedback>
                Нужен для MCP-инструментов в LM Studio
              </template>
            </n-form-item>

            <n-form-item label="Интеграции (JSON)" path="lmstudioIntegrations">
              <n-input
                v-model:value="appStore.settings.lmstudioIntegrations"
                type="textarea"
                :autosize="{ minRows: 3, maxRows: 10 }"
                placeholder='[{ "type": "plugin", "id": "mcp/имя", "allowed_tools": ["инструмент"] }]'
              />
              <template #feedback>
                JSON-массив интеграций, уходит в поле `integrations` API LM
                Studio.
              </template>
            </n-form-item>
          </n-tab-pane>

          <n-tab-pane name="run" tab="Обработка">
            <n-form-item label="Режим">
              <n-radio-group v-model:value="appStore.settings.processingMode">
                <n-space>
                  <n-radio value="auto">Автоматический</n-radio>
                  <n-radio value="manual">Ручной</n-radio>
                </n-space>
              </n-radio-group>
              <template #feedback>
                Ручной режим показывает окно подтверждения перед каждым
                сохранением
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
                Случайная задержка перед каждой записью, сверх времени
                генерации: поток правок без пауз VK принимает за взлом. Ревью и
                раздумья в ручном режиме идут в счёт этой паузы.
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
                VK смотрит и на число правок за день, поэтому большой альбом
                лучше проходить за несколько заходов. 0 — без лимита.
              </template>
            </n-form-item>

            <n-form-item label="Предгенерация в ручном режиме">
              <n-input-number
                v-model:value="appStore.settings.prefetchCount"
                :min="0"
                :max="10"
                size="small"
                style="width: 140px"
              />
              <template #feedback>
                Сколько следующих описаний готовить в фоне, пока вы смотрите
                текущее. Ничего не сохраняется, только подготавливается. 0 —
                выключено.
              </template>
            </n-form-item>
          </n-tab-pane>

          <n-tab-pane name="review" tab="Ревью">
            <n-form-item label="Авто-ревью">
              <n-checkbox v-model:checked="appStore.settings.autoReviewEnabled">
                Проверять готовое описание моделью и перегенерировать с
                замечанием
              </n-checkbox>
              <template #feedback>
                Модель второй раз смотрит на картинку, сверяет описание с
                правилами и при расхождении пишет замечание — оно уходит в
                перегенерацию так же, как ваш комментарий в ручном режиме. Цена
                — ещё один-два запроса к модели на каждое фото.
              </template>
            </n-form-item>

            <template v-if="appStore.settings.autoReviewEnabled">
              <n-form-item label="Попыток перегенерации">
                <n-input-number
                  v-model:value="appStore.settings.reviewMaxRetries"
                  :min="1"
                  :max="5"
                  size="small"
                  style="width: 140px"
                />
              </n-form-item>

              <n-form-item label="Температура ревью">
                <div class="slider-row">
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
                <template #feedback>
                  Ревьюеру креативность не нужна: чем ниже, тем стабильнее
                  вердикт. По умолчанию 0.3
                </template>
              </n-form-item>

              <n-form-item label="Промпт ревью" path="reviewPrompt">
                <n-input
                  v-model:value="reviewPromptDraft"
                  type="textarea"
                  :autosize="{ minRows: 6, maxRows: 16 }"
                  placeholder="Оставьте пустым для сброса к стандартному промпту ревью"
                />
                <template #feedback>
                  Ревьюер видит картинку, правила из системного промпта и
                  готовое описание. Отвечать должен JSON-объектом с полями ok и
                  comment.
                </template>
              </n-form-item>
            </template>
          </n-tab-pane>

          <n-tab-pane name="prompt" tab="Промпт">
            <n-form-item label="Системный промпт" path="systemPrompt">
              <n-input
                v-model:value="systemPromptDraft"
                type="textarea"
                :autosize="{ minRows: 12, maxRows: 28 }"
                placeholder="Оставьте пустым для сброса к стандартному промпту"
              />
              <template #feedback>
                Инструкция для модели. Если очистить и сохранить — вернётся
                стандартный промпт.
              </template>
            </n-form-item>
          </n-tab-pane>
          </n-tabs>
        </n-form>
      </n-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, h } from "vue";
import { onBeforeRouteLeave } from "vue-router";
import { onKeyStroke } from "@vueuse/core";
import type { FormInst, FormRules } from "naive-ui";
import {
  NCard,
  NSpace,
  NForm,
  NFormItem,
  NInput,
  NInputGroup,
  NInputNumber,
  NSlider,
  NButton,
  NAlert,
  NA,
  NRadioGroup,
  NRadio,
  NCheckbox,
  NAutoComplete,
  NSelect,
  NAvatar,
  NText,
  NIcon,
  NTabs,
  NTabPane,
  NTooltip,
  NCollapse,
  NCollapseItem,
  useMessage,
  useDialog,
  useThemeVars,
} from "naive-ui";
import {
  SaveOutline as SaveIcon,
  ShieldCheckmarkOutline as CheckIcon,
} from "@vicons/ionicons5";
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
const themeVars = useThemeVars();
const appStore = useAppStore();
const { loadingModels, modelOptions, handleModelsFetch } = useLmstudioModels();
const formRef = ref<FormInst | null>(null);
const activeTab = ref("vk");
const saving = ref(false);
const loadingAlbums = ref(false);
const checkingToken = ref(false);
const loggingIn = ref(false);
const tokenStatus = ref<{ ok: boolean; text: string } | null>(null);
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

interface VkError {
  error_msg: string;
}

onMounted(handleModelsFetch);

// Альбомы и статус относятся к прежнему токену, с новым они уже неправда
watch(
  () => appStore.settings.vkToken,
  () => {
    tokenStatus.value = null;
    albumOptions.value = [];
  },
);

onKeyStroke(["s", "S", "ы", "Ы"], (e) => {
  if ((!e.ctrlKey && !e.metaKey) || saving.value) {
    return;
  }

  e.preventDefault();
  handleSave();
});

onBeforeRouteLeave(async () => {
  if (!isDirty.value) {
    return true;
  }

  console.log("[Settings] Выход со страницы с несохранёнными настройками");

  return await confirmLeave();
});

function renderAlbumLabel(option: {
  label: string;
  value: string;
  thumb?: string;
  size?: number;
}) {
  return h(
    "div",
    { style: { display: "flex", alignItems: "center", gap: "8px" } },
    [
      h(NAvatar, {
        src: option.thumb,
        size: "small",
        style: { flexShrink: 0 },
      }),
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
}

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

    // Валидация naive-ui отклоняется массивом ошибок, всё остальное — сбой самого сохранения
    if (Array.isArray(e)) {
      activeTab.value = "vk";
      message.error("Проверьте обязательные поля");
    } else {
      message.error(typeof e === "string" ? e : String(e));
    }

    return false;
  } finally {
    saving.value = false;
  }
}

// Кнопка стоит вплотную к «Сохранить», а стирает токен и промпты — спрашиваем
function confirmReset(): void {
  dialog.warning({
    title: "Сбросить настройки?",
    content:
      "Токен, альбом и промпты вернутся к значениям по умолчанию. Сохранённые настройки останутся, пока вы не нажмёте «Сохранить».",
    positiveText: "Сбросить",
    negativeText: "Отмена",
    onPositiveClick: handleReset,
  });
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
    settings.vkAppId ?? "",
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

// VK отдаёт JSONP, поэтому запросы из формы идут мимо Rust — так видно живой ли токен
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

function vkCallbackName(): string {
  return `vk_cb_${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

async function handleVkLogin(): Promise<void> {
  loggingIn.value = true;

  try {
    const token = await invoke<string>("vk_login", {
      clientId: appStore.settings.vkAppId ?? "",
    });
    appStore.settings.vkToken = token;
    message.success("Токен получен, не забудьте сохранить");
  } catch (e) {
    console.error("[Settings] Вход ВКонтакте не удался", e);
    message.error(typeof e === "string" ? e : String(e));
  } finally {
    loggingIn.value = false;
  }
}

async function handleCheckToken(): Promise<void> {
  const token = appStore.settings.vkToken;
  if (!token) {
    message.warning("Сначала вставьте токен");
    return;
  }

  checkingToken.value = true;

  try {
    const fnName = vkCallbackName();
    const url = `https://api.vk.com/method/users.get?v=5.199&access_token=${token}&callback=${fnName}`;

    interface VkUsersResponse {
      response?: Array<{ first_name: string; last_name: string }>;
      error?: VkError;
    }

    const { response, error } = await fetchJsonp<VkUsersResponse>(url, fnName);
    const user = response?.[0];
    console.log("[Settings] Проверка токена:", response ?? error);

    tokenStatus.value = user
      ? { ok: true, text: `Токен рабочий: ${user.first_name} ${user.last_name}` }
      : { ok: false, text: error?.error_msg ?? "VK не принял токен" };
  } catch (e) {
    console.error("[Settings] Проверка токена не удалась", e);
    tokenStatus.value = { ok: false, text: "Не удалось связаться с VK" };
  } finally {
    checkingToken.value = false;
  }
}

async function handleAlbumsFetch(): Promise<void> {
  if (loadingAlbums.value || !appStore.settings.vkToken) {
    return;
  }

  loadingAlbums.value = true;

  try {
    const fnName = vkCallbackName();
    const token = appStore.settings.vkToken;
    let url = `https://api.vk.com/method/photos.getAlbums?v=5.199&need_covers=1&need_system=1&albums_ids=-15&access_token=${token}&callback=${fnName}`;

    if (appStore.settings.vkOwnerId) {
      url += `&owner_id=${appStore.settings.vkOwnerId}`;
    }

    interface VkAlbumsResponse {
      response?: { items: VkAlbum[] };
      error?: VkError;
    }

    const response = await fetchJsonp<VkAlbumsResponse>(url, fnName);

    if (response.response?.items) {
      albumOptions.value = response.response.items.map((album) => ({
        label: album.title,
        value: String(album.id),
        thumb: album.thumb_src,
        size: album.size,
      }));
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
  overflow-y: auto;
}

.settings-page {
  max-width: 880px;
  margin: 0 auto;
  padding: 0 $spacing-lg $spacing-lg;
}

// Панель живёт над карточкой и прилипает к верху прокрутки,
// поэтому «Сохранить» видно с любой вкладки и на любой прокрутке
.settings-bar {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: $spacing-md;
  margin-bottom: $spacing-md;
  padding: $spacing-md 0;
  border-bottom: 1px solid;

  h2 {
    margin: 0;
    font-size: 18px;
    line-height: 1.2;
  }
}

.settings-bar__title {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.settings-bar__hint {
  font-size: 12px;
}

// Подсказка под полем иначе упирается в заголовок следующего
:deep(.n-form-item-feedback-wrapper) {
  padding-bottom: $spacing-xs;
}

.slider-row {
  display: flex;
  align-items: center;
  width: 100%;
  gap: $spacing-md;
}

ol {
  margin-left: $spacing-lg;
  color: var(--n-text-color);

  li {
    margin-bottom: $spacing-xs;
  }
}
</style>
