export type ProductDraft = {
  id: string;
  registrationStatus: 'registered' | 'notRegistered';
  controlNumber: string;
  productType: string;
  brand: string;
  modelNumber: string;
  dynamicFields: Record<string, unknown>;
};

export type ComparisonDraft = {
  state: 'match' | 'mismatch' | 'not_visible';
  observedValue?: string;
  reason?: string;
};

export type InspectionDraft = {
  storeName: string;
  product: ProductDraft;
  activityLogId: string;
  labeling: 'with_label' | 'with_coe' | 'registered_only' | 'not_registered' | null;
  placement: 'passing' | 'failing' | null;
  visualQuality: 'passing' | 'failing' | null;
  productDetails: 'passing' | 'failing' | null;
  comparisons: ComparisonDraft[];
  evidenceCount: number;
  remarks: string;
  retailPrice?: string;
};

export function validateInspectionDraft(draft: InspectionDraft): Record<string, string> {
  const failures: Record<string, string> = {};
  const product = draft.product;
  if (!draft.storeName.trim()) failures.storeName = 'Store name is required.';
  if (!product.id.trim() || (product.registrationStatus === 'registered' && !product.controlNumber.trim())) {
    failures.productIdentity = 'Product identity is required.';
  }
  if (product.registrationStatus === 'notRegistered') {
    const company = String(product.dynamicFields['Company Name'] ?? '').trim();
    const retailPrice = (draft.retailPrice ?? '').trim() || String(product.dynamicFields['Retail Price'] ?? '').trim();
    if (!product.productType.trim() || !product.brand.trim() || !product.modelNumber.trim() || !company || !retailPrice) {
      failures.unregisteredIdentity = 'Product type, brand, model, company, and retail price are required.';
    }
  }
  if (!draft.activityLogId.trim()) failures.activityLogId = 'Activity log is required.';
  if (!draft.labeling) failures.labeling = 'Labeling answer is required.';
  if (draft.labeling === 'with_label' || draft.labeling === 'with_coe' || draft.labeling === null) {
    if (!draft.placement) failures.placement = 'Placement answer is required.';
    if (!draft.visualQuality) failures.visualQuality = 'Visual quality answer is required.';
    if (!draft.productDetails) failures.productDetails = 'Product details answer is required.';
  }
  for (const comparison of draft.comparisons) {
    if (comparison.state === 'mismatch' && !comparison.observedValue?.trim()) {
      failures.comparisons = 'Each mismatch requires an observed value.';
      break;
    }
    if (comparison.state === 'not_visible' && !comparison.reason?.trim()) {
      failures.comparisons = 'Each not-visible field requires a reason.';
      break;
    }
  }
  if (draft.evidenceCount > 3) failures.evidence = 'A maximum of three photos is allowed.';
  else if (requiresEvidence(draft) && draft.evidenceCount === 0) failures.evidence = 'Attach at least one photo to continue.';
  return failures;
}

function requiresEvidence(draft: InspectionDraft): boolean {
  return draft.comparisons.some((comparison) => comparison.state !== 'match')
    || draft.labeling === 'registered_only'
    || draft.labeling === 'not_registered'
    || [draft.placement, draft.visualQuality, draft.productDetails].includes('failing');
}
