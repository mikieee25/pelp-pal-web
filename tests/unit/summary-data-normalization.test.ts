import { describe, expect, it } from 'vitest';
import { productTypeKey } from '@/features/report/report-model';

describe('summary data normalization', () => {
  it.each([
    ['ACU', 'air-conditioner'],
    ['AC', 'air-conditioner'],
    ['REF', 'refrigerating-appliance'],
    ['Refrigerator - Freezer', 'refrigerating-appliance'],
    ['TVL', 'television-set'],
    ['TV', 'television-set'],
    ['CFL', 'lighting-product'],
    ['Fluorescent Lamps', 'lighting-product'],
    ['LED', 'lighting-product'],
    ['CWM', 'energy-saving-device'],
    ['Clothes Washing Machines', 'energy-saving-device'],
    ['DMU', 'energy-saving-device'],
    ['Display Monitors', 'energy-saving-device'],
    ['EFU', 'energy-saving-device'],
    ['Electric Fans', 'energy-saving-device'],
    ['ESD', 'energy-saving-device'],
  ])('maps %s to %s', (value, expected) => {
    expect(productTypeKey(value)).toBe(expected);
  });
});
