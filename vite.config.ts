import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import { defineConfig, type Plugin } from 'vite';

const FXTWITTER_API = "https://api.fxtwitter.com/status";
const VXTWITTER_API = "https://api.vxtwitter.com/Twitter/status";
const SYNDICATION_API = "https://cdn.syndication.twimg.com/tweet-result";
const WAYBACK_API = "https://archive.org/wayback/available";

const DATA_LOG_FILE = path.resolve(process.cwd(), 'data', 'urls_log.json');

function appendServerUrlLog(entry: {
  url: string;
  tweetId: string;
  status: string;
  authorHandle?: string | null;
  authorName?: string | null;
  text?: string | null;
  thumbnailUrl?: string | null;
  isArchived?: boolean;
}) {
  try {
    const dir = path.dirname(DATA_LOG_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    let data: { logs: any[] } = { logs: [] };
    if (fs.existsSync(DATA_LOG_FILE)) {
      try {
        const raw = fs.readFileSync(DATA_LOG_FILE, 'utf-8');
        data = JSON.parse(raw || '{"logs":[]}');
        if (!Array.isArray(data.logs)) data.logs = [];
      } catch {
        data = { logs: [] };
      }
    }
    const newLog = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
      ...entry,
    };
    data.logs.unshift(newLog);
    // Keep last 500 records securely in file
    if (data.logs.length > 500) {
      data.logs = data.logs.slice(0, 500);
    }
    fs.writeFileSync(DATA_LOG_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed writing to data/urls_log.json:', err);
  }
}

const ALLOWED_VIDEO_HOSTS = new Set([
  "video.twimg.com",
  "d.fxtwitter.com",
  "vxtwitter.com",
  "twimg.com",
  "web.archive.org",
  "archive.org",
]);

function getStatusId(input: string): string | null {
  try {
    const trimmed = input.trim();
    if (/^\d{5,30}$/.test(trimmed)) return trimmed;
    const parsed = new URL(trimmed);
    const hostname = parsed.hostname.toLowerCase();
    if (
      hostname !== "x.com" &&
      hostname !== "www.x.com" &&
      hostname !== "twitter.com" &&
      hostname !== "www.twitter.com" &&
      hostname !== "mobile.twitter.com" &&
      hostname !== "fixupx.com" &&
      hostname !== "fxtwitter.com" &&
      hostname !== "vxtwitter.com"
    ) {
      return null;
    }
    const match = parsed.pathname.match(/\/(?:status|statuses)\/(\d+)/i);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function safeFilename(url: string): string {
  const base = url.split("/").pop()?.split("?")[0] ?? "x-video";
  const cleaned = base.replace(/[^a-z0-9._-]/gi, "").slice(-80);
  return cleaned.endsWith(".mp4") ? cleaned : `${cleaned || "x-video"}.mp4`;
}

function apiDevPlugin(): Plugin {
  return {
    name: 'api-dev-middleware',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url || '';
        
        if (url.startsWith('/api/health') || url.startsWith('/api/healthz')) {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
          return;
        }

        if (url.startsWith('/api/videos/inspect') && req.method === 'POST') {
          let body = '';
          req.on('data', chunk => { body += chunk; });
          req.on('end', async () => {
            try {
              const data = JSON.parse(body || '{}');
              const tweetId = getStatusId(data.url || '');
              if (!tweetId) {
                res.statusCode = 400;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ error: "That link doesn't look like an X/Twitter post link." }));
                return;
              }

              let tweet: any = null;
              let isRecovered = false;
              let recoveryNote: string | null = null;

              // 1. Check FxTwitter
              try {
                const upstream = await fetch(`${FXTWITTER_API}/${tweetId}`, {
                  headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" },
                });
                if (upstream.ok) {
                  const payload = await upstream.json();
                  if (payload.tweet && Object.keys(payload.tweet).length > 0) {
                    tweet = payload.tweet;
                  }
                }
              } catch (e) {
                console.warn('FxTwitter error:', e);
              }

              // 2. Check VxTwitter
              if (!tweet) {
                try {
                  const upstream = await fetch(`${VXTWITTER_API}/${tweetId}`, {
                    headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" },
                  });
                  if (upstream.ok) {
                    const payload = await upstream.json();
                    if (payload && Object.keys(payload).length > 0) {
                      tweet = payload;
                    }
                  }
                } catch (e) {
                  console.warn('VxTwitter error:', e);
                }
              }

              // 3. Check Syndication Cache
              if (!tweet) {
                try {
                  const token = ((Number(tweetId) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");
                  const upstream = await fetch(`${SYNDICATION_API}?id=${tweetId}&lang=en&token=${token}`, {
                    headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" },
                  });
                  if (upstream.ok) {
                    const sData = await upstream.json();
                    if (sData.mediaDetails || sData.video) {
                      tweet = sData;
                      isRecovered = true;
                      recoveryNote = "Recovered from public syndication cache.";
                    }
                  }
                } catch (e) {
                  console.warn('Syndication error:', e);
                }
              }

              let video: any = null;
              if (tweet) {
                const media = tweet.media || {};
                const allMedia = Array.isArray(media.all) ? media.all : [];
                video = allMedia.find((item: any) => item.type === "video" || item.type === "gif");

                if (!video && Array.isArray(tweet.mediaURLs)) {
                  const mp4 = tweet.mediaURLs.find((u: string) => typeof u === 'string' && u.includes('.mp4'));
                  if (mp4) {
                    video = { url: mp4, variants: [{ url: mp4, bitrate: 1200000 }] };
                  }
                }

                if (!video && Array.isArray(tweet.mediaDetails)) {
                  for (const m of tweet.mediaDetails) {
                    if (m.video_info && Array.isArray(m.video_info.variants)) {
                      video = {
                        variants: m.video_info.variants,
                        thumbnail_url: m.media_url_https,
                        duration: m.video_info.duration_millis ? m.video_info.duration_millis / 1000 : null,
                      };
                      break;
                    }
                  }
                }
              }

              // 4. If not found in live APIs, search Wayback Machine
              if (!video) {
                try {
                  const testUrls = [`https://twitter.com/i/status/${tweetId}`, `https://x.com/i/status/${tweetId}`];
                  for (const targetUrl of testUrls) {
                    const snapCheck = await fetch(`${WAYBACK_API}?url=${encodeURIComponent(targetUrl)}`);
                    if (snapCheck.ok) {
                      const sJson = await snapCheck.json();
                      const closest = sJson.archived_snapshots?.closest;
                      if (closest && closest.available === true && closest.url) {
                        const rawArchivedUrl = closest.url.replace(/\/web\/(\d+)\//, "/web/$1id_/");
                        const snapRes = await fetch(rawArchivedUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
                        if (snapRes.ok) {
                          const html = await snapRes.text();
                          const videoMatch = html.match(/https:\/\/(?:video\.twimg\.com|d\.fxtwitter\.com)[^"'\s<>]+\.mp4(?:\?[^"'\s<>]*)?/gi);
                          if (videoMatch && videoMatch.length > 0) {
                            const uniqueVids = Array.from(new Set(videoMatch));
                            const timestamp = closest.timestamp;
                            const variants = uniqueVids.map((vUrl, idx) => {
                              const isWayback = vUrl.includes('web.archive.org');
                              const fullVUrl = isWayback ? vUrl : `https://web.archive.org/web/${timestamp || '20230101000000'}oe_/${vUrl}`;
                              return {
                                url: fullVUrl,
                                downloadUrl: `/api/videos/download?url=${encodeURIComponent(fullVUrl)}`,
                                label: idx === 0 ? 'Best available (Archived snapshot)' : `Archived stream ${idx + 1}`,
                                bitrate: null,
                                width: null,
                                height: null,
                              };
                            });

                            const formattedDate = timestamp && timestamp.length >= 8
                              ? `${timestamp.substring(0, 4)}-${timestamp.substring(4, 6)}-${timestamp.substring(6, 8)}`
                              : null;

                            res.setHeader('Content-Type', 'application/json');
                            res.end(JSON.stringify({
                              tweetId,
                              canonicalUrl: `https://x.com/i/status/${tweetId}`,
                              authorHandle: null,
                              authorName: 'Archived Public Post',
                              text: 'Preserved snapshot recovered from the Internet Archive Wayback Machine.',
                              thumbnailUrl: null,
                              durationSeconds: null,
                              width: null,
                              height: null,
                              variants,
                              isArchived: true,
                              recoveryNote: 'Recovered from public internet archive snapshot.',
                              archiveDate: formattedDate,
                            }));
                            return;
                          }
                        }
                      }
                    }
                  }
                } catch (wbErr) {
                  console.warn('Dev Wayback error:', wbErr);
                }
              }

              if (!video) {
                res.statusCode = 404;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({
                  error: "This post could not be found publicly or may have been deleted/taken down. We checked live feeds and public archive snapshots.",
                }));
                return;
              }

              const rawVariants = Array.isArray(video.variants) ? video.variants : [];
              let variants = rawVariants
                .filter((v: any) => v.url && v.content_type !== "application/x-mpegURL")
                .map((v: any) => ({
                  url: v.url,
                  downloadUrl: `/api/videos/download?url=${encodeURIComponent(v.url)}`,
                  bitrate: typeof v.bitrate === 'number' ? v.bitrate : null,
                  label: v.bitrate ? `${Math.round(v.bitrate / 1000)} kbps` : 'Standard quality',
                  width: video.width || null,
                  height: video.height || null,
                }))
                .sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0));

              if (variants.length > 0) {
                variants[0].label = 'Best quality';
              } else if (video.url) {
                variants = [{
                  url: video.url,
                  downloadUrl: `/api/videos/download?url=${encodeURIComponent(video.url)}`,
                  bitrate: 1500000,
                  label: 'Best quality',
                  width: video.width || null,
                  height: video.height || null,
                }];
              }

              const author = tweet.author || tweet.user || {};
              
              // Automatically record every inspected URL into data/urls_log.json on the server
              appendServerUrlLog({
                url: data.url || tweet.url || `https://x.com/i/status/${tweetId}`,
                tweetId,
                status: isRecovered ? 'archived_recovered' : 'inspected',
                authorHandle: author.screen_name || tweet.user_screen_name || tweet.screen_name || null,
                authorName: author.name || tweet.user_name || tweet.name || null,
                text: tweet.text || tweet.description || null,
                thumbnailUrl: video.thumbnail_url || video.poster || null,
                isArchived: isRecovered,
              });

              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({
                tweetId,
                canonicalUrl: tweet.url || `https://x.com/i/status/${tweetId}`,
                authorHandle: author.screen_name || tweet.user_screen_name || tweet.screen_name || null,
                authorName: author.name || tweet.user_name || tweet.name || null,
                text: tweet.text || tweet.description || null,
                thumbnailUrl: video.thumbnail_url || video.poster || null,
                durationSeconds: video.duration || null,
                width: video.width || null,
                height: video.height || null,
                variants,
                isArchived: isRecovered,
                recoveryNote,
              }));
            } catch (err) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: "Internal server error during video inspection" }));
            }
          });
          return;
        }

        if (url.startsWith('/api/videos/download')) {
          try {
            const parsedUrl = new URL(url, 'http://localhost');
            const targetUrlStr = parsedUrl.searchParams.get('url') || '';
            const inline = parsedUrl.searchParams.get('inline') === '1' || parsedUrl.searchParams.get('inline') === 'true';
            
            const targetUrl = new URL(targetUrlStr);
            if (!ALLOWED_VIDEO_HOSTS.has(targetUrl.hostname.toLowerCase())) {
              res.statusCode = 400;
              res.end("Invalid video host");
              return;
            }

            const upstream = await fetch(targetUrl.toString(), {
              headers: { Accept: "video/mp4,video/*;q=0.9,*/*;q=0.1", "User-Agent": "Mozilla/5.0" },
            });

            if (!upstream.ok || !upstream.body) {
              res.statusCode = 502;
              res.end("Download failed");
              return;
            }

            const buffer = Buffer.from(await upstream.arrayBuffer());
            
            // Log download event directly to server file data/urls_log.json
            appendServerUrlLog({
              url: targetUrlStr,
              tweetId: targetUrl.pathname.split('/').pop() || 'download',
              status: 'downloaded',
            });

            res.setHeader('Content-Type', 'video/mp4');
            res.setHeader('Content-Length', buffer.byteLength);
            res.setHeader(
              'Content-Disposition',
              `${inline ? 'inline' : 'attachment'}; filename="${safeFilename(targetUrl.pathname)}"`,
            );
            res.setHeader('Cache-Control', 'no-store');
            res.end(buffer);
          } catch (err) {
            res.statusCode = 500;
            res.end("Error downloading video");
          }
          return;
        }

        // Server-side URLs log file management
        if (url.startsWith('/api/admin/logs')) {
          if (req.method === 'GET') {
            try {
              if (fs.existsSync(DATA_LOG_FILE)) {
                const raw = fs.readFileSync(DATA_LOG_FILE, 'utf-8');
                res.setHeader('Content-Type', 'application/json');
                res.end(raw || '{"logs":[]}');
              } else {
                res.setHeader('Content-Type', 'application/json');
                res.end('{"logs":[]}');
              }
            } catch {
              res.statusCode = 500;
              res.end('{"error":"Could not read log file"}');
            }
            return;
          }

          if (req.method === 'DELETE') {
            try {
              fs.writeFileSync(DATA_LOG_FILE, JSON.stringify({ logs: [] }, null, 2), 'utf-8');
              res.setHeader('Content-Type', 'application/json');
              res.end('{"status":"cleared"}');
            } catch {
              res.statusCode = 500;
              res.end('{"error":"Could not clear log file"}');
            }
            return;
          }
        }

        next();
      });
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), apiDevPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
    server: {
      port: 3000,
      host: '0.0.0.0',
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
