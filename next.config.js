/** @type {import('next').NextConfig} */
const nextConfig = {
  // Generate static pages for all entity/category routes at build time
  output: 'export',

  // Required for static export with dynamic routes
  trailingSlash: true,
}

module.exports = nextConfig
