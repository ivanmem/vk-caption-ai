import { ref, watch, type Ref, type MaybeRefOrGetter, toValue, onScopeDispose } from 'vue';
import { invoke } from '@tauri-apps/api/core';

/**
 * Композабл для ленивой загрузки JPEG-миниатюр через Rust-команду
 * `organizer_get_thumbnail`. Вместо подсовывания браузеру полных webp/png/heic
 * (которые WebView2 декодирует на главном UI-потоке и фризит весь интерфейс)
 * — мы один раз получаем крошечный JPEG ≈10 КБ как `data:`-URL и кешируем
 * его в памяти.
 *
 * Поведение:
 * — `path` реактивный: если он меняется, ставим в очередь новый запрос;
 * — параллелизм ограничен (`MAX_CONCURRENT`), чтобы 100 видимых превью
 *   не сожрали весь tokio-блокинг-пул и не упёрлись в диск;
 * — кеш общий для всего приложения, поэтому при повторном открытии того же
 *   файла превью отдаётся мгновенно;
 * — ошибки молча возвращают `null` — в UI заранее предусмотрен фоллбек
 *   на иконку через `brokenThumbs`.
 */

interface CacheEntry {
  /** Уже готовый data-URL миниатюры. */
  url: string | null;
  /** Висящий запрос (если несколько компонентов попросили одну и ту же картинку). */
  promise?: Promise<string | null>;
  /** true — если загрузить миниатюру не получилось, повторно пытаться нет смысла. */
  failed?: boolean;
}

const MAX_CONCURRENT = 2;
const cache = new Map<string, CacheEntry>();
let inFlight = 0;
const queue: Array<() => void> = [];

function schedule<T>(task: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = (): void => {
      inFlight++;
      task()
        .then(resolve, reject)
        .finally(() => {
          inFlight--;
          const next = queue.shift();
          if (next) {
            next();
          }
        });
    };

    if (inFlight < MAX_CONCURRENT) {
      run();
    } else {
      queue.push(run);
    }
  });
}

async function loadThumbnail(path: string): Promise<string | null> {
  let entry = cache.get(path);
  if (entry) {
    if (entry.url !== null || entry.failed) {
      return entry.url;
    }
    if (entry.promise) {
      return entry.promise;
    }
  } else {
    entry = { url: null };
    cache.set(path, entry);
  }

  const promise = schedule(async () => {
    try {
      const url = await invoke<string>('organizer_get_thumbnail', { filePath: path });
      entry!.url = url;
      return url;
    } catch (e) {
      entry!.failed = true;
      console.warn('[useThumbnail] Не удалось получить миниатюру:', path, e);
      return null;
    } finally {
      entry!.promise = undefined;
    }
  });

  entry.promise = promise;
  return promise;
}

export interface UseThumbnailOptions {
  /** Если false — ничего не запрашиваем (например, расширение неподдерживаемое). */
  enabled?: MaybeRefOrGetter<boolean>;
}

export interface UseThumbnailResult {
  /** data-URL готовой миниатюры или `null`, пока грузится / при ошибке. */
  url: Ref<string | null>;
  /** true — пока висит сетевой/диск-запрос. */
  loading: Ref<boolean>;
}

/**
 * Берёт путь и возвращает реактивный data-URL миниатюры.
 * Запрос стартует автоматически при первом обращении и при смене пути.
 * Если `enabled` ложно — стоит, ничего не дёргает.
 */
export function useThumbnail(
  path: MaybeRefOrGetter<string>,
  options: UseThumbnailOptions = {},
): UseThumbnailResult {
  const url = ref<string | null>(null);
  const loading = ref(false);
  let cancelled = false;
  let lastRequestedPath: string | null = null;

  function refresh(): void {
    const currentPath = toValue(path);
    const enabled = options.enabled === undefined ? true : toValue(options.enabled);

    if (!enabled || !currentPath) {
      url.value = null;
      loading.value = false;
      lastRequestedPath = null;
      return;
    }

    if (lastRequestedPath === currentPath && url.value !== null) {
      return;
    }

    lastRequestedPath = currentPath;
    const cached = cache.get(currentPath);
    if (cached?.url) {
      url.value = cached.url;
      loading.value = false;
      return;
    }

    loading.value = true;
    loadThumbnail(currentPath)
      .then((result) => {
        if (cancelled || lastRequestedPath !== currentPath) {
          return;
        }

        url.value = result;
      })
      .finally(() => {
        if (!cancelled && lastRequestedPath === currentPath) {
          loading.value = false;
        }
      });
  }

  watch(
    () => [toValue(path), options.enabled === undefined ? true : toValue(options.enabled)],
    refresh,
    { immediate: true },
  );

  onScopeDispose(() => {
    cancelled = true;
  });

  return { url, loading };
}
