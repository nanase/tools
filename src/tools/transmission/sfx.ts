/**
 * チェンジペダルとギアの音を作る。白色雑音を、時間ごと・帯域ごとの強さの表どおりに削って作る（短時間フーリエ変換で
 * 周波数ごとに掛けて戻す）。正弦波の共鳴は使わないので、金属的に鳴り続けない。
 * ペダルの 2 つの表は、実車（CT125）の録音から読んだ値。録音そのものは入れていない。
 * 表は 2 ms ごと・100 Hz から 1/3 オクターブ刻みの 22 帯域。値は最大を 0 とした dB で、1 文字が 1 値（'0' が 0 dB、1 つ進むごとに −1 dB）
 */

export type SfxKind = 'press' | 'release' | 'gear';

const BANDS = 22,
  HOP_MS = 2,
  F0 = 100;
/** 録音から読んだ表（最大の 10 ms 前から 2 ms ごとに 90 行） */
const TABLES: Record<'press' | 'release', string> = {
  press:
    'llFl>B::G@@FEFDHORU^elllFlH;79BCEHIHBJQPS_flllIlE96;CHGKHFAIRPR[`hllKlF97@FB>FIDCFOJKMQTllKlD<<>?<3<FBBEICCDKMllEl>J=C;:07CB@CE@@AJLllBl=<99;929EEC@E@ABKNllClA86:@;9>IHC?DCDDKQllElC86ADD>>DE@>DFGHMVllClG<:>AI?>BC?;EIJJQXllFlM>@BACBABDA<ELLJRYllDlH=BFF?>GEF??GKMLT[llCl>;BFC>;CHB<?GJONW]llDl=;<>B@=BDB;?EKPPX_llFl?D8:ED@ADD=CFMRRYallJl?<8:DE>CIGAHIQTSZcllHl>::@EH@FMGFJLSPT[ellIl=A=DGKDFKFEGNJIRW`llLl?@=?FJDKKHCDKFGQU]llJlA;;CGLCJJLBDHFHRV]llQlF==DKKAJLIEDIILSZ^llPlKABEEHBPPHIEJKOU\\^llOlMFJMDJDSNJNJILRX_allYlIHPEHLINLJOKJPSYbgllRlLGFFLPPMLINJKSTZeillOlUFGNORIJNJMKLUU[fjllSlMHJYNOCJNLNOMYU]glllXlLPIKJQAMOOQPO\\W`hlllSlKOIGKOCJSONPO]ZbjlllLlHIMIQOGNUMMRO[[dllllNlHL_MPMIOUNNQQ\\]ellllXlILYNOLHMPNQPR`^gllllLlHKVPSOGPONTPSa_gllllNlKHPLQRGORQVQU`bhllllUlOIHHNPFMVVSSUbehllllRlORIIOOFPSYTVSccgllllalOQNORPJOPWXXTbcgllllXlPKPROONQQUXWTbchllllSlLLTMQKPSRVWWTcdillllMlKKRLTKPSRZXXTeejllllSlMKNMSNOSS\\WYVhhjllllTlRPXNRQOVS^W[ZggkllllPlXXPMSNPWS_Y][fglllllTlXVQKQPLQXZ[\\YfhlllllVlYTUKQWIQVY\\]Xfilllll[lUROLRWHTRZ[`XgjlllllXlSRTOTQGSQW[`[gklllllSlS\\dTSPIVRW\\_]gllllllVlZXXQUTMVTY\\_[iklllll\\lg\\QO\\ULTWW\\_[kjlllllXlVSOPSRIUWW\\a`ljlllllSlOMRRQRHTU[]a`lklllllWlOKNPUVJTT]^a]jllllll^lQMPOUYJVX`\\b]jllllllTlVP^PV\\KUYb\\b`kllllllRlSPRV[[LWX_[bdkllllllQlRRSl^[NZX^[cglllllllXlTcTV_YQYX]^cflllllllPlSYTR_WT[[]`dfkllllllPlR`RQ]UR[^^afhkllllllZlSTSQZUQWZ_`gflllllllUlSVZTXYRVWa^gclllllllTlSZdZ[]OZXa`edgllllll^lUYcd\\YM[[_acdellllll[lXW[[\\VLY]]^ddhllllllXl[[VV_VM[`^^fclllllll_lkjUS[WNV^a_gdlllllll[lZXRQYYNT[c^gelllllllUlTSRQ[YMX\\d^felllllll]lRTZUZYKW^c_fdlllllllXlSZlZ\\VLV_bahclllllllUlVX^Y_UMX^dbjclllllll[l\\\\[YbXMX_eelclllllllYldbfY`\\OXafelelllllllTlZ_cZ^_R\\deaiflllllllVlUX_Y__V_ce`jglllllllflTTZZabU_abajhlllllllVlUU]]`bTb_`egglllllllVlZ\\[[]dV]^adhglllllllfl\\^a[]hX[``akhlllllll[lXYa^cgS^bb`jilllllll[lWW__hjQ^bddikllllllldlZW`\\`lQ[aegillllllllblZZ\\Y\\lR\\bgjkllllllll_l\\`dZ[fU_cgiiklllllll`ldag]_cV^cgchklllllll^la_h`dcV_ehbijlllllll\\lY[l_bbU^dhehjlllllll_lWV\\^g_U_cghfklllllllglVT[_g_Vfdggfllllll',
  release:
    'llTlJDDHMMSPSNIMYSOS]fllRlI@?GMMQOQOJLVRNW_hllNlM>>JMRNPQQLKSQOUafllSlI==JPQMLNJEHQIGLZ_llMlH<;HMH>>@=7>C=8>MSllElF?;?AA77;827<827FKll@l?;<@:@4787349506CIllBl98?D7>5:9745:528CKllGl:6<=7;;>=838=85;FPllIl=667<>@@?849><8>GNllLlE949DA=B=98;?;:@FMllLlH:7BCC;D>===?;<AGNllLlB:8?E@=BC@<@>;<CJQllKlC?<;@>CBEA<B?=>CMTllQlIIC??BCEDC;?A?ACOXllLlSDAMCGBDBE8@@ACDQYllLlJ?=?FJDFBF8BAEDFRYllQlF=<>DKIHDB=BCJEITZllJlD?@DAJKEE@@DGJFJU[llHlICGDAIGFG?AEGIGKV]llPlRGQAAJIJJCBDGIGMXbllNlMHI@ANLMMHDDGJHNZellJlLGWABKGPJIGEGLHM\\gllHlQFEDBKGTEFEEFKGM]ellKlKDELEOIQDDADGHGO^ellSlLGEEIXMMED?CEHJQahllJlOKGHGSJJGEBDEJLPahllHlPIIKFQFKGFEGHMLR`ellFlNFGLIVDIGGDIJNLT`ellDlFFI`L]FIIICIJOMU`illElHKHUKTLLKKBKLNOT`kllHlHKGJJSOQLMDNMOQValllGlHPGMLVLQLKHQLRSXclllLlGHGQOSKLJJISNTUXdlllPlFEIJPSJLILLSNTTZelllMlIFVLNSILKRKRMSR[flllRlMGNXOUKLMUHSOQQ[flllXlJGO[STMMOSIVQQRYfkllTlGFTQVOMQRRITRRS[elllHlGHMPWNMWUQIRRRT^flllHlLNNRVQRXPPLSQRT`hlllJlSXSbYVTUNPNTQSU^hlllKlMLOZVTPSNTMTSSW^jlllTlNHINRUQPOWNSSTXallllWlNJHKSYNOPSNTRUYcllllQlOSKQS[ISPQNURXZbllllKl[RLOR\\HZQPMUT[ZallllIlLJJNRXIWSQNTV\\[bllllKlMILXTTMUUQPSW[]allllMlRKPTVTSVQRPSXZ^`jlllKlLOcRSTNYQULTWZ^ajlllMlPPW]QUKZRVLTVZ]cllllPlS_RTQXLUQVOVYZ]ellllMlQSQPRWNURVRX\\\\]ellllRlPOTVVUOWUVPY[\\]dllllOlSPW_]SRVVWOY[[^dllllLl_SR]_STYXYOX^\\^ellllNlWRSVWWQ_W[PWa][dllllPl\\SXYTXP^U]OXb][dllllVlTZ[WUZRZW[PZc]^ellll[lWaaSYZS[XYSZc]`fllllVlYg\\TV]S\\WWQYb^`illll]lWb^WTdQXWVOY`^aillllUlXb_`U_PZ[XPZ]_`hllll[lXa_YX\\O\\[[Q]]^^gllllZlVXXWY]OZZZO]]_^hllllWlUTUeV\\S^\\[P\\\\_`jllll]lVZUUS^Z___U\\]_cillllWlYb[TS`ZY__Z^__cillllUlZ]bXWbVZ\\\\Ub`^bjllllXla][e\\hV_Z^Re^^alllllWl]jXW[`W`YaSc`_blllll[lWZXVY\\U\\YaWabbbjllll[lWZ[]Z^U^Z\\Uca`bjllllZlYaba[]Za[\\Ria`blllllZl__hZX[Yb]ZRhabblllllWl__]WX[VhbYQdcaclllllQlb`XV_[Wi`ZPea_clllllOl[iWX`^[f_]Sg``blllllPlYXW\\`_[c^_Web`dlllllOlVTYf^aY``aVcd`glllllMlS\\VZ]aW`a`TcfbelllllRlT\\VW]`Vb^_UdecelllllblZVVa[cV_[]YcfeejllllYllXWZYfXa^^ZaeedillllXlZ[]VXe]kddY`cedlllll]lV_dYXa_ldiXbcedlllllXlW]l\\Z`^fdeYfedflllllXlZda_^aZbdcZkhbflllll_l`]]fcaYcdeWkjbflll',
};

