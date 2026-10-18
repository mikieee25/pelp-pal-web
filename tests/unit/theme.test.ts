import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { designTokens } from '@/theme/tokens';

const globalCss = readFileSync(resolve(process.cwd(), 'src/app/globals.css'), 'utf8');

describe('design tokens', () => {
  it('keeps every status foreground/background pair at WCAG AA contrast', () => {
    const { colors } = designTokens;
    const pairs = [
      [colors.success, colors.successSoft],
      [colors.danger, colors.dangerSoft],
      [colors.warning, colors.warningSoft],
      [colors.primary, colors.primarySoft],
      [colors.muted, colors.surfaceAlt],
    ];
    const luminance = (hex: string) => {
      const channels = hex.slice(1).match(/.{2}/g)!.map((channel) => parseInt(channel, 16) / 255);
      const linear = channels.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
      return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
    };

    for (const [foreground, background] of pairs) {
      const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
      expect((values[0]! + 0.05) / (values[1]! + 0.05), `${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('uses the centralized Inter typography and semantic palette', () => {
    expect(designTokens.typography.fontFamily).toMatch(/^'Inter Variable', Inter, Arial/);
    expect(designTokens.colors.primary).toBe('#0B5CAB');
    expect(designTokens.colors.canvas).toBe('#FFFFFF');
    expect(designTokens.radius.control).toBe(10);
  });

  it('exposes the PELP palette through semantic CSS variables for HeroUI and Tailwind', () => {
    for (const [name, value] of Object.entries(designTokens.colors)) {
      const cssName = name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
      expect(globalCss).toContain(`--pelp-${cssName}: ${value};`);
    }
    expect(globalCss).toContain('--color-primary: var(--pelp-primary);');
    expect(globalCss).toContain('--color-ink: var(--pelp-ink);');
  });
});
