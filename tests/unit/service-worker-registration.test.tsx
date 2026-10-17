import { render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServiceWorkerRegistration } from '@/components/providers/service-worker-registration';

describe('service worker lifecycle', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('unregisters the development worker and removes only its static caches', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const unregister = vi.fn().mockResolvedValue(true);
    const untouchedUnregister = vi.fn();
    const registrations = [
      { active: { scriptURL: 'https://localhost/sw.js' }, unregister },
      { active: { scriptURL: 'https://localhost/other-worker.js' }, unregister: untouchedUnregister },
    ];
    const serviceWorker = { getRegistrations: vi.fn().mockResolvedValue(registrations), register: vi.fn() };
    const deleteCache = vi.fn().mockResolvedValue(true);
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: serviceWorker });
    Object.defineProperty(window, 'caches', {
      configurable: true,
      value: { keys: vi.fn().mockResolvedValue(['pelp-pal-static-v3', 'other-cache']), delete: deleteCache },
    });

    render(<><ServiceWorkerRegistration /><div>Workspace</div></>);

    await waitFor(() => expect(unregister).toHaveBeenCalledOnce());
    expect(untouchedUnregister).not.toHaveBeenCalled();
    expect(deleteCache).toHaveBeenCalledOnce();
    expect(deleteCache).toHaveBeenCalledWith('pelp-pal-static-v3');
  });

  it('registers the worker in production with updateViaCache disabled', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const serviceWorker = { getRegistrations: vi.fn(), register: vi.fn().mockResolvedValue({}) };
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: serviceWorker });

    render(<><ServiceWorkerRegistration /><div>Workspace</div></>);

    await waitFor(() => expect(serviceWorker.register).toHaveBeenCalledWith('/sw.js', { updateViaCache: 'none' }));
    expect(serviceWorker.getRegistrations).not.toHaveBeenCalled();
  });
});
