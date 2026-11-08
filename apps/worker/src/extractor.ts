import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';
import type { RawFeedItem, ExtractedArticle } from './types';
import { computeSha256, computeTitleSimHash } from './dedup';

function cleanAndExtractLead(title: string, textContent: string): string | null {
  const cleanParagraphs = textContent
    .split(/\n+/)
    .map(p => p.replace(/\s+/g, ' ').trim())
    .filter(p => p.length > 25);

  if (cleanParagraphs.length === 0) {
    return null;
  }

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
  return leadText.trim();
}

export async function extractArticle(item: RawFeedItem): Promise<ExtractedArticle | null> {
  try {
    const url = new URL(item.link);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return null;
    }

    let html: string | null = null;
    let imageUrl: string | null = item.raw_image_url || null;

    // 1. Attempt web page fetch with standard browser headers
    try {
      const res = await fetch(item.link, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9,bn;q=0.8',
        },
        signal: AbortSignal.timeout(7000),
      });

      if (res.ok) {
        const text = await res.text();
        if (text && text.length >= 200) {
          html = text;
        }
      } else {
        console.warn(`[Extractor] Web fetch returned status ${res.status} for ${item.link}, trying RSS content fallback`);
      }
    } catch (fetchErr: any) {
      console.warn(`[Extractor] Web fetch failed (${fetchErr.message}) for ${item.link}, trying RSS content fallback`);
    }

    let title = item.title;
    let textContent = '';

    // 2. If web HTML was retrieved, parse it with Readability
    if (html) {
      const { document } = parseHTML(html);

      // Extract og:image if not already present
      if (!imageUrl) {
        const ogImageEl = document.querySelector('meta[property="og:image"]') ||
                          document.querySelector('meta[name="og:image"]') ||
                          document.querySelector('meta[name="twitter:image"]');
        if (ogImageEl) {
          const src = ogImageEl.getAttribute('content');
          if (src && src.startsWith('https://')) {
            imageUrl = src;
          }
        }
      }

      try {
        const reader = new Readability(document as any);
        const parsed = reader.parse();
        if (parsed) {
          if (parsed.title) title = parsed.title;
          textContent = parsed.textContent || '';
        }
      } catch {
        // Fallback: extract paragraphs manually from DOM
        const paragraphs = Array.from(document.querySelectorAll('p'))
          .map((p: any) => p.textContent?.trim() || '')
          .filter(t => t.length > 30);
        textContent = paragraphs.join('\n\n');
      }
    }

    // 3. Fallback: If web text is empty, parse raw_content from RSS feed
    if (!textContent || textContent.trim().length < 80) {
      if (item.raw_content && item.raw_content.length >= 50) {
        const { document } = parseHTML(`<div>${item.raw_content}</div>`);

        if (!imageUrl) {
          const imgEl = document.querySelector('img');
          const src = imgEl?.getAttribute('src');
          if (src && (src.startsWith('https://') || src.startsWith('http://'))) {
            imageUrl = src;
          }
        }

        const paragraphs = Array.from(document.querySelectorAll('p, div, li'))
          .map((p: any) => p.textContent?.trim() || '')
          .filter(t => t.length > 25);

        if (paragraphs.length > 0) {
          textContent = paragraphs.join('\n\n');
        } else {
          textContent = document.textContent || '';
        }
      }
    }

    const leadText = cleanAndExtractLead(title, textContent);
    if (!leadText || leadText.length < 50) {
      return null;
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
      cleaned_text: leadText,
      image_url: imageUrl,
    };
  } catch (err: any) {
    console.warn(`[Extractor] Error extracting ${item.link}:`, err.message || err);
    return null;
  }
}
