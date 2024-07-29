<script setup lang="ts">
import { onMounted, ref } from 'vue';

const { tag = 'span', block } = defineProps<{
  tag?: string;
  block?: boolean;
}>();
const Tag = tag;

const container = ref<HTMLElement>();

onMounted(async () => {
  if (container.value) {
    if (container.value.children.length === 0) {
      if (block) {
        container.value.innerText = `$$ ${container.value.innerText} $$`;
      } else {
        container.value.innerText = `\\( ${container.value.innerText} \\)`;
      }
    }

    await (window as any).MathJax.startup.promise;
    (window as any).MathJax.typesetClear([container.value]);
    await (window as any).MathJax.typesetPromise([container.value]);
  }
});
</script>

<template>
  <Tag ref="container">
    <slot></slot>
  </Tag>
</template>
