<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { definePeriodicCall } from '@/lib/vue';
import dayjs, { Dayjs } from '@/lib/dayjs';
import { encode, StopAfterItems, StopDurationItems, CallSignItems, type TimeCode, type EncodeOptions } from '@/lib/jjy';
import { Rules } from '@/lib/siPrefix';
import * as Tone from 'tone';

import AppBase from '@/components/common/AppBase.vue';
import AnimatedClock from '@/components/common/AnimatedClock.vue';
import TimeBars from '@/components/jjy/TimeBars.vue';
import InputRow from '@/components/input/InputRow.vue';

const time = ref<Dayjs>(dayjs());
const timeOnSeconds = ref<Dayjs>(dayjs().startOf('second'));
const timeOnMinutes = ref<Dayjs>(dayjs().startOf('minute'));
const stopped = ref<boolean>();
const timeIsNow = ref<boolean>(true);
const timeDiff = ref<number>(0);
const timeBars = computed<TimeCode[]>(() => encode(timeOnMinutes.value, jjyOptions.value));
const jjyOptions = ref<EncodeOptions>({
  callSign: 'default',
  leapSecondType: true,
  stopAfter: 0,
  stopDuration: 3,
});
const soundPlaying = ref<boolean>();
const soundSendMode = ref<boolean>();
const soundFreq = ref<number>(440);
const soundVolume = ref<number>(0.5);
let synth: Tone.Synth<Tone.SynthOptions> | null = null;
let playingCallsign = false;

definePeriodicCall(async () => {
  if (!stopped.value) {
    time.value = dayjs().subtract(timeDiff.value, 'milliseconds');
  }

  if (timeOnSeconds.value.unix() != time.value.unix()) {
    timeOnSeconds.value = time.value.startOf('second');

    if (time.value.diff(timeOnMinutes.value, 'seconds') >= 60) {
      timeOnMinutes.value = time.value.startOf('minute');
    }
  }

  return 0.05;
});

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

    switch (timeBars.value[timeOnSeconds.value.second()]) {
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
    timeDiff.value = dayjs().diff(time.value, 'milliseconds');
  }
}

async function clickSoundPlaying() {
  if (!soundPlaying.value && synth == null) {
    await Tone.start();
    synth = new Tone.Synth({
      envelope: { attack: 0.05, decay: 0.05, sustain: 0.8, release: 0.05 },
    }).toDestination();
  } else {
    synth?.triggerRelease();
  }
}
</script>

