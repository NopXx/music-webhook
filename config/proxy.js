// Express `trust proxy` setting. Only hops from loopback or private ranges are
// trusted, so req.ip is the first public address in X-Forwarded-For:
// - public traffic: Cloudflare tunnel (host cloudflared → 127.0.0.1:3001 →
//   docker-proxy) reaches the container from the bridge gateway (172.x);
// - Liner Notes calls over the Docker network (172.x) and forwards the user's IP.
// A public client's own X-Forwarded-For value is never trusted.
export const TRUST_PROXY = 'loopback, uniquelocal';
