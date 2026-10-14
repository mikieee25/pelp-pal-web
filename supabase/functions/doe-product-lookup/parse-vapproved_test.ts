// @ts-nocheck - executed by `deno test` in the Supabase functions runtime.
import { assertEquals } from 'jsr:@std/assert';
import { parseVapproved } from './parse-vapproved.ts';

Deno.test('parses the DOE vapproved fixture', async () => {
  const html = await Deno.readTextFile(new URL('./fixtures/doe-vapproved-sample.html', import.meta.url));
  const record = parseVapproved(html, 'https://pelp.doe.gov.ph/vapproved.php?fixturetoken1234567890');
  assertEquals(record?.controlNumber, 'ACU-0049-002154-1025');
  assertEquals(record?.productType, 'Air Conditioners');
  assertEquals(record?.starRating, 4);
  assertEquals(record?.energyLabels[0].validUntil, '2026-10-24');
  assertEquals(record?.imageUrls, ['https://pelp.doe.gov.ph/primg/example.png']);
});
