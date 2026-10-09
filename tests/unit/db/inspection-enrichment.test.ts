import { describe, expect, it } from 'vitest';
import { enrichInspectionsWithActivity, resolveInspectionProduct } from '@/lib/db/inspection-enrichment';

describe('enrichInspectionsWithActivity', () => {
  it('keeps inspection product fields available when the local catalog is missing', () => {
    const result = resolveInspectionProduct({
      id: 'inspection-4',
      storeName: 'Air King Air Conditioning',
      product_type: 'Air Conditioners',
      product_control_number: 'ACU-0049-002275',
      brand: 'Air King',
      model_number: 'AK-200',
      outcome: 'compliant',
    });

    expect(result.source).toBe('inspection');
    expect(result.product).toMatchObject({
      id: 'inspection-product:inspection-4',
      product_type: 'Air Conditioners',
      product_control_number: 'ACU-0049-002275',
      brand: 'Air King',
      model_number: 'AK-200',
    });
  });

  it('uses activity metadata when a synchronized revision is missing store fields', () => {
    const [result] = enrichInspectionsWithActivity(
      [{ id: 'inspection-1', status: 'completed', control_number: 'ACU-1' }],
      [{ id: 'activity-1', inspectionId: 'inspection-1', storeName: 'Landers Superstore Angeles', location: 'Luzon', controlNumber: 'ACU-1', outcome: 'compliant', createdAt: '2026-10-07T00:00:00.000Z' }],
    );

    expect(result).toMatchObject({
      storeName: 'Landers Superstore Angeles',
      location: 'Luzon',
      controlNumber: 'ACU-1',
    });
  });

  it('normalizes synchronized snake_case fields even without an activity event', () => {
    const [result] = enrichInspectionsWithActivity(
      [{
        id: 'inspection-2',
        store_name: 'Abenson',
        product_type: 'Air Conditioners',
        control_number: 'ACU-2',
        model_number_code: 'MODEL-2',
        compliance_status: 'compliant',
        label_status: 'with_label',
        visual_quality: 'passing',
      }],
      [],
    );

    expect(result).toMatchObject({
      storeName: 'Abenson',
      productType: 'Air Conditioners',
      controlNumber: 'ACU-2',
      model: 'MODEL-2',
      outcome: 'compliant',
      labeling: 'with_label',
      visualQuality: 'passing',
    });
  });

  it('falls back to dynamic inspection fields for report identity', () => {
    const [result] = enrichInspectionsWithActivity(
      [{
        id: 'inspection-dynamic',
        status: 'completed',
        dynamic_fields: {
          ecp_type: 'Air Conditioners',
          product_control_number: 'ACU-DYNAMIC',
          model_number_code: 'MODEL-DYNAMIC',
        },
      }],
      [],
    );

    expect(result).toMatchObject({
      productType: 'Air Conditioners',
      controlNumber: 'ACU-DYNAMIC',
      model: 'MODEL-DYNAMIC',
    });
  });

  it('projects Flutter inspection fields from product_snapshot and answer columns', () => {
    const [result] = enrichInspectionsWithActivity(
      [{
        id: 'inspection-3',
        product_control_number: 'LED-3',
        product_snapshot: JSON.stringify({
          controlNumber: 'LED-3',
          productType: 'LED Lamps',
          brand: 'Bright',
          modelNumber: 'MODEL-3',
          dynamicFields: { Company: 'Lighting Co.' },
        }),
        labeling_answer: 'with_label',
        placement_answer: 'passing',
        visual_quality_answer: 'failing',
        product_details_answer: 'passing',
      }],
      [],
    );

    expect(result).toMatchObject({
      controlNumber: 'LED-3',
      productType: 'LED Lamps',
      brand: 'Bright',
      model: 'MODEL-3',
      dynamic_fields: { Company: 'Lighting Co.' },
      labeling: 'with_label',
      placement: 'passing',
      visualQuality: 'failing',
      productDetails: 'passing',
    });
  });
});
