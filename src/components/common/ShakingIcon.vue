<script setup lang="ts"></script>

<template>
  <v-icon class="shaking-icon" />
</template>

<style lang="scss">
.shaking-icon {
  animation: shaking-icon-animation 3s infinite;
}

@keyframes shaking-icon-animation {
  0% {
    transform: translate(0, 0);
  }

  2% {
    transform: translate(2px, 0);
  }

  6% {
    transform: translate(-2px, 0);
  }

  10% {
    transform: translate(2px, 0);
  }

  14% {
    transform: translate(-2px, 0);
  }

  18% {
    transform: translate(0, 0);
  }
}
</style>
