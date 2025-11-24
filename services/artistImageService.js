import LastFmInstance, { LastFmService } from './lastfm.js';

const COLOR_PALETTE = [
  '0ea5e9',
  '2563eb',
  '7c3aed',
  'db2777',
  'ea580c',
  '16a34a',
  '0891b2'
];

const hashName = (name = '') => {
  let hash = 0;
  const normalized = name.toLowerCase();
  for (let i = 0; i < normalized.length; i += 1) {
    hash = (hash << 5) - hash + normalized.charCodeAt(i);
    hash |= 0; // Convert to 32-bit integer
  }
  return Math.abs(hash);
};

const buildAvatarUrl = (name, color) => {
  const encoded = encodeURIComponent(name);
  return `https://ui-avatars.com/api/?name=${encoded}&background=${color}&color=fff&size=256&bold=true`;
};

const pickColor = (name) => {
  if (!name) return COLOR_PALETTE[0];
  const index = hashName(name) % COLOR_PALETTE.length;
  return COLOR_PALETTE[index];
};

/**
 * พยายามดึงรูปศิลปินจาก Last.fm (ถ้ามี API key) หรือ fallback ไป avatar service
 * @param {string} artistName
 * @param {string|null} fallbackUrl
 * @returns {Promise<{ url: string, source: string, meta?: object }|null>}
 */
export const resolveArtistImage = async (artistName, fallbackUrl = null) => {
  if (!artistName || !artistName.trim()) {
    return null;
  }

  if (fallbackUrl) {
    return {
      url: fallbackUrl,
      source: 'latest-scrobble'
    };
  }

  const service = LastFmInstance instanceof LastFmService
    ? LastFmInstance
    : new LastFmService();

  if (service?.apiKey) {
    try {
      const info = await service.getArtistInfo(artistName);
      if (info?.heroImage) {
        return {
          url: info.heroImage,
          source: 'lastfm',
          meta: {
            url: info.url,
            listeners: info?.stats?.listeners,
            playcount: info?.stats?.playcount
          }
        };
      }
      if (info?.images?.length) {
        const firstImage = info.images.find((img) => img.url) || info.images[0];
        if (firstImage?.url) {
          return {
            url: firstImage.url,
            source: 'lastfm',
            meta: {
              url: info.url
            }
          };
        }
      }
    } catch (error) {
      console.warn('⚠️ Failed to load artist image from Last.fm:', error.message);
    }
  }

  const color = pickColor(artistName);
  return {
    url: buildAvatarUrl(artistName, color),
    source: 'ui-avatars'
  };
};

export default resolveArtistImage;

