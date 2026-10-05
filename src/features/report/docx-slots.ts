/** The retained template's documented editable slots. Preserve-only notice and conformity sections are not listed. */
export const DOCX_SLOTS = {
  documentXml: 'word/document.xml',
  summaryTableIndex: 0,
  annexTableIndex: 1,
  paragraphs: {
    inspectionMetadata: 'Date of Inspection:',
    monitoringTeam: 'DOE Monitoring Team (DMT):',
    storeName: 'Name of Store:',
    address: 'Address:',
    email: 'Email Address:',
    contactNumber: 'Contact Number:',
    representative: 'Store Representative:',
    findings: 'Finding(s) / Observation(s):',
    recommendations: 'Recommendation(s) / Resolution(s):',
    signatures: 'Team Leader:',
    designations: 'Designation:',
  },
} as const;
