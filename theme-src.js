// Source for vendor/dycolor.js (bundled with esbuild because Google's color library is ESM-only with extension-less imports).
// Rebuild: npm run build:theme
// Exposes DyColor.rolesFromSeed(seedHex, dark, variant) -> { 'primary': '#rrggbb', 'on-primary': ..., ... } (CSS role names, no prefix)
import {
  argbFromHex, hexFromArgb, Hct, MaterialDynamicColors as M,
  SchemeTonalSpot, SchemeVibrant, SchemeExpressive, SchemeNeutral,
} from '@material/material-color-utilities';

const VARIANTS = { tonal: SchemeTonalSpot, vibrant: SchemeVibrant, expressive: SchemeExpressive, neutral: SchemeNeutral };

const ROLES = [
  'primary', 'onPrimary', 'primaryContainer', 'onPrimaryContainer',
  'secondary', 'onSecondary', 'secondaryContainer', 'onSecondaryContainer',
  'tertiary', 'onTertiary', 'tertiaryContainer', 'onTertiaryContainer',
  'error', 'onError', 'errorContainer', 'onErrorContainer',
  'surface', 'surfaceContainerLowest', 'surfaceContainerLow', 'surfaceContainer', 'surfaceContainerHigh', 'surfaceContainerHighest',
  'onSurface', 'onSurfaceVariant', 'outline', 'outlineVariant', 'inverseSurface', 'inverseOnSurface', 'inversePrimary',
];
const kebab = (s) => s.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());

export function rolesFromSeed(seedHex, dark, variant = 'vibrant', contrast = 0) {
  const Scheme = VARIANTS[variant] || SchemeVibrant;
  const scheme = new Scheme(Hct.fromInt(argbFromHex(seedHex)), !!dark, contrast);
  const out = {};
  for (const name of ROLES) out[kebab(name)] = hexFromArgb(M[name].getArgb(scheme));
  return out;
}

// WCAG 2 contrast ratio between two #rrggbb colours (used by the tests and the settings preview)
export function contrastRatio(a, b) {
  const lum = (hex) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export const VARIANT_NAMES = Object.keys(VARIANTS);
