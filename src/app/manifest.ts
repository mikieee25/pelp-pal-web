import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'PELP Pal',
    short_name: 'PELP Pal',
    description: 'Offline-first PELP Pal inspection workspace.',
    start_url: '/',
    display: 'standalone',
    background_color: '#f7f9fb',
    theme_color: '#0b5cab',
    icons: [{ src: '/icons/Energi.png', sizes: '1231x1277', type: 'image/png', purpose: 'any' }],
  };
}
