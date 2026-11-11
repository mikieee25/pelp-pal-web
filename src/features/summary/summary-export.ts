export type SummaryCsvData = {
  storeLabel: string;
  generatedAt?: string;
  teamSyncedAt?: string;
  statusRule?: string;
  catalogVersion?: number;
  pendingSync?: number;
  complianceRows: Array<{
    label: string;
    models: number;
    visits?: number;
    compliant?: number;
    notApplicable?: number;
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
    notApplicable?: number;
    visits?: number;
    labeled: number;
    exempted: number;
    models: number;
  }>;
  totals: {
    models: number;
    visits?: number;
    labeled: number;
    exempted: number;
    nonCompliant: number;
    compliant: number;
    notApplicable?: number;
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
    retailPrice: string;
    companyEmail: string;
    pcrEmail: string;
    warning: string;
  }>;
};

export function buildSummaryCsv(data: SummaryCsvData): string {
  const rows: string[][] = [
    ["PELP Pal Compliance Summary"],
    ["Data source", "Synced team inspections for the current account"],
    ["Finished store", data.storeLabel],
    ...(data.generatedAt ? [["Generated at", data.generatedAt]] : []),
    ...(data.teamSyncedAt ? [["Team data synced at", data.teamSyncedAt]] : []),
    ...(data.statusRule ? [["Current status rule", data.statusRule]] : []),
    ...(data.catalogVersion !== undefined
      ? [["Catalog version", data.catalogVersion.toString()]]
      : []),
    ...(data.pendingSync !== undefined
      ? [["Pending sync", data.pendingSync.toString()]]
      : []),
    [],
    ["Compliance Summary"],
    [
      "Types of ECPs",
      "Number of Product Models",
      "Completed Inspection Visits",
      "Compliant Product Models",
      "Not Applicable Product Models",
      "Product Models with Energy Label",
      "Product Models with Certificate of Exemption",
      "Number of Non-Compliant Product Models",
      "Compliance Percentage (%)",
    ],
    ...data.complianceRows.map((row) => [
      row.label,
      row.models.toString(),
      (row.visits ?? 0).toString(),
      (row.compliant ?? row.models - row.nonCompliant).toString(),
      (row.notApplicable ?? 0).toString(),
      row.labeled.toString(),
      row.exempted.toString(),
      row.nonCompliant.toString(),
      formatRate(row.compliance),
    ]),
    [
      "Total:",
      data.totals.models.toString(),
      (data.totals.visits ?? 0).toString(),
      (data.totals.compliant ?? data.totals.models - data.totals.nonCompliant).toString(),
      (data.totals.notApplicable ?? 0).toString(),
      data.totals.labeled.toString(),
      data.totals.exempted.toString(),
      data.totals.nonCompliant.toString(),
      formatRate(data.totals.compliance),
    ],
    [],
    ["Non-Compliance Breakdown Summary"],
    [
      "Types of ECPs",
      "Not Registered",
      "Registered but no EL/COE",
      "Placement",
      "Visual Quality",
      "Product Details",
    ],
    ...data.breakdownRows.map((row) => [
      row.label,
      row.notRegistered.toString(),
      row.noDocument.toString(),
      row.placement.toString(),
      row.visualQuality.toString(),
      row.productDetails.toString(),
    ]),
    [
      "Total:",
      sum(data.breakdownRows, (row) => row.notRegistered).toString(),
      sum(data.breakdownRows, (row) => row.noDocument).toString(),
      sum(data.breakdownRows, (row) => row.placement).toString(),
      sum(data.breakdownRows, (row) => row.visualQuality).toString(),
      sum(data.breakdownRows, (row) => row.productDetails).toString(),
    ],
    [],
    ["Summary of EMV Results"],
    [
      "Types of ECPs",
      "No. of Compliant Models",
      "No. of Non-Compliant Models",
      "Not Applicable Models",
      "Completed Inspection Visits",
      "Labeled Models",
      "Exempted Models",
      "Model Count",
    ],
    ...data.emvRows.map((row) => [
      row.label,
      row.compliant.toString(),
      row.nonCompliant.toString(),
      (row.notApplicable ?? 0).toString(),
      (row.visits ?? 0).toString(),
      row.labeled.toString(),
      row.exempted.toString(),
      row.models.toString(),
    ]),
    [
      "Total",
      data.totals.compliant.toString(),
      data.totals.nonCompliant.toString(),
      (data.totals.notApplicable ?? 0).toString(),
      (data.totals.visits ?? 0).toString(),
      data.totals.labeled.toString(),
      data.totals.exempted.toString(),
      data.totals.models.toString(),
    ],
    ["Compliance Rate", formatRate(data.totals.compliance)],
    [],
    ["Non-Compliance Results"],
    [
      "No.",
      "ECP Type",
      "Brand Name",
      "Model Code",
      "Description of Non-Compliance",
      "Status",
      "Company",
      "Retail Price",
      "Company Email",
      "PCR Email",
      "Warning",
    ],
    ...data.nonCompliantRows.map((row) => [
      row.no.toString(),
      row.ecpType,
      row.brandName,
      row.modelCode,
      row.description,
      row.status,
      row.company,
      row.retailPrice,
      row.companyEmail,
      row.pcrEmail,
      row.warning,
    ]),
  ];

  return `\uFEFF${rows.map((row) => row.map(escapeCsvValue).join(",")).join("\r\n")}\r\n`;
}

function escapeCsvValue(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function formatRate(value: number | null): string {
  return value === null ? "N/A" : `${value.toFixed(0)}%`;
}

function sum<T>(items: T[], selector: (item: T) => number): number {
  return items.reduce((total, item) => total + selector(item), 0);
}
