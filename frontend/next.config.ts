import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // No special options required for reverse proxy; our client code infers origin via window.location
};

export default nextConfig;
