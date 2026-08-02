import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // authInterrupts enables forbidden(), which serves the S15 foreign-package page with a real HTTP 403.
    authInterrupts: true,
  },
};

export default nextConfig;
