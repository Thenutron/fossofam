import type { MetadataRoute } from "next";

// Web app manifest — what makes Add-to-Home-Screen land properly on Android
// (full PWA install card) and iOS (uses for theme color + display mode).
// The icons here are generated dynamically by app/icon.tsx + app/apple-icon.tsx.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "FossoFam",
    short_name: "FossoFam",
    description: "The Fosso family's meal planner, grocery router, and weekly budget.",
    start_url: "/",
    display: "standalone",
    background_color: "#faf8f3",
    theme_color: "#faf8f3",
    orientation: "portrait",
    icons: [
      {
        src: "/icon",
        sizes: "any",
        type: "image/png",
      },
      {
        src: "/apple-icon",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  };
}
