import type { PhotoTask } from '@/stores/app';

/**
 * Заранее готовит описания для следующих фото, пока пользователь думает над текущим.
 * Задачи выстроены в цепочку: LM Studio получает запросы по одному и не делит видеокарту.
 */
export function useCaptionPrefetch(produce: (photo: PhotoTask) => Promise<string>) {
  const cache = new Map<number, Promise<string>>();
  let queue: Promise<unknown> = Promise.resolve();

  return { schedule, take, clear };

  function schedule(photos: PhotoTask[]): void {
    for (const photo of photos) {
      if (cache.has(photo.id)) {
        continue;
      }

      console.log(`[Prefetch] В очередь фото ${photo.id}`);
      const task = queue.then(() => produce(photo));
      queue = task.catch((err) => {
        console.warn(`[Prefetch] Не удалось подготовить описание для фото ${photo.id}`, err);
      });
      cache.set(photo.id, task);
    }
  }

  // Готовое описание забирается один раз: дальше фото обрабатывается обычным путём
  function take(photo: PhotoTask): Promise<string> | undefined {
    const task = cache.get(photo.id);
    cache.delete(photo.id);

    return task;
  }

  // Цепочку не трогаем: уже запущенный запрос продолжает выполняться, и новые задачи
  // должны встать за ним, иначе LM Studio получит два запроса разом
  function clear(): void {
    cache.clear();
  }
}
