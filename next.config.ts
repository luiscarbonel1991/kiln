import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  // Native NAPI addons stay external runtime requires instead of bundled, which
  // Turbopack can't do for the non-ECMAScript .node binding: the vectorizer
  // (vectorize Server Action) and resvg (the local SVG plate renderer).
  serverExternalPackages: ["@neplex/vectorizer", "@resvg/resvg-js"],
  experimental: {
    // Master-image uploads POST through a Server Action (uploadMasterImage); the
    // default body cap is 1 MB. Lift it to cover the 15 MB the upload dropzone
    // already validates client-side. (Production upgrade: presigned S3 PUT URLs so
    // bytes never proxy through the function.)
    serverActions: {
      bodySizeLimit: "16mb",
    },
  },
};

export default nextConfig;
