-- Seed initial reliable news sources
insert into public.sources (name, feed_url, site_url, language, category_default, is_active)
values
  ('BBC Bangla', 'https://feeds.bbci.co.uk/bengali/rss.xml', 'https://www.bbc.com/bengali', 'bn', 'national', true),
  ('Prothom Alo Bangla', 'https://www.prothomalo.com/stories.rss', 'https://www.prothomalo.com', 'bn', 'national', true),
  ('Prothom Alo English', 'https://en.prothomalo.com/stories.rss', 'https://en.prothomalo.com', 'en', 'national', true),
  ('The Daily Star', 'https://www.thedailystar.net/rss.xml', 'https://www.thedailystar.net', 'en', 'national', true),
  ('Al Jazeera World', 'https://www.aljazeera.com/xml/rss/all.xml', 'https://www.aljazeera.com', 'en', 'international', true),
  ('BBC News World', 'https://feeds.bbci.co.uk/news/world/rss.xml', 'https://www.bbc.com/news', 'en', 'international', true)
on conflict (feed_url) do nothing;
