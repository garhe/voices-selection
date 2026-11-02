export const DEFAULT_THEME_COLOR = '#8eafa0';
export const THEME_STORAGE_KEY = 'voices-selection.interface-color';
export const themeMixes = [
  { id: 'joy', name: 'Joy', colors: ['#ed982f', '#f7d45b', '#a6b27b', '#f2bb75', '#77915c'] },
  { id: 'calm', name: 'Calm', colors: ['#7fa7c5', '#a9bd9e', '#cbb4db', '#f4f2eb', '#a6c7df'] },
  { id: 'energy', name: 'Energy', colors: ['#d83c32', '#f28a64', '#f5d84b', '#ec6f32', '#f4b39b'] },
  { id: 'melancholy', name: 'Melancholy', colors: ['#304b74', '#a6a7ad', '#252a30', '#799db9', '#1d304f'] },
  { id: 'tenderness', name: 'Tenderness', colors: ['#c9879a', '#f0d0c3', '#cbb3d5', '#f5ead7', '#edb9bb'] },
  { id: 'mystery', name: 'Mystery', colors: ['#694079', '#245b51', '#c6a45e', '#233c62', '#39264e'] },
  { id: 'freedom', name: 'Freedom', colors: ['#5aabc0', '#58a39b', '#b8c6a0', '#f0e9da', '#a4cfe5'] },
  { id: 'hope', name: 'Hope', colors: ['#91ad59', '#f1d77d', '#edb9b5', '#c7d99c', '#f6eed5'] },
] as const;
export function themeMix(selection: string) {
  return themeMixes.find(preset => selection === `mix:${preset.id}`);
}

export function validThemeSelection(selection: string): boolean {
  return validThemeColor(selection) || themeMix(selection) !== undefined;
}

export function themePreview(colors: readonly string[]): string {
  return `linear-gradient(135deg, ${colors.map((color, index) => `${color} ${index * 100 / (colors.length - 1)}%`).join(', ')})`;
}

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
function parseRgb(color: string): Rgb {
  return [Number.parseInt(color.slice(1, 3), 16), Number.parseInt(color.slice(3, 5), 16), Number.parseInt(color.slice(5, 7), 16)];
}
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

function whiteTextBackground(color: Rgb, minimumContrast = 4.5): Rgb {
  let shade = color;
  while (1.05 / (luminance(shade) + .05) < minimumContrast) shade = mix(shade, 0, .06);
  return shade;
}

export function themePalette(selection: string, random: () => number = Math.random): Record<string, string> {
  const preset = themeMix(selection);
  const color = preset?.colors[0] ?? selection;
  if (!validThemeColor(color)) throw new Error('Interface color must be a six-digit hex color, such as #146b58.');
  const base = parseRgb(color);
  const accent = whiteTextBackground(base);
  const glass = mix(base, 255, .55);
  const rgb = (value: Rgb) => value.join(', ');
  const hex = (value: Rgb) => '#' + value.map(channel => channel.toString(16).padStart(2, '0')).join('');
  const palette: Record<string, string> = {
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
    '--theme-glow-third': `rgb(${rgb(mix(base, 255, .58))})`,
    '--theme-card-wash': 'linear-gradient(transparent, transparent)',
    '--theme-panel-wash': 'linear-gradient(transparent, transparent)',
    '--theme-recordings-wash': 'linear-gradient(transparent, transparent)',
    '--theme-sidebar-wash': 'linear-gradient(transparent, transparent)',
    '--theme-sidebar-selected': '#ffffff1f',
    '--theme-sidebar-hover': '#ffffff40',
    '--theme-sidebar-ink': '#ffffff',
    '--theme-sidebar-marker': '#ffffff',
    '--theme-workspace-hover': `rgb(${rgb(accent)})`,
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
  if (preset) {
    const tint = (index: number, amount: number) => mix(parseRgb(preset.colors[index]), 255, amount);
    const paint = (index: number, amount: number) => `rgb(${rgb(tint(index, amount))})`;
    // Opaque, light color washes remain visible even when cards cover the page backdrop.
    palette['--theme-card-wash'] = `linear-gradient(125deg, ${paint(0, .68)}, ${paint(1, .78)})`;
    palette['--theme-panel-wash'] = `linear-gradient(135deg, ${paint(1, .62)}, ${paint(2, .78)})`;
    palette['--theme-recordings-wash'] = `linear-gradient(125deg, ${paint(2, .64)}, ${paint(3, .8)})`;
    const ranked = preset.colors.map(parseRgb).sort((a, b) => luminance(a) - luminance(b));
    const dark = whiteTextBackground(ranked[0], 7);
    // Prefer a light colored paint over near-white ivory for a recognizable highlight.
    const highlight = [...ranked].reverse().find(color => Math.max(...color) - Math.min(...color) >= 30)!;
    const colorClouds = (paints: Rgb[], vertical = false) => {
      const colors = [...paints];
      for (let index = colors.length - 1; index > 0; index--) {
        const other = Math.floor(random() * (index + 1));
        [colors[index], colors[other]] = [colors[other], colors[index]];
      }
      const clouds = colors.map((color, index) => {
        const along = 3 + index * 20 + Math.floor(random() * 15);
        const across = 5 + Math.floor(random() * 91);
        const x = vertical ? across : along;
        const y = vertical ? along : across;
        const width = vertical ? 85 + Math.floor(random() * 76) : 40 + Math.floor(random() * 36);
        const height = vertical ? 25 + Math.floor(random() * 21) : 75 + Math.floor(random() * 86);
        return `radial-gradient(ellipse ${width}% ${height}% at ${x}% ${y}%, rgb(${rgb(color)}) 0%, transparent 100%)`;
      });
      return clouds.join(', ');
    };
    const highlightGradient = (minimumLuminance: number) => {
      const colors = preset.colors.map(color => {
        let shade = mix(parseRgb(color), 255, .6);
        while (luminance(shade) < minimumLuminance) shade = mix(shade, 255, .06);
        return shade;
      });
      return `${colorClouds(colors)}, #f5f7f8`;
    };
    const darkHex = hex(dark);
    palette['--theme-sidebar-rgb'] = rgb(dark);
    palette['--theme-sidebar-wash'] = `${colorClouds(preset.colors.map(color => whiteTextBackground(parseRgb(color), 7)), true)}, linear-gradient(${darkHex}, ${darkHex})`;
    palette['--theme-sidebar-selected'] = highlightGradient(.6);
    palette['--theme-sidebar-hover'] = highlightGradient(.72);
    const workspaceColors = preset.colors.map(color => whiteTextBackground(parseRgb(color)));
    palette['--theme-workspace-hover'] = `${colorClouds(workspaceColors)}, ${hex(accent)}`;
    palette['--theme-sidebar-ink'] = `rgb(${rgb(mix(dark, 0, .5))})`;
    palette['--theme-sidebar-marker'] = `rgb(${rgb(highlight)})`;
    palette['--theme-page'] = paint(3, .72);
    palette['--theme-glow'] = paint(0, .2);
    palette['--theme-glow-soft'] = paint(1, .24);
    palette['--theme-glow-third'] = paint(2, .24);
    palette['--theme-panel-rgb'] = rgb(tint(1, .6));
    palette['--theme-surface-rgb'] = rgb(tint(3, .9));
    palette['--theme-inset-rgb'] = rgb(tint(4, .88));
    palette['--theme-selected'] = paint(2, .72);
    palette['--theme-header'] = paint(1, .8);
  }
  return palette;
}
