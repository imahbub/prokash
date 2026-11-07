-- Enable extensions
create extension if not exists "pgcrypto";

-- 1. News Sources Table (Admin/Service-Role Managed)
create table if not exists public.sources (
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
create table if not exists public.articles (
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
create index if not exists idx_articles_published_at on public.articles (published_at desc) where status = 'published';
create index if not exists idx_articles_category on public.articles (category, published_at desc) where status = 'published';
create index if not exists idx_articles_simhash_recent on public.articles (title_simhash, created_at desc);
create index if not exists idx_articles_fb_queue on public.articles (created_at asc) where status = 'published' and fb_post_id is null;

-- 3. Enable Row Level Security (RLS)
alter table public.sources enable row level security;
alter table public.articles enable row level security;

-- Revoke write privileges from anon and authenticated roles
revoke insert, update, delete on public.sources from anon, authenticated;
revoke insert, update, delete on public.articles from anon, authenticated;

-- Public read-only policy solely for published articles
drop policy if exists "Allow public read of published articles" on public.articles;
create policy "Allow public read of published articles"
  on public.articles
  for select
  to anon, authenticated
  using (status = 'published');

-- 4. Seed initial reliable news sources
insert into public.sources (name, feed_url, site_url, language, category_default, is_active)
values
  ('BBC Bangla', 'https://feeds.bbci.co.uk/bengali/rss.xml', 'https://www.bbc.com/bengali', 'bn', 'national', true),
  ('Prothom Alo Bangla', 'https://www.prothomalo.com/stories.rss', 'https://www.prothomalo.com', 'bn', 'national', true),
  ('Prothom Alo English', 'https://en.prothomalo.com/stories.rss', 'https://en.prothomalo.com', 'en', 'national', true),
  ('The Daily Star', 'https://www.thedailystar.net/rss.xml', 'https://www.thedailystar.net', 'en', 'national', true),
  ('Al Jazeera World', 'https://www.aljazeera.com/xml/rss/all.xml', 'https://www.aljazeera.com', 'en', 'international', true),
  ('BBC News World', 'https://feeds.bbci.co.uk/news/world/rss.xml', 'https://www.bbc.com/news', 'en', 'international', true)
on conflict (feed_url) do nothing;
