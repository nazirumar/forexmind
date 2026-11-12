import { ImageResponse } from "next/og";

/**
 * Open Graph social share card - generated at build time.
 *
 * Rendered when ForexMind URLs are shared on Twitter/X, LinkedIn,
 * Discord, Slack, iMessage, etc. Shows the brand mark + name + tagline
 * on the dark theme.
 *
 * Served at /opengraph-image (Next.js convention). The root layout's
 * metadata automatically picks this up (no manual config needed).
 *
 * Standard OG dimensions: 1200x630.
 */
export const size = {
  width: 1200,
  height: 630,
};

export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#0a0a0a",
          position: "relative",
        }}
      >
        {/* Subtle amber glow accent (top-left) */}
        <div
          style={{
            position: "absolute",
            top: -100,
            left: -100,
            width: 400,
            height: 400,
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(245,158,11,0.15) 0%, transparent 70%)",
          }}
        />
        {/* Brand row */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 28,
          }}
        >
          <div
            style={{
              width: 96,
              height: 96,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "#171717",
              borderRadius: 24,
              border: "2px solid #262626",
            }}
          >
            <svg
              width="64"
              height="64"
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
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div
              style={{
                fontSize: 72,
                fontWeight: 700,
                color: "#fafafa",
                letterSpacing: "-0.02em",
                lineHeight: 1,
              }}
            >
              ForexMind
            </div>
            <div
              style={{
                fontSize: 28,
                color: "#a3a3a3",
                marginTop: 10,
              }}
            >
              AI Forex Risk Assistant
            </div>
          </div>
        </div>

        {/* Tagline */}
        <div
          style={{
            marginTop: 56,
            display: "flex",
            alignItems: "center",
            gap: 16,
          }}
        >
          {[
            "Journal",
            "Analytics",
            "AI Review",
            "Trade Checker",
            "Live Prices",
          ].map((feature) => (
            <div
              key={feature}
              style={{
                display: "flex",
                alignItems: "center",
                padding: "10px 22px",
                borderRadius: 12,
                border: "1px solid #262626",
                background: "#111111",
                color: "#d4d4d4",
                fontSize: 24,
              }}
            >
              {feature}
            </div>
          ))}
        </div>

        {/* Disclaimer footer */}
        <div
          style={{
            position: "absolute",
            bottom: 40,
            fontSize: 20,
            color: "#525252",
          }}
        >
          Advisory only. Trading forex involves substantial risk of loss.
        </div>
      </div>
    ),
    { ...size },
  );
}
