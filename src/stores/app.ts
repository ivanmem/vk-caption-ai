import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { invoke } from '@tauri-apps/api/core';

export interface PhotoTask {
  id: number;
  owner_id: number;
  album_id: number;
  image_url: string;
  caption: string;
  status: 'pending' | 'processing' | 'completed' | 'error' | 'skipped';
  error?: string;
  previousCaption?: string;
}

export const DEFAULT_SYSTEM_PROMPT = `Ты — бот для поиска текста на стикерах.
Верни ТОЛЬКО JSON-массив из 1-3 строк.

Инструкция:
1. Найди текст на картинке. Если он есть, напиши его ПЕРВЫМ элементом ДОСЛОВНО.
2. Добавь 1-2 коротких тега для поиска (эмоция, реакция, смысл цитаты).
3. НЕ описывай то, что видишь (никаких "комната", "персонаж", "скриншот", "интерьер", "окно", "изображение").
4. Если текста нет — пиши только теги.

Примеры:
Выход: ["Ухади", "злость", "прогоняет"]

Вход: [Картинка с задумчивым аниме-парнем и текстом о жизни]
Выход: ["Цитата о жизни...", "философия", "грусть"]

Вход: [Персонаж просто смеется, текста нет]
Выход: ["смех", "ору", "база"]`;

export interface AppSettings {
  vkToken: string;
  vkAlbumId: string;
  vkOwnerId: string;
  lmstudioModel: string;
  processingMode: 'auto' | 'manual';
  systemPrompt: string;
  processPhotosWithCaption?: boolean;
  revOrder?: boolean;
}

export interface ManualReviewPayload {
  photo: PhotoTask;
  caption: string;
  resolve: (action: 'save' | 'skip' | 'regenerate' | 'cancel', comment?: string, editedCaption?: string) => void;
}

export const useAppStore = defineStore('app', () => {
  const settings = ref<AppSettings>({
    vkToken: '',
    vkAlbumId: '',
    vkOwnerId: '',
    lmstudioModel: 'zai-org/glm-4.6v-flash',
    processingMode: 'auto',
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    processPhotosWithCaption: false,
    revOrder: true,
  });

  const photos = ref<PhotoTask[]>([]);
  const isProcessing = ref(false);
  const currentPhotoIndex = ref(0);
  const stats = ref({ total: 0, processed: 0, failed: 0, skipped: 0 });

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

    try {
      const caption = await invoke<string>('generate_caption', {
        imageUrl: photo.image_url,
        userComment: prompt ?? null,
      });
      console.log(`[AppStore] processPhoto success for photo ${photo.id}`, caption);
      return caption;
    } catch (err) {
      console.error(`[AppStore] processPhoto failed for photo ${photo.id}`, err);
      throw err;
    }
  }

  async function startProcessing(): Promise<void> {
    isProcessing.value = true;
    stats.value = { total: 0, processed: 0, failed: 0, skipped: 0 };
    photos.value = [];
    currentPhotoIndex.value = 0;
    lastProcessedPhoto.value = null;

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
              caption = await processPhoto(photo);
            } catch (err) {
              generationError = err instanceof Error ? err.message : String(err);
              console.warn(`[AppStore] Initial generate error for ${photo.id}`, generationError);
            }
          }

          if (!caption && !generationError) {
            generationError = 'Пустая подпись';
          }

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

            while (true) {
              console.log('[ManualReview] Requesting review for photo:', photo.id);
              const { action, comment, editedCaption } = await requestManualReview(photo, currentCaption);
              console.log('[ManualReview] Action received:', action);
              finalAction = action;

              if (action === 'regenerate') {
                console.log('[AppStore] Starting manual regeneration...');
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

          // Сохраняем в VK
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
          stats.value.processed++;
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
  }

  function reset(): void {
    photos.value = [];
    isProcessing.value = false;
    currentPhotoIndex.value = 0;
    stats.value = { total: 0, processed: 0, failed: 0, skipped: 0 };
    lastProcessedPhoto.value = null;
    manualReview.value = null;
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
    },
  },
});
