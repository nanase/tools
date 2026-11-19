/**
 * 楽器のページで手持ちの MIDI ファイルを開く画面（components/MidiFileParts.astro）。
 * 曲の一覧の最後に区切りと「MIDI ファイルを開く…」を足し、開いたファイルは一覧の最後に名前で残す。
 * ファイルの曲を選んでいる間は、曲の行の下にパートの一覧（選ぶ欄・チャンネル・名前・音域の図）を出す。
 * 音域の図は、灰の帯が楽器の音域、線が 1 段目で移した後のパートの音域で、はみ出す所を橙にする
 */
import { $ } from './dom';
import { type FilePart, octaveShift, partsOf, shiftLabel } from './midi-file';
import { parseSmf, type Smf } from './smf';
import { TempoMap } from './tempo';

/** パートの選び方: 1 つ（丸）・複数（チェック）・パートごとに鍵盤（オルガン） */
export type Pick = 'one' | 'many' | 'div';
/** 選んだパート → 鍵盤（'div' のとき）か true */
export type Choice = Map<string, string | true>;

export interface MidiFileOpt {
  pick: Pick;
  /** 凡例に出す楽器の名前（「灰: ヴァイオリンの音域」） */
  inst: string;
  /** 音域 [低い音, 高い音]。'div' では鍵盤の値ごと、ほかは true */
  range: (v: string | true) => readonly [number, number];
  /** 'div' の鍵盤 [値, 表示] */
  divs?: readonly (readonly [string, string])[];
  /** 開いたときに選ぶパート */
  defaults: (parts: readonly FilePart[]) => Choice;
  /** 開いたとき・選び直したとき（演奏を止めて頭に戻し、曲を作り直す） */
  changed: () => void;
  /** メッセージ（'' で消す） */
  say: (msg: string) => void;
}

/** 音域の図の横軸（ピアノの 88 鍵） */
const AX_LO = 21,
  AX_HI = 108;
const xOf = (n: number) => (100 * (Math.min(AX_HI, Math.max(AX_LO, n)) - AX_LO)) / (AX_HI - AX_LO);
const NONE = 'none';
const SVG = 'http://www.w3.org/2000/svg';

export class MidiFileBox {
  smf: Smf | null = null;
  parts: FilePart[] = [];
  choice: Choice = new Map();
  name = '';
  /** 1 段目の幅 [半音] */
  shift = 0;
  private readonly box = $('#mf');
  private readonly list = $('#mf-list');
  private readonly input = $<HTMLInputElement>('#mf-in');
  private readonly fileOpt = document.createElement('option');
  private prev: string;

  constructor(
    private readonly sel: HTMLSelectElement,
    private readonly o: MidiFileOpt,
  ) {
    this.prev = sel.value;
    this.fileOpt.value = 'file';
    this.fileOpt.hidden = true;
    const open = document.createElement('option');
    open.value = 'open';
    open.textContent = 'MIDI ファイルを開く…';
    sel.append(this.fileOpt, document.createElement('hr'), open);
    $('#mf-legend').textContent = `灰: ${o.pick === 'div' ? '鍵盤' : o.inst}の音域　線: パートの音域`;
    /* 「開く…」はページの曲の切り替えより先に受け、曲の欄は直前の曲に戻す（捕捉の段で受けて、ほかの受け口へ渡さない） */
    sel.addEventListener(
      'change',
      (e) => {
        if (sel.value === 'open') {
          e.stopImmediatePropagation();
          sel.value = this.prev;
          this.input.click();
          return;
        }
        this.prev = sel.value;
        this.box.hidden = !this.active();
      },
      true,
    );
    this.input.addEventListener('change', () => void this.read());
  }

  /** ファイルの曲を選んでいるか */
  active(): boolean {
    return this.sel.value === 'file' && !!this.smf;
  }

  /** 選んだパート（打楽器も含む。'div' では鍵盤を選んだもの） */
  selected(): FilePart[] {
    return this.parts.filter((p) => this.choice.has(p.id));
  }

