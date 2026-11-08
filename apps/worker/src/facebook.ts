import type { SupabaseClient } from '@supabase/supabase-js';
import type { Env } from './types';

interface ArticleToPost {
  id: string;
  slug: string;
  title_bn: string;
  fb_caption_bn: string;
  image_url?: string | null;
  original_url?: string | null;
  category: string;
  created_at: string;
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
    // 1. Approach A: Prune stale backlog (> 4 hours old) so old news doesn't delay breaking stories
    const staleCutoff = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
    const { error: pruneErr } = await supabase
      .from('articles')
      .update({ fb_post_id: 'skipped_stale' })
      .is('fb_post_id', null)
      .lt('created_at', staleCutoff);

    if (pruneErr) {
      console.warn('[Facebook] Warning pruning stale articles:', pruneErr.message);
    }

    // 2. Fetch fresh candidates ordered by created_at DESC (newest first)
    const { data: candidates, error: fetchErr } = await supabase
      .from('articles')
      .select('id, slug, title_bn, fb_caption_bn, image_url, original_url, category, created_at')
      .eq('status', 'published')
      .is('fb_post_id', null)
      .order('created_at', { ascending: false })
      .limit(10);

    if (fetchErr) {
      console.error('[Facebook] Error fetching unposted articles:', fetchErr.message);
      return { postedCount: 0, errors: [fetchErr.message] };
    }

    if (!candidates || candidates.length === 0) {
      return { postedCount: 0, errors: [] };
    }

    // 3. Select up to 2 fresh stories prioritizing category diversity (e.g. 1 Tech + 1 National/International)
    const MAX_POSTS_PER_RUN = 2;
    const selectedArticles: ArticleToPost[] = [];
    const seenCategories = new Set<string>();

    for (const item of candidates as ArticleToPost[]) {
      if (!seenCategories.has(item.category)) {
        seenCategories.add(item.category);
        selectedArticles.push(item);
        if (selectedArticles.length >= MAX_POSTS_PER_RUN) break;
      }
    }

    // Backfill if fewer than MAX_POSTS_PER_RUN were selected from distinct categories
    if (selectedArticles.length < MAX_POSTS_PER_RUN) {
      for (const item of candidates as ArticleToPost[]) {
        if (!selectedArticles.some(s => s.id === item.id)) {
          selectedArticles.push(item);
          if (selectedArticles.length >= MAX_POSTS_PER_RUN) break;
        }
      }
    }

    console.log(`[Facebook] Selected ${selectedArticles.length} fresh articles for syndication:`, 
      selectedArticles.map(a => `${a.category}: ${a.slug}`));

    for (let i = 0; i < selectedArticles.length; i++) {
      const article = selectedArticles[i];
      if (i > 0) {
        // Natural 1.5s pause between posts to respect Meta burst rate limits
        await new Promise(r => setTimeout(r, 1500));
      }

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
