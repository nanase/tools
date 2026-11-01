/**
 * 観測地を選ぶ小窓（地名の検索・現在地・地図）。見出しの右の「東京 ▾」から開く。
 * 地名は日食のページの一覧（日本の市と世界の主要都市）、地図は Natural Earth の陸地（日食のページと同じデータ）。
 * 要素は jupiter.astro などの SitePicker の部分（id は loc-…）
 */
import type { Obs } from '../astro/observer';
import { $, esc, norm } from '../dom';
import { store, stored } from '../store';

export interface Place {
  name: string;
  sub: string;
  lat: number;
  lon: number;
  h: number;
}

export const TOKYO: Place = { name: '東京', sub: '東京都庁', lat: 35.6895, lon: 139.6917, h: 0 };

const okPlace = (v: unknown): v is Place => {
  const p = v as Place;
  return (
    !!p &&
    typeof p.name === 'string' &&
    typeof p.lat === 'number' &&
    typeof p.lon === 'number' &&
    Math.abs(p.lat) <= 90 &&
    Math.abs(p.lon) <= 180
  );
};

type Row = [string, string, string, number, number, string];
const D = Math.PI / 180;
const kata2hira = (s: string) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

export class SitePicker {
  place: Place;
  private places: Row[] | null = null;
  private hits: Row[] = [];
  private active = -1;
  private land: number[][] | null = null;

