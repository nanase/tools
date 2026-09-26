<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { useIntervalFn } from '@vueuse/core';
import { Rules } from '@nanase/alnilam/inputRule';
import { getSeconds, getUnixTime, startOfSecond, startOfMinute, differenceInSeconds, subMilliseconds, differenceInMilliseconds } from 'date-fns';
import { encode, StopAfterItems, StopDurationItems, CallSignItems, type TimeCode, type EncodeOptions } from '@/lib/jjy';
import { SliderRoot, SliderTrack, SliderRange, SliderThumb } from 'radix-vue';
import { DialogRoot, DialogPortal, DialogContent, DialogOverlay, DialogClose } from 'radix-vue';
import * as Tone from 'tone';

import AnimatedClock from '@/components/jjy/AnimatedClock.vue';
import TimeBars from '@/components/jjy/TimeBars.vue';
import InputRow from '@/components/input/InputRow.vue';
import SignalIndicator from '@/components/common/SignalIndicator.vue';

const time = ref<Date>(new Date());
const timeOnSeconds = ref<Date>(startOfSecond(new Date()));
const timeOnMinutes = ref<Date>(startOfMinute(new Date()));
const stopped = ref<boolean>(false);
const timeIsNow = ref<boolean>(true);
const timeDiff = ref<number>(0);
const timeBars = computed<TimeCode[]>(() => encode(timeOnMinutes.value, jjyOptions.value));
const jjyOptions = ref<EncodeOptions>({
  callSign: 'default',
  leapSecondType: true,
  stopAfter: 0,
  stopDuration: 3,
});
const soundPlaying = ref<boolean>(false);
const soundSendMode = ref<boolean>(false);
const soundFreq = ref<number>(440);
const soundVolume = ref<number>(0.5);
const soundVolumeSlider = computed<number[]>({
  get: () => [soundVolume.value],
  set: (v: number[]) => {
    soundVolume.value = v[0];
  },
});
const soundSignal = ref<number>(-Infinity);
const helpDialogOpen = ref(false);
let synth: Tone.Synth<Tone.SynthOptions> | null = null;
let meter: Tone.Meter | null = null;
let playingCallsign = false;

useIntervalFn(() => {
  if (!stopped.value) {
    time.value = subMilliseconds(new Date(), timeDiff.value);
  }

  if (getUnixTime(timeOnSeconds.value) !== getUnixTime(time.value)) {
    timeOnSeconds.value = startOfSecond(time.value);

    if (differenceInSeconds(time.value, timeOnMinutes.value) >= 60) {
      timeOnMinutes.value = startOfMinute(time.value);
    }
  }
}, 50);

watch(
  () => timeOnSeconds.value,
  () => {
    if (!soundPlaying.value) {
      return;
    }

    let position = Tone.now();

    function tone(duration: number, high: boolean) {
      const freq = soundSendMode.value
        ? 13333.333
        : Number.isFinite(Number(soundFreq.value))
          ? Math.min(Math.max(Number(soundFreq.value), 20), 24000)
          : 440;

      if (synth != null) {
        synth.oscillator.type = soundSendMode.value ? 'square' : 'sine';
        synth.triggerAttackRelease(freq, duration, position, soundVolume.value * (high ? 1.0 : 0.1));
      }
      position += duration;
    }

    function long() {
      tone(0.25, true);
      tone(0.1, false);
    }

    function short() {
      tone(0.1, true);
      tone(0.1, false);
    }

    switch (timeBars.value[getSeconds(timeOnSeconds.value)]) {
      case 'P': {
        playingCallsign = false;
        tone(0.2, true);
        tone(0.8 + 1, false);
        break;
      }

      case '0': {
        playingCallsign = false;
        tone(0.8, true);
        tone(0.2 + 1, false);
        break;
      }

      case '1': {
        playingCallsign = false;
        tone(0.5, true);
        tone(0.5 + 1, false);
        break;
      }

      case 'S': {
        if (!playingCallsign) {
          playingCallsign = true;

          for (let i = 0; i < 2; i++) {
            tone(0.3, false);

            // J .---
            short();
            long();
            long();
            long();
            tone(0.05, false);

            // J .---
            short();
            long();
            long();
            long();
            tone(0.05, false);

            // Y -.--
            long();
            short();
            long();
            long();
            tone(0.05, false);
          }

          tone(0.6 + 0.1, false);
        }

        break;
      }
    }
  },
);

