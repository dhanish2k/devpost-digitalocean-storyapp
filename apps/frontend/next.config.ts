import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  reactStrictMode: false,
  turbopack: {
    // This is needed to help Turbopack find the root of the project in a monorepo setup.
    root: path.resolve(__dirname, "../.."),
  },
};

export default nextConfig;
