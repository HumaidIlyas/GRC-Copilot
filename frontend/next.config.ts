import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Required for Docker standalone build (Cloud Run)
  output: "standalone",
};

export default nextConfig;