/** 帯域の中心の周波数 [Hz] */
const centerOf = (k: number) => F0 * 2 ** ((k + 0.5) / 3);
/** 表の文字列を dB の行の並びにする */
function decode(s: string): number[][] {
  const rows: number[][] = [];
  for (let i = 0; i + BANDS <= s.length; i += BANDS)
    rows.push([...s.slice(i, i + BANDS)].map((c) => 48 - c.charCodeAt(0)));
  return rows;
}
/**
 * ギアの噛み合い: 低めの帯域（600 Hz〜2 kHz が中心）の短い「ジャッ」。0・4・9・15・22 ms の細かい当たりが
 * それぞれ 3 ms ほどで減る。表は作りで決めた値
 */
function gearTable(): number[][] {
  const hits: [number, number][] = [
    [0, 0],
    [4, -3],
    [9, -6],
    [15, -10],
    [22, -15],
  ];
  const rows: number[][] = [];
  for (let fr = 0; fr < 30; fr++) {
    const t = fr * HOP_MS - 4;
    let env = -60;
    for (const [h, a] of hits) if (t >= h) env = Math.max(env, a - (t - h) * 2.6);
    rows.push(
      Array.from({ length: BANDS }, (_, k) => {
        const f = centerOf(k),
          /* 1.1 kHz を山に、上は 1 オクターブで −9 dB、下は −6 dB */
          oct = Math.log2(f / 1100),
          shape = oct > 0 ? -9 * oct : 6 * oct;
        return Math.max(-60, env + shape);
      }),
    );
  }
  return rows;
}

