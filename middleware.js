// Edge Middleware — site-wide geo-block for high-abuse regions (Three Realms / Transformed by Travels).
// Runs before routing (rewrites/redirects) on Vercel. Uses Vercel's built-in
// `x-vercel-ip-country` header (Vercel sets this itself and ignores any
// client-supplied value, so it can't be spoofed). Blocked country → plain 403,
// never reaches the site, its APIs, or Airtable.
//
// NOTE: this is a public-facing travel site with potential international readers.
// If you want to keep it open to visitors from any of these countries (or scope
// the block to /api only), trim BLOCKED or narrow the matcher and redeploy.
// To turn the block off entirely: delete this file and redeploy.

export const config = {
  // Match everything EXCEPT Vercel's internal routes (/_vercel/* — e.g. Web
  // Analytics script + beacon), which must not be shadowed by middleware.
  matcher: '/((?!_vercel/).*)',
  runtime: 'nodejs',
};

// CN=China, RU=Russia, KP=North Korea, IR=Iran, NG=Nigeria
const BLOCKED = new Set(['CN', 'RU', 'KP', 'IR', 'NG']);

export default function middleware(request) {
  const country = (request.headers.get('x-vercel-ip-country') || '').toUpperCase();
  if (country && BLOCKED.has(country)) {
    return new Response('This service is not available in your region.', {
      status: 403,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'x-blocked-region': country },
    });
  }
  // No return → request continues normally.
}
