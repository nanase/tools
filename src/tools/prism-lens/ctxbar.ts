/**
 * 選んだ部品の設定の帯。部品を選ぶと、図の下端の道具のトレイと入れ替わる。
 * 数値の欄は横にドラッグ・‹ ›・矢印キーで変え、押すと入力欄になる（このページだけの小さな入力）
 */
import { focal, MAT_KEYS, MATS, type MatKey, NAMES, type Part, type PartType } from './optics';
import { PARAMS, type PKey, RANGE } from './params';

/** 図の単位（0.1 mm）で持つ項目 */
const MM_KEYS: readonly PKey[] = ['w', 'size', 'R', 'D', 'h', 'r', 'L'];
const DEF = Object.fromEntries(PARAMS.map((d) => [d.k, d])) as Record<PKey, (typeof PARAMS)[number]>;
/** 部品ごとの項目の並び（ang は最後に足す） */
const KEYS: Record<PartType, PKey[]> = {
  beam: ['lam', 'w'],
  laser: ['lam'],
  lamp: ['lam'],
  prism: ['apex', 'size'],
  penta: ['size'],
  convex: ['R', 'D'],
  concave: ['R', 'D'],
  semi: ['r'],
  plate: ['w', 'h'],
  drop: ['r'],
  mirror: ['L'],
  cmirror: ['R', 'D'],
  half: ['L'],
  screen: ['L'],
};
const HAS_MAT: readonly PartType[] = ['prism', 'penta', 'convex', 'concave', 'semi', 'plate', 'drop'];
const HAS_F: readonly PartType[] = ['convex', 'concave', 'cmirror'];

const ICON = {
  back: '<path d="M14.5 5.5L8 12l6.5 6.5"/>',
  dup: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/>',
  del: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5M10.2 10.5v6M13.8 10.5v6"/>',
};
const icon = (b: string) => `<svg viewBox="0 0 24 24" aria-hidden="true">${b}</svg>`;

export interface CtxEvents {
  /** 値を変えた（ドラッグ中も呼ぶ） */
  change: () => void;
  back: () => void;
  dup: () => void;
  del: () => void;
}

