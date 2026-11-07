import { XMLParser } from 'fast-xml-parser';
import type { NewsSource, RawFeedItem } from './types';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  trimValues: true,
});

export interface FetchedFeedResult {
  sourceId: string;
  items: RawFeedItem[];
  etag?: string | null;
  lastModified?: string | null;
  notModified: boolean;
}

export async function fetchFeed(source: NewsSource): Promise<FetchedFeedResult> {
  const headers: Record<string, string> = {
    'User-Agent': 'ProkashNewsAggregator/1.0 (+https://prokash.news; neutral news bot)',
    'Accept': 'application/rss+xml, application/xml, text/xml, application/atom+xml, */*',
  };

  if (source.last_etag) {
    headers['If-None-Match'] = source.last_etag;
  }
  if (source.last_modified) {
    headers['If-Modified-Since'] = source.last_modified;
  }

  try {
    const res = await fetch(source.feed_url, {
      headers,
      signal: AbortSignal.timeout(8000),
    });

    if (res.status === 304) {
      return {
        sourceId: source.id,
        items: [],
        notModified: true,
      };
    }

    if (!res.ok) {
      console.warn(`[RSS] Failed to fetch feed ${source.name} (${source.feed_url}): status ${res.status}`);
      return {
        sourceId: source.id,
        items: [],
        notModified: false,
      };
    }

    const etag = res.headers.get('ETag');
    const lastModified = res.headers.get('Last-Modified');
    const xmlText = await res.text();
    const parsed = parser.parse(xmlText);

    const items: RawFeedItem[] = [];

    // RSS 2.0 (<rss><channel><item>)
    if (parsed.rss?.channel?.item) {
      const rawList = Array.isArray(parsed.rss.channel.item)
        ? parsed.rss.channel.item
        : [parsed.rss.channel.item];

      for (const item of rawList) {
        const title = typeof item.title === 'string' ? item.title : item.title?.['#text'] || '';
        let link = typeof item.link === 'string' ? item.link : item.link?.['#text'] || '';
        if (typeof item.link === 'object' && item.link?.['@_href']) {
          link = item.link['@_href'];
        }

        if (title && link) {
          items.push({
            source_id: source.id,
            source_name: source.name,
            category_default: source.category_default,
            language: source.language,
            title: title.trim(),
            link: link.trim(),
            guid: typeof item.guid === 'string' ? item.guid : item.guid?.['#text'],
            pubDate: item.pubDate,
          });
        }
      }
    }
    // Atom (<feed><entry>)
    else if (parsed.feed?.entry) {
      const rawList = Array.isArray(parsed.feed.entry)
        ? parsed.feed.entry
        : [parsed.feed.entry];

      for (const entry of rawList) {
        const title = typeof entry.title === 'string' ? entry.title : entry.title?.['#text'] || '';
        let link = '';
        if (typeof entry.link === 'string') {
          link = entry.link;
        } else if (Array.isArray(entry.link)) {
          const alternate = entry.link.find((l: any) => l['@_rel'] === 'alternate') || entry.link[0];
          link = alternate?.['@_href'] || '';
        } else if (entry.link?.['@_href']) {
          link = entry.link['@_href'];
        }

        if (title && link) {
          items.push({
            source_id: source.id,
            source_name: source.name,
            category_default: source.category_default,
            language: source.language,
            title: title.trim(),
            link: link.trim(),
            guid: entry.id,
            pubDate: entry.published || entry.updated,
          });
        }
      }
    }

    return {
      sourceId: source.id,
      items,
      etag,
      lastModified,
      notModified: false,
    };
  } catch (err: any) {
    console.error(`[RSS] Error fetching feed ${source.name}:`, err.message || err);
    return {
      sourceId: source.id,
      items: [],
      notModified: false,
    };
  }
}
