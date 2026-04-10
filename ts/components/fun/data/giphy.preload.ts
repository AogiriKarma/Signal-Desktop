// Copyright 2026 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only
// Modified: Replaced Giphy with Tenor API
import { z } from 'zod';
import { parseUnknown } from '../../../util/schemas.std.ts';
import {
  fetchJsonViaProxy,
  fetchBytesViaProxy,
} from '../../../textsecure/WebAPI.preload.ts';
import { fetchInSegments } from './segments.std.ts';
import { safeParseInteger } from '../../../util/numbers.std.ts';
import type { PaginatedGifResults } from '../panels/FunPanelGifs.dom.tsx';
import {
  getGifCdnUrlOrigin,
  isGifCdnUrlOriginAllowed,
} from '../../../util/gifCdnUrls.dom.ts';

const TENOR_BASE_URL = 'https://g.tenor.com';
const TENOR_API_KEY = 'LIVDSRZULELA';
const CONTENT_FILTER = 'medium';

const StringInteger = z.preprocess(input => {
  if (typeof input === 'string') {
    return safeParseInteger(input);
  }
  return input;
}, z.number().int());

const TenorMediaObjectSchema = z.object({
  url: z.string(),
  dims: z.tuple([StringInteger, StringInteger]),
  size: z.number().optional(),
});

const TenorGifSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  content_description: z.string().optional().default(''),
  media: z.array(
    z.object({
      tinygif: TenorMediaObjectSchema.optional(),
      gif: TenorMediaObjectSchema.optional(),
      mp4: TenorMediaObjectSchema.optional(),
      tinymp4: TenorMediaObjectSchema.optional(),
    })
  ),
});

const TenorResultsSchema = z.object({
  next: z.string().optional().default('0'),
  results: z.array(TenorGifSchema),
});

export type GiphySearchParams = Readonly<{
  query: string;
  limit: number;
  offset: number;
}>;

export type GiphyTrendingParams = Readonly<{
  limit: number;
  offset: number;
}>;

type TenorResults = z.infer<typeof TenorResultsSchema>;
type TenorGif = z.infer<typeof TenorGifSchema>;

function normalizeTenorResults(results: TenorResults): PaginatedGifResults {
  const nextPos = results.next;
  const nextOffset =
    nextPos && nextPos !== '0' ? parseInt(nextPos, 10) || null : null;

  return {
    next: nextOffset,
    gifs: results.results
      .map((item: TenorGif) => {
        const media = item.media[0];
        if (!media) return null;

        // Use tinymp4 for preview, mp4 for full attachment
        // Fall back to tinygif/gif if mp4 not available
        const preview = media.tinymp4 || media.tinygif;
        const attachment = media.mp4 || media.gif;

        if (!preview || !attachment) return null;

        return {
          id: item.id,
          title: item.title,
          description: item.content_description,
          previewMedia: {
            url: preview.url,
            width: preview.dims[0],
            height: preview.dims[1],
          },
          attachmentMedia: {
            url: attachment.url,
            width: attachment.dims[0],
            height: attachment.dims[1],
          },
        };
      })
      .filter(
        (gif): gif is NonNullable<typeof gif> => gif != null
      ),
  };
}

export async function fetchGiphySearch(
  query: string,
  limit: number,
  offset: number | null,
  signal?: AbortSignal
): Promise<PaginatedGifResults> {
  const url = new URL('v1/search', TENOR_BASE_URL);

  url.searchParams.set('key', TENOR_API_KEY);
  url.searchParams.set('contentfilter', CONTENT_FILTER);
  url.searchParams.set('media_filter', 'basic');
  url.searchParams.set('ar_range', 'all');
  url.searchParams.set('q', query);
  url.searchParams.set('limit', `${limit}`);
  if (offset != null) {
    url.searchParams.set('pos', `${offset}`);
  }

  const response = await fetchJsonViaProxy({
    method: 'GET',
    url: url.toString(),
    signal,
  });

  const results = parseUnknown(TenorResultsSchema, response.data);
  return normalizeTenorResults(results);
}

export async function fetchGiphyTrending(
  limit: number,
  offset: number | null,
  signal?: AbortSignal
): Promise<PaginatedGifResults> {
  const url = new URL('v1/trending', TENOR_BASE_URL);

  url.searchParams.set('key', TENOR_API_KEY);
  url.searchParams.set('contentfilter', CONTENT_FILTER);
  url.searchParams.set('media_filter', 'basic');
  url.searchParams.set('ar_range', 'all');
  url.searchParams.set('limit', `${limit}`);
  if (offset != null) {
    url.searchParams.set('pos', `${offset}`);
  }

  const response = await fetchJsonViaProxy({
    method: 'GET',
    url: url.toString(),
    signal,
  });

  const results = parseUnknown(TenorResultsSchema, response.data);
  return normalizeTenorResults(results);
}

export function fetchGiphyFile(
  cdnUrl: string,
  signal?: AbortSignal
): Promise<Blob> {
  const origin = getGifCdnUrlOrigin(cdnUrl);
  if (origin == null) {
    throw new Error('fetchGifFile: Cannot fetch invalid URL');
  }
  if (!isGifCdnUrlOriginAllowed(origin)) {
    throw new Error(
      `fetchGifFile: Blocked unsupported url origin: ${origin}`
    );
  }
  return fetchInSegments(cdnUrl, fetchBytesViaProxy, signal);
}
