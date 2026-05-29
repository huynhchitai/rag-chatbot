/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone output keeps the Docker image tiny and lets `node server.js`
  // run the app without dragging the full node_modules into the runtime stage.
  output: "standalone",
  experimental: {
    serverComponentsExternalPackages: ["pdf-parse"],
  },
};

module.exports = nextConfig;
