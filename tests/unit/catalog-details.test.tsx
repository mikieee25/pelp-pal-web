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
      'Energy Efficiency Ratio': 10.5,
      'Has Inverter': false,
      'Rated Capacity': 0,
    }),
  };

  it('includes canonical fields and every parsed masterlist field', () => {
    const details = getCatalogDetails(product);

    expect(details).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Control number', value: 'CN-100' }),
      expect.objectContaining({ label: 'Product Type', value: 'Air conditioner' }),
      expect.objectContaining({ label: 'Company Name', value: 'ClearView Industries' }),
      expect.objectContaining({ label: 'Energy Efficiency Ratio', value: '10.5' }),
      expect.objectContaining({ label: 'Has Inverter', value: 'false' }),
      expect.objectContaining({ label: 'Rated Capacity', value: '0' }),
    ]));
  });

  it('renders all product information in a responsive details panel', () => {
    render(<CatalogDetails row={product} defaultExpanded />);

    expect(screen.getByText('Full product information')).toBeInTheDocument();
    expect(screen.getByText('ClearView Industries')).toBeInTheDocument();
    expect(screen.getByText('Energy Efficiency Ratio')).toBeInTheDocument();
    expect(screen.getByText('10.5')).toBeInTheDocument();
    expect(screen.getByText('false')).toBeInTheDocument();
  });

  it('does not crash when dynamic fields are not valid JSON', () => {
    expect(() => getCatalogDetails({
      ...product,
      dynamic_fields: '{invalid',
    })).not.toThrow();
  });
});
