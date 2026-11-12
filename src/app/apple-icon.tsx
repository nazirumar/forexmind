import { ImageResponse } from "next/og";

/**
 * Apple touch icon (iOS home screen) - generated at build time.
 *
 * iOS adds its own rounded corners + black background behind the icon,
 * so we render a full-bleed dark background (no border radius needed -
 * iOS masks it) with the amber trending-down mark centered.
 *
 * Served at /apple-icon (Next.js convention for apple-icon.tsx).
 */
export const size = {
  width: 180,
  height: 180,
};

export const contentType = "image/png";

export default function AppleIcon() {
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
        }}
      >
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
          <polyline points="22 17 13.5 8.5 8.5 13.5 2 7" />
          <polyline points="16 17 22 17 22 11" />
        </svg>
      </div>
    ),
    { ...size },
  );
}
