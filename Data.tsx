export interface DownloadLogItem {
  id: string;
  url: string;
  tweetId: string;
  authorHandle: string | null;
  authorName: string | null;
  text: string | null;
  thumbnailUrl: string | null;
  timestamp: string;
  status: 'inspected' | 'downloaded' | 'archived_recovered';
  isArchived: boolean;
  selectedQuality?: string;
}

// Server File: /data/urls_log.json
export async function fetchServerLogs(): Promise<DownloadLogItem[]> {
  try {
    const res = await fetch('/api/admin/logs');
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.logs) ? data.logs : [];
  } catch {
    return [];
  }
}

export async function clearServerLogs(): Promise<boolean> {
  try {
    const res = await fetch('/api/admin/logs', { method: 'DELETE' });
    return res.ok;
  } catch {
    return false;
  }
}
