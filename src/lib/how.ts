/** しくみの枠の 1 工程。components/HowSteps.astro が番号を付けて並べる */
export interface HowStep {
  h: string;
  /** 図の HTML（svg・canvas）。そのまま入れる */
  fig?: string;
  p: string | readonly string[];
  /** 灰色の 2 段目 */
  sub?: string;
}