<template>
  <AppBase page-id="jjy/simulator" toolbar-title="JJY シミュレータ">
    <v-row no-gutters align="center" justify="center">
      <v-col cols="5" sm="7">
        <AnimatedClock :time="time" style="font-size: 125%" />
      </v-col>
      <v-col cols="3" sm="2">
        <v-checkbox v-model="stopped" label="停止" color="red" hide-details @click="clickStopped" />
      </v-col>
      <v-col cols="4" sm="3">
        <v-checkbox v-model="timeIsNow" label="現在の時刻" hide-details @click="clickTimeIsNow" :readonly="timeIsNow" />
      </v-col>
    </v-row>
    <v-row no-gutters>
      <v-col cols="12" v-for="n in 2" :key="n" class="d-flex justify-center">
        <TimeBars :time-codes="timeBars" :time="timeOnSeconds" :jjyOptions :length="30" :offset="(n - 1) * 30" />
      </v-col>
    </v-row>
    <v-row>
      <v-col cols="6" sm="4" lg="3">
        <v-select
          label="コールサイン"
          density="compact"
          variant="underlined"
          v-model="jjyOptions.callSign"
          :items="CallSignItems"
        />
      </v-col>
      <v-col cols="6" sm="4" lg="3">
        <v-checkbox v-model="jjyOptions.summerTime" label="夏時間実施中" hide-details density="compact" />
        <v-checkbox
          v-model="jjyOptions.summerTimeNotice"
          label="6日以内に夏時間を開始または終了"
          hide-details
          density="compact"
        />
      </v-col>
      <v-col cols="6" sm="4" lg="3">
        <v-checkbox v-model="jjyOptions.leapSecondNotice" label="月末に閏秒を実施" hide-details density="compact" />
        <v-radio-group
          v-model="jjyOptions.leapSecondType"
          :disabled="!(jjyOptions.leapSecondNotice ?? false)"
          direction="horizontal"
          density="compact"
        >
          <v-radio label="挿入" :value="true" />
          <v-radio label="削除" :value="false" />
        </v-radio-group>
      </v-col>
      <v-col cols="6" sm="4" lg="3">
        <v-select
          label="停波"
          density="compact"
          variant="underlined"
          v-model="jjyOptions.stopAfter"
          :items="StopAfterItems"
        />
        <v-select
          label="停波期間"
          density="compact"
          variant="underlined"
          v-model="jjyOptions.stopDuration"
          :items="StopDurationItems.slice(1)"
        />
        <v-checkbox v-model="jjyOptions.stopType" label="停波は昼間のみ" hide-details density="compact" />
      </v-col>
      <v-divider />
    </v-row>
    <v-row>
      <v-col cols="6" sm="4" lg="3">
        <v-checkbox v-model="soundPlaying" label="音の再生" hide-details @click="clickSoundPlaying" density="compact" />
        <v-checkbox v-model="soundSendMode" label="時刻合わせモード" hide-details density="compact" />
        <v-dialog max-width="640">
          <template #activator="{ props }">
            <v-btn v-bind="props" prepend-icon="mdi-help" variant="outlined">時刻合わせのやりかた</v-btn>
          </template>
          <template #default="{ isActive }">
            <v-card title="時刻合わせのやりかた">
              <v-card-text>
                <p>
                  お使いのデバイスにスピーカーまたはイヤホンを接続して「音の再生」と「時刻合わせモード」を有効にしてください。スピーカーまたはイヤホンの配線部分に電波時計を近づけると受信が始まります。
                </p>
                <p>
                  サウンドデバイスによってはローパスフィルターによって 40kHz
                  の信号が生成できず時刻合わせができない場合があります。時刻合わせによって生じた問題について責任は負いかねます。ご了承ください。
                </p>
              </v-card-text>
              <v-container class="py-0">
                <v-row no-gutters>
                  <v-col cols="6">
                    <v-checkbox
                      v-model="soundPlaying"
                      label="音の再生"
                      hide-details
                      @click="clickSoundPlaying"
                      density="compact"
                    />
                  </v-col>
                  <v-col cols="6">
                    <v-checkbox v-model="soundSendMode" label="時刻合わせモード" hide-details density="compact" />
                  </v-col>
                  <v-col cols="12">
                    <div class="text-caption">ボリューム</div>
                    <v-slider v-model="soundVolume" min="0" max="1" thumb-label />
                  </v-col>
                </v-row>
              </v-container>
              <v-card-actions>
                <v-spacer />
                <v-btn text="閉じる" @click="isActive.value = false" />
              </v-card-actions>
            </v-card>
          </template>
        </v-dialog>
      </v-col>
      <v-col cols="6" sm="4" lg="3">
        <InputRow
          v-model="soundFreq"
          label="音の周波数"
          variant="underlined"
          density="compact"
          :max="24000"
          :min="20"
          scale="log"
          unit="Hz"
          :rule="[Rules.required, Rules.value, Rules.notNegative]"
          cols="5"
          hide-details
        />
        <InputRow
          v-model="soundVolume"
          label="ボリューム"
          variant="underlined"
          density="compact"
          :max="1"
          :min="0"
          :fraction-digits="3"
          :rule="[Rules.required, Rules.value, Rules.notNegative]"
          cols="5"
          hide-details
        />
      </v-col>
    </v-row>

    <template #footer>
      <v-divider />
      <v-footer>
        <v-container>
          <h4>参考文献</h4>
          <ul>
            <li>
              <a href="https://jjy.nict.go.jp/jjy/trans/index.html" target="_blank">標準電波の出し方</a> -
              情報通信研究機構 日本標準時グループ
            </li>
            <li><a href="https://ja.wikipedia.org/wiki/JJY" target="_blank">JJY</a> - Wikipedia</li>
            <li><a href="https://shogo82148.github.io/web-jjy/" target="_blank">JJYシミュレータWeb版</a></li>
          </ul>
        </v-container>
      </v-footer>
    </template>
  </AppBase>
</template>
