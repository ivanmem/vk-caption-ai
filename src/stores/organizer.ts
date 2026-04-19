import { defineStore } from 'pinia';
import { computed, ref, toRaw } from 'vue';
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

export type OrganizerTaskStatus = 'idle' | 'processing' | 'done' | 'cancelled' | 'error';

export interface OrganizerTaskStats {
  total: number;
  moved: number;
  skipped: number;
  failed: number;
}

export interface OrganizerTask {
  /** Уникальный идентификатор задачи */
  id: string;
  /** Подпись для списка очереди (по умолчанию — последний сегмент пути источника) */
  label: string;
  /** Имя шаблона, из которого задача была создана (только метка, не ссылка) */
  templateName: string | null;
  /** Полный snapshot настроек на момент создания/последней правки задачи */
  config: OrganizerSettings;
  /** Найденные в папке-источнике изображения и их состояние */
  images: OrganizerImage[];
  /** Сводная статистика по задаче */
  stats: OrganizerTaskStats;
  /** Индекс текущего файла (для отображения «Текущий файл») */
  currentIndex: number;
  /** Жизненный цикл задачи */
  status: OrganizerTaskStatus;
  /** Метки времени */
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  /** Текст ошибки (если задача упала на этапе подготовки) */
  errorMessage: string | null;
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

const DEFAULT_TEMPLATE_NAME = 'default';
const STORAGE_KEY = 'vk-caption-ai-organizer';

// ─────────────────────────── Стор ───────────────────────────

export const useOrganizerStore = defineStore('organizer', () => {
  migrateLegacyStorage();

  // ── Шаблоны (пресеты конфигурации) ──
  const templates = ref<Record<string, OrganizerSettings>>({
    [DEFAULT_TEMPLATE_NAME]: createDefaultSettings(),
  });
  const activeTemplateName = ref<string>(DEFAULT_TEMPLATE_NAME);

  // ── Очередь задач ──
  const tasks = ref<OrganizerTask[]>([]);
  /** Задача, которая открыта в форме (может отличаться от выполняемой). */
  const activeTaskId = ref<string | null>(null);
  /** Задача, которую сейчас обрабатывает модель. */
  const runningTaskId = ref<string | null>(null);
  /**
   * Контроллер прерывания для текущей выполняемой задачи. Позволяет
   * мгновенно отменить ожидание `invoke(...)` (классификация изображения
   * может идти десятки секунд — нет смысла ждать её завершения после клика
   * «Остановить»). Сам HTTP-запрос к LMStudio при этом доедет в фоне,
   * но его результат будет проигнорирован.
   */
  const abortController = ref<AbortController | null>(null);
  /** Глобальная блокировка генерации списка папок (общая для всей формы). */
  const isGeneratingFolders = ref(false);

  // ── Производные поля ──

  const templateNames = computed(() => Object.keys(templates.value).sort((a, b) => {
    if (a === DEFAULT_TEMPLATE_NAME) {
      return -1;
    }

    if (b === DEFAULT_TEMPLATE_NAME) {
      return 1;
    }

    return a.localeCompare(b, 'ru');
  }));

  const activeTask = computed<OrganizerTask | null>(() => {
    if (!activeTaskId.value) {
      return null;
    }

    return tasks.value.find((t) => t.id === activeTaskId.value) ?? null;
  });

  const runningTask = computed<OrganizerTask | null>(() => {
    if (!runningTaskId.value) {
      return null;
    }

    return tasks.value.find((t) => t.id === runningTaskId.value) ?? null;
  });

  /** Включена ли вообще обработка (любой задачи). */
  const isProcessing = computed(() => runningTaskId.value !== null);

  /** Идёт ли обработка той задачи, что сейчас открыта в форме. */
  const isRunningActive = computed(() => {
    return runningTaskId.value !== null && runningTaskId.value === activeTaskId.value;
  });

  /**
   * Главное «окно» в данные формы: либо в snapshot активной задачи,
   * либо в активный шаблон, если задача не открыта.
   * Все правки полей формы проходят через этот объект, поэтому
   * автоматически попадают либо в задачу, либо в шаблон.
   */
  const settings = computed<OrganizerSettings>(() => {
    const task = activeTask.value;
    if (task) {
      return task.config;
    }

    const name = activeTemplateName.value;
    if (!templates.value[name]) {
      console.warn('[Organizer] Active template missing, recreating:', name);
      templates.value[name] = createDefaultSettings();
    }

    return templates.value[name];
  });

  /** Список изображений активной задачи (или пустой массив). */
  const images = computed<OrganizerImage[]>(() => activeTask.value?.images ?? []);

  /** Статистика активной задачи (или нули). */
  const stats = computed<OrganizerTaskStats>(() => {
    return activeTask.value?.stats ?? { total: 0, moved: 0, skipped: 0, failed: 0 };
  });

  const currentIndex = computed<number>(() => activeTask.value?.currentIndex ?? 0);

  const activeImage = computed<OrganizerImage | null>(() => {
    const task = activeTask.value;
    if (!task) {
      return null;
    }

    if (task.currentIndex >= task.images.length) {
      return null;
    }

    return task.images[task.currentIndex];
  });

  const progress = computed(() => {
    const s = stats.value;
    if (s.total === 0) {
      return 0;
    }

    const done = s.moved + s.skipped + s.failed;
    return Math.round((done / s.total) * 100);
  });

  const baseDestination = computed(() => {
    return settings.value.destinationFolder.trim() || settings.value.sourceFolder;
  });

  // ── Управление шаблонами ──

  function addTemplate(name: string, copyFromCurrent = false): void {
    const cleaned = name.trim();
    if (!cleaned) {
      throw new Error('Имя шаблона не может быть пустым.');
    }

    if (templates.value[cleaned]) {
      throw new Error(`Шаблон «${cleaned}» уже существует.`);
    }

    templates.value[cleaned] = copyFromCurrent
      ? cloneSettings(settings.value)
      : createDefaultSettings();
    activeTemplateName.value = cleaned;
    console.log('[Organizer] Created template:', cleaned, 'copyFromCurrent=', copyFromCurrent);
  }

  function deleteTemplate(name: string): void {
    if (name === DEFAULT_TEMPLATE_NAME) {
      throw new Error('Шаблон «default» удалить нельзя.');
    }

    if (!templates.value[name]) {
      return;
    }

    delete templates.value[name];

    if (activeTemplateName.value === name) {
      activeTemplateName.value = DEFAULT_TEMPLATE_NAME;
    }

    console.log('[Organizer] Deleted template:', name);
  }

  function renameTemplate(oldName: string, newName: string): void {
    const cleaned = newName.trim();
    if (!cleaned) {
      throw new Error('Имя шаблона не может быть пустым.');
    }

    if (oldName === DEFAULT_TEMPLATE_NAME) {
      throw new Error('Шаблон «default» нельзя переименовать.');
    }

    if (cleaned === oldName) {
      return;
    }

    if (templates.value[cleaned]) {
      throw new Error(`Шаблон «${cleaned}» уже существует.`);
    }

    templates.value[cleaned] = templates.value[oldName];
    delete templates.value[oldName];

    if (activeTemplateName.value === oldName) {
      activeTemplateName.value = cleaned;
    }
  }

  // ── Управление очередью ──

  function setActiveTask(id: string | null): void {
    if (id !== null && !tasks.value.some((t) => t.id === id)) {
      console.warn('[Organizer] setActiveTask: task not found:', id);
      return;
    }

    activeTaskId.value = id;
    console.log('[Organizer] Active task →', id);
  }

  /**
   * Создаёт новую задачу из текущего открытого в форме конфига.
   * Если открыта задача — берётся её config (как «дубликат»),
   * иначе — копия активного шаблона.
   */
  function createTaskFromCurrent(options: { activate?: boolean } = {}): string {
    const id = createId();
    const sourceConfig = cloneSettings(settings.value);
    const templateName = activeTask.value?.templateName ?? activeTemplateName.value;
    const task: OrganizerTask = {
      id,
      label: deriveTaskLabel(sourceConfig, tasks.value.length),
      templateName,
      config: sourceConfig,
      images: [],
      stats: { total: 0, moved: 0, skipped: 0, failed: 0 },
      currentIndex: 0,
      status: 'idle',
      createdAt: Date.now(),
      startedAt: null,
      finishedAt: null,
      errorMessage: null,
    };
    tasks.value.push(task);

    if (options.activate ?? true) {
      activeTaskId.value = id;
    }

    console.log('[Organizer] Task created:', id, 'label=', task.label, 'fromTemplate=', templateName);
    return id;
  }

  function deleteTask(id: string): void {
    if (runningTaskId.value === id) {
      throw new Error('Сначала остановите выполнение задачи.');
    }

    const idx = tasks.value.findIndex((t) => t.id === id);
    if (idx < 0) {
      return;
    }

    tasks.value.splice(idx, 1);

    if (activeTaskId.value === id) {
      activeTaskId.value = null;
    }

    console.log('[Organizer] Task deleted:', id);
  }

  function renameTask(id: string, newLabel: string): void {
    const cleaned = newLabel.trim();
    if (!cleaned) {
      throw new Error('Название задачи не может быть пустым.');
    }

    const task = tasks.value.find((t) => t.id === id);
    if (task) {
      task.label = cleaned;
    }
  }

  function resetTask(id: string): void {
    const task = tasks.value.find((t) => t.id === id);
    if (!task) {
      return;
    }

    if (runningTaskId.value === id) {
      throw new Error('Сначала остановите задачу.');
    }

    task.images = [];
    task.stats = { total: 0, moved: 0, skipped: 0, failed: 0 };
    task.currentIndex = 0;
    task.status = 'idle';
    task.startedAt = null;
    task.finishedAt = null;
    task.errorMessage = null;
    console.log('[Organizer] Task reset:', id);
  }

  // ── Запуск/остановка задач ──

  async function runTaskById(id: string): Promise<void> {
    if (runningTaskId.value !== null && runningTaskId.value !== id) {
      throw new Error('Уже выполняется другая задача.');
    }

    const task = tasks.value.find((t) => t.id === id);
    if (!task) {
      throw new Error('Задача не найдена.');
    }

    if (!task.config.sourceFolder) {
      task.status = 'error';
      task.errorMessage = 'Не выбрана папка-источник.';
      throw new Error(task.errorMessage);
    }

    const cleanFolders = task.config.folders.map((f) => f.trim()).filter(Boolean);
    if (cleanFolders.length === 0) {
      task.status = 'error';
      task.errorMessage = 'Не задан ни один вариант папки назначения.';
      throw new Error(task.errorMessage);
    }

    const controller = new AbortController();
    abortController.value = controller;
    runningTaskId.value = id;
    task.status = 'processing';
    task.startedAt = Date.now();
    task.errorMessage = null;
    console.log('[Organizer] Run task:', id, 'sourceFolder=', task.config.sourceFolder);

    try {
      const list = await raceAbort(
        invoke<ImageFileDto[]>('organizer_list_images', {
          folder: task.config.sourceFolder,
        }),
        controller.signal,
      );
      console.log(`[Organizer] Loaded ${list.length} images for task ${id}`);

      task.images = list.map((item) => ({
        path: item.path,
        name: item.name,
        size: item.size,
        status: 'pending' as const,
      }));
      task.stats = { total: task.images.length, moved: 0, skipped: 0, failed: 0 };
      task.currentIndex = 0;

      const baseDest = task.config.destinationFolder.trim() || task.config.sourceFolder;

      for (let i = 0; i < task.images.length; i++) {
        if (controller.signal.aborted) {
          console.log('[Organizer] Aborted before image', i);
          task.status = 'cancelled';
          break;
        }

        task.currentIndex = i;
        const image = task.images[i];
        image.status = 'processing';
        console.log(`[Organizer] [${task.label}] Classifying ${image.name}`);

        try {
          const result = await raceAbort(
            invoke<ClassifyResultDto>('organizer_classify_image', {
              filePath: image.path,
              userRules: task.config.userPrompt,
              folders: cleanFolders,
              modelOverride: task.config.modelOverride.trim() || null,
              temperatureOverride: task.config.temperatureOverride,
            }),
            controller.signal,
          );
          image.raw = result.raw;
          console.log(`[Organizer] [${task.label}] Raw answer:`, JSON.stringify(result.raw));
          console.log(`[Organizer] [${task.label}] Matched folder:`, result.folder);

          if (!result.raw || !result.raw.trim()) {
            throw new Error('Модель вернула пустой ответ. Проверьте, что модель vision и поддерживает выбранный формат.');
          }

          if (!result.matched || !result.folder) {
            if (task.config.moveSkippedToUnsorted) {
              const target = task.config.unsortedFolderName || '_unsorted';
              const moved = await raceAbort(
                invoke<string>('organizer_move_file', {
                  filePath: image.path,
                  baseFolder: baseDest,
                  subFolder: target,
                }),
                controller.signal,
              );
              image.targetFolder = target;
              image.movedTo = moved;
              image.status = 'skipped';
              task.stats.skipped++;
              console.log(`[Organizer] [${task.label}] ${image.name} → ${target} (unsorted)`);
            } else {
              image.status = 'skipped';
              task.stats.skipped++;
              console.log(`[Organizer] [${task.label}] ${image.name}: SKIP (left in place)`);
            }

            continue;
          }

          const moved = await raceAbort(
            invoke<string>('organizer_move_file', {
              filePath: image.path,
              baseFolder: baseDest,
              subFolder: result.folder,
            }),
            controller.signal,
          );
          image.targetFolder = result.folder;
          image.movedTo = moved;
          image.status = 'moved';
          task.stats.moved++;
          console.log(`[Organizer] [${task.label}] ${image.name} → ${result.folder} (${moved})`);
        } catch (err) {
          if (isAbortError(err)) {
            // Пользователь нажал «Остановить». Текущий файл по факту не
            // обработан — возвращаем его в pending, а саму задачу помечаем
            // как cancelled и выходим из цикла мгновенно.
            image.status = 'pending';
            task.status = 'cancelled';
            console.log(`[Organizer] [${task.label}] Aborted mid-image: ${image.name}`);
            break;
          }

          image.status = 'error';
          image.error = err instanceof Error ? err.message : String(err);
          task.stats.failed++;
          console.error(`[Organizer] [${task.label}] Error processing ${image.name}:`, err);
        }
      }

      if (task.status !== 'cancelled') {
        task.status = task.stats.failed > 0 && task.stats.moved + task.stats.skipped === 0
          ? 'error'
          : 'done';
      }
    } catch (err) {
      if (isAbortError(err)) {
        task.status = 'cancelled';
        console.log('[Organizer] Task aborted before/while listing images:', id);
      } else {
        task.status = 'error';
        task.errorMessage = err instanceof Error ? err.message : String(err);
        console.error('[Organizer] Task failed before/while loading images:', err);
        throw err;
      }
    } finally {
      task.finishedAt = Date.now();
      runningTaskId.value = null;
      // Снимаем контроллер только если он наш — мог быть пересоздан рестартом.
      if (abortController.value === controller) {
        abortController.value = null;
      }

      // Авто-переход к следующей «idle» задаче — пользователь хотел это поведение.
      // Используем queueMicrotask, чтобы дать текущему finally-блоку завершиться чисто.
      if (task.status === 'done') {
        const next = tasks.value.find((t) => t.status === 'idle');
        if (next) {
          console.log('[Organizer] Auto-advancing to next task:', next.id);
          queueMicrotask(() => {
            runTaskById(next.id).catch((err) => {
              console.error('[Organizer] Auto-advance failed:', err);
            });
          });
        }
      }
    }
  }

  function stopProcessing(): void {
    if (!runningTaskId.value) {
      return;
    }

    console.log('[Organizer] Stop requested for', runningTaskId.value);
    abortController.value?.abort();
  }

  /**
   * Запускает задачу, открытую в форме. Если она ещё не была запущена —
   * стартует с нуля. Если уже завершена/прервана — переиспользует тот же id,
   * но сначала сбрасывает счётчики (через `resetTask`).
   */
  async function startActiveTask(): Promise<void> {
    let id = activeTaskId.value;
    if (!id) {
      // Если открыт шаблон — на лету создаём задачу из него.
      id = createTaskFromCurrent({ activate: true });
    } else {
      const task = tasks.value.find((t) => t.id === id);
      if (task && task.status !== 'idle' && task.status !== 'processing') {
        resetTask(id);
      }
    }

    await runTaskById(id);
  }

  // ── Генерация целевых папок ──

  async function generateFolders(mode: 'replace' | 'merge'): Promise<string[]> {
    if (isGeneratingFolders.value) {
      return [];
    }

    if (!settings.value.userPrompt.trim()) {
      throw new Error('Заполните правила классификации, чтобы модель могла предложить папки.');
    }

    isGeneratingFolders.value = true;
    try {
      console.log('[Organizer] Generating folders, mode=', mode);
      const generated = await invoke<string[]>('organizer_generate_folders', {
        userRules: settings.value.userPrompt,
        existingFolders: settings.value.folders,
        modelOverride: settings.value.modelOverride.trim() || null,
        temperatureOverride: settings.value.temperatureOverride,
      });

      console.log('[Organizer] Generated folders:', generated);

      if (mode === 'replace') {
        settings.value.folders = [...generated];
      } else {
        const existingLower = new Set(settings.value.folders.map((f) => f.trim().toLowerCase()));
        const additions = generated.filter((f) => !existingLower.has(f.trim().toLowerCase()));
        settings.value.folders = [...settings.value.folders, ...additions];
      }

      return generated;
    } finally {
      isGeneratingFolders.value = false;
    }
  }

  return {
    // шаблоны
    templates,
    activeTemplateName,
    templateNames,
    addTemplate,
    deleteTemplate,
    renameTemplate,

    // данные формы (через активную задачу или активный шаблон)
    settings,
    baseDestination,

    // очередь
    tasks,
    activeTaskId,
    activeTask,
    runningTaskId,
    runningTask,
    isProcessing,
    isRunningActive,
    setActiveTask,
    createTaskFromCurrent,
    deleteTask,
    renameTask,
    resetTask,
    runTaskById,
    startActiveTask,
    stopProcessing,

    // данные «текущей» задачи (для совместимости с шаблоном)
    images,
    stats,
    currentIndex,
    activeImage,
    progress,

    // вспомогательное
    isGeneratingFolders,
    generateFolders,
  };
}, {
  persist: {
    key: STORAGE_KEY,
    pick: ['templates', 'activeTemplateName', 'tasks', 'activeTaskId'],
    afterHydrate(ctx) {
      // После рестарта приложения никакая задача физически не может быть в
      // статусе «processing» — приведём такие в «cancelled». Заодно почистим
      // зависшие image.status === 'processing' и проверим валидность activeTaskId.
      sanitizePersistedState(ctx.store as unknown as PersistedStateShape);
    },
  },
});

interface PersistedStateShape {
  tasks: OrganizerTask[];
  activeTaskId: string | null;
}

/**
 * Чинит состояние очереди после восстановления из localStorage.
 * Вызывается ровно один раз — в `afterHydrate` плагина персистентности.
 *
 * `runningTaskId` и `abortController` намеренно не входят в `pick`, поэтому
 * после рестарта они равны начальным `null` — отдельно сбрасывать не нужно.
 */
function sanitizePersistedState(store: PersistedStateShape): void {
  let touchedTasks = 0;
  let touchedImages = 0;

  for (const task of store.tasks) {
    if (task.status === 'processing') {
      task.status = 'cancelled';
      task.errorMessage ??= 'Обработка прервана перезапуском приложения.';
      task.finishedAt ??= Date.now();
      touchedTasks++;
    }

    for (const img of task.images) {
      if (img.status === 'processing') {
        img.status = 'pending';
        touchedImages++;
      }
    }

    // currentIndex после прерывания может торчать на «следующем непросчитанном» —
    // визуально это нормально, но защитим от выхода за границы массива.
    if (task.currentIndex < 0) {
      task.currentIndex = 0;
    } else if (task.images.length > 0 && task.currentIndex >= task.images.length) {
      task.currentIndex = task.images.length - 1;
    }
  }

  // Если активная задача указывает в пустоту (например, её удалили в другой
  // вкладке или хранилище повреждено) — закроем форму на «шаблон».
  if (store.activeTaskId && !store.tasks.some((t) => t.id === store.activeTaskId)) {
    console.warn('[Organizer] activeTaskId points to a missing task, resetting:', store.activeTaskId);
    store.activeTaskId = null;
  }

  if (touchedTasks > 0 || touchedImages > 0) {
    console.log(
      `[Organizer] Sanitized state after restart: tasks=${touchedTasks}, images=${touchedImages}.`,
    );
  }
}

/**
 * Делает глубокую копию настроек, отвязанную от Vue-реактивности.
 * Раньше использовался `structuredClone`, но он падает на Pinia-прокси
 * из-за внутренних Symbol-ключей. У нас в настройках только примитивы
 * и массив строк, поэтому JSON-клон безопасен и предсказуем.
 */
function cloneSettings(src: OrganizerSettings): OrganizerSettings {
  const raw = toRaw(src);
  return {
    sourceFolder: raw.sourceFolder,
    destinationFolder: raw.destinationFolder,
    userPrompt: raw.userPrompt,
    folders: [...raw.folders],
    modelOverride: raw.modelOverride,
    temperatureOverride: raw.temperatureOverride,
    moveSkippedToUnsorted: raw.moveSkippedToUnsorted,
    unsortedFolderName: raw.unsortedFolderName,
  };
}

/**
 * Сентинельная ошибка отмены. Используем именно `DOMException` с именем
 * `AbortError` — это та же конвенция, что у `fetch` / стандартных Web API,
 * её легко узнать через `isAbortError`.
 */
function makeAbortError(): Error {
  if (typeof DOMException === 'function') {
    return new DOMException('Operation aborted', 'AbortError');
  }

  const err = new Error('Operation aborted');
  err.name = 'AbortError';
  return err;
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

/**
 * Возвращает Promise, который резолвится результатом `promise`, либо
 * мгновенно отклоняется `AbortError`, как только сработает `signal`.
 *
 * Важно: исходный `promise` (то есть `invoke(...)`) не имеет настоящей
 * отмены — он просто доедет в фоне. Но UI получает управление сразу,
 * а это ровно то, что нужно для кнопки «Остановить».
 */
function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(makeAbortError());
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(makeAbortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (err) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      },
    );
  });
}

