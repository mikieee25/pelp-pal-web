import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { buildReportDiagnostics } from '@/features/report/report-diagnostics';
import { PELPPalDatabase } from '@/lib/db/database';
import { LocalRepository } from '@/lib/db/repository';
import type { InspectionRecord } from '@/lib/db/records';

const databases: PELPPalDatabase[] = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.delete()));
});

describe('inspection outcome parity', () => {
  it('keeps Activity outcome filters aligned with Summary across both payload shapes', async () => {
    const inspections: InspectionRecord[] = [
      {
        id: 'web-compliant',
        status: 'completed',
        storeName: 'Web Store',
        controlNumber: 'WEB-COMPLIANT',
        outcome: 'compliant',
        labeling: 'with_label',
        placement: 'passing',
        visualQuality: 'passing',
        productDetails: 'passing',
      },
      {
        id: 'web-nc',
        status: 'completed',
        storeName: 'Web Store',
        controlNumber: 'WEB-NC',
        outcome: 'non_compliant',
        labeling: 'with_label',
        placement: 'failing',
      },
      {
        id: 'mobile-compliant',
        status: 'completed',
        storeName: 'Mobile Store',
        controlNumber: 'MOBILE-COMPLIANT',
        labeling_answer: 'with_label',
        placement_answer: 'passing',
        visual_quality_answer: 'passing',
        product_details_answer: 'passing',
      },
      {
        id: 'mobile-nc',
        status: 'completed',
        storeName: 'Mobile Store',
        controlNumber: 'MOBILE-NC',
        labeling_answer: 'registered_only',
        placement_answer: 'passing',
        visual_quality_answer: 'passing',
        product_details_answer: 'passing',
      },
      {
        id: 'mobile-coe',
        status: 'completed',
        storeName: 'Mobile Store',
        controlNumber: 'MOBILE-COE',
        labeling_answer: 'with_coe',
        placement_answer: 'passing',
      },
      {
        id: 'no-answers',
        status: 'completed',
        storeName: 'Unknown Store',
        controlNumber: 'NO-ANSWERS',
      },
    ];
    const database = new PELPPalDatabase(`test-${crypto.randomUUID()}`);
    databases.push(database);
    const repository = new LocalRepository(database);
    await database.inspections.bulkPut(inspections);
    await database.activity.bulkPut(inspections.map((inspection, index) => ({
      id: `activity-${inspection.id}`,
      inspection_id: inspection.id,
      event_type: 'inspection_completed',
      change_cursor: index + 1,
      server_created_at: `2026-10-13T0${index}:00:00.000Z`,
      payload: inspection,
    })));

    const activity = await repository.listActivityPage({ limit: 20 });
    const nonCompliantActivity = await repository.listActivityPage({ outcome: 'non_compliant', limit: 20 });
    const summaryDiagnostics = buildReportDiagnostics(inspections);

    expect(nonCompliantActivity.rows).toHaveLength(summaryDiagnostics.nonCompliantCount);
    expect(activity.rows.filter((row) => row.outcome === 'compliant')).toHaveLength(3);
    expect(activity.rows.filter((row) => row.outcome === 'non_compliant')).toHaveLength(2);
    expect(activity.rows.filter((row) => row.outcome === 'unavailable')).toHaveLength(1);
    expect(activity.rows).toHaveLength(inspections.length);
  });
});
