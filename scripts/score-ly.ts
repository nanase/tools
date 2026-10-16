/**
 * LilyPond の楽譜（.ly）から、独奏の声部の音を読む（scripts/violin-scores.ts・trumpet-scores.ts が使う）。
 * 対応するもの: \relative（なければ opt.absolute で絶対音高）、音名（オランダ語: c d e f g a b、is/es。
 * opt.lang = 'it' ならイタリア語・カタルーニャ語: do re mi fa sol la si、d/s/b）、オクターブの ' と ,、長さと付点、
 * 長さの倍率（d4*1/2）、休符 r と空白の休符 s と全休符 R（R2.*5）、タイ ~、スラー ( )、強弱（\pp \p \mp \mf \f \ff \fz \sf）、
 * 松葉 \< \> \!、\trill、スタッカート -.、アクセント ->、テヌート --、
 * \tuplet n/m {…} と \times n/m {…}、曲の頭の \partial、\repeat volta n {…} \alternative {{…}{…}}、和音 <…>、
 * 同時の部分 << {…} \\ {…} >>、\fermata、小節線 |。装飾音（\grace など）は鳴らさない。そのほかの \命令とフレーズのスラー \( \) は読み飛ばす。
 * \markup { arpeggio } は和音を分散して弾く指示、\markup { (tr) } は \trill、\markup { \dynamic p … } は強弱として読み、
 * そのほかの \markup {…} は読み飛ばす
 */

export interface LyNote {
  /** 開始と長さ（4 分音符 = 1） */
  t: number;
  d: number;
  /** 音の高さ（MIDI）。和音なら和音の全部 */
  n: number[];
  /** スラーの始まり・終わり */
  slurOn: boolean;
  slurOff: boolean;
  /** この音に付いた強弱の記号（pp … ff、fz） */
  dyn?: string;
  /** 松葉: '<' '>' が始まる、'!' で終わる */
  hair?: '<' | '>' | '!';
  trill: boolean;
  /** スタッカート（-.）・アクセント（->）・テヌート（--） */
  stacc: boolean;
  accent: boolean;
  tenuto: boolean;
  /** \upbow \downbow */
  bow?: 'up' | 'down';
  fermata: boolean;
  /** \markup { arpeggio }（和音を分散して弾く指示） */
  arp?: boolean;
}

/** 読み方: 音名の言語（'it' はイタリア語・カタルーニャ語）と、\relative がないときに絶対音高で読むか */
export interface LyOpt {
  lang?: 'nl' | 'it';
  absolute?: boolean;
}

