import { describe, expect, it } from 'vitest';
import { inspectionHref } from '@/lib/offline/inspection-route';

describe('offline inspection route', () => {
  it('uses a fixed prepared page and preserves inspection options', () => {
    expect(inspectionHref('inspection-a', { offline: true, catalogId: 'catalog a', view: true }))
      .toBe('/inspect/work?inspectionId=inspection-a&catalogId=catalog+a&view=1');
    expect(inspectionHref('inspection-a')).toBe('/inspect/inspection-a');
  });
});
