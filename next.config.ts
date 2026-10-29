import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.mzstatic.com",
      },
      {
        protocol: "https",
        hostname: "coverartarchive.org",
      },
      {
        protocol: "https",
        hostname: "**.archive.org",
      },
      {
        protocol: "https",
        hostname: "i.discogs.com",
      },
      {
        protocol: "https",
        hostname: "**.ebayimg.com",
      },
    ],
  },
};

export default nextConfig;
