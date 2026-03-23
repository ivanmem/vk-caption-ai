import { defineStore } from 'pinia';
import { ref, watch } from 'vue';

export const useThemeStore = defineStore('theme', () => {
  const getSystemDark = () =>
    window.matchMedia('(prefers-color-scheme: dark)').matches;

  // null = следуем системной теме, true/false = ручной выбор пользователя
  const userPreference = ref<boolean | null>(null);
  const isDark = ref(getSystemDark());

  // Подписываемся на изменения системной темы ОС
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  const onSystemThemeChange = (e: MediaQueryListEvent) => {
    if (userPreference.value === null) {
      isDark.value = e.matches;
    }
  };
  mediaQuery.addEventListener('change', onSystemThemeChange);

  const toggleTheme = () => {
    isDark.value = !isDark.value;
    userPreference.value = isDark.value;
  };

  const resetToSystem = () => {
    userPreference.value = null;
    isDark.value = getSystemDark();
  };

  // Восстанавливаем ручной выбор после гидрации store
  watch(userPreference, (pref) => {
    if (pref !== null) {
      isDark.value = pref;
    }
  }, { immediate: true });

  return {
    isDark,
    userPreference,
    toggleTheme,
    resetToSystem,
  };
}, {
  persist: {
    pick: ['userPreference'],
  },
});
