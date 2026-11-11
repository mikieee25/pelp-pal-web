import { describe, expect, it } from "vitest";
import { productTypeKey } from "@/features/report/report-model";

describe("summary data normalization", () => {
  it.each([
    ["ACU", "air-conditioner"],
    ["AC", "air-conditioner"],
    ["REF", "refrigerating-appliance"],
    ["Refrigerator - Freezer", "refrigerating-appliance"],
    ["TVL", "television-set"],
    ["TV", "television-set"],
    ["CFL", "lighting-product"],
    ["Fluorescent Lamps", "lighting-product"],
    ["LED", "lighting-product"],
    ["CWM", "clothes-washing-machine"],
    ["Clothes Washing Machines", "clothes-washing-machine"],
    ["DMU", "display-monitor"],
    ["Display Monitors", "display-monitor"],
    ["EFU", "electric-fan"],
    ["Electric Fans", "electric-fan"],
    ["ESD", "esd"],
    ["Energy Saving Devices", "esd"],
  ])("maps %s to %s", (value, expected) => {
    expect(productTypeKey(value)).toBe(expected);
  });
});
