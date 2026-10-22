import type { ActivityOutcome } from '@/lib/db/records';

export type InspectionOutcomeRecord = Record<string, unknown>;
export type NormalizedInspectionAnswers = {
  labeling: string;
  placement: string;
  visualQuality: string;
  productDetails: string;
  outcome: ActivityOutcome;
};

const LABELING_KEYS = ['labeling', 'label_status', 'labelStatus', 'labeling_answer'];
const PLACEMENT_KEYS = ['placement', 'placement_answer'];
const VISUAL_QUALITY_KEYS = ['visualQuality', 'visual_quality', 'visual_quality_answer'];
const PRODUCT_DETAILS_KEYS = ['productDetails', 'product_details', 'product_details_answer'];
const OUTCOME_KEYS = ['outcome', 'compliance', 'complianceStatus', 'compliance_status'];
const FINDING_KEYS = [PLACEMENT_KEYS, VISUAL_QUALITY_KEYS, PRODUCT_DETAILS_KEYS];
const NC_VALUES = new Set(['failing', 'nc', 'non_compliant']);
const LABELING_VALUES = new Set(['not_registered', 'registered_only', 'with_coe', 'with_label']);
const CHECKLIST_VALUES = new Set(['passing', 'failing', 'nc', 'non_compliant', 'not_applicable']);
const OUTCOME_VALUES = new Set(['compliant', 'pass', 'passing', 'non_compliant', 'noncompliant', 'fail', 'failing']);

export function deriveInspectionOutcome(
  record: InspectionOutcomeRecord,
  fallback?: InspectionOutcomeRecord,
): ActivityOutcome {
  return normalizeInspectionAnswers(record, fallback).outcome;
}

export function normalizeInspectionAnswers(
  record: InspectionOutcomeRecord,
  fallback?: InspectionOutcomeRecord,
): NormalizedInspectionAnswers {
  const sources = fallback ? [record, fallback] : [record];
  const labeling = firstNormalizedValue(sources, LABELING_KEYS);
  const placement = firstNormalizedValue(sources, PLACEMENT_KEYS);
  const visualQuality = firstNormalizedValue(sources, VISUAL_QUALITY_KEYS);
  const productDetails = firstNormalizedValue(sources, PRODUCT_DETAILS_KEYS);
  const rawOutcome = firstNormalizedValue(sources, OUTCOME_KEYS);
  const allChecklistAnswersNotApplicable = [placement, visualQuality, productDetails]
    .every((answer) => answer === 'not_applicable');
  const outcome = isNonCompliantAnswer(labeling, placement, visualQuality, productDetails, rawOutcome)
    ? 'non_compliant'
    : LABELING_VALUES.has(labeling) && labeling.startsWith('with_') && allChecklistAnswersNotApplicable
      ? 'unavailable'
    : hasRecognizedAnswer(sources, labeling, rawOutcome) ? 'compliant' : 'unavailable';
  return { labeling, placement, visualQuality, productDetails, outcome };
}

export function hasNonCompliantFinding(
  record: InspectionOutcomeRecord,
  fallback?: InspectionOutcomeRecord,
): boolean {
  const sources = fallback ? [record, fallback] : [record];
  const labeling = firstNormalizedValue(sources, LABELING_KEYS);
  if (labeling === 'not_registered' || labeling === 'registered_only') return true;
  return FINDING_KEYS.some((keys) => NC_VALUES.has(firstNormalizedValue(sources, keys)));
}

function isNonCompliantAnswer(labeling: string, placement: string, visualQuality: string, productDetails: string, outcome: string): boolean {
  return labeling === 'not_registered' || labeling === 'registered_only'
    || [placement, visualQuality, productDetails].some((value) => NC_VALUES.has(value))
    || isNonCompliantOutcome(outcome);
}

function hasRecognizedAnswer(
  sources: InspectionOutcomeRecord[],
  labeling: string,
  rawOutcome: string,
): boolean {
  if (LABELING_VALUES.has(labeling) || OUTCOME_VALUES.has(rawOutcome)) return true;
  return FINDING_KEYS.some((keys) => CHECKLIST_VALUES.has(firstNormalizedValue(sources, keys)));
}

function isNonCompliantOutcome(value: string): boolean {
  return value === 'non_compliant' || value === 'noncompliant' || value === 'fail' || value === 'failing';
}

function firstNormalizedValue(sources: InspectionOutcomeRecord[], keys: string[]): string {
  for (const source of sources) {
    for (const key of keys) {
      const value = source[key];
      if (typeof value !== 'string' || !value.trim()) continue;
      return normalize(value);
    }
  }
  return '';
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replaceAll('-', '_').replaceAll(' ', '_');
}
