/**
 * The terminal screen's look (docs/terminal.md): an instrument, not a game menu. Warm white and
 * the frame's coolant amber on a warm black, hairline rules, one sans for the interface, one mono
 * for figures, one serif for what people said. The palette is the entry screen's (src/style.css).
 */
export const SCREEN_W = 1920;
export const SCREEN_H = 1200;

export const INK = {
  bg: '#0b0a08',
  bgLift: '#15120e',
  ink: 'rgba(250, 242, 226, 0.95)',
  dim: 'rgba(250, 242, 226, 0.7)',
  faint: 'rgba(250, 242, 226, 0.46)',
  ghost: 'rgba(250, 236, 210, 0.12)',
  rule: 'rgba(255, 236, 200, 0.16)',
  amber: 'rgb(255, 184, 104)',
  amberDim: 'rgba(255, 184, 104, 0.55)',
  amberGhost: 'rgba(255, 170, 80, 0.16)',
  bronze: 'rgb(214, 172, 118)',
  ok: 'rgb(186, 214, 160)',
} as const;

export const FONT = {
  sans: '"SF Pro Display", "SF Pro Text", "Helvetica Neue", Inter, system-ui, sans-serif',
  mono: '"SF Mono", "JetBrains Mono", Menlo, ui-monospace, monospace',
  serif: '"Iowan Old Style", "Palatino", "Georgia", serif',
} as const;

/** The frame: margins, header, navigation column, content, footer (px). */
export const GRID = {
  m: 64,
  headerY: 54,
  headerRule: 128,
  navX: 64,
  navW: 470,
  navY: 186,
  navRow: 118,
  divX: 580,
  contentX: 630,
  contentY: 176,
  contentW: 1920 - 630 - 64,
  contentH: 1020 - 176,
  footerRule: 1040,
  footerY: 1080,
} as const;
