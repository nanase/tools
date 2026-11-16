/**
 * コード進行のページのギターの音: ギターのページの物理モデル（弦の固有振動と胴の響き）をそのまま使う。
 * 和音の音を標準の調弦の弦とフレットに割り当て、ギターのページの AudioWorklet へ撥弦を送る。
 * スチール弦（ドレッドノートの胴・ピック）とナイロン弦（クラシックの胴・指）の 2 つ
 */
import { reverbSpec, roomOf } from '../../lib/reverb';
import { makeBody } from '../guitar/body';
import { bodyDesc, type PluckMsg } from '../guitar/engine';
import { type Guitar, type Modes, modesOf, pluckOf, toolOf, tuneCoupled } from '../guitar/model';
import { noteHz, setOf, stringPhys, tuningOf } from '../guitar/strings';
import type { GtMsg } from '../guitar/worklet';
import workletUrl from '../guitar/worklet.ts?worker&url';

export type GtKind = 'steel' | 'nylon';
const OPEN = tuningOf('std').notes;
/** 押さえるフレットの上限（和音の割り当て） */
const MAX_FRET = 12;

interface Kind {
  G: Guitar;
  pos: number;
  tool: 'pick' | 'finger';
  modes: Map<string, Modes>;
}
function build(k: GtKind): Guitar {
  const set = setOf(k),
    body = makeBody(
      k === 'steel'
        ? { type: 'dread', wood: 'spruce', h: 2.9e-3, V: 17.5e-3, dh: 100e-3 }
        : { type: 'classical', wood: 'spruce', h: 2.5e-3, V: 13e-3, dh: 85e-3 },
    ),
    specs = set.strings.map((s) => ({ ...s })),
    G: Guitar = { L: set.L, frets: set.frets, str: specs.map(stringPhys), body };
  /* 胴との結合でずれる分も含めて、標準の調弦に合う張力にする（ギターのページの自動の調弦と同じ） */
  specs.forEach((sp, i) => {
    sp.T = tuneCoupled(G, i, noteHz(OPEN[i]));
  });
  G.str = specs.map(stringPhys);
  return G;
}

/**
 * 和音の音（MIDI のノート番号）を弦とフレットに割り当てる。低い音ほど低い弦に置き、押さえる幅が狭いものを選ぶ。
 * 置けない音はオクターブを移して試す。返すのは音ごとの [弦（0 = 1 弦）, フレット]（置けなければ null）
 */
export function fretting(tones: readonly number[]): ([number, number] | null)[] {
  const order = tones.map((m, i) => [m, i] as const).sort((a, b) => a[0] - b[0]),
    best: { cost: number; pick: ([number, number] | null)[] } = { cost: Number.POSITIVE_INFINITY, pick: [] },
    cur: ([number, number] | null)[] = tones.map(() => null);
  const cost = () => {
    const fr = cur.filter((x): x is [number, number] => !!x).map((x) => x[1]),
      held = fr.filter((f) => f > 0),
      span = held.length ? Math.max(...held) - Math.min(...held) : 0,
      miss = cur.filter((x) => !x).length;
    return miss * 100 + span * 3 + held.reduce((a, f) => a + f, 0) * 0.3 + (span > 4 ? 50 : 0);
  };
  const go = (j: number, maxSi: number) => {
    if (j === order.length) {
      const c = cost();
      if (c < best.cost) {
        best.cost = c;
        best.pick = cur.slice();
      }
      return;
    }
    const [m, i] = order[j];
    let placed = false;
    for (let si = maxSi; si >= 0; si--)
      for (const mm of [m, m + 12, m - 12]) {
        const f = mm - OPEN[si];
        if (f < 0 || f > MAX_FRET) continue;
        cur[i] = [si, f];
        placed = true;
        go(j + 1, si - 1);
        cur[i] = null;
        break;
      }
    /* 置かずに次へ（置けない音があっても残りを置く。置かない音は大きく減点する） */
    if (!placed || order.length > 1) go(j + 1, maxSi);
  };
  go(0, 5);
  return best.pick.length ? best.pick : tones.map(() => null);
}

