<script setup lang="ts">
import { getSeconds } from 'date-fns';
import {
  TimeCodeName,
  TimeCodeSignalDescription,
  getTimeCodeDescription,
  callsignEnabled,
  type EncodeOptions,
  type TimeCode,
} from '@/lib/jjy';
import { TooltipRoot, TooltipTrigger, TooltipPortal, TooltipContent, TooltipProvider } from 'radix-vue';

const {
  timeCodes,
  time,
  jjyOptions,
  length,
  offset = 0,
} = defineProps<{
  timeCodes: TimeCode[];
  time: Date;
  jjyOptions: EncodeOptions;
  length: number;
  offset?: number;
}>();

function getBarClass(timecode: TimeCode) {
  switch (timecode) {
    case 'P':
      return 'timebar-position';
    case '0':
      return 'timebar-zero';
    case '1':
      return 'timebar-one';
    case 'S':
      return 'timebar-sign';
  }
}
</script>

<template>
  <div class="flex justify-center">
    <TooltipProvider :delay-duration="100">
      <TooltipRoot v-for="(timecode, index) in timeCodes.slice(offset, length + offset)" :key="index">
        <TooltipTrigger as-child>
          <div
            class="timebar inline-flex items-center justify-center"
            :class="[getBarClass(timecode), { now: getSeconds(time) === offset + index }]"
          />
        </TooltipTrigger>
        <TooltipPortal>
          <TooltipContent
            class="z-50 max-w-[280px] rounded-lg bg-[#333] px-3 py-2 text-sm text-white shadow-lg"
            :side-offset="4"
          >
            <div class="mb-1 flex items-center gap-1.5 font-bold">
              <div class="inline-block size-3.5 shrink-0 border border-[#121212]" :class="getBarClass(timecode)" />
              <span>{{ offset + index }}: {{ TimeCodeName[timecode] }}</span>
            </div>
            <div>{{ getTimeCodeDescription(offset + index, callsignEnabled(time, jjyOptions)) }}</div>
            <div class="opacity-70">{{ TimeCodeSignalDescription[timecode] }}</div>
          </TooltipContent>
        </TooltipPortal>
      </TooltipRoot>
    </TooltipProvider>
  </div>
</template>

<style>
.timebar-position {
  background-size: auto auto;
  background-color: #f44336;
  background-image: repeating-linear-gradient(60deg, transparent, transparent 10px, #ffebee 10px, #ffebee 20px);
}

.timebar-zero {
  background-color: #2196f3;
}

.timebar-one {
  background-color: #ffd54f;
}

.timebar-sign {
  background-size: auto auto;
  background-color: #009688;
  background-image: repeating-linear-gradient(0deg, transparent, transparent 10px, #e0f2f1 10px, #e0f2f1 20px);
}

.timebar {
  width: 30px;
  height: 80px;
  border: solid 2px #121212;
  transition: transform 0.2s;
  cursor: default;
}

.timebar:hover {
  transform: scale(1.15);
}

.timebar.now {
  border: solid 2px #f4f5fa;
  border-top-width: 5px;
  border-bottom-width: 5px;
  outline: #121212 2px solid;
}
</style>
