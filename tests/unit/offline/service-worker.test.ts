import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

type WorkerEvent = { waitUntil: (promise: Promise<unknown>) => void };

describe('offline app-shell preparation', () => {
  it('caches the report template and route scripts from public, credential-free responses', async () => {
    const listeners = new Map<string, (event: WorkerEvent) => void>();
    const stored = new Map<string, Response>();
    const cache = {
      put: vi.fn(async (request: string | Request, response: Response) => {
        stored.set(new URL(typeof request === 'string' ? request : request.url, 'https://app.test').pathname, response.clone());
      }),
      match: vi.fn(async (request: string | Request) =>
        stored.get(new URL(typeof request === 'string' ? request : request.url, 'https://app.test').pathname)),
    };
    const fetches: Array<{ path: string; credentials?: RequestCredentials }> = [];
    const fetchResource = vi.fn(async (input: string, init?: RequestInit) => {
      const path = new URL(input, 'https://app.test').pathname;
      fetches.push({ path, credentials: init?.credentials });
      if (path.endsWith('.docx')) return new Response('word-template', { headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' } });
      if (path.endsWith('.js')) return new Response('app-script', { headers: { 'content-type': 'text/javascript' } });
      return new Response('<html><script src="/_next/static/chunks/app.js"></script><img src="/_next/image?url=%2Ficons%2Flogo.png&amp;w=64&amp;q=75"></html>', { headers: { 'content-type': 'text/html' } });
    });

    runInNewContext(readFileSync('public/sw.js', 'utf8'), {
      self: { location: { origin: 'https://app.test' }, addEventListener: (type: string, listener: (event: WorkerEvent) => void) => listeners.set(type, listener), skipWaiting: async () => undefined },
      caches: { open: async () => cache },
      fetch: fetchResource,
      URL,
      Promise,
    });
    let installed: Promise<unknown> | undefined;
    listeners.get('install')?.({ waitUntil: (promise) => { installed = promise; } });
    await installed;

    expect(stored.has('/EMV%20Report%20Sample.docx')).toBe(true);
    expect(stored.has('/_next/static/chunks/app.js')).toBe(true);
    expect(stored.has('/_next/image')).toBe(true);
    expect(fetches.filter(({ path }) => path === '/dashboard').every(({ credentials }) => credentials === 'omit')).toBe(true);
  });
});
