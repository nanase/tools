/**
 * 入力の枠とモニターの枠（InputPanel.astro・MonitorPanel.astro）の動作。
 * 入力の状態は AudioIn が持ち、ここは画面との受け渡しだけをする
 */
import { Choice } from '../../lib/choice';
import { $ } from '../../lib/dom';
import { fmt, minus } from '../../lib/format';
import { ParamGroup } from '../../lib/param';
import { AudioIn, NB, type Src } from './capture';
import { type InKey, TF_PARAM, VOL_PARAM } from './params';
import { PERIODIC, type Wave } from './signal';

const txt = (id: string, s: string) => {
  const el = $(id);
  if (el.textContent !== s) el.textContent = s;
};
const tms = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const RUN_TITLE: Record<Src, string> = {
  mic: 'マイクから取り込む・止める',
  file: 'ファイルを再生する・一時停止する',
  test: 'テスト信号を出す・止める',
};

export interface InputUi {
  readonly a: AudioIn;
  /** 毎フレーム呼ぶ: レベルと再生位置。fresh は新しい音を受け取ったか */
  tick(fresh: boolean): void;
}

export function initInput(): InputUi {
  const a = new AudioIn();
  const pnl = $('.a-in');
  const ratio = document.getElementById('p-tr');

  const g = new ParamGroup<InKey>([TF_PARAM, VOL_PARAM], (v, k) => {
    if (k === 'tf') {
      a.test = { ...a.test, f: v.tf };
      a.testChanged();
    } else if (k === 'vol') a.setVol(v.vol);
  });
  const src = new Choice<Src>($('#p-src'), (v) => a.setSrc(v));
  const tw = new Choice<Wave>($('#p-tw'), (v) => {
    a.test = { ...a.test, wave: v };
    a.testChanged();
    sync();
  });
  if (ratio) {
    new Choice<string>(ratio, (v) => {
      const [x, y] = v.split(':').map(Number);
      a.test = { ...a.test, ra: [x, y] };
      a.testChanged();
    });
    new Choice<string>($('#p-tph'), (v) => {
      a.test = { ...a.test, ph: Number(v) };
      a.testChanged();
    });
  }

  /** モニターを使えない状態（マイク）か。初めは使える状態から合わせる */
  let monOff = false;
  const snd = $<HTMLDetailsElement>('.a-snd');
  /* 畳んで開けなくしている間は、見出しを押しても開かない（開閉の動き（tool-page.ts）より先に止める） */
  snd.addEventListener(
    'click',
    (e) => {
      if (!snd.classList.contains('lock') || !(e.target as Element).closest('summary')) return;
      e.preventDefault();
      e.stopPropagation();
    },
    true,
  );
  /** 枠の表示を入力の状態に合わせる */
  function sync(): void {
    const s = a.src,
      on = s === 'mic' ? a.micOn : s === 'file' ? a.playing : a.run;
    src.set(s);
    const rb = $<HTMLButtonElement>('#runBtn');
    rb.disabled = s === 'file' && !a.buf;
    rb.setAttribute('aria-pressed', String(on));
    rb.title = RUN_TITLE[s];
    $('#runLed').classList.toggle('on', on);
    txt('#runT', s === 'file' ? (on ? '一時停止' : '再生') : on ? '停止' : '開始');
    txt('#in-msg', s === 'mic' ? a.micMsg : '');
    $('#in-tab').dataset.src = s;
    const fm = $('#m-file');
    fm.className = `msg${a.fileMsg ? ' er' : ''}`;
    txt(
      '#m-file',
      a.fileMsg ||
        (a.buf
          ? `${a.file} · ${tms(a.buf.duration)} · ${fmt(a.buf.sampleRate, 'Hz', 4)} · ${a.buf.numberOfChannels >= 2 ? 'ステレオ' : 'モノラル'}`
          : 'まだ選んでいません'),
    );
    $<HTMLInputElement>('#seek').disabled = !a.buf;
    const test = s === 'test',
      per = PERIODIC.has(a.test.wave);
    tw.set(a.test.wave);
    $('#p-tf').hidden = !test || !per;
    if (ratio) ratio.hidden = $('#p-tph').hidden = !test || !per;
    /* モニター: マイクの間は枠ごと畳んで開けなくする。ほかの入力元に変えたら開く */
    const mic = s === 'mic';
    if (mic !== monOff) {
      monOff = mic;
      snd.classList.toggle('lock', mic);
      $('summary', snd).setAttribute('aria-disabled', String(mic));
      snd.open = !mic;
    }
    $('#monBtn').setAttribute('aria-pressed', String(a.monOn));
    $('#monLed').classList.toggle('on', a.monOn);
    txt('#monT', a.monOn ? '停止' : '再生');
    g.note('vol', test && a.monOn && a.testMute ? 'この環境ではテスト信号を鳴らせません' : '');
  }
  a.onChange = sync;

  $('#runBtn').addEventListener('click', () => a.toggle());
  $('#monBtn').addEventListener('click', () => a.setMon(!a.monOn));

  /* ファイル: 選ぶ・枠へ落とす・再生位置 */
  const fin = $<HTMLInputElement>('#fileIn'),
    seek = $<HTMLInputElement>('#seek');
  let seeking = false;
  const open = (f: File | undefined) => {
    if (!f) return;
    a.fileMsg = '';
    txt('#m-file', '読み込んでいます…');
    a.open(f);
  };
  $('#fileBtn').addEventListener('click', () => fin.click());
  fin.addEventListener('change', () => {
    open(fin.files?.[0]);
    fin.value = '';
  });
  pnl.addEventListener('dragover', (e) => {
    e.preventDefault();
    pnl.classList.add('drop');
  });
  pnl.addEventListener('dragleave', (e) => {
    if (!pnl.contains(e.relatedTarget as Node | null)) pnl.classList.remove('drop');
  });
  pnl.addEventListener('drop', (e) => {
    e.preventDefault();
    pnl.classList.remove('drop');
    open(e.dataTransfer?.files[0]);
  });
  seek.addEventListener('input', () => {
    seeking = true;
  });
  seek.addEventListener('change', () => {
    seeking = false;
    if (a.buf) a.seek((+seek.value / 1000) * a.buf.duration);
  });

  /* レベル（直近 50 ms のピーク。下がるときはゆっくり） */
  const pk = [0, 0];
  let epoch = a.epoch;
  function tick(fresh: boolean): void {
    if (epoch !== a.epoch) {
      epoch = a.epoch;
      pk.fill(0);
    }
    if (fresh) {
      const n = Math.min(NB, Math.round(a.fs * 0.05));
      [a.L, a.R].forEach((x, c) => {
        let m = 0;
        for (let i = NB - n; i < NB; i++) {
          const q = Math.abs(x[i]);
          if (q > m) m = q;
        }
        pk[c] = Math.max(m, pk[c] * 0.9);
      });
    }
    for (const c of [0, 1]) {
      const d = 20 * Math.log10(pk[c] + 1e-12),
        q = Math.max(0, Math.min(1, (d + 60) / 60)),
        bar = $(`#lv${c}`);
      bar.style.width = `${(q * 100).toFixed(1)}%`;
      bar.classList.toggle('hot', d > -3);
      txt(`#lt${c}`, pk[c] > 0 ? `${d < -99 ? '−∞' : minus(d.toFixed(1))} dBFS` : '—');
    }
    if (a.buf) {
      const p = a.pos;
      txt('#m-pos', `${tms(p)} / ${tms(a.buf.duration)}`);
      if (!seeking) {
        seek.value = String(Math.round((p / a.buf.duration) * 1000));
        seek.style.setProperty('--p', (p / a.buf.duration).toFixed(4));
      }
    }
  }

  sync();
  return { a, tick };
}
