// Deduplication: URL normalization, SHA-256 hash, and 64-bit Title SimHash

export function normalizeUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl.trim());
    parsed.protocol = parsed.protocol.toLowerCase();
    parsed.hostname = parsed.hostname.toLowerCase();
    parsed.hash = '';

    const trackingParams = [
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
      'fbclid', 'gclid', 'ref', 'oc', 'ved', '_ga', '_gl'
    ];
    for (const param of trackingParams) {
      parsed.searchParams.delete(param);
    }

    let normalized = parsed.toString();
    if (normalized.endsWith('/') && parsed.pathname.length > 1) {
      normalized = normalized.slice(0, -1);
    }
    return normalized;
  } catch {
    return rawUrl.trim();
  }
}

export async function computeSha256(input: string): Promise<string> {
  const msgUint8 = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// 64-bit FNV-1a hash for string tokens
function fnv1a64(str: string): bigint {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let i = 0; i < str.length; i++) {
    hash ^= BigInt(str.charCodeAt(i));
    hash = (hash * prime) & 0xffffffffffffffffn;
  }
  return hash;
}

// 64-bit SimHash based on character 3-grams (works for both Bengali and English)
export function computeTitleSimHash(title: string): string {
  const normalized = title.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').trim();
  if (!normalized) return '0000000000000000';

  const n = 3;
  const shingles: string[] = [];
  if (normalized.length <= n) {
    shingles.push(normalized);
  } else {
    for (let i = 0; i <= normalized.length - n; i++) {
      shingles.push(normalized.substring(i, i + n));
    }
  }

  const v = new Array(64).fill(0);
  for (const shingle of shingles) {
    const hash = fnv1a64(shingle);
    for (let bit = 0; bit < 64; bit++) {
      const isSet = (hash >> BigInt(bit)) & 1n;
      v[bit] += isSet ? 1 : -1;
    }
  }

  let simhash = 0n;
  for (let bit = 0; bit < 64; bit++) {
    if (v[bit] > 0) {
      simhash |= (1n << BigInt(bit));
    }
  }

  return simhash.toString(16).padStart(16, '0');
}

export function hammingDistanceHex(hex1: string, hex2: string): number {
  try {
    const b1 = BigInt('0x' + hex1);
    const b2 = BigInt('0x' + hex2);
    let xor = b1 ^ b2;
    let distance = 0;
    while (xor > 0n) {
      if (xor & 1n) distance++;
      xor >>= 1n;
    }
    return distance;
  } catch {
    return 64;
  }
}

// If Hamming distance <= 4 out of 64 bits (~93% similar), treat as near duplicate
export function isNearDuplicate(newSimHash: string, existingSimHashes: string[], threshold = 4): boolean {
  for (const existing of existingSimHashes) {
    if (hammingDistanceHex(newSimHash, existing) <= threshold) {
      return true;
    }
  }
  return false;
}
