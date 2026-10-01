import { describe, expect, it } from 'vitest';
import { validateInspectionDraft, type InspectionDraft } from '@/features/inspection/validator';

const baseDraft: InspectionDraft = {
  storeName: 'Store',
  product: { id: 'p-1', registrationStatus: 'registered', controlNumber: 'C-1', productType: 'Fan', brand: 'Brand', modelNumber: 'M-1', dynamicFields: {} },
  activityLogId: 'activity-1',
  labeling: 'with_label',
  placement: 'passing',
  visualQuality: 'passing',
  productDetails: 'passing',
  comparisons: [],
  evidenceCount: 0,
  remarks: '',
};

describe('inspection validator parity', () => {
  it('accepts a complete compliant registered-product draft', () => {
    expect(validateInspectionDraft(baseDraft)).toEqual({});
  });

  it('requires evidence for a comparison mismatch', () => {
    expect(validateInspectionDraft({ ...baseDraft, comparisons: [{ state: 'mismatch', observedValue: '' }] })).toMatchObject({ evidence: expect.any(String), comparisons: expect.any(String) });
  });

  it('requires unregistered identity fields', () => {
    expect(validateInspectionDraft({
      ...baseDraft,
      product: { ...baseDraft.product, registrationStatus: 'notRegistered', controlNumber: '', productType: '', brand: '', modelNumber: '', dynamicFields: {} },
      labeling: 'not_registered', placement: null, visualQuality: null, productDetails: null,
    })).toMatchObject({ unregisteredIdentity: expect.any(String) });
  });
});
