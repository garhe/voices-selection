export const DEFAULT_THEME_COLOR = '#8eafa0';
export const THEME_STORAGE_KEY = 'voices-selection.interface-color';
export const themeFamilies = [
  { name: 'Sage', colors: ['#c5d8cd', DEFAULT_THEME_COLOR, '#527766'] },
  { name: 'Lagoon', colors: ['#b9dcd6', '#6caba3', '#316f70'] },
  { name: 'Sky', colors: ['#bfd4e2', '#7ca4bd', '#3f6686'] },
  { name: 'Iris', colors: ['#d1c5df', '#a18ab7', '#695080'] },
  { name: 'Rose', colors: ['#dfc4cf', '#bb8a9d', '#8b526a'] },
] as const;
const shades = ['Mist', 'Soft', 'Deep'] as const;
export const themePresets = themeFamilies.flatMap(family => family.colors.map((color, index) => ({
  name: `${family.name} ${shades[index]}`, family: family.name, shade: shades[index], color,
})));

export function validThemeColor(color: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(color);
}

type Rgb = [number, number, number];
function mix(color: Rgb, target: number, amount: number): Rgb {
  const channel = (value: number) => Math.round(value + (target - value) * amount);
  return [channel(color[0]), channel(color[1]), channel(color[2])];
}
function luminance(color: Rgb): number {
  const channels = color.map(value => {
    const channel = value / 255;
    return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
  });
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
}

export function themePalette(color: string): Record<string, string> {
  if (!validThemeColor(color)) throw new Error('Interface color must be a six-digit hex color, such as #146b58.');
  const base: Rgb = [Number.parseInt(color.slice(1, 3), 16), Number.parseInt(color.slice(3, 5), 16), Number.parseInt(color.slice(5, 7), 16)];
  let accent = base;
  // White button labels must remain readable even for very pale custom colors.
  while (1.05 / (luminance(accent) + .05) < 4.5) accent = mix(accent, 0, .06);
  const glass = mix(base, 255, .55);
  const rgb = (value: Rgb) => value.join(', ');
  return {
    '--theme-color': color.toLowerCase(),
    '--theme-accent': `rgb(${rgb(accent)})`,
    '--theme-accent-hover': `rgb(${rgb(mix(accent, 0, .32))})`,
    '--theme-row-hover': `rgb(${rgb(mix(accent, 255, .68))})`,
    '--theme-heading': `rgb(${rgb(mix(accent, 0, .45))})`,
    '--theme-text': `rgb(${rgb(mix(accent, 0, .5))})`,
    '--theme-muted': `rgb(${rgb(mix(accent, 0, .42))})`,
    '--theme-page': `rgb(${rgb(mix(base, 255, .89))})`,
    '--theme-glow': `rgb(${rgb(mix(base, 255, .58))})`,
    '--theme-glow-soft': `rgb(${rgb(mix(base, 255, .77))})`,
    '--theme-surface-rgb': rgb(mix(base, 255, .96)),
    '--theme-glass-rgb': rgb([Math.max(200, glass[0]), Math.max(200, glass[1]), Math.max(200, glass[2])]),
    '--theme-panel-rgb': rgb(mix(base, 255, .87)),
    '--theme-sidebar-rgb': rgb(mix(accent, 0, .66)),
    '--theme-inset-rgb': rgb(mix(base, 255, .94)),
    '--theme-selected': `rgb(${rgb(mix(base, 255, .85))})`,
    '--theme-header': `rgb(${rgb(mix(base, 255, .91))})`,
    '--theme-border': `rgba(${rgb(accent)}, .25)`,
    '--theme-scrollbar': `rgb(${rgb(mix(accent, 255, .45))})`,
  };
}
