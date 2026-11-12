import { ImageResponse } from "next/og";

/**
 * Dynamic favicon - generated at build time.
 *
 * Renders the ForexMind brand mark: a dark rounded square with an
 * amber downward-trend arrow (matching the sidebar's TrendingDown
 * logo). Using ImageResponse means there are no binary icon files
 * in the repo - the icon is code, so it always stays in sync with
 * the brand.
 *
 * Served at /icon (Next.js convention for icon.tsx).
 *
 * NOTE: `next/og` uses a minimal font stack (no custom fonts loaded
 * here), so we draw the trend arrow with SVG rather than text glyphs
 * to avoid font-rendering surprises across build environments.
 */
export const size = {
  width: 192,
  height: 192,
};

export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0a0a0a",
          borderRadius: 24,
          border: "4px solid #262626",
        }}
      >
        {/* Trending-down arrow: line from top-left to bottom-right with arrowhead */}
        <svg
          width="120"
          height="120"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#f59e0b"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {/* Main diagonal line with a dip (matches lucide TrendingDown) */}
          <polyline points="22 17 13.5 8.5 8.5 13.5 2 7" />
          {/* Arrowhead */}
          <polyline points="16 17 22 17 22 11" />
        </svg>
      </div>
    ),
    { ...size },
  );
}
