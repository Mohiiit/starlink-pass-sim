import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: { unoptimized: true },
  // Exclude simulation engine from server-side bundling —
  // it uses satellite.js which needs browser APIs and does heavy
  // SGP4 computation that hangs the build process
  serverExternalPackages: ['satellite.js'],
};

export default nextConfig;
