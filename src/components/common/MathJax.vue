<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';

const {
  tag = 'span',
  node,
  block,
  overlook,
} = defineProps<{
  tag?: string;
  node?: boolean;
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
const FormulaTag = computed<string>(() => (block ? 'div' : 'span'));
const observer = new MutationObserver(typeset);

async function typeset() {
  if (!formula.value) {
    return;
  }

  prepareFormulaNode();
  await window.MathJax.typesetPromise([formula.value]);
}

function prepareFormulaNode() {
  if (!raw.value || !formula.value) {
    return;
  }

  if (raw.value.children.length === 0 && !node) {
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
}

async function updateObservation() {
  if (overlook) {
    if (formula.value) {
      window.MathJax.typesetClear([formula.value]);
      prepareFormulaNode();
    }
  } else {
    await typeset();
  }
}

watch(() => [node, block, overlook], updateObservation);
onMounted(async () => {
  await updateObservation();

  if (raw.value) {
    observer.observe(raw.value, { childList: true, subtree: true, characterData: true });
  }
});
onUnmounted(() => observer.disconnect);

defineExpose({ typeset });
</script>

<template>
  <Tag>
    <span ref="raw" class="mathjax-raw">
      <slot></slot>
    </span>
    <FormulaTag ref="formula"></FormulaTag>
  </Tag>
</template>

<style lang="scss">
.mathjax-raw {
  display: none;
}
</style>
