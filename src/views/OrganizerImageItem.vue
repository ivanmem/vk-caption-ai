<template>
  <div class="image-item">
    <div class="image-item-thumb">
      <img
        v-if="previewable && thumbnailUrl"
        :src="thumbnailUrl"
        :alt="item.name"
        decoding="async"
        @error="onThumbError"
      >
      <n-icon v-else :component="FileImageIcon" size="32" />
    </div>
    <div class="image-item-info">
      <n-button
        text
        tag="a"
        type="primary"
        class="image-item-name"
        :title="`Открыть файл: ${item.path}`"
        @click="emit('open', item)"
      >
        {{ item.name }}
      </n-button>
      <div class="image-item-sub">
        <template v-if="item.error">
          <n-text type="error" depth="3" style="font-size: 12px">
            {{ item.error }}
          </n-text>
        </template>
        <template v-else-if="item.targetFolder">
          <n-text depth="3" style="font-size: 12px">→ {{ item.targetFolder }}</n-text>
          <template v-if="item.movedTo">
            <n-text depth="3" style="font-size: 12px"> · </n-text>
            <n-button
              text
              tag="a"
              type="primary"
              class="image-item-path"
              :title="`Показать в проводнике: ${item.movedTo}`"
              @click="emit('reveal', item)"
            >
              {{ item.movedTo }}
            </n-button>
          </template>
        </template>
        <template v-else>
          <n-text depth="3" style="font-size: 12px">Ожидание...</n-text>
        </template>
      </div>
    </div>
    <n-tag size="small" :type="statusType">
      {{ statusLabel }}
    </n-tag>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { NButton, NIcon, NTag, NText } from 'naive-ui';
import { ImageOutline as FileImageIcon } from '@vicons/ionicons5';
import { useThumbnail } from '@/composables/useThumbnail';
import type { OrganizerImage } from '@/stores/organizer';

const PREVIEWABLE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp']);

const props = defineProps<{
  item: OrganizerImage;
  showThumbnail: boolean;
  statusLabel: string;
  statusType: 'default' | 'info' | 'success' | 'warning' | 'error';
}>();

const emit = defineEmits<{
  open: [item: OrganizerImage];
  reveal: [item: OrganizerImage];
}>();

const broken = ref(false);

const previewable = computed(() => {
  if (!props.showThumbnail || broken.value) {
    return false;
  }

  const dot = props.item.name.lastIndexOf('.');
  if (dot < 0) {
    return false;
  }

  const ext = props.item.name.slice(dot + 1).toLowerCase();
  return PREVIEWABLE_EXTS.has(ext);
});

const { url: thumbnailUrl } = useThumbnail(() => props.item.path, { enabled: previewable });

function onThumbError(): void {
  console.warn('[Organizer] Thumbnail decode failed:', props.item.path);
  broken.value = true;
}
</script>

<style scoped lang="scss">
.image-item {
  display: flex;
  align-items: center;
  gap: $spacing-md;
  padding: $spacing-sm $spacing-md;
  border-bottom: 1px solid var(--n-border-color);
  min-height: 76px;

  &:last-child {
    border-bottom: none;
  }

  &-thumb {
    flex-shrink: 0;
    width: 56px;
    height: 56px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: $radius-sm;
    background: var(--n-action-color, rgba(128, 128, 128, 0.08));
    overflow: hidden;

    > img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
  }

  &-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    overflow: hidden;
  }

  &-name {
    font-weight: 600;
    text-align: left;
    justify-content: flex-start;
    max-width: 100%;

    :deep(.n-button__content) {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      display: block;
      max-width: 100%;
    }
  }

  &-sub {
    display: flex;
    align-items: center;
    gap: 4px;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  &-path {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;

    :deep(.n-button__content) {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      display: block;
      max-width: 100%;
    }
  }
}
</style>
