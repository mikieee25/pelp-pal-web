import type { CatalogRecord } from '@/lib/db/records';
import { ChevronDown } from 'lucide-react';
import { AnimatedDisclosure } from '@/components/motion/animated-disclosure';

export type CatalogDetail = {
  label: string;
  value: string;
};

const inspectorFields: Array<{ label: string; keys: string[] }> = [
  { label: 'Product Category', keys: ['product_category'] },
  { label: 'Product Type', keys: ['product_type', 'productType', 'ecp_type', 'ecpType'] },
  { label: 'Particular Product', keys: ['particular_product'] },
  { label: 'Company Name', keys: ['company_name', 'companyName', 'company'] },
  { label: 'Original Equipment Manufacturer', keys: ['original_equipment_manufacturer', 'originalEquipmentManufacturer', 'manufacturer'] },
  { label: 'Control Number', keys: ['control_number', 'product_control_number', 'controlNumber'] },
  { label: 'Brand', keys: ['brand_name', 'brandName', 'brand'] },
  { label: 'Product Name', keys: ['product_name', 'productName'] },
  { label: 'Model Number / Code', keys: ['model_number_code', 'modelNumberCode', 'model_number', 'modelNumber', 'model'] },
  { label: 'Monthly Energy Consumption (kWh)', keys: ['monthly_energy_consumption_kwh', 'monthly_energy_consumption', 'energy_consumption'] },
  { label: 'Monthly Equivalent GHG Emission (kg CO₂)', keys: ['monthly_equivalent_ghg_emission_kg_co2', 'monthly_equivalent_ghg_emission'] },
  { label: 'Volume (L)', keys: ['volume_l', 'volume'] },
  { label: 'Freezing Capacity', keys: ['freezing_capacity'] },
  { label: 'Ice Making Capacity', keys: ['ice_making_capacity'] },
  { label: 'Defrost Type', keys: ['defrost_type'] },
  { label: 'Coldness Star Rating', keys: ['coldness_star_rating'] },
  { label: 'Refrigerant', keys: ['refrigerant', 'refrigerant_used'] },
  { label: 'Global Warming Potential (GWP)', keys: ['gwp', 'global_warming_potential_gwp_of_the_refrigerant'] },
  { label: 'Voltage (V)', keys: ['voltage_v'] },
  { label: 'Frequency (Hz)', keys: ['frequency_hz'] },
  { label: 'Energy Efficiency Factor (EEF)', keys: ['energy_efficiency_factor_eef', 'eef', 'eef_rated_performance_value'] },
  { label: 'Cooling Capacity (kW)', keys: ['cooling_capacity_kw'] },
  { label: 'Cooling Seasonal Performance Factor (CSPF)', keys: ['cooling_seasonal_performance_factor_cspf'] },
  { label: 'Power Input (W)', keys: ['power_input_w', 'power_input_watts', 'power_input'] },
  { label: 'Light Output (lm)', keys: ['light_output_lm'] },
  { label: 'Energy Efficiency Value (lm/W)', keys: ['energy_efficiency_value_lm_w'] },
  { label: 'Total Energy Consumption (kW)', keys: ['total_energy_consumption_kw'] },
  { label: 'Luminous Area (m²)', keys: ['luminous_area_m2'] },
  { label: 'Energy Efficiency Value', keys: ['energy_efficiency_value'] },
  { label: 'Standby Power (W)', keys: ['standby_power_w'] },
  { label: 'Load Type', keys: ['load_type'] },
  { label: 'Washing Performance Ratio', keys: ['washing_performance_ratio'] },
  { label: 'Heater (W)', keys: ['heater'] },
  { label: 'Washer Motor', keys: ['washer_motor'] },
  { label: 'Spin Motor', keys: ['spin_motor'] },
  { label: 'Fan Category', keys: ['fan_category'] },
  { label: 'Blade Diameter (mm)', keys: ['blade_diameter_mm'] },
  { label: 'Maximum Fan Flow Rate (m³/min)', keys: ['maximum_fan_flow_rate_m3_min', 'maximum_fan_flow_rate'] },
  { label: 'With EWBS', keys: ['with_ewbs'] },
];

export function getCatalogDetails(row: CatalogRecord): CatalogDetail[] {
  const details: CatalogDetail[] = [];
  const values = new Map<string, unknown>();
  for (const [key, value] of Object.entries(row)) values.set(normalizeFieldKey(key), value);
  for (const [key, value] of parseDynamicFields(row.dynamic_fields)) values.set(normalizeFieldKey(key), value);

  for (const field of inspectorFields) {
    const value = field.keys
      .map((key) => values.get(normalizeFieldKey(key)))
      .map(formatCatalogValue)
      .find(Boolean);
    if (value && !details.some((detail) => detail.label === field.label)) {
      details.push({ label: field.label, value });
    }
  }

  return details;
}

export function CatalogDetails({
  row,
  defaultExpanded = false,
}: {
  row: CatalogRecord;
  defaultExpanded?: boolean;
}) {
  const details = getCatalogDetails(row);

  return (
      <AnimatedDisclosure id={`catalog-details-${row.id}`} defaultOpen={defaultExpanded} ariaLabel="Product details" className="overflow-hidden rounded-lg border border-border bg-white" summaryClassName="flex min-h-14 w-full items-center justify-between gap-3 px-3 py-2 text-left focus-visible:outline-2 focus-visible:outline-focus" summary={<><span><strong className="block text-sm font-bold text-ink">Product details</strong><span className="text-xs text-muted">Inspector-relevant fields</span></span><ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted" /></>} panelClassName="overflow-hidden border-t border-border p-3">
        {details.length > 0 ? (
          <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
            {details.map((detail, index) => (
              <div key={`${detail.label}-${index}`} className="min-w-0 break-words">
                <div className="text-xs text-muted">{detail.label}</div>
                <div className="whitespace-pre-wrap break-words text-sm font-semibold text-ink">{detail.value}</div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted">
            No product information is available in this catalog row.
          </p>
        )}
    </AnimatedDisclosure>
  );
}

function parseDynamicFields(value: unknown): Array<[string, unknown]> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.entries(value);
  }

  if (typeof value !== 'string' || !value.trim()) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return Object.entries(parsed);
    }
  } catch {
    return [['Dynamic fields', value]];
  }

  return [];
}

function formatCatalogValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'string') {
    return value.trim();
  }

  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }

  try {
    return JSON.stringify(value, null, 2) ?? '';
  } catch {
    return String(value);
  }
}

function normalizeFieldKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}