const STEP: Record<string, number> = {
  c: 0,
  d: 1,
  e: 2,
  f: 3,
  g: 4,
  a: 5,
  b: 6,
  do: 0,
  re: 1,
  mi: 2,
  fa: 3,
  sol: 4,
  la: 5,
  si: 6,
};
const SEMI = [0, 2, 4, 5, 7, 9, 11];
/** 変化記号の語尾 → 半音のずれ（オランダ語の s は as・es の ♭、カタルーニャ語の s は ♯） */
const ALT = {
  nl: { is: 1, isis: 2, es: -1, s: -1, eses: -2 } as Record<string, number>,
  it: { d: 1, dd: 2, s: 1, b: -1, bb: -2 } as Record<string, number>,
};
/** 字句に分けるときの音名と休符（長さの前まで） */
const NAME = {
  nl: "[a-grs](?:isis|eses|is|es|s)?!?[',]*",
  it: "(?:do|re|mi|fa|sol|la|si)(?:dd|d|bb|b|s)?!?[',]*|[rs]",
};
/** 音名の字句: 音名, 変化記号, オクターブの記号, 長さ, 付点 */
const PITCH = {
  nl: /^([a-g])(isis|eses|is|es|s)?!?([',]*)(\d+)?(\.*)(?:\*\d+(?:\/\d+)?)?$/,
  it: /^(do|re|mi|fa|sol|la|si)(dd|d|bb|b|s)?!?([',]*)(\d+)?(\.*)(?:\*\d+(?:\/\d+)?)?$/,
};

/** Scheme の式（#(…)、#'(…)、#'記号、#"…"、##t、#数）を取り除く */
function stripScheme(s: string): string {
  let out = '',
    i = 0;
  while (i < s.length) {
    if (s[i] !== '#') {
      out += s[i++];
      continue;
    }
    let j = i + 1;
    while (s[j] === '#' || s[j] === "'" || s[j] === '`') j++;
    if (s[j] === '(') {
      let depth = 0;
      for (; j < s.length; j++) {
        if (s[j] === '(') depth++;
        if (s[j] === ')' && --depth === 0) break;
      }
      j++;
    } else if (s[j] === '"') j = s.indexOf('"', j + 1) + 1;
    else while (j < s.length && /[^\s{}]/.test(s[j])) j++;
    out += ' ';
    i = j;
  }
  return out;
}

/** 字句: 波括弧・和音の括弧・\命令・音・記号に分ける */
function tokens(src: string, lang: 'nl' | 'it'): string[] {
  const s = stripScheme(
    src
      .replace(/%\{[\s\S]*?%\}/g, ' ')
      .replace(/%[^\n]*/g, ' ')
      .replace(/\\markup\s*\{\s*arpeggio\s*\}/g, ' \\arpeggioMark ')
      .replace(/\\markup\s*\{\s*\(tr\)\s*\}/g, ' \\trill ')
      .replace(/\\markup\s*\{\s*\\dynamic\s+([a-z]+)[^{}]*\}/g, ' \\$1 ')
      .replace(/\\markup\s*\{[^{}]*\}/g, ' '),
  )
    /* 譜表・設定の命令（音符と紛れる語を含むので、字句に分ける前に消す） */
    .replace(/\\clef\s+("[^"]*"|[\w^_]+)/g, ' ')
    .replace(/\\(set|unset|override|revert)\s+[\w.]+(\s*=)?/g, ' ');
  const re = new RegExp(
    String.raw`\\\\|\\[a-zA-Z]+|\\[<>!()]|R\d+\.*(?:\*\d+(?:\/\d+)?)?|[A-Z][a-zA-Z.]*|\b(?:volta|unfold|percent|tremolo)\b|<<|>>|[{}<>()[\]~|]|-[.>-]|"[^"]*"|(?:${NAME[lang]})(?:\d+\.*)?(?:\*\d+(?:\/\d+)?)?|\d+\/\d+|\d+\.*|\S`,
    'g',
  );
  return s.match(re) ?? [];
}

/** 長さの倍率（d4*1/2 の *1/2）。なければ 1 */
const multOf = (tk: string) => {
  const m = tk.match(/\*(\d+)(?:\/(\d+))?$/);
  return m ? Number(m[1]) / Number(m[2] ?? 1) : 1;
};

/** 音名の字句 → [音階の段（c=0）, 半音のずれ, オクターブの記号, 長さ（なければ 0）, 付点の数] */
function pitchTok(tk: string, lang: 'nl' | 'it' = 'nl'): [number, number, number, number, number] | null {
  const m = tk.match(PITCH[lang]);
  if (!m) return null;
  const alt = m[2] ? ALT[lang][m[2]] : 0;
  let oct = 0;
  for (const ch of m[3]) oct += ch === "'" ? 1 : -1;
  return [STEP[m[1]], alt, oct, m[4] ? Number(m[4]) : 0, m[5].length];
}

/** 変数 name の中身（name = … { … }）を取り出して字句に分ける */
function varTokens(src: string, name: string, lang: 'nl' | 'it'): string[] {
  /* 行頭の「name =」を探す */
  let at = -1,
    pos = 0;
  for (const line of src.split('\n')) {
    if (/^\s*\w+\s*=/.test(line) && line.trim().split(/\s|=/)[0] === name) {
      at = pos;
      break;
    }
    pos += line.length + 1;
  }
  if (at < 0) throw new Error(`変数 ${name} がありません`);
  let j = src.indexOf('{', at),
    depth = 0;
  /* 「name = \relative a' {」のように、波括弧の前の \relative も含める */
  const a = src.indexOf('=', at) + 1;
  for (; j < src.length; j++) {
    if (src[j] === '{') depth++;
    if (src[j] === '}') depth--;
    if (depth === 0) break;
  }
  return tokens(src.slice(a, j + 1), lang);
}

/** seq[i] が '{' のとき、対応する '}' までの中身と、その次の位置 */
function block(seq: string[], i: number): { inner: string[]; end: number } {
  if (seq[i] !== '{') throw new Error(`${i} 番目の字句に { がありません: ${seq[i]}`);
  let depth = 0,
    j = i;
  for (; j < seq.length; j++) {
    if (seq[j] === '{') depth++;
    if (seq[j] === '}') depth--;
    if (depth === 0) break;
  }
  return { inner: seq.slice(i + 1, j), end: j + 1 };
}

/**
 * 楽譜の文字列から、変数 name の旋律を読む。barChecks には小節線（|）の時刻 [拍] を足す。
 * 同時の部分の \relative の基準は、simul = 'chain' なら書いた順に前の部分から続け、'prev' なら各部分を << の前の音から始める
 */
export function readLy(
  src: string,
  name: string,
  barChecks: number[] = [],
  simul: 'chain' | 'prev' = 'chain',
  opt: LyOpt = {},
): LyNote[] {
  const lang = opt.lang ?? 'nl',
    pt = (s: string) => pitchTok(s, lang),
    tk = varTokens(src, name, lang),
    notes: LyNote[] = [];
  /* \relative の外は絶対音高（c = C3） */
  let rel = !opt.absolute;
  /* \relative の基準（音階の段とオクターブ: c' = 中央の C = 段 0・オクターブ 4） */
  let refStep = 0,
    refOct = 4,
    dur = 1,
    t = 0,
    scale = 1,
    tieNext = false,
    pendDyn: string | undefined,
    pendHair: LyNote['hair'];
  const place = (step: number, alt: number, oct: number): [number, number] => {
    if (!rel) return [12 * (4 + oct) + SEMI[step] + alt, 3 + oct];
    /* 前の音から 4 度以内に置く */
    let o = refOct;
    const d = step - refStep;
    if (d > 3) o--;
    else if (d < -3) o++;
    o += oct;
    refStep = step;
    refOct = o;
    return [12 * (o + 1) + SEMI[step] + alt, o];
  };
  const push = (n: number[], d: number) => {
    const last = notes[notes.length - 1];
    if (tieNext && last && last.n[0] === n[0]) {
      last.d += d;
      t += d;
      tieNext = false;
      return;
    }
    tieNext = false;
    notes.push({
      t,
      d,
      n,
      slurOn: false,
      slurOff: false,
      dyn: pendDyn,
      hair: pendHair,
      trill: false,
      stacc: false,
      accent: false,
      tenuto: false,
      fermata: false,
    });
    pendDyn = undefined;
    pendHair = undefined;
    t += d;
  };
  /* 繰り返しの展開のため、字句の列を再帰的に読む */
  const run = (seq: string[]): void => {
    let i = 0;
    while (i < seq.length) {
      const x = seq[i];
      if (x === '\\relative') {
        const p = pt(seq[i + 1]);
        if (p) {
          rel = true;
          refStep = p[0];
          refOct = 3 + p[2];
          i += 2;
          continue;
        }
      }
      if (x === '\\transpose') {
        i += 3;
        continue;
      }
      if (x === '\\time' || x === '\\key' || x === '\\bar' || x === '\\clef' || x === '\\set' || x === '\\once') {
        i += x === '\\key' ? 3 : x === '\\once' ? 1 : 2;
        continue;
      }
      if (x === '<<') {
        /* 同時の部分 << {…} \\ {…} >>: それぞれを同じ時刻から読み、長いほうの終わりへ進む */
        let depth = 0,
          j = i;
        for (; j < seq.length; j++) {
          if (seq[j] === '<<') depth++;
          if (seq[j] === '>>' && --depth === 0) break;
        }
        const parts: string[][] = [];
        let cur: string[] = [],
          bd = 0,
          sd = 0;
        for (const y of seq.slice(i + 1, j)) {
          if (y === '{') bd++;
          if (y === '}') bd--;
          if (y === '<<') sd++;
          if (y === '>>') sd--;
          if (y === '\\\\' && bd === 0 && sd === 0) {
            parts.push(cur);
            cur = [];
          } else cur.push(y);
        }
        parts.push(cur);
        const t0 = t,
          r0: [number, number, number] = [refStep, refOct, dur];
        let tEnd = t0;
        for (const pt of parts) {
          t = t0;
          if (simul === 'prev') [refStep, refOct, dur] = r0;
          tieNext = false;
          run(pt);
          tEnd = Math.max(tEnd, t);
        }
        t = tEnd;
        i = j + 1;
        continue;
      }
      if (x === '\\partial') {
        /* 曲の頭の弱起だけ、最初の小節線が 0 拍になるようにずらす（途中の \partial は小節の数え方だけで、時刻は変えない） */
        const m = seq[i + 1].match(/^(\d+)(\.*)$/);
        if (m && notes.length === 0 && t === 0) t -= (4 / Number(m[1])) * (2 - 0.5 ** m[2].length);
        i += 2;
        continue;
      }
      if (x === '\\grace' || x === '\\appoggiatura' || x === '\\acciaccatura') {
        /* 装飾音は鳴らさない（音か {…} を 1 つ）。\relative の基準は動かす */
        const g = seq[i + 1] === '{' ? block(seq, i + 1) : { inner: [seq[i + 1]], end: i + 2 };
        for (const y of g.inner) {
          const p = pt(y);
          if (p) place(p[0], p[1], p[2]);
        }
        i = g.end;
        continue;
      }
      if (x === '\\tuplet' || x === '\\times') {
        /* \tuplet 3/2 は長さを 2/3 倍、古い書き方の \times 2/3 も 2/3 倍 */
        const [a, b] = seq[i + 1].split('/').map(Number);
        const body = block(seq, i + 2);
        const old = scale;
        scale *= x === '\\times' ? a / b : b / a;
        run(body.inner);
        scale = old;
        i = body.end;
        continue;
      }
      if (x === '\\repeat') {
        const times = Number(seq[i + 2]),
          body = block(seq, i + 3);
        let j = body.end;
        const alts: string[][] = [];
        if (seq[j] === '\\alternative') {
          const outer = block(seq, j + 1);
          let k = 0;
          while (k < outer.inner.length) {
            if (outer.inner[k] === '{') {
              const b2 = block(outer.inner, k);
              alts.push(b2.inner);
              k = b2.end;
            } else k++;
          }
          j = outer.end;
        }
        /*
         * \relative の基準と長さの既定値は、書いた順に決まる: 繰り返す部分は毎回同じ音になるよう、始まりの状態から読み直す。
         * 括弧（\alternative）は書いた順に、1 つ目は繰り返す部分の終わりから、2 つ目以降は前の括弧の終わりから続ける
         */
        const st0: [number, number, number] = [refStep, refOct, dur],
          stAlt: [number, number, number][] = [];
        let stBody: [number, number, number] = st0;
        for (let r = 0; r < times; r++) {
          [refStep, refOct, dur] = st0;
          run(body.inner);
          stBody = [refStep, refOct, dur];
          if (alts.length) {
            const k = Math.min(r, alts.length - 1);
            [refStep, refOct, dur] = k === 0 ? stBody : (stAlt[k - 1] ?? stBody);
            run(alts[k]);
            stAlt[k] = [refStep, refOct, dur];
          }
        }
        [refStep, refOct, dur] = alts.length ? (stAlt[alts.length - 1] ?? stAlt[stAlt.length - 1] ?? stBody) : stBody;
        i = j;
        continue;
      }
      if (x === '{' || x === '}') {
        i++;
        continue;
      }
      if (x === '<') {
        /* 和音: 閉じるまでの音を集める。基準は最初の音に戻す */
        const ps: number[] = [];
        let j = i + 1,
          first: [number, number] | null = null;
        while (seq[j] !== '>') {
          const p = pt(seq[j]);
          if (p) {
            const [n, o] = place(p[0], p[1], p[2]);
            if (!first) first = [p[0], o];
            ps.push(n);
          }
          j++;
        }
        if (first) {
          refStep = first[0];
          refOct = first[1];
        }
        j++;
        const m = seq[j]?.match(/^(\d+)(\.*)$/);
        if (m) {
          dur = (4 / Number(m[1])) * (2 - 0.5 ** m[2].length);
          j++;
        }
        push(ps, dur * scale);
        i = j;
        continue;
      }
      const p = pt(x);
      if (p || /^[rsR]\d*\.*(?:\*\d+(?:\/\d+)?)?$/.test(x)) {
        let d = dur;
        let m = x.replace(/\*.*$/, '').match(/(\d+)(\.*)$/);
        /* 「fis 8」のように、音名と長さの間に空白があるもの */
        if (!m && /^(1|2|4|8|16|32|64)\.*$/.test(seq[i + 1] ?? '')) {
          m = seq[i + 1].match(/(\d+)(\.*)$/);
          i++;
        }
        if (m) d = dur = (4 / Number(m[1])) * (2 - 0.5 ** m[2].length);
        d *= multOf(x);
        if (p) {
          const [n] = place(p[0], p[1], p[2]);
          push([n], d * scale);
        } else t += d * scale;
        i++;
        continue;
      }
      /* 音に付く記号（休符に付いたフェルマータは前の音に付けない） */
      const last = notes[notes.length - 1];
      if (x === '|') barChecks.push(t);
      if (x === '(' && last) last.slurOn = true;
      else if (x === ')' && last) last.slurOff = true;
      else if (x === '~' && last) tieNext = true;
      else if (/^\\(ppp|pp|p|mp|mf|f|ff|fff|fz|sf|sfz)$/.test(x)) {
        if (last && last.t + last.d > t - 1e-9) last.dyn = x.slice(1);
        else pendDyn = x.slice(1);
      } else if (x === '\\<' || x === '\\>' || x === '\\!') {
        if (last) last.hair = x.slice(1) as LyNote['hair'];
        else pendHair = x.slice(1) as LyNote['hair'];
      } else if (x === '\\trill' && last) last.trill = true;
      else if (x === '-.' && last) last.stacc = true;
      else if (x === '->' && last) last.accent = true;
      else if (x === '--' && last) last.tenuto = true;
      else if (x === '\\upbow' && last) last.bow = 'up';
      else if (x === '\\downbow' && last) last.bow = 'down';
      else if (x === '\\fermata' && last && last.t + last.d > t - 1e-9) last.fermata = true;
      else if (x === '\\arpeggioMark' && last) last.arp = true;
      i++;
    }
  };
  run(tk);
  return notes;
}
