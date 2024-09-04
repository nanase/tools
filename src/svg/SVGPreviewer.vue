<script setup lang="ts">
import { ref, watch } from 'vue';

const { theme, svgElement } = defineProps<{
  theme: 'light' | 'dark';
  svgElement?: SVGSVGElement;
}>();

const position = defineModel<{ x: number; y: number }>('position');
const scale = defineModel<number>('scale');
const previewElement = ref<HTMLIFrameElement | null>(null);

watch(
  () => svgElement,
  () => {
    if (svgElement && previewElement.value) {
      const newNode = cloneSVGSVGElement(svgElement);
      updateSvgStyles(newNode);
      insertSVGIntoIframe(newNode, previewElement.value, theme);

      let mousedownState = false;
      let startX = 0;
      let startY = 0;
      previewElement.value.contentDocument?.addEventListener('mousedown', function (ev) {
        mousedownState = true;
        startX = ev.x;
        startY = ev.y;
      });
      previewElement.value.contentDocument?.addEventListener('mouseup', function () {
        mousedownState = false;
      });
      previewElement.value.contentDocument?.addEventListener('mousemove', function (ev) {
        if (mousedownState && position.value) {
          const dx = ev.x - startX;
          const dy = ev.y - startY;
          position.value.x += dx;
          position.value.y += dy;
          startX = ev.x;
          startY = ev.y;
        }
      });
      previewElement.value.contentDocument?.addEventListener(
        'wheel',
        function (ev) {
          ev.preventDefault();

          const rect = previewElement.value?.contentDocument?.body.getBoundingClientRect();
          if (!rect || !position.value || !scale.value) {
            return;
          }
          const mouseX = ev.x - rect.left;
          const mouseY = ev.y - rect.top;
          const newScale = scale.value * (ev.deltaY < 0 ? 1.1 : 0.9);
          const dx = mouseX - (mouseX * newScale) / scale.value;
          const dy = mouseY - (mouseY * newScale) / scale.value;
          position.value.x += dx;
          position.value.y += dy;
          scale.value = newScale;
        },
        { passive: false },
      );
    }
  },
);

watch(
  () => [position.value?.x, position.value?.y, scale.value],
  () => {
    const style = previewElement.value?.contentDocument?.body.style;

    if (style && position.value && scale.value) {
      style.transform = `translate(${position.value.x}px, ${position.value.y}px) scale(${scale.value})`;
    }
  },
);

function cloneSVGSVGElement(element: SVGSVGElement): SVGSVGElement {
  return element.cloneNode(true) as SVGSVGElement;
}

function insertSVGIntoIframe(svgSvgElement: SVGSVGElement, iframe: HTMLIFrameElement, theme: 'dark' | 'light') {
  const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;

  if (!iframeDoc) {
    console.error('Failed to access iframe document.');
    return;
  }

  iframeDoc.open();
  iframeDoc.close();
  iframeDoc.body.appendChild(svgSvgElement);
  iframeDoc.body.style.margin = '0';
  iframeDoc.body.style.overflow = 'hidden';
  iframeDoc.body.parentElement!.style.cursor = 'grab';
  iframeDoc.body.classList.add(`theme-${theme}`);
}

function updateSvgStyles(svgElement: SVGSVGElement): void {
  const styleElement = svgElement.querySelector('style');

  if (!styleElement || !styleElement.textContent) {
    return;
  }

  let styleText = styleElement.textContent;

  styleText = styleText.replace(/@media\s*\(prefers-color-scheme:\s*dark\)\s*\{([^}]+)\}/g, '.theme-dark {$1}');
  styleText = styleText.replace(/@media\s*\(prefers-color-scheme:\s*light\)\s*\{([^}]+)\}/g, '.theme-light {$1}');
  styleText = styleText.replace(/:root/g, 'svg');

  const newStyleElement = document.createElement('style');
  newStyleElement.textContent = styleText;

  svgElement.replaceChild(newStyleElement, styleElement);
}
</script>

<template>
  <iframe ref="previewElement" class="preview" :class="`theme-${theme}`"></iframe>
</template>

<style lang="scss" scoped>
.preview {
  height: 100%;
  width: 100%;
  min-height: 300px;
  border: 1px solid #444;
  background-size: 20px 20px;
  background-position:
    0 0,
    10px 0,
    10px -10px,
    0 10px;
  background-repeat: repeat;
  background-color: var(--preview-background-color);
  background-image: linear-gradient(45deg, var(--preview-checker-color) 26%, transparent 26%),
    linear-gradient(135deg, var(--preview-checker-color) 26%, transparent 26%),
    linear-gradient(45deg, transparent 75%, var(--preview-checker-color) 75%),
    linear-gradient(135deg, transparent 75%, var(--preview-checker-color) 75%);

  &.theme-light {
    --preview-background-color: white;
    --preview-checker-color: #f8f8f8;
  }

  &.theme-dark {
    --preview-background-color: #111;
    --preview-checker-color: #191919;
  }
}
</style>
