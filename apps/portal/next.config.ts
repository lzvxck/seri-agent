import type { NextConfig } from "next";

// Both ship raw TS(X), so Next has to compile them rather than treat them as built deps.
const nextConfig: NextConfig = {
  transpilePackages: ["@seri/ui", "@seri/plans", "@seri/provisioning"],
};

export default nextConfig;
