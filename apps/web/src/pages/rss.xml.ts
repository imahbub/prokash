import type { APIRoute } from 'astro';
import { supabase, type Article } from '../lib/supabase';

export const GET: APIRoute = async ({ request }) => {
  const siteUrl = import.meta.env.PUBLIC_SITE_URL || new URL(request.url).origin;

  const { data: articles } = await supabase
    .from('articles')
    .select('*')
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .limit(25);

  const itemsXml = (articles || []).map((art: Article) => {
    const itemUrl = `${siteUrl}/news/${art.slug}`;
    const pubDate = new Date(art.published_at || art.created_at).toUTCString();
    return `
    <item>
      <title><![CDATA[${art.title_bn}]]></title>
      <link>${itemUrl}</link>
      <guid isPermaLink="true">${itemUrl}</guid>
      <description><![CDATA[${art.summary_bn}]]></description>
      <category>${art.category}</category>
      <pubDate>${pubDate}</pubDate>
      <source url="${art.original_url}"><![CDATA[${art.source_name}]]></source>
    </item>`;
  }).join('');

  const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>প্রকাশ — সংবেদনশীলতাহীন নিরপেক্ষ সংবাদ</title>
    <link>${siteUrl}</link>
    <description>দৈনিক গুরুত্বপূর্ণ সংবাদের প্রমিত বাংলায় বস্তুনিষ্ঠ ও সংক্ষিপ্ত সারসংক্ষেপ।</description>
    <language>bn-BD</language>
    <atom:link href="${siteUrl}/rss.xml" rel="self" type="application/rss+xml"/>
    ${itemsXml}
  </channel>
</rss>`;

  return new Response(rss, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=3600',
    },
  });
};