function clickTimeIsNow() {
  if (!timeIsNow.value) {
    timeDiff.value = 0;
    stopped.value = false;
  }
}

function clickStopped() {
  if (!stopped.value) {
    timeIsNow.value = false;
  } else {
    timeDiff.value = differenceInMilliseconds(new Date(), time.value);
  }
}

async function clickSoundPlaying() {
  if (!soundPlaying.value && synth == null) {
    await Tone.start();
    synth = new Tone.Synth({
      envelope: { attack: 0.05, decay: 0.05, sustain: 0.8, release: 0.05 },
    }).toDestination();
    meter = new Tone.Meter({ smoothing: 0 });
    synth.connect(meter);
  } else {
    synth?.triggerRelease();
  }
}

useIntervalFn(() => {
  if (meter) {
    const rawValue = meter.getValue();
    soundSignal.value = Array.isArray(rawValue) ? rawValue[0] : rawValue;
  }
}, 100);
</script>

<template>
  <div class="mb-4 flex flex-wrap items-center gap-4">
    <div class="flex-1">
      <AnimatedClock :time="time" />
    </div>
    <label class="flex items-center gap-2 text-sm">
      <input type="checkbox" v-model="stopped" @click="clickStopped" class="accent-[var(--color-negative)]" />
      停止
    </label>
    <label class="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        v-model="timeIsNow"
        @click="clickTimeIsNow"
        :disabled="timeIsNow"
      />
      現在の時刻
    </label>
  </div>

  <div v-for="n in 2" :key="n" class="flex justify-center">
    <TimeBars :time-codes="timeBars" :time="timeOnSeconds" :jjy-options="jjyOptions" :length="30" :offset="(n - 1) * 30" />
  </div>

  <div class="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
    <div>
      <label class="mb-1 block text-xs opacity-60">コールサイン</label>
      <select
        v-model="jjyOptions.callSign"
        class="w-full border-b border-[var(--color-on-background)]/30 bg-transparent py-1 text-sm outline-none focus:border-[var(--color-primary)]"
      >
        <option v-for="item in CallSignItems" :key="item.value" :value="item.value">{{ item.title }}</option>
      </select>
    </div>
    <div class="space-y-1">
      <label class="flex items-center gap-2 text-sm">
        <input type="checkbox" v-model="jjyOptions.summerTime" />
        夏時間実施中
      </label>
      <label class="flex items-center gap-2 text-sm">
        <input type="checkbox" v-model="jjyOptions.summerTimeNotice" />
        6日以内に夏時間を開始または終了
      </label>
    </div>
    <div class="space-y-1">
      <label class="flex items-center gap-2 text-sm">
        <input type="checkbox" v-model="jjyOptions.leapSecondNotice" />
        月末に閏秒を実施
      </label>
      <div class="flex gap-4 pl-6">
        <label class="flex items-center gap-1 text-sm" :class="{ 'opacity-40': !(jjyOptions.leapSecondNotice ?? false) }">
          <input
            type="radio"
            :value="true"
            v-model="jjyOptions.leapSecondType"
            :disabled="!(jjyOptions.leapSecondNotice ?? false)"
          />
          挿入
        </label>
        <label class="flex items-center gap-1 text-sm" :class="{ 'opacity-40': !(jjyOptions.leapSecondNotice ?? false) }">
          <input
            type="radio"
            :value="false"
            v-model="jjyOptions.leapSecondType"
            :disabled="!(jjyOptions.leapSecondNotice ?? false)"
          />
          削除
        </label>
      </div>
    </div>
    <div class="space-y-2">
      <div>
        <label class="mb-1 block text-xs opacity-60">停波</label>
        <select
          v-model="jjyOptions.stopAfter"
          class="w-full border-b border-[var(--color-on-background)]/30 bg-transparent py-1 text-sm outline-none focus:border-[var(--color-primary)]"
        >
          <option v-for="item in StopAfterItems" :key="item.value" :value="item.value">{{ item.title }}</option>
        </select>
      </div>
      <div>
        <label class="mb-1 block text-xs opacity-60">停波期間</label>
        <select
          v-model="jjyOptions.stopDuration"
          class="w-full border-b border-[var(--color-on-background)]/30 bg-transparent py-1 text-sm outline-none focus:border-[var(--color-primary)]"
        >
          <option v-for="item in StopDurationItems.slice(1)" :key="item.value" :value="item.value">{{ item.title }}</option>
        </select>
      </div>
      <label class="flex items-center gap-2 text-sm">
        <input type="checkbox" v-model="jjyOptions.stopType" />
        停波は昼間のみ
      </label>
    </div>
  </div>

  <hr class="my-6 border-[var(--color-on-background)]/10" />

  <div class="grid grid-cols-1 gap-6 sm:grid-cols-2">
    <div class="space-y-2">
      <div class="flex items-center gap-3">
        <label class="flex items-center gap-2 text-sm">
          <input type="checkbox" v-model="soundPlaying" @click="clickSoundPlaying" />
          音の再生
        </label>
        <SignalIndicator :value="soundSignal" :max="-10" :min="-30" :disabled="!soundPlaying" class="size-4" />
      </div>
      <label class="flex items-center gap-2 text-sm">
        <input type="checkbox" v-model="soundSendMode" />
        時刻合わせモード
      </label>
      <button
        class="mt-2 rounded border border-[var(--color-on-background)]/20 px-3 py-1.5 text-sm transition-colors hover:bg-[var(--color-on-background)]/10"
        @click="helpDialogOpen = true"
      >
        <span class="mdi mdi-help mr-1" />時刻合わせのやりかた
      </button>

      <DialogRoot v-model:open="helpDialogOpen">
        <DialogPortal>
          <DialogOverlay class="fixed inset-0 z-40 bg-black/30" />
          <DialogContent
            class="fixed top-1/2 left-1/2 z-50 max-h-[85vh] w-full max-w-xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg bg-[var(--color-surface)] p-6 shadow-xl focus:outline-none"
          >
            <h3 class="mb-3 text-lg font-semibold">時刻合わせのやりかた</h3>
            <p class="mb-2 text-sm">
              お使いのデバイスにスピーカーまたはイヤホンを接続して「音の再生」と「時刻合わせモード」を有効にしてください。スピーカーまたはイヤホンの配線部分に電波時計を近づけると受信が始まります。
            </p>
            <p class="mb-4 text-sm opacity-70">
              サウンドデバイスによってはローパスフィルターによって 40kHz
              の信号が生成できず時刻合わせができない場合があります。時刻合わせによって生じた問題について責任は負いかねます。ご了承ください。
            </p>
            <div class="mb-3 flex flex-wrap gap-4">
              <label class="flex items-center gap-2 text-sm">
                <input type="checkbox" v-model="soundPlaying" @click="clickSoundPlaying" />
                音の再生
              </label>
              <label class="flex items-center gap-2 text-sm">
                <input type="checkbox" v-model="soundSendMode" />
                時刻合わせモード
              </label>
            </div>
            <div class="mb-4">
              <label class="mb-1 block text-xs opacity-60">ボリューム</label>
              <SliderRoot
                v-model="soundVolumeSlider"
                :max="1"
                :min="0"
                :step="0.01"
                class="relative flex w-full touch-none items-center select-none"
              >
                <SliderTrack class="relative h-1 w-full grow rounded-full bg-[var(--color-on-background)]/15">
                  <SliderRange class="absolute h-full rounded-full bg-[var(--color-primary)]" />
                </SliderTrack>
                <SliderThumb
                  class="block size-4 rounded-full bg-[var(--color-primary)] shadow focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/50"
                />
              </SliderRoot>
            </div>
            <div class="flex justify-end">
              <DialogClose as-child>
                <button class="rounded px-4 py-1.5 text-sm transition-colors hover:bg-[var(--color-on-background)]/10">
                  閉じる
                </button>
              </DialogClose>
            </div>
          </DialogContent>
        </DialogPortal>
      </DialogRoot>
    </div>
    <div class="space-y-3">
      <InputRow
        v-model="soundFreq"
        label="音の周波数"
        :max="24000"
        :min="20"
        scale="log"
        unit="Hz"
        :rule="[Rules.required, Rules.value, Rules.notNegative]"
      />
      <InputRow
        v-model="soundVolume"
        label="ボリューム"
        :max="1"
        :min="0"
        :fraction-digits="3"
        :rule="[Rules.required, Rules.value, Rules.notNegative]"
      />
    </div>
  </div>
</template>
