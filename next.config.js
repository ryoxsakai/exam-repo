/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Enable React Server Components features
  },
  // For Cloudflare Pages deployment, output can be set to 'export' for static
  // but we need API routes so we use the standard build
  images: {
    unoptimized: true,
  },
  // Allow environment variables to be passed through
  env: {
    CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID,
    CLOUDFLARE_D1_DATABASE_ID: process.env.CLOUDFLARE_D1_DATABASE_ID,
    CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN,
  },
};

module.exports = nextConfig;
