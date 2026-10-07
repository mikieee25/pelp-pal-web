import type { ActivityRecord, InspectionRecord } from './records';
import { firstObject } from './inspection-fields';

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
      productType: firstValue(inspection.productType, inspection.product_type, inspection.ecpType, inspection.ecp_type, inspection.type, snapshot?.productType, snapshot?.product_type, snapshot?.ecpType, snapshot?.ecp_type, snapshot?.type, activity?.productType),
      controlNumber: firstValue(inspection.controlNumber, inspection.control_number, inspection.productControlNumber, inspection.product_control_number, snapshot?.controlNumber, snapshot?.control_number, snapshot?.productControlNumber, snapshot?.product_control_number, activity?.controlNumber),
      brand: firstValue(inspection.brand, inspection.brandName, inspection.brand_name, snapshot?.brand, snapshot?.brandName, snapshot?.brand_name, activity?.brand),
      model: firstValue(inspection.model, inspection.modelNumber, inspection.model_number, inspection.modelNumberCode, inspection.model_number_code, snapshot?.model, snapshot?.modelNumber, snapshot?.model_number, snapshot?.modelNumberCode, snapshot?.model_number_code, activity?.model),
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

