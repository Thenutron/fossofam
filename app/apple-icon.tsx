import { ImageResponse } from "next/og";

// iOS Add-to-Home-Screen icon. 180×180 is the size iOS picks up.
// Matches the regular icon visually but sized for the iOS tile.
export const size = { width: 180, height: 180 };
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
          background: "#faf8f3",
          fontFamily: "Georgia, 'Times New Roman', serif",
          fontSize: 134,
          fontWeight: 500,
          color: "#1d6e6e",
          letterSpacing: -4,
        }}
      >
        F
      </div>
    ),
    { ...size },
  );
}
