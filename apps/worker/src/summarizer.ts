import type { ExtractedArticle, GeminiSummarizedItem, ArticleRecord } from './types';

const SYSTEM_INSTRUCTION = `You are a senior Bengali news editor writing in natural, contemporary standard journalistic Bengali (প্রমিত সংবাদপত্রের ভাষা, similar to BBC Bangla and Prothom Alo).
Rules:
1. Never translate English idioms word-for-word. Reconstruct sentences naturally using subject-object-verb (SOV) Bengali syntax.
2. Preserve factual accuracy: numbers, dates, named entities, and quotes must strictly match the provided source text.
3. Transliterate foreign proper nouns into Bengali script accurately, keeping widely used acronyms (e.g., UN, IMF, FIFA) in parentheses on first mention if helpful.
4. Keep the tone neutral, objective, and concise. Avoid sensationalist clickbait.
5. Output strictly valid JSON matching the requested schema for each article id.`;

const RESPONSE_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      id: { type: 'STRING', description: 'Input article correlation ID' },
      t: { type: 'STRING', description: 'Natural Bengali headline (max 14 words)' },
      s: { type: 'STRING', description: 'Natural Bengali summary paragraph (45-65 words)' },
      b: {
        type: 'ARRAY',
        items: { type: 'STRING' },
        description: '3 key factual takeaways in Bengali (1 sentence each)',
      },
      c: {
        type: 'STRING',
        enum: ['national', 'international', 'economy', 'tech', 'sports', 'opinion'],
      },
      fb: { type: 'STRING', description: 'Engaging 1-2 sentence Bengali caption for Facebook Page post' },
    },
    required: ['id', 't', 's', 'b', 'c', 'fb'],
  },
};

function generateSlug(urlHash: string, category: string): string {
  const dateStr = new Date().toISOString().slice(0, 10);
  const shortHash = urlHash.slice(0, 8);
  return `${dateStr}-${category}-${shortHash}`;
}

export async function summarizeArticlesBatch(
  articles: ExtractedArticle[],
  geminiApiKey: string
): Promise<ArticleRecord[]> {
  if (articles.length === 0) return [];

  const results: ArticleRecord[] = [];
  const chunkSize = 4;

  for (let i = 0; i < articles.length; i += chunkSize) {
    const batch = articles.slice(i, i + chunkSize);
    try {
      const promptContent = batch.map((a, idx) => {
        return `--- Article ${idx + 1} ---
ID: ${a.id}
Source: ${a.source_name} (${a.language})
Category Hint: ${a.category_default}
${a.cleaned_text}
`;
      }).join('\n\n');

      const payload = {
        systemInstruction: {
          parts: [{ text: SYSTEM_INSTRUCTION }],
        },
        contents: [
          {
            parts: [{ text: promptContent }],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
        },
      };

      // Use gemini-3.5-flash-lite for high free-tier quota (1,500 RPD) and sub-second generation
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${geminiApiKey}`;
      let res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30000),
      });

      if (!res.ok && (res.status === 503 || res.status === 429)) {
        console.warn(`[Summarizer] Primary model returned ${res.status}, retrying once with gemini-3.5-flash in 2s...`);
        await new Promise(r => setTimeout(r, 2000));
        const fallbackUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${geminiApiKey}`;
        res = await fetch(fallbackUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(30000),
        });
      }

      if (!res.ok) {
        const errText = await res.text();
        console.error(`[Summarizer] Gemini API error (${res.status}):`, errText);
        continue;
      }

      const json: any = await res.json();
      const rawText = json.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawText) {
        console.warn('[Summarizer] Empty response candidate from Gemini');
        continue;
      }

      const parsedItems: GeminiSummarizedItem[] = JSON.parse(rawText);

      // Map back to articles
      for (const item of parsedItems) {
        const original = batch.find(b => b.id === item.id);
        if (!original) continue;

        const slug = generateSlug(original.url_hash, item.c || original.category_default);

        results.push({
          source_id: original.source_id,
          source_name: original.source_name,
          original_url: original.original_url,
          url_hash: original.url_hash,
          title_simhash: original.title_simhash,
          slug,
          title_bn: item.t,
          summary_bn: item.s,
          bullets_bn: item.b || [],
          category: item.c || original.category_default,
          image_url: original.image_url,
          fb_caption_bn: item.fb,
          status: 'published',
        });
      }
    } catch (err: any) {
      console.error('[Summarizer] Batch processing failed:', err.message || err);
    }
  }

  return results;
}
