<script setup lang="ts">
import { ref, watch, computed, nextTick } from 'vue';
import { whenever } from '@vueuse/core';
import { basicEditor, updateTheme } from 'prism-code-editor/setups';
import { loadTheme } from 'prism-code-editor/themes';
import 'prism-code-editor/prism/languages/xml';
import DOMPurify from 'dompurify';

import { useTheme } from '@/composables/useTheme';
import type { PrismEditor } from 'prism-code-editor';
import svgExample from '@/../public/svg/example.svg?raw';
import SVGPreviewer from './SVGPreviewerNew.vue';

const { isDark } = useTheme();
let editor: PrismEditor | null = null;
const lightPreviewer = ref<InstanceType<typeof SVGPreviewer>>();
const darkPreviewer = ref<InstanceType<typeof SVGPreviewer>>();
const editorElement = ref<HTMLElement | null>(null);
const editorTheme = computed<string>(() => (isDark.value ? 'github-dark' : 'github-light'));
const svgElement = ref<SVGSVGElement>();
const position = ref<{ x: number; y: number }>({ x: 0, y: 0 });
const lightScale = ref<number>(1.0);
const darkScale = ref<number>(1.0);

DOMPurify.addHook('afterSanitizeAttributes', function (node) {
  if (node.hasAttribute('xlink:href') && !node.getAttribute('xlink:href')?.match(/^#/)) {
    node.remove();
  }
});

whenever(
  () => editorElement.value,
  (editorElement) => {
    editor = basicEditor(
      editorElement,
      {
        language: 'xml',
        theme: editorTheme.value,
        value: svgExample,
      },
      () => {
        editor!.scrollContainer.style.height = '300px';
        onUpdateEditor.call(editor!, svgExample);
        editor!.addListener('update', onUpdateEditor);
      },
    );
  },
);

watch(
  () => editorTheme.value,
  async () => {
    if (editor) {
      await loadTheme(editorTheme.value);
      updateTheme(editor, editorTheme.value);
    }
  },
);

function onUpdateEditor(this: PrismEditor, value: string) {
  const cleanElement = DOMPurify.sanitize(value, { RETURN_DOM: true, ADD_TAGS: ['use'] });

  if (cleanElement.hasChildNodes() && isSVGSVGElement(cleanElement.childNodes[0])) {
    svgElement.value = cleanElement.childNodes[0];
  }
}

function isSVGSVGElement(node: Node): node is SVGSVGElement {
  return node.nodeName === 'svg';
}

async function setInitialTransform() {
  position.value = { x: 0, y: 0 };
  lightScale.value = 1.0;
  darkScale.value = 1.0;

  await nextTick();

  lightPreviewer.value?.setInitialTransform();
}
</script>

<template>
  <!-- Preview Grid -->
  <div class="grid grid-cols-2">
    <div class="text-center">
      <SVGPreviewer
        ref="lightPreviewer"
        theme="light"
        :svgElement
        v-model:position="position"
        :scale="lightScale"
        @scale-changed="(newScale) => { darkScale = newScale; }"
        @svg-mounted.once="setInitialTransform"
      />
    </div>
    <div>
      <SVGPreviewer
        ref="darkPreviewer"
        theme="dark"
        :svgElement
        v-model:position="position"
        :scale="darkScale"
        @scale-changed="(newScale) => { lightScale = newScale; }"
      />
    </div>
  </div>

  <!-- Controls -->
  <div class="mt-1 flex justify-end">
    <button
      class="rounded-lg p-2 transition-colors hover:bg-[var(--color-on-background)]/10"
      title="全体を表示"
      @click="setInitialTransform"
    >
      <span class="mdi mdi-fit-to-screen-outline text-xl" />
    </button>
  </div>

  <!-- Editor -->
  <div ref="editorElement"></div>
</template>
