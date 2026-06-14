import { ImageResponse } from "next/og";

// Generated favicon + 512×512 icon. Cream background with a deep-teal "F"
// in a serif face — matches the rest of the app's earthy palette. Replace
// this file with a designed icon when one's ready.
export const size = { width: 512, height: 512 };
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
          background: "#faf8f3",
          fontFamily: "Georgia, 'Times New Roman', serif",
          fontSize: 380,
          fontWeight: 500,
          color: "#1d6e6e",
          letterSpacing: -10,
        }}
      >
        F
      </div>
    ),
    { ...size },
  );
}
