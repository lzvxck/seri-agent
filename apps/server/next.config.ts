import type { NextConfig } from "next";

// Both ship raw TS, so Next has to compile them rather than treat them as built deps.
const nextConfig: NextConfig = {
  transpilePackages: ["@seri/plans", "@seri/model-catalog"],
};

export default nextConfig;
