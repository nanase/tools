<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';

const {
  tag = 'span',
  block,
  overlook,
} = defineProps<{
  tag?: string;
  block?: boolean;
  overlook?: boolean;
}>();
const Tag = tag;

declare global {
  interface Window {
    MathJax: {
      typesetPromise: (nodes?: Iterable<Node>) => Promise<void>;
      typesetClear: (nodes?: Iterable<Node>) => Promise<void>;
    };
  }
}

if (!('MathJax' in window)) {
  console.warn('window.MathJax does not exist. For typesetting, MathJax import is required.');
}

const raw = ref<HTMLElement>();
const formula = ref<HTMLElement>();
const observer = new MutationObserver(typeset);

async function typeset() {
  if (!raw.value || !formula.value) {
    return;
  }

  if (raw.value.children.length === 0) {
    if (block) {
      formula.value.innerText = `$$ ${raw.value.innerText} $$`;
    } else {
      formula.value.innerText = `\\( ${raw.value.innerText} \\)`;
    }
  } else {
    while (formula.value.lastElementChild) {
      formula.value.removeChild(formula.value.lastElementChild);
    }

    for (const childNode of raw.value.childNodes) {
      formula.value.appendChild(childNode.cloneNode(true));
    }
  }

  await window.MathJax.typesetPromise([formula.value]);
}

async function updateObservation() {
  if (!raw.value || !formula.value) {
    return;
  }

  if (overlook) {
    observer.disconnect();
    window.MathJax.typesetClear([formula.value]);
  } else {
    await typeset();
    observer.observe(raw.value, { childList: true, subtree: true, characterData: true });
  }
}

watch(() => overlook, updateObservation);
onMounted(updateObservation);
onUnmounted(() => observer.disconnect);

defineExpose({ typeset });
</script>

<template>
  <Tag>
    <span ref="raw" class="mathjax-raw">
      <slot></slot>
    </span>
    <span ref="formula"></span>
  </Tag>
</template>

<style lang="scss">
.mathjax-raw {
  display: none;
}
</style>