  private async read(): Promise<void> {
    const f = this.input.files?.[0];
    this.input.value = '';
    if (!f) return;
    let smf: Smf;
    try {
      smf = parseSmf(await f.arrayBuffer());
    } catch (err) {
      this.o.say(
        err instanceof Error && err.message
          ? `${f.name} を読めませんでした。${err.message}。`
          : `${f.name} を読めませんでした。`,
      );
      return;
    }
    this.o.say('');
    this.smf = smf;
    this.parts = partsOf(smf);
    this.choice = this.o.defaults(this.parts);
    this.name = f.name;
    this.fileOpt.textContent = f.name;
    this.fileOpt.hidden = false;
    const tm = new TempoMap(smf.tempo),
      sec = Math.round((tm.tau(smf.end) * 60) / smf.bpm);
    $('#mf-sum').textContent =
      `${this.parts.length} パート · ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
    this.build();
    this.update();
    /* ページの曲の切り替え（保存・演奏の停止・小節の描き直し）を通す */
    this.sel.value = 'file';
    this.sel.dispatchEvent(new Event('change'));
  }

  /** 音域が変わったとき（ギターの調弦など）に、幅と図を求め直す */
  redraw(): void {
    if (this.smf) this.update();
  }

  /** パートの一覧の行を作る */
  private build(): void {
    const { pick } = this.o;
    this.list.classList.toggle('div', pick === 'div');
    const head = document.createElement('div');
    head.className = 'mf-row mf-hd';
    head.setAttribute('aria-hidden', 'true');
    head.innerHTML =
      pick === 'div'
        ? '<span></span><span></span><span>音域</span><span>鍵盤</span>'
        : '<span></span><span></span><span></span><span>音域</span>';
    const rows = this.parts.map((p) => {
      const row = document.createElement(pick === 'div' ? 'div' : 'label');
      row.className = 'mf-row';
      row.dataset.id = p.id;
      const ch = document.createElement('span');
      ch.className = 'mf-ch';
      ch.textContent = String(p.ch + 1);
      const nm = document.createElement('span');
      nm.className = 'mf-nm';
      nm.textContent = p.name;
      const fig = document.createElementNS(SVG, 'svg');
      fig.setAttribute('class', 'mf-rng');
      fig.setAttribute('viewBox', '0 0 100 12');
      fig.setAttribute('preserveAspectRatio', 'none');
      fig.setAttribute('aria-hidden', 'true');
      if (pick === 'div') {
        const seg = document.createElement('span');
        seg.className = 'seg';
        seg.setAttribute('role', 'group');
        seg.setAttribute('aria-label', `${p.ch + 1} ${p.name}の鍵盤`);
        for (const [v, l] of [...(this.o.divs ?? []), [NONE, 'なし'] as const]) {
          const b = document.createElement('button');
          b.type = 'button';
          b.dataset.v = v;
          b.textContent = l;
          b.addEventListener('click', () => {
            if (v === NONE) this.choice.delete(p.id);
            else this.choice.set(p.id, v);
            this.picked();
          });
          seg.append(b);
        }
        row.append(ch, nm, fig, seg);
      } else {
        const inp = document.createElement('input');
        inp.type = pick === 'one' ? 'radio' : 'checkbox';
        inp.name = 'mf-part';
        inp.value = p.id;
        inp.addEventListener('change', () => {
          if (pick === 'one') this.choice = new Map([[p.id, true]]);
          else if (inp.checked) this.choice.set(p.id, true);
          else this.choice.delete(p.id);
          this.picked();
        });
        row.append(inp, ch, nm, fig);
      }
      return row;
    });
    this.list.replaceChildren(head, ...rows);
  }

  private picked(): void {
    this.update();
    this.o.changed();
  }

  /** 1 段目の幅を求め、選ぶ欄・音域の図・移した幅を描き直す */
  private update(): void {
    const groups = this.selected()
      .filter((p) => !p.drum)
      .map((p) => {
        const [lo, hi] = this.o.range(this.choice.get(p.id) ?? true);
        return { notes: p.notes, lo, hi };
      });
    this.shift = groups.length ? octaveShift(groups) : 0;
    $('#mf-shift').textContent = shiftLabel(this.shift);
    for (const p of this.parts) {
      const row = this.list.querySelector<HTMLElement>(`.mf-row[data-id="${p.id}"]`);
      if (!row) continue;
      const v = this.choice.get(p.id);
      row.classList.toggle('on', v !== undefined);
      const inp = row.querySelector('input');
      if (inp) inp.checked = v !== undefined;
      for (const b of row.querySelectorAll<HTMLButtonElement>('.seg button'))
        b.setAttribute('aria-pressed', String((v ?? NONE) === b.dataset.v));
      this.figure(row.querySelector('svg') as SVGSVGElement, p, v);
    }
  }

  /**
   * 音域の図: 灰の帯（楽器・鍵盤の音域）、パートの線（移した後）、はみ出す所は橙。
   * 1 つだけ選ぶ楽器では、選んでいないパートもそのパートを選んだときの幅で描く（選ぶ前に収まり方を比べられる）
   */
  private figure(svg: SVGSVGElement, p: FilePart, v: string | true | undefined): void {
    const [lo, hi] = this.o.range(this.o.pick === 'div' ? (v ?? this.o.divs?.[0]?.[0] ?? true) : true),
      sh = this.o.pick === 'one' && v === undefined ? octaveShift([{ notes: p.notes, lo, hi }]) : this.shift,
      a = p.lo + sh,
      b = p.hi + sh,
      el = (cls: string, x0: number, x1: number) => {
        const r = document.createElementNS(SVG, 'rect');
        r.setAttribute('class', cls);
        r.setAttribute('x', String(x0));
        r.setAttribute('width', String(Math.max(0.6, x1 - x0)));
        return r;
      },
      out: SVGElement[] = [el('mf-band', xOf(lo), xOf(hi)), el('mf-line', xOf(a), xOf(b))];
    if (a < lo) out.push(el('mf-line out', xOf(a), xOf(Math.min(b, lo))));
    if (b > hi) out.push(el('mf-line out', xOf(Math.max(a, hi)), xOf(b)));
    svg.replaceChildren(...out);
  }
}