function createDefaultSettings(): OrganizerSettings {
  return {
    sourceFolder: '',
    destinationFolder: '',
    userPrompt: '',
    folders: [],
    modelOverride: '',
    temperatureOverride: null,
    moveSkippedToUnsorted: false,
    unsortedFolderName: '_unsorted',
  };
}

function deriveTaskLabel(cfg: OrganizerSettings, indexHint: number): string {
  if (cfg.sourceFolder) {
    const segments = cfg.sourceFolder.split(/[\\/]/).filter(Boolean);
    const last = segments.length > 0 ? segments[segments.length - 1] : '';
    if (last) {
      return last;
    }
  }

  return `Задача ${indexHint + 1}`;
}

function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  // Запасной вариант для устаревших окружений: миллисекунды + случайный суффикс.
  return `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Мигрирует старый формат хранилища (`{ settings: {...} }`) к новому
 * (`{ templates: { default: {...} }, activeTemplateName: 'default' }`).
 * Запускается до того, как pinia-plugin-persistedstate успеет восстановить состояние.
 */
function migrateLegacyStorage(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return;
    }

    const parsed = JSON.parse(raw);
    if (parsed?.templates) {
      return;
    }

    if (parsed?.settings && typeof parsed.settings === 'object') {
      const migrated = {
        templates: { [DEFAULT_TEMPLATE_NAME]: parsed.settings },
        activeTemplateName: DEFAULT_TEMPLATE_NAME,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
      console.log('[Organizer] Migrated legacy settings into "default" template.');
    }
  } catch (err) {
    console.warn('[Organizer] Failed to migrate legacy storage:', err);
  }
}
