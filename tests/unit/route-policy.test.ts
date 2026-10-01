import { describe, expect, it } from 'vitest';
import robots from '@/app/robots';
import nextConfig from '../../next.config';

describe('private route policy', () => {
  it('disallows indexing all application routes', () => {
    expect(robots().rules).toEqual({ userAgent: '*', disallow: '/' });
  });

  it('adds a noindex response header for application routes', async () => {
    const headers = await nextConfig.headers?.();
    expect(headers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: '/:path*',
          headers: expect.arrayContaining([
            { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
          ]),
        }),
      ]),
    );
  });
});
