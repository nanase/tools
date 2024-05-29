<script setup lang="ts">
import { onMounted } from 'vue';

onMounted(() => {
  (window as any).MathJax.typeset();
});
</script>

<template>
  <slot></slot>
</template>
