<script setup lang="ts">
import { ref, watch, computed, nextTick } from 'vue';
import { whenever } from '@vueuse/core';
import { useTheme } from 'vuetify';
import { basicEditor, updateTheme } from 'prism-code-editor/setups';
import { loadTheme } from 'prism-code-editor/themes';
import 'prism-code-editor/prism/languages/xml';
import DOMPurify from 'dompurify';

import ToolAppBase from '@/components/common/ToolAppBase.vue';
import type { PrismEditor } from 'prism-code-editor';
import svgExample from '@/../public/svg/example.svg?raw';
import SVGPreviewer from './SVGPreviewer.vue';

const theme = useTheme();
let editor: PrismEditor | null = null;
const lightPreviewer = ref<InstanceType<typeof SVGPreviewer>>();
const darkPreviewer = ref<InstanceType<typeof SVGPreviewer>>();
const editorElement = ref<HTMLElement | null>(null);
const editorTheme = computed<string>(() => (theme.global.current.value.dark ? 'github-dark' : 'github-light'));
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
  // set position / scale to initial value
  position.value = { x: 0, y: 0 };
  lightScale.value = 1.0;
  darkScale.value = 1.0;

  // apply
  await nextTick();

  // at last, (re)calc transform
  lightPreviewer.value?.setInitialTransform();
}
</script>

<template>
  <ToolAppBase>
    <v-row no-gutters>
      <v-col cols="6" class="text-center">
        <SVGPreviewer
          ref="lightPreviewer"
          theme="light"
          :svgElement
          v-model:position="position"
          :scale="lightScale"
          @scale-changed="
            (newScale) => {
              darkScale = newScale;
            }
          "
          @svg-mounted.once="setInitialTransform"
        />
      </v-col>
      <v-col cols="6">
        <SVGPreviewer
          ref="darkPreviewer"
          theme="dark"
          :svgElement
          v-model:position="position"
          :scale="darkScale"
          @scale-changed="
            (newScale) => {
              lightScale = newScale;
            }
          "
        />
      </v-col>
    </v-row>
    <v-row no-gutters class="mt-1">
      <v-col class="d-flex justify-end">
        <v-tooltip text="全体を表示">
          <template #activator="{ props }">
            <v-btn
              v-bind="props"
              icon="mdi-fit-to-screen-outline"
              variant="plain"
              density="comfortable"
              @click="setInitialTransform"
            ></v-btn>
          </template>
        </v-tooltip>
      </v-col>
      <v-col cols="12">
        <div ref="editorElement"></div>
      </v-col>
    </v-row>

    <template #footer>
      <v-divider />
      <v-footer>
        <v-container>
          <h4>参考文献</h4>
          <ul>
            <li>
              <a href="https://zenn.dev/nanase_t/articles/7c14092b24424c" target="_blank">
                SVG テーマスキーマチェッカーの技術参考記事
              </a>
            </li>
          </ul>
        </v-container>
      </v-footer>
    </template>
  </ToolAppBase>
</template>
