import type { NextConfig } from "next";

/**
 * ForexMind Next.js configuration.
 *
 * Key choices:
 *  - `output: "standalone"` - produces a self-contained .next/standalone
 *    bundle for deployment (Docker / Vercel / bare-metal). Reduces the
 *    deploy artifact to the server + minimal node_modules + public/.
 *  - `reactStrictMode: false` - the original project scaffold disabled
 *    it. We keep it off to avoid double-effect dev noise during phase
 *    work; turning it on later is a one-line change.
 *  - `typescript.ignoreBuildErrors: false` - production builds MUST fail
 *    on type errors. We previously had this true as a safety net during
 *    early phases; now that all tsc errors are resolved (Phase 8), we
 *    enforce strictness so regressions can't slip to prod.
 *  - `eslint.ignoreDuringBuilds: false` - same reasoning.
 *
 * Security headers (applied to every response, including static):
 *  - Content-Security-Policy: restrictive allow-list. We allow:
 *      'self' for everything
 *      https://fonts.gstatic.com + https://fonts.googleapis.com for the
 *        Geist font (loaded by next/font/google)
 *      'unsafe-inline' for styles (Tailwind + shadcn/ui inject styles
 *        at runtime; CSP-friendly nonce-based style hashing is a larger
 *        refactor we defer to a future hardening pass)
 *      'unsafe-inline' for scripts ONLY in dev (Next.js HMR / React
 *        DevTools need it; prod restricts to 'self')
 *      connect-src 'self' https://*.supabase.co - for the browser
 *        Supabase client (auth + RLS)
 *      img-src 'self' data: - data: for inline SVG icons from lucide
 *      font-src 'self' https://fonts.gstatic.com
 *  - X-Frame-Options: DENY - no iframing (clickjacking defense)
 *  - X-Content-Type-Options: nosniff - no MIME sniffing
 *  - Referrer-Policy: strict-origin-when-cross-origin
 *  - Permissions-Policy: lock down camera, mic, geolocation, etc.
 *  - Strict-Transport-Security: 1 year + preload (HTTPS only; safe
 *    because Supabase + Vercel both force HTTPS)
 *
 * Notes on what is NOT in CSP:
 *  - No 'unsafe-eval' - we don't use eval anywhere
 *  - No wildcard hosts - explicit allow-list only
 *  - The Groq API key never reaches the browser, so no connect-src
 *    entry for api.groq.com is needed
 */
const isDev = process.env.NODE_ENV === "development";

const csp = [
  `default-src 'self'`,
  `script-src 'self'${isDev ? " 'unsafe-inline'" : ""}`,
  `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
  `font-src 'self' https://fonts.gstatic.com data:`,
  `img-src 'self' data: blob:`,
  `connect-src 'self' https://*.supabase.co https://finnhub.io`,
  `frame-ancestors 'none'`,
  `base-uri 'self'`,
  `form-action 'self'`,
].join("; ");

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    ignoreBuildErrors: false,
  },
  reactStrictMode: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value:
              "camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains; preload",
          },
          { key: "X-DNS-Prefetch-Control", value: "on" },
        ],
      },
    ];
  },
};

export default nextConfig;