/** ギターの音（AudioWorklet）。AudioContext ごとに作る */
export class GtrVoices {
  private readonly nodes = new Map<GtKind, AudioWorkletNode>();
  private readonly kinds = new Map<GtKind, Kind>();
  private loaded: Promise<boolean> | null = null;
  private seq = 0;
  private readonly frets = new Map<string, ([number, number] | null)[]>();

  constructor(
    private readonly ac: BaseAudioContext,
    private readonly out: AudioNode,
  ) {}

  /** ワークレットを読み込む。読めなければ false（その間はギターを鳴らさない） */
  load(): Promise<boolean> {
    this.loaded ??= this.ac.audioWorklet
      .addModule(workletUrl)
      .then(() => true)
      .catch(() => false);
    return this.loaded;
  }

  private kind(k: GtKind): Kind {
    let x = this.kinds.get(k);
    if (!x) {
      x = { G: build(k), pos: k === 'steel' ? 0.1 : 0.14, tool: k === 'steel' ? 'pick' : 'finger', modes: new Map() };
      this.kinds.set(k, x);
    }
    return x;
  }
  private node(k: GtKind): AudioWorkletNode {
    let n = this.nodes.get(k);
    if (!n) {
      n = new AudioWorkletNode(this.ac, 'guitar-model', { numberOfInputs: 0, outputChannelCount: [2] });
      n.connect(this.out);
      const post = (m: GtMsg) => n?.port.postMessage(m);
      post({ type: 'body', d: bodyDesc(this.kind(k).G.body) });
      /* 部屋の響きはページの残響で付けるので、ここでは掛けない */
      post({ type: 'room', r: reverbSpec(roomOf('off'), 1) });
      this.nodes.set(k, n);
    }
    return n;
  }

  /** 和音のうち、音 m を弾く弦とフレット（和音ごとに 1 度だけ割り当てる） */
  private place(tones: readonly number[], m: number): [number, number] | null {
    const key = tones.join(',');
    let f = this.frets.get(key);
    if (!f) {
      f = fretting(tones);
      this.frets.set(key, f);
    }
    const i = tones.indexOf(m);
    return i < 0 ? null : f[i];
  }

  /** 和音 tones の音 m を時刻 at に弾き、end に指を離す（vel は 0〜1 の強さ） */
  pluck(k: GtKind, tones: readonly number[], m: number, at: number, end: number, vel: number): void {
    const sf = this.place(tones, m);
    if (!sf) return;
    const [si, fret] = sf,
      x = this.kind(k),
      fs = this.ac.sampleRate,
      mk = `${si}:${fret}:${fs}`;
    let md = x.modes.get(mk);
    if (!md) {
      md = modesOf(x.G, si, fret, fs);
      x.modes.set(mk, md);
    }
    const t = toolOf(x.tool),
      pl = pluckOf(x.G, si, md, {
        pos: x.pos,
        amp: 1.2e-3 * vel,
        width: t.w,
        soft: t.soft,
        angle: Math.PI / 4,
      }),
      p: PluckMsg = { si, N: md.N, w: md.w, s: md.s, f: pl.f },
      n = this.node(k),
      id = ++this.seq;
    n.port.postMessage({ type: 'pluck', at, p, pan: (0.12 * (2.5 - si)) / 2.5, id } satisfies GtMsg);
    n.port.postMessage({ type: 'damp', at: end, si, tau: 0.08, id } satisfies GtMsg);
  }

  /** 先の予定（撥弦と指を離す予定）を消す。鳴っている弦はそのまま減衰する */
  cancel(): void {
    for (const n of this.nodes.values()) n.port.postMessage({ type: 'cancel' } satisfies GtMsg);
  }
  /** すべての弦を止める */
  stop(): void {
    for (const n of this.nodes.values()) n.port.postMessage({ type: 'stop', tau: 0.05 } satisfies GtMsg);
  }
}