/** 数値の欄 1 つ */
class Scrub {
  readonly el: HTMLElement;
  private readonly box: HTMLElement;
  private readonly val: HTMLElement;
  private readonly bar: HTMLElement;
  private v = 0;
  constructor(
    private readonly k: PKey,
    private readonly min: number,
    private readonly max: number,
    private readonly onSet: (v: number) => void,
  ) {
    const d = DEF[k];
    this.el = document.createElement('span');
    this.el.className = 'pl-cf';
    this.el.innerHTML = `<span class="pl-cl" aria-hidden="true">${d.name}</span><span class="pl-sf" tabindex="0" role="slider" aria-label="${d.name}" aria-valuemin="${min}" aria-valuemax="${max}"><button type="button" class="pl-sa" data-d="-1" tabindex="-1" aria-hidden="true">‹</button><span class="pl-sv"></span><span class="pl-su">${d.unit}</span><button type="button" class="pl-sa" data-d="1" tabindex="-1" aria-hidden="true">›</button><i class="pl-sb" aria-hidden="true"></i></span>`;
    this.box = this.el.querySelector('.pl-sf') as HTMLElement;
    this.val = this.el.querySelector('.pl-sv') as HTMLElement;
    this.bar = this.el.querySelector('.pl-sb') as HTMLElement;
    this.bind();
  }
  private get step(): number {
    return DEF[this.k].lin?.step ?? 1;
  }
  private get big(): number {
    return DEF[this.k].lin?.big ?? 10;
  }
  private fmt(v: number): string {
    const dec = MM_KEYS.includes(this.k) ? 1 : 0,
      s = v.toFixed(dec);
    return v < 0 ? `−${s.slice(1)}` : s;
  }
  private clamp(v: number): number {
    const st = this.step;
    return Math.min(this.max, Math.max(this.min, Math.round(v / st) * st));
  }
  /** 値を入れる（onSet は呼ばない） */
  set(v: number): void {
    this.v = v;
    const t = this.fmt(v);
    if (this.val.textContent !== t) this.val.textContent = t;
    this.box.setAttribute('aria-valuenow', String(v));
    this.box.setAttribute('aria-valuetext', `${t} ${DEF[this.k].unit}`);
    this.bar.style.setProperty('--p', `${((v - this.min) / (this.max - this.min)) * 100}%`);
  }
  private put(v: number): void {
    const c = this.clamp(v);
    if (c === this.v) return;
    this.set(c);
    this.onSet(c);
  }
  private bind(): void {
    const b = this.box;
    for (const a of b.querySelectorAll<HTMLButtonElement>('.pl-sa'))
      a.addEventListener('click', (e) => {
        this.put(this.v + Number(a.dataset.d) * (e.shiftKey ? this.big : this.step));
        b.focus({ preventScroll: true });
      });
    /* 横にドラッグすると 6 px ごとに 1 刻み（Shift で大きく）。動かさずに離すと入力欄 */
    b.addEventListener('pointerdown', (e) => {
      if ((e.target as Element).closest('.pl-sa, input')) return;
      e.preventDefault();
      b.setPointerCapture(e.pointerId);
      b.focus({ preventScroll: true });
      const x0 = e.clientX,
        v0 = this.v;
      let moved = false;
      const mv = (ev: PointerEvent) => {
        const dx = ev.clientX - x0;
        if (Math.abs(dx) > 3) moved = true;
        if (moved) this.put(v0 + Math.round(dx / 6) * (ev.shiftKey ? this.big : this.step));
      };
      const up = () => {
        b.removeEventListener('pointermove', mv);
        b.removeEventListener('pointerup', up);
        b.removeEventListener('pointercancel', up);
        b.classList.remove('drag');
        if (!moved) this.edit();
      };
      b.classList.add('drag');
      b.addEventListener('pointermove', mv);
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
    });
    b.addEventListener('keydown', (e) => {
      if (e.target !== b) return;
      const s = e.shiftKey ? this.big : this.step,
        m: Record<string, number> = {
          ArrowLeft: -s,
          ArrowDown: -s,
          ArrowRight: s,
          ArrowUp: s,
          PageDown: -this.big,
          PageUp: this.big,
        };
      if (e.key in m) this.put(this.v + m[e.key]);
      else if (e.key === 'Home') this.put(this.min);
      else if (e.key === 'End') this.put(this.max);
      else if (e.key === 'Enter') this.edit();
      else return;
      e.preventDefault();
    });
  }
  /** 押すと入力欄に変わる。Enter・欄の外で確定、Esc で取り消し */
  private edit(): void {
    if (this.box.querySelector('input')) return;
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.inputMode = 'decimal';
    inp.className = 'pl-si';
    inp.value = this.fmt(this.v).replace('−', '-');
    inp.setAttribute('aria-label', DEF[this.k].name);
    this.val.hidden = true;
    this.val.after(inp);
    inp.focus();
    inp.select();
    let done = false;
    const end = (ok: boolean) => {
      if (done) return;
      done = true;
      const n = Number.parseFloat(
        inp.value
          .normalize('NFKC')
          .replace(/[−‒–]/g, '-')
          .replace(/[^\d.+-]/g, ''),
      );
      inp.remove();
      this.val.hidden = false;
      if (ok && Number.isFinite(n)) this.put(n);
      this.box.focus({ preventScroll: true });
    };
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') end(true);
      else if (e.key === 'Escape') end(false);
      else return;
      e.preventDefault();
      e.stopPropagation();
    });
    inp.addEventListener('blur', () => end(true));
  }
}