  /**
   * @param base サイトの base（import.meta.env.BASE_URL）
   * @param onChange 観測地が変わったとき
   * @param hint 候補の右に出す補足（その地点の惑星の高度など）
   */
  constructor(
    private readonly base: string,
    private readonly onChange: (p: Place) => void,
    private readonly hint: (o: Obs) => string = () => '',
  ) {
    const sv = stored('site');
    this.place = okPlace(sv) ? sv : TOKYO;
    const btn = $('#loc-btn'),
      pop = $('#loc-pop');
    btn.addEventListener('click', () => this.open(pop.hidden === true));
    document.addEventListener('click', (e) => {
      const t = e.target as Element;
      if (!t.closest('.pn-locw')) this.open(false);
      if (!t.closest('.pn-lsearch')) $('#loc-sugg').hidden = true;
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !pop.hidden) {
        this.open(false);
        btn.focus();
      }
    });
    const q = $<HTMLInputElement>('#loc-q');
    q.addEventListener('input', () => void this.suggest());
    q.addEventListener('focus', () => void this.load());
    q.addEventListener('keydown', (ev) => this.key(ev));
    $('#loc-sugg').addEventListener('click', (e) => {
      const b = (e.target as Element).closest<HTMLElement>('.pn-sg');
      if (b) this.pick(Number(b.dataset.k));
    });
    $('#loc-here').addEventListener('click', () => this.here());
    $('#loc-mapbtn').addEventListener('click', () => {
      const box = $('#loc-mapbox');
      box.hidden = !box.hidden;
      $('#loc-mapbtn').setAttribute('aria-expanded', String(!box.hidden));
      if (!box.hidden) void this.drawMap();
    });
    $<HTMLCanvasElement>('#loc-map').addEventListener('click', (e) => void this.mapClick(e));
    this.show();
  }

  get obs(): Obs {
    return { lat: this.place.lat, lon: this.place.lon, h: this.place.h || 0 };
  }

  private open(on: boolean): void {
    $('#loc-pop').hidden = !on;
    $('#loc-btn').setAttribute('aria-expanded', String(on));
    if (on) $<HTMLInputElement>('#loc-q').focus();
  }

  private show(): void {
    const p = this.place;
    $('#loc-name').textContent = p.name;
    $('#loc-now').textContent = p.sub ? `${p.name}（${p.sub}）` : p.name;
    $('#loc-coord').textContent =
      `${Math.abs(p.lat).toFixed(3)}°${p.lat >= 0 ? 'N' : 'S'} ${Math.abs(p.lon).toFixed(3)}°${p.lon >= 0 ? 'E' : 'W'}`;
  }

  set(p: Place): void {
    this.place = p;
    store('site', p);
    this.show();
    this.onChange(p);
  }

  private async load(): Promise<Row[]> {
    if (!this.places) this.places = (await import('../../tools/solar-eclipse/places.json')).default as Row[];
    return this.places;
  }

  private async suggest(): Promise<void> {
    const list = await this.load();
    const q = $<HTMLInputElement>('#loc-q'),
      sugg = $('#loc-sugg');
    const s = kata2hira(norm(q.value.trim()));
    this.hits = (
      s ? list.filter((r) => norm(r[0]).includes(s) || r[1].startsWith(s) || (r[5] && norm(r[5]).startsWith(s))) : []
    ).slice(0, 10);
    this.active = -1;
    if (!this.hits.length) {
      sugg.hidden = true;
      q.setAttribute('aria-expanded', 'false');
      return;
    }
    sugg.innerHTML = this.hits
      .map(
        (r, k) =>
          `<li><button type="button" class="pn-sg" data-k="${k}" role="option" aria-selected="false"><b>${esc(r[0])}</b><small>${esc(r[2])}</small><span>${esc(this.hint({ lat: r[3], lon: r[4], h: 0 }))}</span></button></li>`,
      )
      .join('');
    sugg.hidden = false;
    q.setAttribute('aria-expanded', 'true');
  }

  private key(ev: KeyboardEvent): void {
    const sugg = $('#loc-sugg');
    if (sugg.hidden) return;
    const n = this.hits.length;
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      this.active = (this.active + (ev.key === 'ArrowDown' ? 1 : n - 1) + n) % n;
      sugg.querySelectorAll('.pn-sg').forEach((b, k) => {
        b.setAttribute('aria-selected', String(k === this.active));
      });
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      this.pick(this.active < 0 ? 0 : this.active);
    } else if (ev.key === 'Escape') {
      ev.stopPropagation();
      sugg.hidden = true;
    }
  }

  private pick(k: number): void {
    const r = this.hits[k];
    if (!r) return;
    this.set({ name: r[0], sub: r[2], lat: r[3], lon: r[4], h: 0 });
    $<HTMLInputElement>('#loc-q').value = '';
    $('#loc-sugg').hidden = true;
    this.open(false);
  }

  private async nearest(lat: number, lon: number, km: number): Promise<Place | null> {
    const list = await this.load();
    let best: Row | null = null;
    let bd = km;
    for (const r of list) {
      const d = 6371 * Math.hypot((r[3] - lat) * D, (r[4] - lon) * D * Math.cos(lat * D));
      if (d < bd) {
        bd = d;
        best = r;
      }
    }
    return best && { name: best[0], sub: best[2], lat: best[3], lon: best[4], h: 0 };
  }

  private here(): void {
    const msg = $('#loc-msg');
    if (!navigator.geolocation) {
      msg.textContent = 'このブラウザでは現在地を使えません。';
      return;
    }
    msg.textContent = '現在地を取得中…';
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude,
          lon = pos.coords.longitude;
        msg.textContent = '';
        const near = await this.nearest(lat, lon, 10);
        this.set({
          name: '現在地',
          sub: near ? `${near.name}付近` : '',
          lat: +lat.toFixed(4),
          lon: +lon.toFixed(4),
          h: Math.max(0, Math.round(pos.coords.altitude ?? 0)),
        });
      },
      () => {
        msg.textContent = '現在地を使えません。位置情報の許可を確かめてください。';
      },
      { maximumAge: 600000, timeout: 15000 },
    );
  }

  private async drawMap(): Promise<void> {
    const cv = $<HTMLCanvasElement>('#loc-map');
    if (!this.land) this.land = (await (await fetch(`${this.base}solar-eclipse/land110.json`)).json()) as number[][];
    const c = cv.getContext('2d');
    if (!c) return;
    const W = cv.width,
      H = cv.height;
    c.fillStyle = '#0d1b2a';
    c.fillRect(0, 0, W, H);
    c.fillStyle = '#3b4a3f';
    c.beginPath();
    for (const r of this.land) {
      for (let n = 0; n < r.length; n += 2) {
        const x = ((r[n] / 100 + 180) / 360) * W,
          y = ((90 - r[n + 1] / 100) / 180) * H;
        if (n) c.lineTo(x, y);
        else c.moveTo(x, y);
      }
      c.closePath();
    }
    c.fill('evenodd');
    const x = ((this.place.lon + 180) / 360) * W,
      y = ((90 - this.place.lat) / 180) * H;
    c.strokeStyle = '#f2c230';
    c.lineWidth = 2;
    c.beginPath();
    c.arc(x, y, 6, 0, 2 * Math.PI);
    c.stroke();
  }

  private async mapClick(e: MouseEvent): Promise<void> {
    const cv = e.currentTarget as HTMLCanvasElement;
    const r = cv.getBoundingClientRect();
    const lon = ((e.clientX - r.left) / r.width) * 360 - 180,
      lat = 90 - ((e.clientY - r.top) / r.height) * 180;
    const near = await this.nearest(lat, lon, 60);
    this.set(near ?? { name: '地図で選んだ地点', sub: '', lat: +lat.toFixed(2), lon: +lon.toFixed(2), h: 0 });
    void this.drawMap();
  }
}
