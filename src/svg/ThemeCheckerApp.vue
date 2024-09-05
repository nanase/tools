<script setup lang="ts">
import { ref, watch, computed, onMounted } from 'vue';
import { useTheme } from 'vuetify';
import { basicEditor, updateTheme } from 'prism-code-editor/setups';
import { loadTheme } from 'prism-code-editor/themes';
import 'prism-code-editor/prism/languages/xml';
import DOMPurify from 'dompurify';

import AppBase from '@/components/common/AppBase.vue';
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

onMounted(() => {
  if (editorElement.value) {
    editor = basicEditor(
      editorElement.value,
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
  }
});

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
  const cleanElement = DOMPurify.sanitize(value, { RETURN_DOM: true });

  if (cleanElement.hasChildNodes() && isSVGSVGElement(cleanElement.childNodes[0])) {
    svgElement.value = cleanElement.childNodes[0];
  }
}

function isSVGSVGElement(node: Node): node is SVGSVGElement {
  return node.nodeName === 'svg';
}

function setInitialTransform() {
  lightPreviewer.value?.setInitialTransform();
}
</script>

<template>
  <AppBase page-id="svg/theme-checker" toolbar-title="SVG テーマスキーマチェッカー">
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
    <v-row>
      <v-col>
        <div ref="editorElement"></div>
      </v-col>
    </v-row>
  </AppBase>
</template>
