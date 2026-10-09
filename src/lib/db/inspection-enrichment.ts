import type { ActivityRecord, CatalogRecord, InspectionRecord } from './records';
import { firstObject, readInspectionField } from './inspection-fields';

export type InspectionProductSource = 'catalog' | 'inspection' | 'unavailable';

export type ResolvedInspectionProduct = {
  product?: CatalogRecord;
  source: InspectionProductSource;
};

export function resolveInspectionProduct(
  inspection?: InspectionRecord,
  catalogProduct?: CatalogRecord,
): ResolvedInspectionProduct {
  if (catalogProduct) return { product: catalogProduct, source: 'catalog' };
  if (!inspection) return { source: 'unavailable' };

  const snapshot = firstObject(inspection.productSnapshot, inspection.product_snapshot);
  const product = { ...inspection, ...snapshot };
  const hasProductIdentity = [
    product.productType,
    product.product_type,
    product.ecpType,
    product.ecp_type,
    product.controlNumber,
    product.control_number,
    product.productControlNumber,
    product.product_control_number,
    product.brand,
    product.model,
    product.modelNumber,
    product.model_number,
  ].some((value) => (typeof value === 'string' || typeof value === 'number') && String(value).trim());
  if (!hasProductIdentity) return { source: 'unavailable' };

  return {
    source: 'inspection',
    product: {
      ...product,
      id: `inspection-product:${inspection.id}`,
      catalogScope: 'masterlist',
    } as CatalogRecord,
  };
}

/**
 * Remote inspection revisions and activity events can arrive with different
 * subsets of the inspection metadata. Use the activity event as a fallback so
 * store filters remain complete without replacing the authoritative revision.
 */
export function enrichInspectionsWithActivity(
  inspections: InspectionRecord[],
  activities: ActivityRecord[],
): InspectionRecord[] {
  const activityByInspection = new Map(
    activities
      .filter((activity): activity is ActivityRecord & { inspectionId: string } => Boolean(activity.inspectionId))
      .map((activity) => [activity.inspectionId, activity]),
  );

  return inspections.map((inspection) => {
    const activity = activityByInspection.get(inspection.id);
    const snapshot = firstObject(inspection.productSnapshot, inspection.product_snapshot);
    const dynamicFields = firstObject(
      inspection.dynamic_fields,
      inspection.dynamicFields,
      snapshot?.dynamicFields,
      snapshot?.dynamic_fields,
    );
    return {
      ...inspection,
      storeName: firstValue(inspection.storeName, inspection.store_name, activity?.storeName),
      location: firstValue(inspection.location, inspection.storeLocation, inspection.store_location, activity?.location),
      productType: firstValue(inspection.productType, inspection.product_type, inspection.ecpType, inspection.ecp_type, inspection.type, snapshot?.productType, snapshot?.product_type, snapshot?.ecpType, snapshot?.ecp_type, snapshot?.type, readInspectionField(inspection, ['productType', 'product_type', 'ecpType', 'ecp_type', 'type']), activity?.productType),
      controlNumber: firstValue(inspection.controlNumber, inspection.control_number, inspection.productControlNumber, inspection.product_control_number, snapshot?.controlNumber, snapshot?.control_number, snapshot?.productControlNumber, snapshot?.product_control_number, readInspectionField(inspection, ['controlNumber', 'control_number', 'productControlNumber', 'product_control_number']), activity?.controlNumber),
      brand: firstValue(inspection.brand, inspection.brandName, inspection.brand_name, snapshot?.brand, snapshot?.brandName, snapshot?.brand_name, readInspectionField(inspection, ['brand', 'brandName', 'brand_name']), activity?.brand),
      model: firstValue(inspection.model, inspection.modelNumber, inspection.model_number, inspection.modelNumberCode, inspection.model_number_code, snapshot?.model, snapshot?.modelNumber, snapshot?.model_number, snapshot?.modelNumberCode, snapshot?.model_number_code, readInspectionField(inspection, ['model', 'modelNumber', 'model_number', 'modelNumberCode', 'model_number_code']), activity?.model),
      outcome: firstValue(inspection.outcome, inspection.compliance, inspection.complianceStatus, inspection.compliance_status, activity?.outcome),
      labeling: firstValue(inspection.labeling, inspection.label_status, inspection.labelStatus, inspection.labeling_answer),
      placement: firstValue(inspection.placement, inspection.placement_answer),
      visualQuality: firstValue(inspection.visualQuality, inspection.visual_quality, inspection.visual_quality_answer),
      productDetails: firstValue(inspection.productDetails, inspection.product_details, inspection.product_details_answer),
      dynamic_fields: dynamicFields ?? inspection.dynamic_fields,
      username: firstValue(inspection.username, activity?.username),
      evidenceCount: inspection.evidenceCount ?? activity?.evidenceCount,
    };
  });
}

function firstValue(...values: unknown[]): string | undefined {
  const value = values.find((candidate) => (typeof candidate === 'string' || typeof candidate === 'number') && String(candidate).trim());
  return value === undefined ? undefined : String(value).trim();
}

