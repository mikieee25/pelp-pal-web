import type { ReportDraft } from '@/lib/db/records';

export function createEmptyReportDraft(storeKey: string): ReportDraft {
  return {
    id: `report:${storeKey}`,
    storeKey,
    inspectionDate: '',
    regionProvince: '',
    monitoringTeam: '',
    distributorType: '',
    storeName: '',
    address: '',
    email: '',
    contactNumber: '',
    storeRepresentative: '',
    findings: '',
    recommendations: '',
    teamLeader: '',
    acknowledgedBy: '',
    teamLeaderDesignation: '',
    representativeDesignation: '',
    updatedAt: new Date().toISOString(),
  };
}
