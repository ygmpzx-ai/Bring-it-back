import { useMutation, useQuery } from '@tanstack/react-query';
import type { UseMutationOptions, UseMutationResult, UseQueryOptions, UseQueryResult } from '@tanstack/react-query';

export interface VideoVariant {
  url: string;
  downloadUrl: string;
  label?: string;
  bitrate?: number | null;
  width?: number | null;
  height?: number | null;
  content_type?: string;
}

export interface VideoInspection {
  tweetId: string;
  canonicalUrl: string;
  authorHandle: string | null;
  authorName: string | null;
  text: string | null;
  thumbnailUrl: string | null;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  variants: VideoVariant[];
  isArchived?: boolean;
  recoveryNote?: string | null;
  archiveDate?: string | null;
}

export interface VideoInspectInput {
  url: string;
  recovery?: boolean;
}

export interface DownloadVideoParams {
  url: string;
}

export async function customFetch<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, init);
  if (!res.ok) {
    let errJson: any;
    try {
      errJson = await res.json();
    } catch {
      errJson = { error: `Request failed with status ${res.status}` };
    }
    throw errJson;
  }
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return (await res.json()) as T;
  }
  return (await res.blob()) as unknown as T;
}

export const inspectVideo = async (input: VideoInspectInput): Promise<VideoInspection> => {
  return customFetch<VideoInspection>('/api/videos/inspect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
};

export const useInspectVideo = (
  options?: UseMutationOptions<VideoInspection, { error?: string; message?: string }, { data: VideoInspectInput }>
): UseMutationResult<VideoInspection, { error?: string; message?: string }, { data: VideoInspectInput }> => {
  return useMutation({
    mutationKey: ['inspectVideo'],
    mutationFn: (variables) => inspectVideo(variables.data),
    ...options,
  });
};

export const getDownloadVideoUrl = (params: DownloadVideoParams): string => {
  const searchParams = new URLSearchParams();
  if (params?.url) {
    searchParams.append('url', params.url);
  }
  return `/api/videos/download?${searchParams.toString()}`;
};

export const downloadVideo = async (params: DownloadVideoParams): Promise<Blob> => {
  return customFetch<Blob>(getDownloadVideoUrl(params), {
    method: 'GET',
  });
};

export const getDownloadVideoQueryKey = (params?: DownloadVideoParams) => {
  return ['/api/videos/download', params?.url] as const;
};

export const useDownloadVideo = (
  params: DownloadVideoParams,
  options?: { query?: UseQueryOptions<Blob, { error?: string; message?: string }> }
): UseQueryResult<Blob, { error?: string; message?: string }> => {
  const queryKey = options?.query?.queryKey ?? getDownloadVideoQueryKey(params);
  return useQuery({
    queryKey,
    queryFn: () => downloadVideo(params),
    ...options?.query,
  });
};
