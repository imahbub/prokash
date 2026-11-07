import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';
import type { RawFeedItem, ExtractedArticle } from './types';
import { computeSha256, computeTitleSimHash } from './dedup';

export async function extractArticle(item: RawFeedItem): Promise<ExtractedArticle | null> {
  try {
    const url = new URL(item.link);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return null;
    }

    const res = await fetch(item.link, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Prokash/1.0',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'bn,en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(6000),
    });

    if (!res.ok) {
      console.warn(`[Extractor] Fetch failed for ${item.link}: status ${res.status}`);
      return null;
    }

    const html = await res.text();
    if (!html || html.length < 200) {
      return null;
    }

    const { document } = parseHTML(html);

    // Extract og:image
    let imageUrl: string | null = null;
    const ogImageEl = document.querySelector('meta[property="og:image"]') ||
                      document.querySelector('meta[name="og:image"]') ||
                      document.querySelector('meta[name="twitter:image"]');
    if (ogImageEl) {
      const src = ogImageEl.getAttribute('content');
      if (src && src.startsWith('https://')) {
        imageUrl = src;
      }
    }

    // Run Readability
    let title = item.title;
    let textContent = '';

    try {
      const reader = new Readability(document as any);
      const parsed = reader.parse();
      if (parsed) {
        if (parsed.title) title = parsed.title;
        textContent = parsed.textContent || '';
      }
    } catch {
      // Fallback: extract paragraphs manually
      const paragraphs = Array.from(document.querySelectorAll('p'))
        .map((p: any) => p.textContent?.trim() || '')
        .filter(t => t.length > 30);
      textContent = paragraphs.join('\n\n');
    }

    // Clean and collapse whitespace
    const cleanParagraphs = textContent
      .split(/\n+/)
      .map(p => p.replace(/\s+/g, ' ').trim())
      .filter(p => p.length > 25);

    if (cleanParagraphs.length === 0) {
      return null;
    }

    // Inverted pyramid: headline + first 4-6 paragraphs (cap at 2,200 chars)
    let leadText = `Headline: ${title}\n\n`;
    const selectedParas = cleanParagraphs.slice(0, 5);
    for (const para of selectedParas) {
      if ((leadText + para).length > 2200) {
        const remaining = 2200 - leadText.length;
        if (remaining > 50) {
          leadText += para.slice(0, remaining) + '...';
        }
        break;
      }
      leadText += para + '\n\n';
    }

    const urlHash = await computeSha256(item.link);
    const titleSimHash = computeTitleSimHash(title);

    return {
      id: urlHash,
      source_id: item.source_id,
      source_name: item.source_name,
      category_default: item.category_default,
      language: item.language,
      original_url: item.link,
      url_hash: urlHash,
      title_simhash: titleSimHash,
      raw_title: title,
      cleaned_text: leadText.trim(),
      image_url: imageUrl,
    };
  } catch (err: any) {
    console.warn(`[Extractor] Error extracting ${item.link}:`, err.message || err);
    return null;
  }
}
