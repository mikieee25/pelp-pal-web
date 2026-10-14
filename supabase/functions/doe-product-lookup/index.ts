// @ts-nocheck - this module runs in the Supabase Deno runtime.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { parseVapproved } from './parse-vapproved.ts';
import { getDoeToken, isAllowedDoeUrl, isBlockedDoeResponse, sha256Hex } from './security.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const CACHE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
    const body = await request.json();
    const url = typeof body?.url === 'string' ? body.url.trim() : '';
    const refresh = body?.refresh === true;
    if (!isAllowedDoeUrl(url)) return json({ error: 'INVALID_URL' }, 400);
    const token = getDoeToken(url);
    if (!token) return json({ error: 'INVALID_URL' }, 400);

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !anonKey || !serviceRoleKey) return json({ error: 'CONFIGURATION_ERROR' }, 500);
    const authorization = request.headers.get('Authorization');
    if (!authorization?.startsWith('Bearer ')) return json({ error: 'UNAUTHORIZED' }, 401);

    const caller = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
    const { data: account, error: accountError } = await caller.rpc('current_account');
    if (accountError || !isActiveAccount(account)) return json({ error: 'FORBIDDEN' }, 403);
    const accountId = String(account.account_id ?? account.id ?? '');
    if (!accountId) return json({ error: 'FORBIDDEN' }, 403);

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const tokenHash = await sha256Hex(token);
    const now = Date.now();
    const { data: tokenMapping } = await admin.from('doe_token_map').select('control_number').eq('token_hash', tokenHash).maybeSingle();
    const mappedControlNumber = tokenMapping?.control_number as string | undefined;
    const cached = mappedControlNumber ? await getFreshCache(admin, mappedControlNumber, now) : undefined;
    if (cached && !refresh) return json({ record: cached.record, cached: true, fetchedAt: cached.fetched_at });

    const hourAgo = new Date(now - 60 * 60 * 1000).toISOString();
    const { count: accountCount } = await admin.from('doe_product_lookup_logs').select('id', { count: 'exact', head: true }).eq('account_id', accountId).gte('created_at', hourAgo);
    if ((accountCount ?? 0) >= 30) return json({ error: 'RATE_LIMITED' }, 429);
    if (refresh) {
      const refreshQuery = mappedControlNumber
        ? admin.from('doe_product_lookup_logs').select('id', { count: 'exact', head: true }).eq('control_number', mappedControlNumber).gte('created_at', hourAgo)
        : admin.from('doe_product_lookup_logs').select('id', { count: 'exact', head: true }).eq('token_hash', tokenHash).gte('created_at', hourAgo);
      const { count: refreshCount } = await refreshQuery;
      if ((refreshCount ?? 0) > 0) return json({ error: 'RATE_LIMITED' }, 429);
    }
    await admin.from('doe_product_lookup_logs').insert({ account_id: accountId, token_hash: tokenHash, control_number: mappedControlNumber ?? null });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    let response;
    try {
      response = await fetch(url, { method: 'GET', redirect: 'manual', signal: controller.signal, headers: { 'User-Agent': 'PELP-Pal/1.0 (inspection assistant)' } });
    } catch (error) {
      if (error?.name === 'AbortError') return json({ error: 'UPSTREAM_TIMEOUT' }, 504);
      return json({ error: 'UPSTREAM_BLOCKED' }, 502);
    } finally {
      clearTimeout(timeout);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    const html = new TextDecoder('windows-1252').decode(bytes);
    if (isBlockedDoeResponse(response.status, html, response.headers) || (response.status >= 300 && response.status < 400)) return json({ error: 'UPSTREAM_BLOCKED' }, 502);
    const fetchedAt = new Date().toISOString();
    const record = parseVapproved(html, url, fetchedAt);
    if (!record) return json({ error: 'PARSE_FAILED' }, 422);
    const compactRecord = compactForCache(record);
    const { error: cacheError } = await admin.from('official_product_records').upsert({ control_number: record.controlNumber, record: compactRecord, source_url_hash: await sha256Hex(url), fetched_at: fetchedAt });
    if (cacheError) return json({ error: 'CACHE_WRITE_FAILED' }, 500);
    await admin.from('doe_token_map').upsert({ token_hash: tokenHash, control_number: record.controlNumber, last_seen_at: fetchedAt }, { onConflict: 'token_hash' });
    await admin.from('doe_product_lookup_logs').update({ control_number: record.controlNumber }).eq('token_hash', tokenHash).eq('account_id', accountId).is('control_number', null).gte('created_at', hourAgo);
    return json({ record, cached: false, fetchedAt });
  } catch (error) {
    console.error('DOE lookup failed', error instanceof Error ? error.message : 'unknown error');
    return json({ error: 'LOOKUP_FAILED' }, 500);
  }
});

async function getFreshCache(admin, controlNumber: string, now: number) {
  const { data } = await admin.from('official_product_records').select('record, fetched_at').eq('control_number', controlNumber).maybeSingle();
  return data && now - Date.parse(data.fetched_at) < CACHE_AGE_MS ? data : undefined;
}

function isActiveAccount(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && (value as Record<string, unknown>).is_active === true;
}

function compactForCache(record: Record<string, unknown>) {
  const compact = { ...record, imageUrls: [] as string[], fields: { ...(record.fields as Record<string, string>) } };
  const required = new Set(['Control Number', 'Control number', 'Product Type', 'ECP Type', 'Brand', 'Brand Name', 'Product Name', 'Product Model', 'Model Code', 'Model Number', 'Manufacturer', 'Company', 'Company Name']);
  for (const field of Object.keys(compact.fields)) {
    if (JSON.stringify(compact).length <= 4800) break;
    if (!required.has(field)) delete compact.fields[field];
  }
  return compact;
}

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
