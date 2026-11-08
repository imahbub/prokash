import type { APIRoute } from 'astro';
import { supabase } from '../lib/supabase';

const CATEGORIES = [
  'national',
  'international',
  'economy',
  'tech',
  'sports',
  'opinion',
];

interface SitemapArticleRow {
  slug: string;
  category: string;
  published_at?: string | null;
  created_at: string;
}

export const GET: APIRoute = async ({ request }) => {
  const siteUrl = (import.meta.env.PUBLIC_SITE_URL || new URL(request.url).origin).replace(/\/$/, '');

  // Fetch published articles (up to 2,000 for high-performance single sitemap)
  const { data: articles } = await supabase
    .from('articles')
    .select('slug, category, published_at, created_at')
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .limit(2000);

  const nowIso = new Date().toISOString();
  const latestArticleDate = articles && articles.length > 0
    ? new Date(articles[0].published_at || articles[0].created_at).toISOString()
    : nowIso;

  // 1. Core pages (Homepage & Category sections)
  const coreUrls = [
    `  <url>
    <loc>${siteUrl}/</loc>
    <lastmod>${latestArticleDate}</lastmod>
    <changefreq>always</changefreq>
    <priority>1.0</priority>
  </url>`,
    ...CATEGORIES.map(cat => `  <url>
    <loc>${siteUrl}/category/${cat}</loc>
    <lastmod>${nowIso}</lastmod>
    <changefreq>hourly</changefreq>
    <priority>0.8</priority>
  </url>`),
  ];

  // 2. Individual article detail pages
  const articleUrls = ((articles || []) as SitemapArticleRow[]).map((art) => {
    const lastMod = new Date(art.published_at || art.created_at).toISOString();
    return `  <url>
    <loc>${siteUrl}/news/${encodeURIComponent(art.slug)}</loc>
    <lastmod>${lastMod}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>`;
  });

  const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${coreUrls.join('\n')}
${articleUrls.join('\n')}
</urlset>`;

  return new Response(sitemapXml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=86400',
    },
  });
};
