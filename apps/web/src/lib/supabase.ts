import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || 'https://iswjsedffboyytxrkdpz.supabase.co';
const supabaseAnonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlzd2pzZWRmZmJveXl0eHJrZHB6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQwNTgxMjEsImV4cCI6MjEwOTYzNDEyMX0.YdBPYmZKiHjYYiPrD3hMHUrL1UOUXwucmDmSasprHJc';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

export interface Article {
  id: string;
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
  fb_caption_bn?: string | null;
  status: 'draft' | 'published' | 'archived';
  published_at: string;
  created_at: string;
}
