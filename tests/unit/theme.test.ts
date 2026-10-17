import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { designTokens } from '@/theme/tokens';

const globalCss = readFileSync(resolve(process.cwd(), 'src/app/globals.css'), 'utf8');

describe('design tokens', () => {
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
