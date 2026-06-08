import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  // The vectorizer is a native NAPI addon (used only in the vectorize Server
  // Action) — keep it an external runtime require instead of bundling, which
  // Turbopack can't do for the non-ECMAScript .node binding.
  serverExternalPackages: ["@neplex/vectorizer"],
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
