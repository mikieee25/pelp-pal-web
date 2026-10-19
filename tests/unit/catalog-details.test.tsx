import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CatalogDetails, getCatalogDetails } from '@/features/catalog/catalog-details';

describe('catalog details', () => {
  const product = {
    id: 'product-1',
    catalogScope: 'masterlist' as const,
    control_number: 'CN-100',
    product_type: 'Air conditioner',
    brand: 'ClearView',
    model_number: 'CV-100',
    dynamic_fields: JSON.stringify({
      'Company Name': 'ClearView Industries',
      'Energy Efficiency Factor EEF': 10.5,
      'Has Inverter': false,
      'Rated Capacity': 0,
    }),
  };

  it('shows inspector fields and omits catalog bookkeeping fields', () => {
    const details = getCatalogDetails(product);

    expect(details).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Control Number', value: 'CN-100' }),
      expect.objectContaining({ label: 'Product Type', value: 'Air conditioner' }),
      expect.objectContaining({ label: 'Company Name', value: 'ClearView Industries' }),
      expect.objectContaining({ label: 'Energy Efficiency Factor (EEF)', value: '10.5' }),
    ]));
    expect(details.map(({ label }) => label)).not.toContain('Catalog ID');
    expect(details.map(({ label }) => label)).not.toContain('Has Inverter');
    expect(details.map(({ label }) => label)).not.toContain('Rated Capacity');
  });

  it('renders a concise inspector product details panel', () => {
    render(<CatalogDetails row={product} defaultExpanded />);

    expect(screen.getByText('Product details')).toBeInTheDocument();
    const disclosure = screen.getByText('Product details').closest('button')!;
    expect(disclosure.querySelector('svg')).toBeInTheDocument();
    expect(disclosure).not.toHaveTextContent('⌄');
    expect(screen.getByText('ClearView Industries')).toBeInTheDocument();
    expect(screen.getByText('Energy Efficiency Factor (EEF)')).toBeInTheDocument();
    expect(screen.getByText('10.5')).toBeInTheDocument();
    expect(screen.queryByText('Has Inverter')).not.toBeInTheDocument();
  });

  it('keeps the inspector-relevant energy and identity fields from the supplied DOE shape', () => {
    const details = getCatalogDetails({
      ...product,
      dynamic_fields: JSON.stringify({
        control_number: 'REFF-0018-2026-000138-rev.0',
        product_name: 'Multidoor Refrigerator',
        monthly_energy_consumption_kwh: 45.9,
        volume_l: 474,
        coldness_star_rating: '4-Star (****)',
        'Accreditation Certificate Expiration Date': '2027-09-05',
        source_version: 'internal-only',
      }),
    });

    expect(details.map(({ label }) => label)).toEqual(expect.arrayContaining([
      'Product Name', 'Monthly Energy Consumption (kWh)', 'Volume (L)', 'Coldness Star Rating',
    ]));
    expect(details.map(({ label }) => label)).not.toContain('Accreditation Certificate Expiration Date');
    expect(details.map(({ label }) => label)).not.toContain('source_version');
  });

  it('recognizes inspector field labels already used in catalog snapshots', () => {
    const details = getCatalogDetails({
      ...product,
      dynamic_fields: JSON.stringify({
        'Monthly Energy Consumption': 45.9,
        'Power Input': 810,
        'Eef Rated Performance Value': 0.68,
      }),
    });

    expect(details).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Monthly Energy Consumption (kWh)', value: '45.9' }),
      expect.objectContaining({ label: 'Power Input (W)', value: '810' }),
      expect.objectContaining({ label: 'Energy Efficiency Factor (EEF)', value: '0.68' }),
    ]));
  });

  it('does not crash when dynamic fields are not valid JSON', () => {
    expect(() => getCatalogDetails({
      ...product,
      dynamic_fields: '{invalid',
    })).not.toThrow();
  });
});
