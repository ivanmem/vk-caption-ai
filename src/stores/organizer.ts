import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';

// ─────────────────────────── Типы ───────────────────────────

export interface OrganizerImage {
  /** Полный путь к исходному файлу */
  path: string;
  /** Имя файла без пути */
  name: string;
  /** Размер в байтах */
  size: number;
  /** Текущий статус обработки */
  status: 'pending' | 'processing' | 'moved' | 'skipped' | 'error';
  /** В какую папку был перемещён файл (если был) */
  targetFolder?: string;
  /** Итоговый путь после перемещения */
  movedTo?: string;
  /** Сырой ответ модели — пригодится для отладки */
  raw?: string;
  /** Сообщение об ошибке */
  error?: string;
}

export interface OrganizerSettings {
  /** Папка-источник (откуда берём файлы) */
  sourceFolder: string;
  /** Папка-назначение (где будут созданы подпапки). Пусто = равна sourceFolder. */
  destinationFolder: string;
  /** Свободные правила классификации от пользователя */
  userPrompt: string;
  /** Список целевых папок — БЕЗ дублирования внутри userPrompt */
  folders: string[];
  /** Переопределение модели LMStudio (пусто = брать из общих настроек) */
  modelOverride: string;
  /** Переопределение температуры (null = брать из общих настроек) */
  temperatureOverride: number | null;
  /** Перемещать ли файл, для которого модель вернула SKIP (false — оставлять на месте) */
  moveSkippedToUnsorted: boolean;
  /** Имя «мусорной» папки для нераспознанных файлов */
  unsortedFolderName: string;
}

interface ClassifyResultDto {
  raw: string;
  folder: string | null;
  matched: boolean;
}

interface ImageFileDto {
  path: string;
  name: string;
  size: number;
}

// ─────────────────────────── Стор ───────────────────────────

export const useOrganizerStore = defineStore('organizer', () => {
  const settings = ref<OrganizerSettings>({
    sourceFolder: '',
    destinationFolder: '',
    userPrompt: '',
    folders: [],
    modelOverride: '',
    temperatureOverride: null,
    moveSkippedToUnsorted: false,
    unsortedFolderName: '_unsorted',
  });

  const images = ref<OrganizerImage[]>([]);
  const isProcessing = ref(false);
  const currentIndex = ref(0);
  const stats = ref({ total: 0, moved: 0, skipped: 0, failed: 0 });

  const progress = computed(() => {
    if (stats.value.total === 0) {
      return 0;
    }

    const done = stats.value.moved + stats.value.skipped + stats.value.failed;
    return Math.round((done / stats.value.total) * 100);
  });

  const activeImage = computed(() => {
    if (currentIndex.value < images.value.length) {
      return images.value[currentIndex.value];
    }

    return null;
  });

  const baseDestination = computed(() => {
    return settings.value.destinationFolder.trim() || settings.value.sourceFolder;
  });

  async function loadImages(): Promise<void> {
    if (!settings.value.sourceFolder) {
      throw new Error('Не выбрана папка-источник.');
    }

    const list = await invoke<ImageFileDto[]>('organizer_list_images', {
      folder: settings.value.sourceFolder,
    });

    images.value = list.map((item) => {
      return {
        path: item.path,
        name: item.name,
        size: item.size,
        status: 'pending' as const,
      };
    });

    stats.value = { total: images.value.length, moved: 0, skipped: 0, failed: 0 };
    currentIndex.value = 0;
  }

  async function classifyOne(image: OrganizerImage): Promise<ClassifyResultDto> {
    const folders = settings.value.folders.filter((f) => f.trim().length > 0);

    return await invoke<ClassifyResultDto>('organizer_classify_image', {
      filePath: image.path,
      userRules: settings.value.userPrompt,
      folders,
      modelOverride: settings.value.modelOverride.trim() || null,
      temperatureOverride: settings.value.temperatureOverride,
    });
  }

  async function moveOne(image: OrganizerImage, folder: string): Promise<string> {
    return await invoke<string>('organizer_move_file', {
      filePath: image.path,
      baseFolder: baseDestination.value,
      subFolder: folder,
    });
  }

  async function startProcessing(): Promise<void> {
    if (!settings.value.sourceFolder) {
      throw new Error('Не выбрана папка-источник.');
    }

    const cleanFolders = settings.value.folders.map((f) => f.trim()).filter(Boolean);
    if (cleanFolders.length === 0) {
      throw new Error('Не задан ни один вариант папки назначения.');
    }

    isProcessing.value = true;

    try {
      console.log('[Organizer] Loading images from', settings.value.sourceFolder);
      await loadImages();
      console.log(`[Organizer] Loaded ${images.value.length} images.`);

      for (let i = 0; i < images.value.length; i++) {
        if (!isProcessing.value) {
          console.log('[Organizer] Stop requested');
          break;
        }

        currentIndex.value = i;
        const image = images.value[i];
        image.status = 'processing';
        console.log(`[Organizer] Classifying ${image.name}`);

        try {
          const result = await classifyOne(image);
          image.raw = result.raw;
          console.log(`[Organizer] Raw answer for ${image.name}:`, JSON.stringify(result.raw));
          console.log(`[Organizer] Matched folder for ${image.name}:`, result.folder);

          if (!result.raw || !result.raw.trim()) {
            // Если модель вернула пустую строку — это, скорее всего, проблема с моделью/промптом,
            // а не сознательный SKIP. Помечаем как ошибку, чтобы пользователь увидел.
            throw new Error('Модель вернула пустой ответ. Проверьте, что модель vision и поддерживает выбранный формат.');
          }

          if (!result.matched || !result.folder) {
            // SKIP или нераспознанный ответ
            if (settings.value.moveSkippedToUnsorted) {
              const target = settings.value.unsortedFolderName || '_unsorted';
              const moved = await moveOne(image, target);
              image.targetFolder = target;
              image.movedTo = moved;
              image.status = 'skipped';
              stats.value.skipped++;
              console.log(`[Organizer] ${image.name} → ${target} (unsorted)`);
            } else {
              image.status = 'skipped';
              stats.value.skipped++;
              console.log(`[Organizer] ${image.name}: SKIP (left in place)`);
            }

            continue;
          }

          const moved = await moveOne(image, result.folder);
          image.targetFolder = result.folder;
          image.movedTo = moved;
          image.status = 'moved';
          stats.value.moved++;
          console.log(`[Organizer] ${image.name} → ${result.folder} (${moved})`);
        } catch (err) {
          image.status = 'error';
          image.error = err instanceof Error ? err.message : String(err);
          stats.value.failed++;
          console.error(`[Organizer] Error processing ${image.name}:`, err);
        }
      }
    } finally {
      isProcessing.value = false;
    }
  }

  function stopProcessing(): void {
    isProcessing.value = false;
  }

  function reset(): void {
    images.value = [];
    isProcessing.value = false;
    currentIndex.value = 0;
    stats.value = { total: 0, moved: 0, skipped: 0, failed: 0 };
  }

  return {
    settings,
    images,
    isProcessing,
    currentIndex,
    stats,
    progress,
    activeImage,
    baseDestination,
    loadImages,
    startProcessing,
    stopProcessing,
    reset,
  };
}, {
  persist: {
    key: 'vk-caption-ai-organizer',
    pick: ['settings'],
  },
});
