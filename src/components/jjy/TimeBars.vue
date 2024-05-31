<script setup lang="ts">
import { Dayjs } from '@/lib/dayjs';
import {
  TimeCodeName,
  TimeCodeSignalDescription,
  getTimeCodeDescription,
  callsignEnabled,
  type EncodeOptions,
  type TimeCode,
} from '@/lib/jjy';

const {
  timeCodes,
  time,
  jjyOptions,
  length,
  offset = 0,
} = defineProps<{
  timeCodes: TimeCode[];
  time: Dayjs;
  jjyOptions: EncodeOptions;
  length: number;
  offset?: number;
}>();
</script>

<template>
  <v-sheet
    v-for="(timecode, index) in timeCodes.slice(offset, length + offset)"
    :key="index"
    class="timebar d-inline-flex justify-center align-center"
    :class="{
      now: time.second() === offset + index,
      'marker-position': timecode === 'P',
      'marker-zero': timecode === '0',
      'marker-one': timecode === '1',
      'marker-sign': timecode === 'S',
    }"
  >
    <v-tooltip activator="parent" location="bottom" open-delay="100" class="timebar-tooltip">
      <div class="title">
        <div
          class="legend"
          :class="{
            'marker-position': timecode === 'P',
            'marker-zero': timecode === '0',
            'marker-one': timecode === '1',
            'marker-sign': timecode === 'S',
          }"
        ></div>
        <span>{{ offset + index }}: {{ TimeCodeName[timecode] }}</span>
      </div>
      <div>{{ getTimeCodeDescription(offset + index, callsignEnabled(time, jjyOptions)) }}</div>
      <div>{{ TimeCodeSignalDescription[timecode] }}</div>
    </v-tooltip>
  </v-sheet>
</template>

<style lang="scss">
.timebar,
.timebar-tooltip {
  &.marker-position,
  .marker-position {
    background-size: auto auto;
    background-color: #f44336;
    background-image: repeating-linear-gradient(60deg, transparent, transparent 10px, #ffebee 10px, #ffebee 20px);
  }

  &.marker-zero,
  .marker-zero {
    background-color: #2196f3;
  }

  &.marker-one,
  .marker-one {
    background-color: #ffd54f;
  }

  &.marker-sign,
  .marker-sign {
    background-size: auto auto;
    background-color: #009688;
    background-image: repeating-linear-gradient(0deg, transparent, transparent 10px, #e0f2f1 10px, #e0f2f1 20px);
  }
}

.timebar {
  width: 30px;
  height: 80px;
  border: solid 2px #121212;
  transition: transform 0.2s;

  &:hover {
    transform: scale(1.15);
  }

  &.now {
    border: solid 2px #f4f5fa;
    border-top-width: 5px;
    border-bottom-width: 5px;
    outline: #121212 2px solid;
  }
}

.timebar-tooltip {
  .title {
    font-size: 125%;
    font-weight: bold;
  }

  .legend {
    width: 15px;
    height: 15px;
    border: solid 1px #121212;
    display: inline-block;
    margin-right: 5px;
  }
}
</style>
