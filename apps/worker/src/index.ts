import { createClient } from '@supabase/supabase-js';
import type { Env, NewsSource, RawFeedItem, ExtractedArticle } from './types';
import { fetchFeed } from './rss';
import { normalizeUrl, computeSha256, computeTitleSimHash, isNearDuplicate } from './dedup';
import { extractArticle } from './extractor';
import { summarizeArticlesBatch } from './summarizer';
import { syndicateToFacebook } from './facebook';

async function runPipeline(env: Env) {
  const startedAt = Date.now();
  console.log('[Worker] Starting news ingestion & processing pipeline...');

  // Validate required environment secrets
  const missingSecrets: string[] = [];
  if (!env.SUPABASE_URL) missingSecrets.push('SUPABASE_URL');
  if (!env.SUPABASE_SERVICE_ROLE_KEY) missingSecrets.push('SUPABASE_SERVICE_ROLE_KEY');
  if (!env.GEMINI_API_KEY) missingSecrets.push('GEMINI_API_KEY');

  if (missingSecrets.length > 0) {
    const errorMsg = `Missing required secrets in Cloudflare Worker: ${missingSecrets.join(', ')}. Please add them via wrangler secret put or Cloudflare Dashboard.`;
    console.error(`[Worker] ${errorMsg}`);
    return { success: false, error: errorMsg };
  }

  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // 1. Fetch active news sources
  const { data: sources, error: sourcesErr } = await supabase
    .from('sources')
    .select('*')
    .eq('is_active', true);

  if (sourcesErr) {
    console.error('[Worker] Error loading sources:', sourcesErr.message);
    return { success: false, error: sourcesErr.message };
  }

  if (!sources || sources.length === 0) {
    console.log('[Worker] No active news sources configured.');
    return { success: true, message: 'No active sources' };
  }

  console.log(`[Worker] Polling ${sources.length} active sources...`);

  // 2. Fetch RSS feeds concurrently
  const feedPromises = (sources as NewsSource[]).map(s => fetchFeed(s));
  const feedResults = await Promise.all(feedPromises);

  const rawCandidateItems: RawFeedItem[] = [];

  for (const res of feedResults) {
    // Update source fetch metadata
    await supabase
      .from('sources')
      .update({
        last_etag: res.etag ?? null,
        last_modified: res.lastModified ?? null,
        last_fetched_at: new Date().toISOString(),
      })
      .eq('id', res.sourceId);

    if (res.items.length > 0) {
      rawCandidateItems.push(...res.items);
    }
  }

  console.log(`[Worker] Collected ${rawCandidateItems.length} raw feed items.`);
  if (rawCandidateItems.length === 0) {
    // Still run Facebook syndication for any pending articles
    const fbResult = await syndicateToFacebook(supabase, env);
    return {
      success: true,
      rawItems: 0,
      ingested: 0,
      fbPosted: fbResult.postedCount,
      durationMs: Date.now() - startedAt,
    };
  }

  // 3. Stage 1: URL Normalization and Hash Deduplication
  const normalizedCandidates = await Promise.all(
    rawCandidateItems.map(async (item) => {
      const cleanUrl = normalizeUrl(item.link);
      const urlHash = await computeSha256(cleanUrl);
      return {
        ...item,
        link: cleanUrl,
        urlHash,
      };
    })
  );

  // Deduplicate against themselves in the current batch
  const uniqueInBatch = new Map<string, typeof normalizedCandidates[0]>();
  for (const item of normalizedCandidates) {
    if (!uniqueInBatch.has(item.urlHash)) {
      uniqueInBatch.set(item.urlHash, item);
    }
  }
  const deduplicatedBatch = Array.from(uniqueInBatch.values());

  const hashes = deduplicatedBatch.map(i => i.urlHash);

  // Query existing articles in Supabase
  const { data: existingRows, error: checkErr } = await supabase
    .from('articles')
    .select('url_hash')
    .in('url_hash', hashes);

  if (checkErr) {
    console.error('[Worker] Error checking existing url_hashes:', checkErr.message);
  }

  const existingHashSet = new Set((existingRows || []).map((r: any) => r.url_hash));
  const newCandidateItems = deduplicatedBatch.filter(i => !existingHashSet.has(i.urlHash));

  console.log(`[Worker] After URL hash check: ${newCandidateItems.length} new items.`);

  if (newCandidateItems.length === 0) {
    const fbResult = await syndicateToFacebook(supabase, env);
    return {
      success: true,
      rawItems: rawCandidateItems.length,
      ingested: 0,
      fbPosted: fbResult.postedCount,
      durationMs: Date.now() - startedAt,
    };
  }

  // 4. Stage 2: Title SimHash Near-Duplicate Check
  // Load recent articles from the last 24 hours
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: recentArticles } = await supabase
    .from('articles')
    .select('title_simhash')
    .gte('created_at', oneDayAgo);

  const existingSimHashes = (recentArticles || [])
    .map((r: any) => r.title_simhash)
    .filter(Boolean);

  const itemsToExtract: RawFeedItem[] = [];
  const currentBatchSimHashes = [...existingSimHashes];

  for (const item of newCandidateItems) {
    const simhash = computeTitleSimHash(item.title);
    if (!isNearDuplicate(simhash, currentBatchSimHashes, 4)) {
      itemsToExtract.push(item);
      currentBatchSimHashes.push(simhash);
    } else {
      console.log(`[Worker] Skipping near-duplicate wire story: "${item.title}"`);
    }
  }

  // Enforce batch cap per run (up to 8 items to stay well within Cloudflare Worker 30s CPU limit)
  const cappedItems = itemsToExtract.slice(0, 8);
  console.log(`[Worker] Extracting full text for ${cappedItems.length} candidate articles...`);

  // 5. Stage 3: DOM Content Extraction
  const extractedList: ExtractedArticle[] = [];
  for (const item of cappedItems) {
    const extracted = await extractArticle(item);
    if (extracted && extracted.cleaned_text.length >= 80) {
      extractedList.push(extracted);
    }
  }

  console.log(`[Worker] Extracted ${extractedList.length} valid articles. Calling Gemini API...`);

  // 6. Stage 4 & 5: Batch Gemini Summarization
  const summarizedRecords = await summarizeArticlesBatch(extractedList, env.GEMINI_API_KEY);

  let insertedCount = 0;
  if (summarizedRecords.length > 0) {
    const { data: inserted, error: insertErr } = await supabase
      .from('articles')
      .insert(summarizedRecords)
      .select('id');

    if (insertErr) {
      console.error('[Worker] Error inserting summarized articles:', insertErr.message);
    } else {
      insertedCount = inserted?.length || 0;
      console.log(`[Worker] Successfully inserted ${insertedCount} summarized articles.`);
    }
  }

  // 7. Stage 6: Automated Facebook Syndication
  const fbResult = await syndicateToFacebook(supabase, env);

  const durationMs = Date.now() - startedAt;
  console.log(`[Worker] Pipeline finished in ${durationMs}ms. Ingested: ${insertedCount}, FB Posted: ${fbResult.postedCount}`);

  return {
    success: true,
    rawItems: rawCandidateItems.length,
    extracted: extractedList.length,
    ingested: insertedCount,
    fbPosted: fbResult.postedCount,
    durationMs,
  };
}

export default {
  // Cloudflare Workers Scheduled Cron Trigger
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runPipeline(env));
  },

  // HTTP Endpoint for Healthcheck and Manual Triggering
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok', name: 'prokash-worker' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.pathname === '/trigger') {
      try {
        const result = await runPipeline(env);
        return new Response(JSON.stringify(result, null, 2), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (err: any) {
        return new Response(JSON.stringify({ success: false, error: err.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    return new Response(
      JSON.stringify({
        name: 'Prokash News Worker',
        endpoints: ['/health', '/trigger'],
      }),
      {
        headers: { 'Content-Type': 'application/json' },
      }
    );
  },
};
