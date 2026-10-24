/** @type {import('next').NextConfig} */
const nextConfig = {
  trailingSlash: true,
  poweredByHeader: false,
  images: {
    unoptimized: true,
  },
  async redirects(){return ['/pricing','/qiymet','/qiymetler','/paketler','/package-builder','/plans'].map(source=>({source,destination:'/mehsul/avadanliq/',permanent:false}));},
  async headers() {
    return [
      {
        source: '/((?!_next|assets).*)',
        headers: [{ key: 'Cache-Control', value: 'no-cache, must-revalidate' }],
      },
      {source:'/odenis/:path*',headers:[{key:'Cache-Control',value:'private, no-store'},{key:'Referrer-Policy',value:'no-referrer'},{key:'X-Robots-Tag',value:'noindex, nofollow'}]},
    ];
  },
};

export default nextConfig;
