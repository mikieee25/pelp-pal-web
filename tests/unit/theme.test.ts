import { describe, expect, it } from 'vitest';
import { appTheme } from '@/theme/theme';
import { designTokens } from '@/theme/tokens';

describe('appTheme', () => {
  it('uses the centralized Inter typography and semantic palette', () => {
    expect(appTheme.typography.fontFamily).toBe(designTokens.typography.fontFamily);
    expect(appTheme.palette.primary.main).toBe(designTokens.colors.primary);
    expect(appTheme.palette.background.default).toBe(designTokens.colors.canvas);
    expect(appTheme.shape.borderRadius).toBe(designTokens.radius.md);
  });
});
