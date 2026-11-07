import type { SupabaseClient } from '@supabase/supabase-js';
import type { Env } from './types';

interface ArticleToPost {
  id: string;
  slug: string;
  title_bn: string;
  fb_caption_bn: string;
  image_url?: string | null;
  original_url?: string | null;
}

export async function syndicateToFacebook(
  supabase: SupabaseClient,
  env: Env
): Promise<{ postedCount: number; errors: string[] }> {
  const errors: string[] = [];
  let postedCount = 0;

  if (!env.FB_PAGE_ID || !env.FB_PAGE_ACCESS_TOKEN) {
    console.warn('[Facebook] FB_PAGE_ID or FB_PAGE_ACCESS_TOKEN not configured. Skipping syndication.');
    return { postedCount: 0, errors: ['Missing Facebook credentials'] };
  }

  try {
    // Select up to 2 unposted articles, ordered by created_at asc
    const { data: articles, error: fetchErr } = await supabase
      .from('articles')
      .select('id, slug, title_bn, fb_caption_bn, image_url, original_url')
      .eq('status', 'published')
      .is('fb_post_id', null)
      .order('created_at', { ascending: true })
      .limit(2);

    if (fetchErr) {
      console.error('[Facebook] Error fetching unposted articles:', fetchErr.message);
      return { postedCount: 0, errors: [fetchErr.message] };
    }

    if (!articles || articles.length === 0) {
      return { postedCount: 0, errors: [] };
    }

    for (const article of articles as ArticleToPost[]) {
      try {
        const isLocal = env.PUBLIC_SITE_URL.includes('localhost');
        const articleUrl = `${env.PUBLIC_SITE_URL.replace(/\/$/, '')}/news/${article.slug}`;
        const messageText = `${article.fb_caption_bn}\n\n📌 বিস্তারিত পড়ুন:\n${isLocal ? (article.original_url || articleUrl) : articleUrl}`;

        const postBody: Record<string, string> = {
          message: messageText,
          access_token: env.FB_PAGE_ACCESS_TOKEN,
        };

        // Meta strictly requires a publicly resolvable URL for the 'link' parameter
        if (!isLocal) {
          postBody.link = articleUrl;
        } else if (article.original_url && article.original_url.startsWith('https://')) {
          postBody.link = article.original_url;
        }

        const fbEndpoint = `https://graph.facebook.com/v21.0/${env.FB_PAGE_ID}/feed`;
        const res = await fetch(fbEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(postBody),
          signal: AbortSignal.timeout(10000),
        });

        const resData: any = await res.json();

        if (res.ok && resData.id) {
          postedCount++;
          await supabase
            .from('articles')
            .update({
              fb_post_id: resData.id,
              fb_posted_at: new Date().toISOString(),
              fb_error: null,
            })
            .eq('id', article.id);
          console.log(`[Facebook] Successfully posted article ${article.slug} -> Post ID: ${resData.id}`);
        } else {
          const errMsg = resData.error?.message || JSON.stringify(resData);
          errors.push(`Article ${article.id}: ${errMsg}`);
          await supabase
            .from('articles')
            .update({
              fb_error: errMsg,
            })
            .eq('id', article.id);
          console.warn(`[Facebook] Failed to post article ${article.slug}:`, errMsg);
        }
      } catch (postErr: any) {
        errors.push(`Article ${article.id}: ${postErr.message}`);
        await supabase
          .from('articles')
          .update({
            fb_error: postErr.message,
          })
          .eq('id', article.id);
      }
    }
  } catch (err: any) {
    errors.push(err.message || String(err));
  }

  return { postedCount, errors };
}
