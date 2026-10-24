/** @type {import('next').NextConfig} */
const nextConfig = {
  trailingSlash: true,
  poweredByHeader: false,
  images: {
    unoptimized: true,
    dangerouslyAllowSVG: false,
  },
  async redirects(){return ['/pricing','/qiymet','/qiymetler','/paketler','/package-builder','/plans'].map(source=>({source,destination:'/mehsul/avadanliq/',permanent:false}));},
  async headers() {
    return [
      {source:'/:path*',headers:[{key:'X-Content-Type-Options',value:'nosniff'},{key:'Referrer-Policy',value:'strict-origin-when-cross-origin'},{key:'Content-Security-Policy',value:"frame-ancestors 'self'; base-uri 'self'; object-src 'none'"},{key:'Permissions-Policy',value:'camera=(), microphone=(), geolocation=()'}]},
      {
        source: '/((?!_next|assets).*)',
        headers: [{ key: 'Cache-Control', value: 'no-cache, must-revalidate' }],
      },
      {source:'/odenis/:path*',headers:[{key:'Cache-Control',value:'private, no-store'},{key:'Referrer-Policy',value:'no-referrer'},{key:'X-Robots-Tag',value:'noindex, nofollow'}]},
    ];
  },
};

export default nextConfig;
