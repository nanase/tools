<script setup lang="ts">
import { ref, watch } from 'vue';

const { theme, svgElement, scale } = defineProps<{
  theme: 'light' | 'dark';
  svgElement?: SVGSVGElement;
  scale?: number;
}>();

const emits = defineEmits<{ (e: 'scaleChanged', scale: number): void; (e: 'svgMounted'): void }>();
const position = defineModel<{ x: number; y: number }>('position');
const innerScale = ref<number>(1.0);
const previewElement = ref<HTMLIFrameElement | null>(null);

defineExpose({ setInitialTransform });

watch(
  () => svgElement,
  () => {
    if (svgElement && previewElement.value && previewElement.value.contentDocument) {
      const newNode = cloneSVGSVGElement(svgElement);
      updateSvgStyles(newNode);
      insertSVGIntoIframe(newNode, previewElement.value, theme);
      addEventListener(previewElement.value.contentDocument, previewElement.value);
      emits('svgMounted');
    }
  },
);

watch(
  () => [position.value?.x, position.value?.y],
  () => {
    const body = previewElement.value?.contentDocument?.body;
    if (body && position.value) {
      setTransform(body);
    }
  },
);

watch(
  () => scale,
  () => {
    const body = previewElement.value?.contentDocument?.body;
    if (scale && body && position.value) {
      setScale(scale);
      setTransform(body);
    }
  },
);

function setInitialTransform() {
  if (
    !previewElement.value ||
    !previewElement.value.contentDocument ||
    previewElement.value.contentDocument.body.children.length === 0 ||
    !position.value
  ) {
    return;
  }

  const body = previewElement.value.contentDocument.body;
  const svgDOMRect = body.children[0].getBoundingClientRect();
  const cotainerDOMRect = previewElement.value.getBoundingClientRect();

  if (cotainerDOMRect.width > svgDOMRect.width && cotainerDOMRect.height > svgDOMRect.height) {
    // 表示領域 ＞ SVGのサイズ
    position.value.x = (cotainerDOMRect.width - svgDOMRect.width) / 2;
    position.value.y = (cotainerDOMRect.height - svgDOMRect.height) / 2;
    setScale(1.0);
  } else {
    // 表示領域 ＜ SVGのサイズ
    const newScale =
      Math.min(cotainerDOMRect.width / svgDOMRect.width, cotainerDOMRect.height / svgDOMRect.height) * 0.9;

    position.value.x = (cotainerDOMRect.width - svgDOMRect.width * newScale) / 2;
    position.value.y = (cotainerDOMRect.height - svgDOMRect.height * newScale) / 2;
    setScale(newScale);
  }
}

function getScale(): number {
  return innerScale.value ?? 1.0;
}

function setScale(value: number) {
  innerScale.value = value;
  emits('scaleChanged', value);
}

function setTransform(body: HTMLElement) {
  body.style.transformOrigin = 'top left';
  body.style.transform = `translate(${position.value?.x}px, ${position.value?.y}px) scale(${getScale()})`;
}

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
  iframeDoc.body.classList.add(`svg-inner-theme-${theme}`);
}

function updateSvgStyles(svgElement: SVGSVGElement): void {
  const styleElement = svgElement.querySelector('style');

  if (!styleElement || !styleElement.textContent) {
    return;
  }

  let styleText = styleElement.textContent;

  styleText = styleText.replace(
    /@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)\s*\{([^}]+)\}/g,
    '.svg-inner-theme-dark {$1}',
  );
  styleText = styleText.replace(
    /@media\s*\(\s*prefers-color-scheme\s*:\s*light\s*\)\s*\{([^}]+)\}/g,
    '.svg-inner-theme-light {$1}',
  );
  styleText = styleText.replace(/:root/g, 'svg');

  const newStyleElement = document.createElement('style');
  newStyleElement.textContent = styleText;

  svgElement.replaceChild(newStyleElement, styleElement);
}

function addEventListener(document: Document, iframe: HTMLIFrameElement): void {
  const body = document.body;
  let isDragging = false;
  let startX: number, startY: number;

  const iframeRect = iframe.getBoundingClientRect();

  function getAdjustedMousePosition(clientX: number, clientY: number) {
    return {
      x: clientX - iframeRect.left,
      y: clientY - iframeRect.top,
    };
  }

  document.addEventListener('mousedown', (e) => {
    if (!position.value) {
      return;
    }

    isDragging = true;
    const { x, y } = getAdjustedMousePosition(e.clientX, e.clientY);
    startX = x - position.value.x;
    startY = y - position.value.y;
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging || !position.value) {
      return;
    }

    const { x, y } = getAdjustedMousePosition(e.clientX, e.clientY);
    position.value.x = x - startX;
    position.value.y = y - startY;

    setTransform(body);
  });

  document.addEventListener('mouseup', () => {
    isDragging = false;
  });

  document.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();

      if (!position.value) {
        return;
      }

      const { x, y } = getAdjustedMousePosition(e.clientX, e.clientY);
      const delta = e.deltaY > 0 ? -0.1 : 0.1;

      let scale = getScale();
      const prevScale = scale;
      scale *= 1 + 0.1 * Math.sign(delta);

      position.value.x -= (x * (scale - prevScale)) / scale;
      position.value.y -= (y * (scale - prevScale)) / scale;

      setScale(scale);
      setTransform(body);
    },
    { passive: false },
  );

  setTransform(body);
}
</script>

<template>
  <iframe ref="previewElement" class="preview" :class="`preview-theme-${theme}`"></iframe>
</template>

<style lang="scss" scoped>
.preview {
  color-scheme: light;
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

  &.preview-theme-light {
    --preview-background-color: white;
    --preview-checker-color: #f8f8f8;
  }

  &.preview-theme-dark {
    --preview-background-color: #111;
    --preview-checker-color: #191919;
  }
}
</style>
