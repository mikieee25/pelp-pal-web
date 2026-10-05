export type SummaryCsvData = {
  storeLabel: string;
  complianceRows: Array<{
    label: string;
    models: number;
    labeled: number;
    exempted: number;
    nonCompliant: number;
    compliance: number | null;
  }>;
  breakdownRows: Array<{
    label: string;
    notRegistered: number;
    noDocument: number;
    placement: number;
    visualQuality: number;
    productDetails: number;
  }>;
  emvRows: Array<{
    label: string;
    compliant: number;
    nonCompliant: number;
    labeled: number;
    exempted: number;
    models: number;
  }>;
  totals: {
    models: number;
    labeled: number;
    exempted: number;
    nonCompliant: number;
    compliant: number;
    compliance: number | null;
  };
  nonCompliantRows: Array<{
    no: number;
    ecpType: string;
    brandName: string;
    modelCode: string;
    description: string;
    status: string;
    company: string;
    companyEmail: string;
    pcrEmail: string;
    warning: string;
  }>;
};

export function buildSummaryCsv(data: SummaryCsvData): string {
  const rows: string[][] = [
    ['PELP Pal Compliance Summary'],
    ['Finished store', data.storeLabel],
    [],
    ['Compliance Summary'],
    ['Types of ECPs', 'Number of Product Models', 'Product Models with Energy Label', 'Product Models with Certificate of Exemption', 'Number of Non-Compliant Product Models', 'Compliance Percentage (%)'],
    ...data.complianceRows.map((row) => [row.label, row.models.toString(), row.labeled.toString(), row.exempted.toString(), row.nonCompliant.toString(), formatRate(row.compliance)]),
    ['Total:', data.totals.models.toString(), data.totals.labeled.toString(), data.totals.exempted.toString(), data.totals.nonCompliant.toString(), formatRate(data.totals.compliance)],
    [],
    ['Non-Compliance Breakdown Summary'],
    ['Types of ECPs', 'Not Registered', 'Registered but no EL/COE', 'Placement', 'Visual Quality', 'Product Details'],
    ...data.breakdownRows.map((row) => [row.label, row.notRegistered.toString(), row.noDocument.toString(), row.placement.toString(), row.visualQuality.toString(), row.productDetails.toString()]),
    ['Total:', sum(data.breakdownRows, (row) => row.notRegistered).toString(), sum(data.breakdownRows, (row) => row.noDocument).toString(), sum(data.breakdownRows, (row) => row.placement).toString(), sum(data.breakdownRows, (row) => row.visualQuality).toString(), sum(data.breakdownRows, (row) => row.productDetails).toString()],
    [],
    ['Summary of EMV Results'],
    ['Types of ECPs', 'No. of Compliant Models', 'No. of Non-Compliant Models', 'Labeled Models', 'Exempted Models', 'Model Count'],
    ...data.emvRows.map((row) => [row.label, row.compliant.toString(), row.nonCompliant.toString(), row.labeled.toString(), row.exempted.toString(), row.models.toString()]),
    ['Total', data.totals.compliant.toString(), data.totals.nonCompliant.toString(), data.totals.labeled.toString(), data.totals.exempted.toString(), data.totals.models.toString()],
    ['Compliance Rate', formatRate(data.totals.compliance)],
    [],
    ['Non-Compliance Results'],
    ['No.', 'ECP Type', 'Brand Name', 'Model Code', 'Description of Non-Compliance', 'Status', 'Company', 'Company Email', 'PCR Email', 'Warning'],
    ...data.nonCompliantRows.map((row) => [row.no.toString(), row.ecpType, row.brandName, row.modelCode, row.description, row.status, row.company, row.companyEmail, row.pcrEmail, row.warning]),
  ];

  return `\uFEFF${rows.map((row) => row.map(escapeCsvValue).join(',')).join('\r\n')}\r\n`;
}

function escapeCsvValue(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function formatRate(value: number | null): string {
  return value === null ? 'N/A' : `${value.toFixed(0)}%`;
}

function sum<T>(items: T[], selector: (item: T) => number): number {
  return items.reduce((total, item) => total + selector(item), 0);
}
