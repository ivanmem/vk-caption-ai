import { ref, computed } from "vue";
import { invoke } from "@tauri-apps/api/core";

export function useLmstudioModels() {
  const loadingModels = ref(false);
  const availableModels = ref<string[]>([]);

  const modelOptions = computed(() => {
    return availableModels.value.map((m) => ({
      label: m,
      value: m,
    }));
  });

  async function handleModelsFetch(): Promise<void> {
    if (loadingModels.value) {
      return;
    }

    loadingModels.value = true;
    try {
      const models = await invoke<string[]>("list_lmstudio_models");
      availableModels.value = models;
    } catch (e) {
      console.warn("Failed to fetch models from LMStudio:", e);
    } finally {
      loadingModels.value = false;
    }
  }

  return {
    loadingModels,
    availableModels,
    modelOptions,
    handleModelsFetch,
  };
}
