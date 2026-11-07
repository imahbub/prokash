# Automated Bengali News Aggregation, Summarization & Distribution Platform (`plan.md`)

> **Agent Execution Directive**: This specification defines a zero-cost, defense-in-depth, and ultra-low-token automated Bengali news platform. Execute the phases sequentially. Do not expose service keys in client bundles, do not send raw HTML to the LLM, and verify every milestone before advancing.

## 1. System Architecture & Technology Stack

The platform separates **scheduled ingestion & LLM processing** (server-side edge cron worker) from **public content delivery** (static/edge-cached minimal news frontend) and **database state** (PostgreSQL with Row Level Security).

| Layer | Technology Choice | Role & Free-Tier Justification |
| :--- | :--- | :--- |
| **Frontend & Edge Hosting** | [Astro](https://docs.astro.build/en/getting-started/) on [Cloudflare Pages](https://developers.cloudflare.com/pages/) | Ships zero client-side JavaScript by default, supports [On-Demand Rendering](https://docs.astro.build/en/guides/on-demand-rendering/) with `Cache-Control` edge headers, and provides unlimited free static bandwidth on [Cloudflare Pages Limits](https://developers.cloudflare.com/pages/platform/limits/). |
| **Ingestion & Cron Engine** | [Cloudflare Workers Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/) | Executes the [`scheduled()` handler](https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/) every 15–30 minutes without public HTTP exposure, keeping API keys isolated in encrypted Worker bindings. |
| **Database & Auth** | [Supabase Database](https://supabase.com/docs/guides/database/overview) | Managed PostgreSQL with [Row Level Security (RLS)](https://supabase.com/docs/guides/database/postgres/row-level-security) and [Supabase Storage](https://supabase.com/docs/guides/storage) for optional OG image caching. |
| **Content Extraction** | [Mozilla Readability](https://github.com/mozilla/readability) + `linkedom` | Strips DOM bloat, scripts, ads, and navigation locally inside the Worker before any LLM call, cutting input token volume by 85–95%. |
| **Bengali Summarization** | [Gemini API (`gemini-3.8-flash`)](https://aistudio.google.com/docs) | Supports [Structured Outputs](https://ai.google.dev/gemini-api/docs/generate-content/structured-output) and [Context Caching](https://aistudio.google.com/docs/caching) for high-fluency Bengali (*Prothom Alo* / *BBC Bangla* standard) at minimal cost. |
| **Social Syndication** | [Facebook Pages API](https://developers.facebook.com/documentation/pages-api) | Publishes directly to the [`/{page-id}/feed` endpoint](https://developers.facebook.com/docs/graph-api/reference/page/feed/) via a zero-cost native `fetch` call without third-party automation middleware fees. |

## 2. Token-Optimization Pipeline (5-Stage Cost Control)

To minimize LLM token consumption while producing natural, journalistic Bengali (*প্রমিত বাংলা*), the ingestion Worker must enforce five sequential filters before and during inference:

| Optimization Stage | Mechanism | Token Savings Impact |
| :--- | :--- | :--- |
| **1. Pre-LLM URL & Hash Deduplication** | Normalize source URLs (strip `utm_*`, `fbclid`, trailing slashes) and compute a SHA-256 hash (`url_hash`). Query [Supabase Database](https://supabase.com/docs/guides/database/overview) before fetching the article body. | **100% savings** on already-ingested articles across overlapping RSS runs. |
| **2. Title SimHash Near-Duplicate Filter** | Compute a 64-bit word shingle hash or trigram similarity check against articles ingested in the last 24 hours to skip wire-service reprints. | **100% savings** on syndicated agency duplicates. |
| **3. Local DOM Pruning & Lead-Paragraph Slicing** | Parse HTML using [Mozilla Readability](https://github.com/mozilla/readability), collapse whitespace, and extract only the headline + first 4–6 paragraphs (capped at `2,200` characters). News follows the inverted-pyramid structure, where 95% of core facts reside in the lead. | **85%–95% reduction** in input tokens compared to raw HTML or full-page scraping. |
| **4. Multi-Article Batching (`3–5` items/call)** | Group 3 to 5 cleaned articles into a single [Gemini API](https://aistudio.google.com/docs) call so the Bengali editorial system prompt is amortized across multiple stories, leveraging [Context Caching](https://aistudio.google.com/docs/caching) when shared prefixes exceed token thresholds. | **65%–75% reduction** in repeated system prompt overhead. |
| **5. Compact JSON Schema Enforcement** | Use [Gemini Structured Outputs](https://ai.google.dev/gemini-api/docs/generate-content/structured-output) with short keys (`t` for Bengali title, `s` for 60-word summary, `b` for 3 bullet points, `c` for category slug, `fb` for Facebook hook) and `temperature: 0.2`. | **30%–40% reduction** in output wrapper tokens and zero retry waste from malformed JSON. |

### Natural Bengali Editorial Prompt Specification

Configure the system instruction with these strict linguistic rules so output reads like a human Bengali desk editor rather than literal machine translation:

```text
You are a senior Bengali news editor writing in natural, contemporary standard journalistic Bengali (প্রমিত সংবাদপত্রের ভাষা, similar to BBC Bangla and Prothom Alo).
Rules:
1. Never translate English idioms word-for-word. Reconstruct sentences naturally using subject-object-verb (SOV) Bengali syntax.
2. Preserve factual accuracy: numbers, dates, named entities, and quotes must strictly match the provided source text.
3. Transliterate foreign proper nouns into Bengali script accurately, keeping widely used acronyms (e.g., UN, IMF, FIFA) in parentheses on first mention if helpful.
4. Keep the tone neutral, objective, and concise. Avoid sensationalist clickbait.
5. Output strictly valid JSON matching the requested schema for each article `id`.
```

### Compact Batch Response Schema

```json
{
  "type": "ARRAY",
  "items": {
    "type": "OBJECT",
    "properties": {
      "id": { "type": "STRING", "description": "Input article correlation ID" },
      "t": { "type": "STRING", "description": "Natural Bengali headline (max 14 words)" },
      "s": { "type": "STRING", "description": "Natural Bengali summary paragraph (45-65 words)" },
      "b": {
        "type": "ARRAY",
        "items": { "type": "STRING" },
        "description": "3 key factual takeaways in Bengali (1 sentence each)"
      },
      "c": {
        "type": "STRING",
        "enum": ["national", "international", "economy", "tech", "sports", "opinion"]
      },
      "fb": { "type": "STRING", "description": "Engaging 1-2 sentence Bengali caption for Facebook Page post" }
    },
    "required": ["id", "t", "s", "b", "c", "fb"]
  }
}
```

## 3. Security Architecture & Hardening

Follow a strict zero-trust architecture across [Supabase](https://supabase.com/docs), [Cloudflare Workers](https://developers.cloudflare.com/workers/), and [Meta for Developers](https://developers.facebook.com/docs/graph-api/):

* **Strict Secret Isolation**: Store `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, `FB_PAGE_ACCESS_TOKEN`, and `FB_PAGE_ID` exclusively as encrypted [Cloudflare Workers Secrets](https://developers.cloudflare.com/workers/) via `wrangler secret put`. Never expose these keys in the [Cloudflare Pages](https://developers.cloudflare.com/pages/) client environment.
* **Read-Only Frontend Key**: The [Astro](https://docs.astro.build/en/guides/backend/supabase/) frontend only receives `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_ANON_KEY` (or executes server-side queries in Pages Functions), constrained by [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security) to `SELECT` only rows where `status = 'published'`.
* **Revoke Default Grants & Enforce RLS**: Per [Supabase Securing Your Data](https://supabase.com/docs/guides/database/secure-data), enable RLS on every table in `public` and restrict write operations (`INSERT`, `UPDATE`, `DELETE`) exclusively to the `service_role` used by the ingestion Worker.
* **SSRF & Sanitization Guardrails**: Restrict the ingestion Worker to an explicit allowlist of domains stored in the `sources` table, enforce a 5-second fetch timeout, strip all HTML tags from extracted text before database insertion, and validate `image_url` values to allow only `https://` URLs.
* **Long-Lived Page Access Token Management**: Generate a non-expiring System User or long-lived Page Access Token scoped strictly to `pages_manage_posts` and `pages_read_engagement` per the [Facebook Pages API Getting Started Guide](https://developers.facebook.com/documentation/pages-api/getting-started).

## 4. Database Schema & RLS Migration (`supabase/migrations/0001_init.sql`)

Instruct the coding agent to apply the following idempotent SQL migration in [Supabase](https://supabase.com/docs/guides/database/overview):

```sql
-- Enable extensions
create extension if not exists "pgcrypto";

-- 1. News Sources Table (Admin/Service-Role Managed)
create table public.sources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  feed_url text not null unique,
  site_url text not null,
  language text not null default 'en',
  category_default text not null default 'international',
  is_active boolean not null default true,
  last_etag text,
  last_modified text,
  last_fetched_at timestamptz,
  created_at timestamptz not null default now()
);

-- 2. Articles Table
create table public.articles (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.sources(id) on delete cascade,
  source_name text not null,
  original_url text not null,
  url_hash text not null unique,
  title_simhash text not null,
  slug text not null unique,
  title_bn text not null,
  summary_bn text not null,
  bullets_bn jsonb not null default '[]'::jsonb,
  category text not null default 'international',
  image_url text,
  fb_caption_bn text,
  status text not null default 'published' check (status in ('draft', 'published', 'archived')),
  fb_post_id text,
  fb_posted_at timestamptz,
  fb_error text,
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- Indexes for fast public queries & deduplication
create index idx_articles_published_at on public.articles (published_at desc) where status = 'published';
create index idx_articles_category on public.articles (category, published_at desc) where status = 'published';
create index idx_articles_simhash_recent on public.articles (title_simhash, created_at desc);
create index idx_articles_fb_queue on public.articles (created_at asc) where status = 'published' and fb_post_id is null;

-- 3. Enable Row Level Security (RLS)
alter table public.sources enable row level security;
alter table public.articles enable row level security;

-- Revoke write privileges from anon and authenticated roles
revoke insert, update, delete on public.sources from anon, authenticated;
revoke insert, update, delete on public.articles from anon, authenticated;

-- Public read-only policy solely for published articles
create policy "Allow public read of published articles"
  on public.articles
  for select
  to anon, authenticated
  using (status = 'published');
```

## 5. Repository Structure

```text
bengali-news-platform/
├── apps/
│   ├── web/                          # Astro minimal news site deployed to Cloudflare Pages
│   │   ├── src/
│   │   │   ├── layouts/BaseLayout.astro
│   │   │   ├── components/
│   │   │   │   ├── ArticleCard.astro
│   │   │   │   ├── CategoryNav.astro
│   │   │   │   └── SeoMeta.astro     # OpenGraph + Twitter Card tags for Facebook previews
│   │   │   ├── lib/supabase.ts       # Read-only anon client
│   │   │   └── pages/
│   │   │       ├── index.astro       # Home feed with SWR edge caching
│   │   │       ├── category/[slug].astro
│   │   │       ├── news/[slug].astro # Article detail + source attribution link
│   │   │       └── rss.xml.ts
│   │   ├── astro.config.mjs
│   │   └── package.json
│   └── worker/                       # Cloudflare Worker with Cron Trigger
│       ├── src/
│       │   ├── index.ts              # scheduled() entrypoint
│       │   ├── rss.ts                # Conditional HTTP fetch (ETag / If-Modified-Since)
│       │   ├── extractor.ts          # linkedom + @mozilla/readability + lead slicer
│       │   ├── dedup.ts              # URL normalization, SHA-256 & 64-bit SimHash
│       │   ├── summarizer.ts         # Batch Gemini API call with Structured Output
│       │   └── facebook.ts           # Graph API /{page-id}/feed publisher with retry
│       ├── wrangler.toml
│       └── package.json
└── supabase/
    └── migrations/
        └── 0001_init.sql
```

## 6. Step-by-Step Implementation Plan for the Coding Agent

### Phase 1: Database & Environment Bootstrap
1. Initialize the monorepo workspace (`npm init -y`) with `apps/web`, `apps/worker`, and `supabase`.
2. Using the [Supabase CLI](https://supabase.com/docs), link the project and push `supabase/migrations/0001_init.sql`.
3. Seed `public.sources` with 5–10 reliable RSS feeds (e.g., Reuters, BBC News, Al Jazeera, Prothom Alo English/Bangla) including `name`, `feed_url`, `site_url`, and `category_default`.
4. Verify [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security) by running a test query using `SUPABASE_ANON_KEY`: confirm `SELECT` on `public.articles` succeeds while `INSERT` and `SELECT` on `public.sources` return permission denied.

### Phase 2: Ingestion, Deduplication & Content Extraction Worker
1. Scaffold `apps/worker` and configure `wrangler.toml` with a [Cron Trigger](https://developers.cloudflare.com/workers/configuration/cron-triggers/) (`crons = ["*/20 * * * *"]`).
2. Implement `src/rss.ts`:
   * Fetch active rows from `public.sources` using the `service_role` key.
   * Send `If-None-Match` (`last_etag`) and `If-Modified-Since` (`last_modified`) headers on every RSS request. If the server returns `304 Not Modified`, skip parsing immediately.
3. Implement `src/dedup.ts`:
   * Normalize item URLs (strip tracking query parameters, lowercase hostname) and compute SHA-256 (`url_hash`).
   * Query `public.articles` for matching `url_hash` values in a single `.in('url_hash', hashes)` query and filter out existing URLs.
   * Compute a normalized 3-gram title hash (`title_simhash`) and compare against the last 24 hours of articles to drop cross-outlet wire duplicates.
4. Implement `src/extractor.ts`:
   * Fetch the target article HTML with a 5,000 ms `AbortSignal.timeout(5000)`.
   * Parse DOM with `linkedom` and extract the article via [Mozilla Readability](https://github.com/mozilla/readability).
   * Extract `og:image` from `<meta property="og:image">` if valid `https://`, then slice the plain text body to the headline + first 5 paragraphs (hard cap: `2,200` characters).

### Phase 3: Batch Bengali Summarization Engine
1. Implement `src/summarizer.ts` targeting the [Gemini API](https://aistudio.google.com/docs):
   * Chunk pending extracted articles into batches of `4`.
   * Construct a single request to `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent` with `generationConfig.responseMimeType = "application/json"`, `generationConfig.responseSchema` set to the Compact Batch Response Schema, and `temperature = 0.2`.
2. Map the structured output back to each candidate article by `id`, generate a URL-safe slug (`YYYY-MM-DD-short-hash`), and perform a single bulk `.insert()` into `public.articles`.

### Phase 4: Minimal Bengali News Website on Cloudflare Pages
1. Initialize [Astro](https://docs.astro.build/en/getting-started/) in `apps/web` with `@astrojs/cloudflare` configured for [Cloudflare Pages](https://developers.cloudflare.com/pages/).
2. Typography & Minimal UI:
   * Load **Hind Siliguri** or **Noto Serif Bengali** with `font-display: swap` and subsetting for fast mobile rendering on 3G/4G connections.
   * Build `ArticleCard.astro` and `news/[slug].astro` to display:
     * Bengali Headline (`title_bn`)
     * 3 Key Takeaway Bullets (`bullets_bn`) in a subtle highlight box
     * Concise Summary Paragraph (`summary_bn`)
     * Clear Source Attribution Badge & outbound canonical link (`মূল প্রতিবেদন: [Source Name]`) to comply with copyright and fair-use attribution standards.
3. Edge Caching & OpenGraph:
   * Set `Astro.response.headers.set('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600')` on feed and article routes so [Cloudflare Pages](https://developers.cloudflare.com/pages/functions/pricing/) serves 99% of traffic from the edge cache without hitting Supabase or consuming Worker invocations.
   * Populate `<meta property="og:title">`, `<meta property="og:description">`, and `<meta property="og:image">` on every `/news/[slug]` route so Facebook automatically renders rich link cards.

### Phase 5: Automated Facebook Page Syndication
1. Implement `src/facebook.ts` inside `apps/worker` using the [Facebook Pages API Posts Endpoint](https://developers.facebook.com/documentation/pages-api/posts):
   * Query up to `2` unposted articles per cron run (`status = 'published'` and `fb_post_id is null`) to space out posts organically and avoid Meta spam rate limits.
   * Execute an HTTPS `POST` to `https://graph.facebook.com/v26.0/${env.FB_PAGE_ID}/feed` (see [Page Feed Reference](https://developers.facebook.com/docs/graph-api/reference/page/feed/)):

```typescript
const response = await fetch(
  `https://graph.facebook.com/v26.0/${env.FB_PAGE_ID}/feed`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: `${article.fb_caption_bn}\n\n📌 বিস্তারিত পড়ুন কমেন্টে বা নিচের লিংকে:`,
      link: `${env.PUBLIC_SITE_URL}/news/${article.slug}`,
      access_token: env.FB_PAGE_ACCESS_TOKEN,
    }),
  }
);
```

2. Record the returned `id` in `articles.fb_post_id` and set `fb_posted_at = now()`. If an error occurs, store the sanitized message in `fb_error` and implement exponential backoff (skip after 3 failed attempts).

## 7. Verification & Acceptance Checklist for the Agent

- [ ] **Zero-Secret Leak Check**: Run `grep -rn "SERVICE_ROLE\|GEMINI_API_KEY\|FB_PAGE" apps/web/dist` after building the frontend to confirm zero secret strings exist in the client bundle.
- [ ] **Token Budget Audit**: Run the Worker locally via `wrangler dev --test-scheduled` (per [Setting Cron Triggers](https://developers.cloudflare.com/workers/examples/cron-trigger/)) on 4 sample articles and verify total prompt + completion tokens average **< 750 tokens per article**.
- [ ] **RLS Penetration Test**: Attempt an `INSERT` and `UPDATE` against `public.articles` using the public `anon` key and verify PostgreSQL rejects both with `42501 (insufficient_privilege)`.
- [ ] **Bengali Readability & Attribution Check**: Inspect rendered `/news/[slug]` pages to verify natural *প্রমিত বাংলা* phrasing, proper `og:image` tags, and a working outbound link to `original_url`.
- [ ] **Facebook Graph API Live Dry-Run**: Trigger a single test post to the target Facebook Page and verify `fb_post_id` is persisted in Supabase and the link preview renders properly on Facebook.
