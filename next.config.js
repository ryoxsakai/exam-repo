/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static export for GitHub Pages
  output: "export",
  // Trailing slash ensures correct routing on GitHub Pages
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  // basePath is set by GitHub Actions via NEXT_PUBLIC_BASE_PATH env var.
  // Leave empty when using a custom domain, or set to "/repo-name" for
  // github.io/<repo-name> deployments.
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || "",
  // Make base path available client-side
  env: {
    NEXT_PUBLIC_BASE_PATH: process.env.NEXT_PUBLIC_BASE_PATH || "",
  },
};

module.exports = nextConfig;
