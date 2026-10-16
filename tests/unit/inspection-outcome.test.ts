import { describe, expect, it } from 'vitest';
import { normalizeInspectionAnswers } from '@/lib/inspection-outcome';

describe('normalizeInspectionAnswers', () => {
  it.each([
    ['web compliant', { labeling: 'with_label', placement: 'passing', visualQuality: 'passing', productDetails: 'passing' }, 'compliant', 'with_label'],
    ['web non-compliant', { labeling: 'not_registered', placement: 'passing', visualQuality: 'passing', productDetails: 'passing' }, 'non_compliant', 'not_registered'],
    ['mobile with COE', { labeling_answer: 'with_coe', placement_answer: 'passing', visual_quality_answer: 'passing', product_details_answer: 'passing' }, 'compliant', 'with_coe'],
    ['mobile with label', { labeling_answer: 'with_label', placement_answer: 'passing', visual_quality_answer: 'passing', product_details_answer: 'passing' }, 'compliant', 'with_label'],
    ['mobile registered only', { labeling_answer: 'registered_only', placement_answer: 'passing', visual_quality_answer: 'passing', product_details_answer: 'passing' }, 'non_compliant', 'registered_only'],
    ['mobile not registered', { labeling_answer: 'not_registered', placement_answer: 'passing', visual_quality_answer: 'passing', product_details_answer: 'passing' }, 'non_compliant', 'not_registered'],
    ['mobile failing product details', { labeling_answer: 'with_label', placement_answer: 'passing', visual_quality_answer: 'passing', product_details_answer: 'failing' }, 'non_compliant', 'with_label'],
    ['no answers', {}, 'unavailable', ''],
  ])('normalizes %s answers consistently', (_name, record, outcome, labeling) => {
    expect(normalizeInspectionAnswers(record)).toMatchObject({ outcome, labeling });
  });
});
