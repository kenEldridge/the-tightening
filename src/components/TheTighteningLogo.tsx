import React from "react";

export const TheTighteningLogo: React.FC<{
  width?: number;
}> = ({ width = 240 }) => {
  const height = width * 0.5;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "1rem",
        fontFamily:
          'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
    >
      {/* Chaos → Order SVG */}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 120 60"
        style={{ width, height }}
      >
        {/* Baseline */}
        <line
          x1="6"
          y1="30"
          x2="114"
          y2="30"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />

        {/* Left: chaotic waveform */}
        <polyline
          points="6,28 12,20 18,36 24,18 30,40 36,22 42,38 48,24 54,34"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Divider arrow */}
        <polygon points="58,30 66,26 66,34" fill="currentColor" />

        {/* Right: ordered pulses */}
        <polyline
          points="72,30 72,18 78,18 78,30 84,30 84,18 90,18 90,30 96,30 96,18 102,18 102,30 108,30 108,18 114,18 114,30"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>

      {/* Wordmark */}
      <div>
        <div
          style={{
            letterSpacing: "0.18em",
            fontSize: "0.8rem",
            textTransform: "uppercase",
            opacity: 0.8,
          }}
        >
          THE
        </div>
        <div
          style={{
            fontSize: "1.8rem",
            fontWeight: 700,
            letterSpacing: "0.06em",
          }}
        >
          TIGHTENING
        </div>
        <div
          style={{
            fontSize: "0.8rem",
            opacity: 0.65,
            marginTop: "0.15rem",
          }}
        >
          Chaos to rhythm, tightened in real time.
        </div>
      </div>
    </div>
  );
};
