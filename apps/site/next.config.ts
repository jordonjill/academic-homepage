import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  images: {
    unoptimized: true
  },
  transpilePackages: ["@academic-homepage/shared"]
};

export default nextConfig;

