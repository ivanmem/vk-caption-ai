<template>
  <n-modal
    :show="!!review"
    :closable="true"
    :mask-closable="false"
    :close-on-esc="false"
    preset="card"
    title="Проверка описания"
    style="max-width: 640px; width: 90vw"
    @close="handleCancel"
  >
    <n-space vertical size="large">
      <div class="photo-block">
        <img :src="review?.photo.image_url" alt="Photo" class="photo-img" />
        <n-a :href="vkLink" class="vk-link" @click.prevent="handleOpenLink">
          <n-icon :component="LinkIcon" size="14" />
          {{ vkLink }}
        </n-a>
      </div>

      <n-alert
        v-if="review?.photo.error"
        type="error"
        title="Ошибка генерации"
        closable
        @close="handleClearError"
      >
        {{ review?.photo.error }}
      </n-alert>

      <div>
        <n-text depth="3" style="font-size: 12px">Сгенерированное описание:</n-text>
        <n-input
          v-model:value="editableCaption"
          type="textarea"
          class="caption-card"
          :autosize="{ minRows: 3, maxRows: 8 }"
          :disabled="isActionProcessing"
        />
      </div>

      <n-collapse-transition :show="showComment">
        <n-space vertical size="small">
          <n-text depth="3" style="font-size: 12px">Комментарий для нейросети (необязательно):</n-text>
          <n-input
            v-model:value="userComment"
            type="textarea"
            placeholder="Например: сделай описание короче, добавь хэштеги..."
            :autosize="{ minRows: 2, maxRows: 4 }"
            :disabled="isActionProcessing"
          />
        </n-space>
      </n-collapse-transition>

      <n-space justify="end">
        <n-button
          :disabled="isActionProcessing"
          @click="handleCancel"
        >
          <template #icon>
            <n-icon :component="CloseIcon" />
          </template>
          Отмена
        </n-button>

        <n-button
          :disabled="isActionProcessing"
          @click="handleSkip"
        >
          Пропустить
        </n-button>

        <n-button
          :type="showComment ? 'warning' : 'default'"
          :loading="isActionProcessing"
          @click="handleRegenerate"
        >
          <template #icon>
            <n-icon :component="RefreshIcon" />
          </template>
          {{ showComment ? 'Перегенерировать' : 'Перегенерировать...' }}
        </n-button>

        <n-button
          type="primary"
          :disabled="isActionProcessing"
          @click="handleSave"
        >
          <template #icon>
            <n-icon :component="SaveIcon" />
          </template>
          Сохранить
        </n-button>
      </n-space>
    </n-space>
  </n-modal>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import {
  NModal, NSpace, NText, NA, NInput, NButton, NIcon,
  NCollapseTransition, NAlert,
} from 'naive-ui';
import {
  LinkOutline as LinkIcon,
  RefreshOutline as RefreshIcon,
  SaveOutline as SaveIcon,
  CloseOutline as CloseIcon,
} from '@vicons/ionicons5';
import { useAppStore } from '@/stores/app';
import { storeToRefs } from 'pinia';
import { invoke } from '@tauri-apps/api/core';

const appStore = useAppStore();
const { manualReview: review, isRegenerating } = storeToRefs(appStore);

const userComment = ref('');
const showComment = ref(false);
const editableCaption = ref('');

const isActionProcessing = computed(() => {
  return isRegenerating.value || review.value?.photo.status === 'processing';
});

const vkLink = computed(() => {
  if (!review.value) {
    return '';
  }

  const { owner_id, id } = review.value.photo;
  return `https://vk.com/photo${owner_id}_${id}`;
});

watch(review, (val) => {
  if (val) {
    console.log('[ManualReviewModal] Resetting state for new review:', val.photo.id);
    userComment.value = '';
    showComment.value = false;
    editableCaption.value = val.caption;
  }
}, { immediate: true });

async function handleOpenLink(): Promise<void> {
  try {
    // В Tauri v2 плагин opener предоставляет команду open_url
    await invoke('plugin:opener|open_url', { url: vkLink.value });
  } catch (error) {
    console.error('Failed to open link:', error);
  }
}

function handleSave(): void {
  review.value?.resolve('save', undefined, editableCaption.value);
}

function handleSkip(): void {
  review.value?.resolve('skip');
}

function handleRegenerate(): void {
  if (!showComment.value) {
    showComment.value = true;
    return;
  }

  review.value?.resolve('regenerate', userComment.value);
  showComment.value = false;
  userComment.value = '';
}

function handleCancel(): void {
  review.value?.resolve('cancel');
}

function handleClearError(): void {
  if (review.value) {
    review.value.photo.error = undefined;
  }
}
</script>

<style scoped lang="scss">
.photo-block {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: $spacing-sm;
}

.photo-img {
  max-width: 100%;
  max-height: 280px;
  border-radius: $radius-md;
  object-fit: contain;
}

.vk-link {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
}

.caption-card {
  margin-top: $spacing-xs;
  width: 100%;
}
</style>
