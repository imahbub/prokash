export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SUPABASE_ANON_KEY: string;
  GEMINI_API_KEY: string;
  FB_PAGE_ID: string;
  FB_PAGE_ACCESS_TOKEN: string;
  PUBLIC_SITE_URL: string;
}

export interface NewsSource {
  id: string;
  name: string;
  feed_url: string;
  site_url: string;
  language: string;
  category_default: string;
  is_active: boolean;
  last_etag?: string | null;
  last_modified?: string | null;
  last_fetched_at?: string | null;
}

export interface RawFeedItem {
  source_id: string;
  source_name: string;
  category_default: string;
  language: string;
  title: string;
  link: string;
  guid?: string;
  pubDate?: string;
}

export interface ExtractedArticle {
  id: string; // Correlation ID (e.g. url_hash)
  source_id: string;
  source_name: string;
  category_default: string;
  language: string;
  original_url: string;
  url_hash: string;
  title_simhash: string;
  raw_title: string;
  cleaned_text: string;
  image_url?: string | null;
}

export interface GeminiSummarizedItem {
  id: string;
  t: string; // Bengali headline (max 14 words)
  s: string; // Bengali summary paragraph (45-65 words)
  b: string[]; // 3 key factual takeaways in Bengali (1 sentence each)
  c: 'national' | 'international' | 'economy' | 'tech' | 'sports' | 'opinion';
  fb: string; // Engaging 1-2 sentence Bengali caption for Facebook
}

export interface ArticleRecord {
  id?: string;
  source_id: string;
  source_name: string;
  original_url: string;
  url_hash: string;
  title_simhash: string;
  slug: string;
  title_bn: string;
  summary_bn: string;
  bullets_bn: string[];
  category: string;
  image_url?: string | null;
  fb_caption_bn: string;
  status: 'published' | 'draft' | 'archived';
  published_at?: string;
}