export class CtxBar {
  private part: Part | null = null;
  private fields = new Map<PKey, Scrub>();
  private fEl: HTMLElement | null = null;
  private lamEl: HTMLElement | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly ev: CtxEvents,
  ) {
    new ResizeObserver(() => this.fade()).observe(root);
    root.addEventListener('scroll', () => this.fade(), { passive: true });
  }

  /** 部品の設定を組み立てて出す */
  show(o: Part): void {
    this.part = o;
    this.fields.clear();
    const R = RANGE[o.t],
      r = this.root;
    r.replaceChildren();
    const head = document.createElement('span');
    head.className = 'pl-ch';
    head.innerHTML = `<button type="button" class="pl-ib" data-a="back" aria-label="部品の追加へ戻る" title="部品の追加へ戻る">${icon(ICON.back)}</button><b>${NAMES[o.t]}</b>`;
    r.append(head);
    const body = document.createElement('span');
    body.className = 'pl-cb';
    r.append(body);
    if (o.t === 'beam' || o.t === 'lamp') {
      const s = document.createElement('span');
      s.className = 'pl-cf';
      s.innerHTML =
        '<span class="pl-cl" id="pl-cl-white">色</span><span class="pl-seg" role="group" aria-labelledby="pl-cl-white"><button type="button" data-w="1">白色光</button><button type="button" data-w="0">単色</button></span>';
      s.addEventListener('click', (e) => {
        const b = (e.target as Element).closest<HTMLElement>('[data-w]');
        if (!b || !this.part) return;
        this.part.white = b.dataset.w === '1';
        this.syncWhite();
        this.ev.change();
      });
      body.append(s);
    }
    if (HAS_MAT.includes(o.t)) {
      const s = document.createElement('span');
      s.className = 'pl-cf';
      s.innerHTML = `<label class="pl-cl" for="pl-mat">材質</label><select class="pl-sel" id="pl-mat">${MAT_KEYS.map((k) => `<option value="${k}" title="${MATS[k].name}">${MATS[k].sh}</option>`).join('')}</select>`;
      const sel = s.querySelector('select') as HTMLSelectElement;
      sel.value = o.mat;
      sel.addEventListener('change', () => {
        if (!this.part) return;
        this.part.mat = sel.value as MatKey;
        this.syncFocal();
        this.ev.change();
      });
      body.append(s);
    }
    for (const k of [...KEYS[o.t], 'ang' as PKey]) {
      const rg = k === 'ang' ? { min: -180, max: 180 } : (R[k] ?? { min: DEF[k].min, max: DEF[k].max }),
        f = new Scrub(k, rg.min, rg.max, (v) => {
          if (!this.part) return;
          const p = this.part as unknown as Record<string, number>;
          p[k] = MM_KEYS.includes(k) ? v * 10 : v;
          this.syncFocal();
          this.ev.change();
        });
      f.set(this.value(o, k));
      this.fields.set(k, f);
      if (k === 'lam') this.lamEl = f.el;
      body.append(f.el);
    }
    if (HAS_F.includes(o.t)) {
      this.fEl = document.createElement('span');
      this.fEl.className = 'pl-cf pl-cfo';
      body.append(this.fEl);
    } else this.fEl = null;
    const acts = document.createElement('span');
    acts.className = 'pl-ca';
    acts.innerHTML = `<button type="button" class="pl-ib" data-a="dup" aria-label="複製" title="複製">${icon(ICON.dup)}</button><button type="button" class="pl-ib del" data-a="del" aria-label="削除" title="削除（Delete）">${icon(ICON.del)}</button>`;
    r.append(acts);
    for (const b of r.querySelectorAll<HTMLElement>('[data-a]'))
      b.addEventListener('click', () => this.ev[b.dataset.a as 'back' | 'dup' | 'del']());
    this.syncWhite();
    this.syncFocal();
    r.hidden = false;
    r.scrollLeft = 0;
    this.fade();
  }
  hide(): void {
    this.part = null;
    this.root.hidden = true;
  }
  /** 図の上で回した角度・動かした値を欄へ */
  sync(): void {
    if (!this.part) return;
    for (const [k, f] of this.fields) f.set(this.value(this.part, k));
  }
  private value(o: Part, k: PKey): number {
    if (k === 'ang') return Math.round(o.ang);
    const v = o[k] as number;
    return MM_KEYS.includes(k) ? Math.round(v) / 10 : v;
  }
  private syncWhite(): void {
    const o = this.part;
    if (!o) return;
    for (const b of this.root.querySelectorAll<HTMLElement>('[data-w]'))
      b.setAttribute('aria-pressed', String((b.dataset.w === '1') === o.white));
    if (this.lamEl) this.lamEl.hidden = o.white && o.t !== 'laser';
    this.fade();
  }
  private syncFocal(): void {
    if (!this.fEl || !this.part) return;
    const v = focal(this.part) / 10;
    this.fEl.innerHTML = `<span class="pl-cl">焦点距離</span><b>${v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}</b><span class="pl-su">mm</span>`;
  }
  /** 横にはみ出す間は右端をぼかす */
  private fade(): void {
    const r = this.root;
    r.classList.toggle('over', r.scrollWidth - r.scrollLeft > r.clientWidth + 2);
  }
}
