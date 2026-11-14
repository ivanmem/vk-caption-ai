import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { delay, random } from 'es-toolkit';
import { useCaptionPrefetch } from '@/composables/useCaptionPrefetch';

export interface PhotoTask {
  id: number;
  owner_id: number;
  album_id: number;
  image_url: string;
  thumb_url: string;
  caption: string;
  status: 'pending' | 'processing' | 'completed' | 'error' | 'skipped';
  error?: string;
  previousCaption?: string;
  // Последнее замечание авто-ревью по этому фото
  reviewComment?: string;
}

export const DEFAULT_SYSTEM_PROMPT = `Вытащи текст со стикера (если есть) и 1-3 слова-тега (эмоция, реакция, смысл).
Верни ТОЛЬКО валидный JSON-массив из строк. Отвечай ИСКЛЮЧИТЕЛЬНО на русском языке.

Правила:
1. Пиши ТОЛЬКО на русском. Последним элементом массива ВСЕГДА добавляй один наиболее подходящий смайлик (эмодзи).
2. Первый элемент: если на стикере есть текст — напиши его дословно. Если текста нет — первым элементом должна быть ГЛАВНАЯ ЭМОЦИЯ или СМЫСЛ (например: "радость", "грусть", "гнев", "злость", "удивление", "шок", "страх", "отвращение", "тошнота", "смех", "любовь", "одобрение", "усталость", "раздражение", "сарказм", "плач", "агрессия", "паника", "тильт", "безысходность", "безумие", "отчаяние", "боль", "тлен", "смущение", "разочарование").
3. ВАЖНО: Анализируй саму картинку, а не только текст! Если текст радостный, а персонаж выглядит жутко, крипово, плачет или страдает — это сарказм. В таком случае теги должны описывать РЕАЛЬНУЮ картинку (например: "отчаяние", "ужас", "безумие", "ирония"), а не слепо верить позитивному тексту.
4. Категорически ЗАПРЕЩЕНО описывать, ЧТО нарисовано (запрещены слова вроде "аниме", "девушка", "кот", "человек", "фон"). Описывай только чувства, реакции и суть!
5. Никакого Markdown ('\`\`\`json' и т.д.), возвращай только чистый код массива.

Пример (без текста на картинке):
["отвращение", "тошнота", "фу", "🤢"]

Пример (с текстом на картинке):
["Ухади", "злость", "прогоняет", "😡"]`;

export const DEFAULT_REVIEW_PROMPT = `Ты — строгий редактор описаний к картинкам.
Тебе дают картинку, правила составления описания и предложенный вариант.
Проверь, что описание соответствует самой картинке и всем правилам.

Верни ТОЛЬКО JSON-объект, без Markdown и пояснений:
{"ok": true} — если описание годится;
{"ok": false, "comment": "что именно не так и что исправить"} — если нет.

Комментарий пиши на русском, коротко и по делу, как указание автору описания.
Не придирайся по мелочам: отклоняй только явные ошибки — описание не про эту картинку,
нарушены правила, есть лишний текст, Markdown или неверный формат.`;

export const DEFAULT_SAVE_DELAY_MIN_SEC = 10;
export const DEFAULT_SAVE_DELAY_MAX_SEC = 60;
export const DEFAULT_REVIEW_RETRIES = 2;
export const DEFAULT_REVIEW_TEMPERATURE = 0.3;
export const DEFAULT_PREFETCH_COUNT = 1;
export const DEFAULT_MAX_SAVES_PER_RUN = 50;

/** Приложение «vk.com»: его ID подставляется в окно входа по умолчанию */
export const DEFAULT_VK_APP_ID = '6287487';

export interface AppSettings {
  vkToken: string;
  /** ID Standalone-приложения VK для входа прямо из программы */
  vkAppId?: string;
  vkAlbumId: string;
  vkOwnerId: string;
  lmstudioModel: string;
  lmstudioToken?: string;
  processingMode: 'auto' | 'manual';
  systemPrompt: string;
  processPhotosWithCaption?: boolean;
  revOrder?: boolean;
  temperature?: number;
  imageTransmissionMode?: 'direct' | 'path' | 'mixed';
  lmstudioIntegrations?: string;
  autoReviewEnabled?: boolean;
  reviewPrompt?: string;
  reviewMaxRetries?: number;
  reviewTemperature?: number;
  saveDelayMinSec?: number;
  saveDelayMaxSec?: number;
  prefetchCount?: number;
  maxSavesPerRun?: number;
}

// Вердикт автоматического ревью, приходит из Rust
export interface CaptionReview {
  ok: boolean;
  comment: string;
}