/** 基数 2 の FFT（その場で。inv なら逆変換で、1/n は掛けない） */
function fft(re: Float64Array, im: Float64Array, inv: boolean): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let l = 2; l <= n; l <<= 1) {
    const a = ((inv ? 2 : -2) * Math.PI) / l;
    for (let i = 0; i < n; i += l)
      for (let k = 0; k < l / 2; k++) {
        const wr = Math.cos(a * k),
          wi = Math.sin(a * k),
          u = i + k,
          v = u + l / 2,
          tr = re[v] * wr - im[v] * wi,
          ti = re[v] * wi + im[v] * wr;
        re[v] = re[u] - tr;
        im[v] = im[u] - ti;
        re[u] += tr;
        im[u] += ti;
      }
  }
}
/** 決まった種から作る乱数（同じ音が毎回同じ形になるように） */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** 音の波形（最大の振幅が 1）を作る */
export function makeSfx(kind: SfxKind, fs: number): Float32Array {
  const rows = kind === 'gear' ? gearTable() : decode(TABLES[kind]),
    rand = rng(kind.length * 7919 + 17),
    hop = Math.round((HOP_MS / 1000) * fs);
  let NF = 64;
  while (NF < hop * 4) NF *= 2;
  const n = rows.length * hop + NF,
    y = new Float64Array(n),
    wsum = new Float64Array(n),
    win = Float64Array.from({ length: NF }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / NF));
  /* 周波数の目盛りごとに、両隣の帯域の中心の間を対数で補間する */
  const kOf = new Float64Array(NF / 2 + 1);
  for (let i = 0; i <= NF / 2; i++) {
    const f = Math.max(1, (i * fs) / NF);
    kOf[i] = Math.min(BANDS - 1, Math.max(0, 3 * Math.log2(f / F0) - 0.5));
  }
  for (const [fr, row] of rows.entries()) {
    const re = new Float64Array(NF),
      im = new Float64Array(NF);
    for (let i = 0; i < NF; i++) re[i] = (rand() * 2 - 1) * win[i];
    fft(re, im, false);
    for (let i = 0; i <= NF / 2; i++) {
      const k = kOf[i],
        k0 = Math.floor(k),
        u = k - k0,
        d = row[k0] * (1 - u) + row[Math.min(BANDS - 1, k0 + 1)] * u,
        /* 100 Hz より下は絞る */
        g = 10 ** (d / 20) * ((i * fs) / NF < F0 ? 0.1 : 1);
      re[i] *= g;
      im[i] *= g;
      if (i > 0 && i < NF / 2) {
        re[NF - i] = re[i];
        im[NF - i] = -im[i];
      }
    }
    fft(re, im, true);
    const s0 = fr * hop;
    for (let i = 0; i < NF; i++) {
      y[s0 + i] += re[i] * win[i];
      wsum[s0 + i] += win[i] * win[i];
    }
  }
  let mx = 0;
  for (let i = 0; i < n; i++) {
    if (wsum[i] > 1e-3) y[i] /= Math.max(wsum[i], 0.3);
    mx = Math.max(mx, Math.abs(y[i]));
  }
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = mx > 0 ? y[i] / mx : 0;
  return out;
}
