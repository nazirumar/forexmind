"use client";

/**
 * global-error.tsx - the LAST resort. Shown when the root layout
 * itself fails (e.g. globals.css fails to load, or a provider in
 * the root layout throws). This file REPLACES <html><body> for the
 * error page, so it must render its own <html><body> tags.
 *
 * It can't rely on Tailwind classes being available (because the
 * layout didn't mount), so it uses inline styles for the critical
 * bits and a simple dark theme that matches the rest of the app.
 */
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global error boundary]", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#0a0a0a",
          color: "#fafafa",
          fontFamily:
            "system-ui, -apple-system, sans-serif",
          padding: "1rem",
          textAlign: "center",
        }}
      >
        <h1 style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>
          ForexMind hit a critical error
        </h1>
        <p style={{ color: "#a3a3a3", maxWidth: 400, marginBottom: "1.5rem" }}>
          The application shell failed to load. Please refresh the page. If
          the problem persists, the dev server may need restarting.
        </p>
        {error.digest && (
          <p
            style={{
              fontFamily: "monospace",
              fontSize: "0.75rem",
              color: "#737373",
              marginBottom: "1.5rem",
            }}
          >
            error id: {error.digest}
          </p>
        )}
        <button
          onClick={reset}
          style={{
            background: "#fafafa",
            color: "#0a0a0a",
            border: "none",
            padding: "0.5rem 1rem",
            borderRadius: "0.375rem",
            fontSize: "0.875rem",
            cursor: "pointer",
            fontWeight: 500,
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
