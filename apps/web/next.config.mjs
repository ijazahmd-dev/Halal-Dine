/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    '@halal-dine/contracts',
    '@halal-dine/validation',
    '@halal-dine/utils',
    '@halal-dine/api-client',
  ],
};

export default nextConfig;