export type ProcessingStage = 'idle' | 'generating' | 'reviewing' | 'awaiting' | 'waiting' | 'saving';

export interface ManualReviewPayload {
  photo: PhotoTask;
  caption: string;
  resolve: (action: 'save' | 'skip' | 'regenerate' | 'cancel', comment?: string, editedCaption?: string) => void;
}

export const useAppStore = defineStore('app', () => {
  const settings = ref<AppSettings>({
    vkToken: '',
    vkAppId: DEFAULT_VK_APP_ID,
    vkAlbumId: '',
    vkOwnerId: '',
    lmstudioModel: 'zai-org/glm-4.6v-flash',
    lmstudioToken: '',
    processingMode: 'auto',
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    processPhotosWithCaption: false,
    revOrder: true,
    temperature: 1.1,
    imageTransmissionMode: 'direct',
    lmstudioIntegrations: '',
    autoReviewEnabled: false,
    reviewPrompt: '',
    reviewMaxRetries: DEFAULT_REVIEW_RETRIES,
    reviewTemperature: DEFAULT_REVIEW_TEMPERATURE,
    saveDelayMinSec: DEFAULT_SAVE_DELAY_MIN_SEC,
    saveDelayMaxSec: DEFAULT_SAVE_DELAY_MAX_SEC,
    prefetchCount: DEFAULT_PREFETCH_COUNT,
    maxSavesPerRun: DEFAULT_MAX_SAVES_PER_RUN,
  });

  const photos = ref<PhotoTask[]>([]);
  const isProcessing = ref(false);
  const currentPhotoIndex = ref(0);
  const stats = ref({ total: 0, processed: 0, failed: 0, skipped: 0 });

  // Что приложение делает прямо сейчас — для индикатора на главной
  const stage = ref<ProcessingStage>('idle');
  const waitSecondsLeft = ref(0);

  // Сколько описаний записано в VK за текущий запуск и упёрлись ли мы в лимит
  const savedThisRun = ref(0);
  const limitReached = ref(false);

  const saveLimit = computed(() => settings.value.maxSavesPerRun ?? DEFAULT_MAX_SAVES_PER_RUN);
  const savesLeft = computed(() => (saveLimit.value > 0 ? saveLimit.value - savedThisRun.value : Infinity));

  const prefetch = useCaptionPrefetch(produceCaption);

  // Последнее обработанное фото (для автоматического режима)
  const lastProcessedPhoto = ref<PhotoTask | null>(null);

  // Состояние ручного подтверждения
  const manualReview = ref<ManualReviewPayload | null>(null);
  const isRegenerating = ref(false);

  const progress = computed(() => {
    if (stats.value.total === 0) {
      return 0;
    }

    const done = stats.value.processed + stats.value.failed + stats.value.skipped;
    return Math.round((done / stats.value.total) * 100);
  });

  const activePhoto = computed(() => {
    if (currentPhotoIndex.value < photos.value.length) {
      return photos.value[currentPhotoIndex.value];
    }
    return null;
  });

  function saveSettings(newSettings: AppSettings): void {
    settings.value = newSettings;
  }

  // Запрашивает подтверждение у пользователя в ручном режиме
  function requestManualReview(photo: PhotoTask, caption: string): Promise<{ action: 'save' | 'skip' | 'regenerate' | 'cancel'; comment?: string; editedCaption?: string }> {
    return new Promise((resolve) => {
      manualReview.value = {
        photo,
        caption,
        resolve: (action, comment, editedCaption) => {
          // Не закрываем модалку для 'regenerate', чтобы избежать мерцания в процессе получения нового ответа
          if (action !== 'regenerate') {
            manualReview.value = null;
          }

          resolve({ action, comment, editedCaption });
        },
      };
    });
  }

  async function processPhoto(photo: PhotoTask, userComment?: string): Promise<string> {
    console.log(`[AppStore] processPhoto start for photo ${photo.id}`, userComment ? `with comment: ${userComment}` : '');
    const prompt = userComment
      ? `${userComment}`
      : undefined;

    const systemPrompt = settings.value.systemPrompt || DEFAULT_SYSTEM_PROMPT;

    try {
      const caption = await invoke<string>('generate_caption', {
        imageUrl: photo.image_url,
        systemPrompt,
        userComment: prompt ?? null,
      });
      console.log(`[AppStore] processPhoto success for photo ${photo.id}`, caption);
      return caption;
    } catch (err) {
      console.error(`[AppStore] processPhoto failed for photo ${photo.id}`, err);
      throw err;
    }
  }

  // Полный цикл подготовки описания: генерация и, если включено, авто-ревью с перегенерацией
  async function produceCaption(photo: PhotoTask, onStage?: (value: ProcessingStage) => void): Promise<string> {
    onStage?.('generating');
    const caption = await processPhoto(photo);

    if (!caption || !settings.value.autoReviewEnabled) {
      return caption;
    }

    return await reviewAndFix(photo, caption, onStage);
  }

  // Ревью «нажимает перегенерировать» за пользователя и передаёт модели своё замечание
  async function reviewAndFix(photo: PhotoTask, caption: string, onStage?: (value: ProcessingStage) => void): Promise<string> {
    const systemPrompt = settings.value.systemPrompt || DEFAULT_SYSTEM_PROMPT;
    const reviewPrompt = settings.value.reviewPrompt || DEFAULT_REVIEW_PROMPT;
    const maxRetries = settings.value.reviewMaxRetries ?? DEFAULT_REVIEW_RETRIES;
    let current = caption;

    for (let attempt = 1; attempt <= maxRetries && isProcessing.value; attempt++) {
      onStage?.('reviewing');

      let verdict: CaptionReview;
      try {
        verdict = await invoke<CaptionReview>('review_caption', {
          imageUrl: photo.image_url,
          caption: current,
          systemPrompt,
          reviewPrompt,
          temperature: settings.value.reviewTemperature ?? DEFAULT_REVIEW_TEMPERATURE,
        });
      } catch (err) {
        console.error(`[Review] Ревью не удалось для фото ${photo.id}, оставляем описание как есть`, err);
        break;
      }

      console.log(`[Review] Фото ${photo.id}, попытка ${attempt}/${maxRetries}: ok=${verdict.ok}`, verdict.comment);
      photo.reviewComment = verdict.ok ? '' : verdict.comment;

      if (verdict.ok) {
        break;
      }

      onStage?.('generating');
      try {
        current = await processPhoto(photo, verdict.comment);
      } catch (err) {
        console.error(`[Review] Перегенерация по замечанию не удалась для фото ${photo.id}`, err);
        break;
      }

      if (attempt === maxRetries) {
        console.warn(`[Review] Попытки закончились, сохраняем последний вариант для фото ${photo.id}`);
      }
    }

    return current;
  }

  function randomSaveDelayMs(): number {
    const min = settings.value.saveDelayMinSec ?? DEFAULT_SAVE_DELAY_MIN_SEC;
    const max = settings.value.saveDelayMaxSec ?? DEFAULT_SAVE_DELAY_MAX_SEC;
    const from = Math.max(0, Math.min(min, max));
    const to = Math.max(0, Math.max(min, max));

    // random из es-toolkit требует строго большей верхней границы
    return (from === to ? from : random(from, to)) * 1000;
  }

  // Ждём по секунде, чтобы «Остановить» срабатывало сразу и был виден обратный отсчёт
  async function waitUntil(deadline: number): Promise<void> {
    while (isProcessing.value) {
      const left = deadline - Date.now();
      if (left <= 0) {
        break;
      }

      stage.value = 'waiting';
      waitSecondsLeft.value = Math.ceil(left / 1000);
      await delay(Math.min(left, 1000));
    }

    waitSecondsLeft.value = 0;
  }

  function setStage(value: ProcessingStage): void {
    stage.value = value;
  }

  function schedulePrefetch(fromIndex: number): void {
    // Готовим не больше, чем успеем сохранить до лимита
    const count = Math.min(settings.value.prefetchCount ?? DEFAULT_PREFETCH_COUNT, savesLeft.value);
    if (count <= 0) {
      return;
    }

    prefetch.schedule(
      photos.value.slice(fromIndex, fromIndex + count).filter(next => !next.caption?.trim()),
    );
  }

  async function startProcessing(): Promise<void> {
    isProcessing.value = true;
    stats.value = { total: 0, processed: 0, failed: 0, skipped: 0 };
    photos.value = [];
    currentPhotoIndex.value = 0;
    lastProcessedPhoto.value = null;
    savedThisRun.value = 0;
    limitReached.value = false;
    prefetch.clear();

    try {
      console.log('[AppStore] Loading photos from VK...');
      const loadedPhotos = await invoke<PhotoTask[]>('load_photos_without_caption');
      console.log(`[AppStore] Loaded ${loadedPhotos.length} photos.`);
      photos.value = loadedPhotos;
      stats.value.total = loadedPhotos.length;

      for (let i = 0; i < photos.value.length; i++) {
        if (!isProcessing.value) {
          break;
        }

        // Лимит проверяем до генерации, чтобы не гонять модель впустую
        if (savesLeft.value <= 0) {
          limitReached.value = true;
          console.warn(`[AppStore] Достигнут лимит ${saveLimit.value} сохранений за запуск, останавливаемся`);
          break;
        }

        currentPhotoIndex.value = i;
        const photo = photos.value[i];
        photo.status = 'processing';

        try {
          let caption = '';
          let generationError: string | undefined;

          const isCaptioned = typeof photo.caption === 'string' && photo.caption.trim() !== '';
          const isManualReviewRequired = settings.value.processingMode === 'manual' || isCaptioned;

          console.log(`[AppStore] Processing step 1: Initial generate for ${photo.id}`);
          if (isCaptioned) {
            caption = photo.caption;
            console.log(`[AppStore] Using existing caption for photo ${photo.id}`);
          } else {
            try {
              const prepared = prefetch.take(photo);
              if (prepared) {
                console.log(`[Prefetch] Берём заранее подготовленное описание для фото ${photo.id}`);
                stage.value = 'generating';
              }

              caption = await (prepared ?? produceCaption(photo, setStage));
            } catch (err) {
              generationError = err instanceof Error ? err.message : String(err);
              console.warn(`[AppStore] Initial generate error for ${photo.id}`, generationError);
            }
          }

          if (!caption && !generationError) {
            generationError = 'Пустая подпись';
          }

          // Пауза перед записью в VK отсчитывается отсюда: ревью и раздумья пользователя её съедают
          const saveNotBefore = Date.now() + randomSaveDelayMs();

          if (isManualReviewRequired) {
            // Ручной режим ИЛИ у фото уже есть описание: ждём решения пользователя
            if (generationError) {
              photo.error = generationError;
              photo.status = 'error';
            } else {
              photo.status = 'pending'; // Сбрасываем статус, чтобы убрать спиннер в модалке
            }

            let finalAction: 'save' | 'skip' | 'regenerate' | 'cancel' | undefined = undefined;
            let currentCaption = caption;

            // Пока пользователь думает, видеокарта готовит описания для следующих фото
            schedulePrefetch(i + 1);

            while (true) {
              setStage('awaiting');
              console.log('[ManualReview] Requesting review for photo:', photo.id);
              const { action, comment, editedCaption } = await requestManualReview(photo, currentCaption);
              console.log('[ManualReview] Action received:', action);
              finalAction = action;

              if (action === 'regenerate') {
                console.log('[AppStore] Starting manual regeneration...');
                setStage('generating');
                isRegenerating.value = true;
                photo.status = 'processing';
                photo.error = undefined;
                generationError = undefined;
                try {
                  currentCaption = await processPhoto(photo, comment);
                  console.log('[AppStore] Manual regeneration finished successfully');
                } catch (err) {
                  photo.status = 'error';
                  photo.error = err instanceof Error ? err.message : String(err);
                  currentCaption = '';
                } finally {
                  photo.status = 'pending';
                  isRegenerating.value = false;
                }
                continue;
              }
              if (editedCaption !== undefined) {
                currentCaption = editedCaption;
              }

              break;
            }

            if (finalAction === 'cancel' || !isProcessing.value) {
              console.log('[ManualReview] Stopping processing due to cancel');
              isProcessing.value = false;
              break;
            }

            if (finalAction === 'skip') {
              console.log('[ManualReview] Skipping photo');
              photo.status = 'skipped';
              stats.value.skipped++;
              continue;
            }

            caption = currentCaption;
          } else if (generationError) {
            // Авто режим: ошибка остаётся ошибкой
            photo.status = 'error';
            photo.error = generationError;
            stats.value.failed++;
            continue;
          }

          // Держим случайную паузу: подряд идущие правки VK считает флудом. Время ревью
          // и раздумий пользователя уже прошло, поэтому ждём только остаток
          await waitUntil(saveNotBefore);

          if (!isProcessing.value) {
            break;
          }

          // Сохраняем в VK
          stage.value = 'saving';
          console.log('[ManualReview] Saving caption for photo:', photo.id);
          await invoke('save_photo_caption', {
            photoId: photo.id,
            ownerId: photo.owner_id,
            caption,
          });

          photo.previousCaption = '';
          photo.caption = caption;
          photo.status = 'completed';
          photo.error = undefined;
          photo.reviewComment = '';
          stats.value.processed++;
          savedThisRun.value++;
          lastProcessedPhoto.value = { ...photo };
          console.log('[ManualReview] Photo completed:', photo.id);

        } catch (error) {
          photo.status = 'error';
          photo.error = error instanceof Error ? error.message : String(error);
          stats.value.failed++;
        }
      }
    } catch (error) {
      isProcessing.value = false;
      throw error;
    } finally {
      isProcessing.value = false;
      stage.value = 'idle';
      waitSecondsLeft.value = 0;
      prefetch.clear();
    }
  }

  async function undoLastCaption(): Promise<void> {
    if (!lastProcessedPhoto.value) {
      return;
    }

    const photo = lastProcessedPhoto.value;
    const prev = photo.previousCaption ?? '';

    await invoke('save_photo_caption', {
      photoId: photo.id,
      ownerId: photo.owner_id,
      caption: prev,
    });

    // Обновляем в списке
    const idx = photos.value.findIndex(p => p.id === photo.id);
    if (idx !== -1) {
      photos.value[idx].caption = prev;
      photos.value[idx].status = prev ? 'completed' : 'pending';
    }

    if (stats.value.processed > 0) {
      stats.value.processed--;
    }

    lastProcessedPhoto.value = null;
  }

  function stopProcessing(): void {
    isProcessing.value = false;
    prefetch.clear();
  }

  function reset(): void {
    photos.value = [];
    isProcessing.value = false;
    currentPhotoIndex.value = 0;
    stats.value = { total: 0, processed: 0, failed: 0, skipped: 0 };
    lastProcessedPhoto.value = null;
    manualReview.value = null;
    stage.value = 'idle';
    waitSecondsLeft.value = 0;
    savedThisRun.value = 0;
    limitReached.value = false;
    prefetch.clear();
  }

  async function manualEditPhoto(photo: PhotoTask): Promise<void> {
    if (manualReview.value) {
      return;
    }

    let currentCaption = photo.caption || '';
    const originalStatus = photo.status;

    try {
      while (true) {
        const { action, comment, editedCaption } = await requestManualReview(photo, currentCaption);

        if (action === 'regenerate') {
          isRegenerating.value = true;
          photo.status = 'processing';
          photo.error = undefined;

          try {
            currentCaption = await processPhoto(photo, comment);
            photo.status = 'pending';
          } catch (err) {
            photo.status = 'error';
            photo.error = err instanceof Error ? err.message : String(err);
          } finally {
            isRegenerating.value = false;
          }

          continue;
        }

        if (action === 'cancel' || action === 'skip') {
          photo.status = originalStatus;
          break;
        }

        const finalCaption = editedCaption ?? currentCaption;

        await invoke('save_photo_caption', {
          photoId: photo.id,
          ownerId: photo.owner_id,
          caption: finalCaption,
        });

        photo.caption = finalCaption;
        photo.status = 'completed';
        photo.reviewComment = '';

        // Обновляем последнее обработанное фото, если это оно
        if (lastProcessedPhoto.value && lastProcessedPhoto.value.id === photo.id) {
          lastProcessedPhoto.value.caption = finalCaption;
          lastProcessedPhoto.value.status = 'completed';
        }

        break;
      }
    } catch (e) {
      photo.status = 'error';
      photo.error = String(e);
    }
  }

  return {
    settings,
    photos,
    isProcessing,
    currentPhotoIndex,
    stats,
    progress,
    activePhoto,
    lastProcessedPhoto,
    manualReview,
    isRegenerating,
    stage,
    waitSecondsLeft,
    savedThisRun,
    limitReached,
    saveLimit,
    saveSettings,
    startProcessing,
    stopProcessing,
    undoLastCaption,
    manualEditPhoto,
    reset,
  };
}, {
  persist: {
    key: 'vk-caption-ai',
    pick: ['settings'],
    afterHydrate: (ctx) => {
      if (!ctx.store.settings.systemPrompt) {
        ctx.store.settings.systemPrompt = DEFAULT_SYSTEM_PROMPT;
      }
      if (typeof ctx.store.settings.temperature === 'undefined') {
        ctx.store.settings.temperature = 1.1;
      }

      ctx.store.settings.vkAppId ??= DEFAULT_VK_APP_ID;
      ctx.store.settings.autoReviewEnabled ??= false;
      ctx.store.settings.reviewPrompt ??= '';
      ctx.store.settings.reviewMaxRetries ??= DEFAULT_REVIEW_RETRIES;
      ctx.store.settings.reviewTemperature ??= DEFAULT_REVIEW_TEMPERATURE;
      ctx.store.settings.saveDelayMinSec ??= DEFAULT_SAVE_DELAY_MIN_SEC;
      ctx.store.settings.saveDelayMaxSec ??= DEFAULT_SAVE_DELAY_MAX_SEC;
      ctx.store.settings.prefetchCount ??= DEFAULT_PREFETCH_COUNT;
      ctx.store.settings.maxSavesPerRun ??= DEFAULT_MAX_SAVES_PER_RUN;
    },
  },
});
