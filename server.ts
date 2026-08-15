import express, { type Request, type Response } from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import { z } from "zod";
import { createServer as createViteServer } from "vite";

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const FXTWITTER_API = "https://api.fxtwitter.com/status";
const VXTWITTER_API = "https://api.vxtwitter.com/Twitter/status";
const SYNDICATION_API = "https://cdn.syndication.twimg.com/tweet-result";
const WAYBACK_API = "https://archive.org/wayback/available";

const DATA_LOG_FILE = path.resolve(process.cwd(), "data", "urls_log.json");

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
        const raw = fs.readFileSync(DATA_LOG_FILE, "utf-8");
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
    if (data.logs.length > 500) {
      data.logs = data.logs.slice(0, 500);
    }
    fs.writeFileSync(DATA_LOG_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch (err) {
    console.error("Failed writing to data/urls_log.json:", err);
  }
}

const MAX_DOWNLOAD_BYTES = 150 * 1024 * 1024; // 150 MB
const ALLOWED_VIDEO_HOSTS = new Set([
  "video.twimg.com",
  "d.fxtwitter.com",
  "vxtwitter.com",
  "twimg.com",
  "web.archive.org",
  "archive.org",
  "asmrfree.com"
]);

interface VideoVariant {
  url: string;
  bitrate: number | null;
  content_type?: string;
  label?: string;
}

interface RecoveredResult {
  tweetId: string;
  canonicalUrl: string;
  authorHandle: string | null;
  authorName: string | null;
  text: string | null;
  thumbnailUrl: string | null;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  variants: Array<{
    url: string;
    downloadUrl: string;
    label: string;
    bitrate: number | null;
    width: number | null;
    height: number | null;
  }>;
  isArchived: boolean;
  recoveryNote?: string | null;
  archiveDate?: string | null;
}

const InspectVideoBody = z.object({
  url: z.string().min(1),
  recovery: z.boolean().optional(),
});

function getStatusId(input: string): string | null {
  try {
    const trimmed = input.trim();
    if (/^\d{5,30}$/.test(trimmed)) {
      return trimmed;
    }
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
      hostname !== "vxtwitter.com" &&
      hostname !== "asmrfree.com"
    ) {
      return null;
    }
    const match = parsed.pathname.match(/\/(?:status|statuses)\/(\d+)/i);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function getDownloadUrl(url: string): string {
  return `/api/videos/download?url=${encodeURIComponent(url)}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function safeFilename(url: string, id: string = "video"): string {
  const base = url.split("/").pop()?.split("?")[0] ?? `x-video-${id}`;
  const cleaned = base.replace(/[^a-z0-9._-]/gi, "").slice(-80);
  return cleaned.endsWith(".mp4") ? cleaned : `${cleaned || `x-video-${id}`}.mp4`;
}

// 1. Fetch from live API providers (FxTwitter & VxTwitter)
async function fetchPublicTweet(tweetId: string): Promise<Record<string, unknown> | null> {
  try {
    const upstream = await fetch(`${FXTWITTER_API}/${tweetId}`, {
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (upstream.ok) {
      const payload = asRecord(await upstream.json());
      const tweet = asRecord(payload.tweet);
      if (Object.keys(tweet).length > 0) return tweet;
    }
  } catch (err) {
    console.warn("FxTwitter fetch failed:", err);
  }

  try {
    const upstream = await fetch(`${VXTWITTER_API}/${tweetId}`, {
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (upstream.ok) {
      const tweet = asRecord(await upstream.json());
      if (Object.keys(tweet).length > 0) return tweet;
    }
  } catch (err) {
    console.warn("VxTwitter fetch failed:", err);
  }

  return null;
}

// 2. Fetch from Syndication CDN Cache
async function fetchSyndicationTweet(tweetId: string): Promise<Record<string, unknown> | null> {
  try {
    const token = ((Number(tweetId) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");
    const upstream = await fetch(`${SYNDICATION_API}?id=${tweetId}&lang=en&token=${token}`, {
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (upstream.ok) {
      const data = asRecord(await upstream.json());
      if (data.mediaDetails || data.video) {
        return data;
      }
    }
  } catch (err) {
    console.warn("Syndication fetch failed:", err);
  }
  return null;
}

// 3. Search public Web Archive (Wayback Machine) for deleted/taken-down posts
async function fetchWaybackArchiveTweet(tweetId: string): Promise<RecoveredResult | null> {
  const testUrls = [
    `https://twitter.com/i/status/${tweetId}`,
    `https://x.com/i/status/${tweetId}`,
  ];

  for (const targetUrl of testUrls) {
    try {
      const res = await fetch(`${WAYBACK_API}?url=${encodeURIComponent(targetUrl)}`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) continue;

      const data = asRecord(await res.json());
      const snapshots = asRecord(data.archived_snapshots);
      const closest = asRecord(snapshots.closest);

      if (closest && closest.available === true && typeof closest.url === "string") {
        const snapshotUrl = closest.url as string;
        const timestamp = asString(closest.timestamp);

        // Fetch the raw archived snapshot HTML
        const rawArchivedUrl = snapshotUrl.replace(/\/web\/(\d+)\//, "/web/$1id_/");
        const snapRes = await fetch(rawArchivedUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
          },
          signal: AbortSignal.timeout(12_000),
        });

        if (snapRes.ok) {
          const html = await snapRes.text();

          // Search for video.twimg.com URLs inside the archived HTML
          const videoMatch = html.match(/https:\/\/(?:video\.twimg\.com|d\.fxtwitter\.com)[^"'\s<>]+\.mp4(?:\?[^"'\s<>]*)?/gi);

          // Search for author and text
          const authorMatch = html.match(/@([a-zA-Z0-9_]{1,15})/i);
          const authorHandle = authorMatch ? authorMatch[1] : null;

          const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
          const rawTitle = titleMatch ? titleMatch[1].replace(/on (?:Twitter|X):.*$/i, "").trim() : null;

          const posterMatch = html.match(/https:\/\/(?:pbs\.twimg\.com\/[^"'\s<>]+\.(?:jpg|png|jpeg)|web\.archive\.org\/web\/[^\/]+\/https:\/\/pbs\.twimg\.com\/[^"'\s<>]+)/i);

          if (videoMatch && videoMatch.length > 0) {
            const uniqueVideos = Array.from(new Set(videoMatch));
            const variants = uniqueVideos.map((vUrl, index) => {
              // Wrap with Wayback fallback if necessary
              const isWayback = vUrl.includes("web.archive.org");
              const archivedVideoUrl = isWayback ? vUrl : `https://web.archive.org/web/${timestamp || "20230101000000"}oe_/${vUrl}`;

              return {
                url: archivedVideoUrl,
                downloadUrl: getDownloadUrl(archivedVideoUrl),
                label: index === 0 ? "Best available (Archived)" : `Archived stream ${index + 1}`,
                bitrate: null,
                width: null,
                height: null,
              };
            });

            const formattedDate = timestamp && timestamp.length >= 8
              ? `${timestamp.substring(0, 4)}-${timestamp.substring(4, 6)}-${timestamp.substring(6, 8)}`
              : null;

            return {
              tweetId,
              canonicalUrl: `https://x.com/i/status/${tweetId}`,
              authorHandle,
              authorName: authorHandle ? `@${authorHandle}` : "Archived X Post",
              text: rawTitle || "Recovered from public internet archive snapshot.",
              thumbnailUrl: posterMatch ? posterMatch[0] : null,
              durationSeconds: null,
              width: null,
              height: null,
              variants,
              isArchived: true,
              recoveryNote: "Recovered from public Wayback Machine snapshot. Video was preserved before post was removed.",
              archiveDate: formattedDate,
            };
          }
        }
      }
    } catch (err) {
      console.warn("Wayback check failed for", targetUrl, err);
    }
  }

  return null;
}

function findVideo(tweet: Record<string, unknown>): Record<string, unknown> | null {
  const media = asRecord(tweet.media);
  const allMedia = Array.isArray(media.all) ? media.all : [];
  const video = allMedia.find((item) => {
    const rec = asRecord(item);
    return rec.type === "video" || rec.type === "gif";
  });
  if (video) return asRecord(video);

  // VxTwitter format compatibility
  const mediaUrls = Array.isArray(tweet.mediaURLs) ? tweet.mediaURLs : [];
  if (mediaUrls.length > 0) {
    const mp4Url = mediaUrls.find((u: unknown) => typeof u === "string" && (u.includes(".mp4") || u.includes("video.twimg.com")));
    if (mp4Url) {
      return {
        url: mp4Url,
        variants: [{ url: mp4Url, content_type: "video/mp4", bitrate: 1000000 }],
      };
    }
  }

  // Syndication video format
  const mediaDetails = Array.isArray(tweet.mediaDetails) ? tweet.mediaDetails : [];
  for (const m of mediaDetails) {
    const rec = asRecord(m);
    const videoInfo = asRecord(rec.video_info);
    if (Array.isArray(videoInfo.variants)) {
      return {
        variants: videoInfo.variants,
        thumbnail_url: rec.media_url_https,
        duration: asNumber(videoInfo.duration_millis) ? (asNumber(videoInfo.duration_millis)! / 1000) : null,
      };
    }
  }

  return null;
}

function findLinkedStatusIds(tweet: Record<string, unknown>): string[] {
  const rawText = asRecord(tweet.raw_text);
  const facets = Array.isArray(rawText.facets) ? rawText.facets : [];
  const ids = new Set<string>();
  for (const facet of facets) {
    const replacement = asString(asRecord(facet).replacement);
    const linkedId = replacement ? getStatusId(replacement) : null;
    if (linkedId) ids.add(linkedId);
  }
  return [...ids];
}

// Health check endpoint
app.get(["/api/health", "/api/healthz"], (_req: Request, res: Response) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Inspect video route with automatic archive/takedown recovery
app.post("/api/videos/inspect", async (req: Request, res: Response): Promise<void> => {
  const parsedBody = InspectVideoBody.safeParse(req.body);
  if (!parsedBody.success) {
    res.status(400).json({ error: "Paste a valid X or Twitter video link." });
    return;
  }

  const tweetId = getStatusId(parsedBody.data.url);
  if (!tweetId) {
    res.status(400).json({
      error: "That link doesn’t look like an X/Twitter post link.",
    });
    return;
  }

  try {
    const recoveryRequested = parsedBody.data.recovery === true;
    let resolvedTweetId = tweetId;
    let isRecovered = false;
    let recoveryNote: string | null = null;

    // Step 1: Live tweet APIs
    let tweet = await fetchPublicTweet(tweetId);

    // Step 2: Try Syndication cache if live API returned null
    if (!tweet) {
      tweet = await fetchSyndicationTweet(tweetId);
      if (tweet) {
        isRecovered = true;
        recoveryNote = "Retrieved via public syndication cache.";
      }
    }

    let video = tweet ? findVideo(tweet) : null;

    // Step 3: Linked quotes or retweets
    if (!video && tweet) {
      for (const linkedId of findLinkedStatusIds(tweet)) {
        const linkedTweet = (await fetchPublicTweet(linkedId)) || (await fetchSyndicationTweet(linkedId));
        const linkedVideo = linkedTweet ? findVideo(linkedTweet) : null;
        if (linkedTweet && linkedVideo) {
          tweet = linkedTweet;
          video = linkedVideo;
          resolvedTweetId = linkedId;
          isRecovered = true;
          recoveryNote = "Found matching video in linked public quote/post.";
          break;
        }
      }
    }

    // Step 4: If still no tweet or video found, perform Public Web Archive (Wayback) Lookup
    if (!video) {
      const archivedResult = await fetchWaybackArchiveTweet(tweetId);
      if (archivedResult) {
        res.json(archivedResult);
        return;
      }
    }

    if (!tweet || !video) {
      res.status(404).json({
        error: recoveryRequested
          ? "No public copy or archived web snapshot was found for this link."
          : "This post could not be found publicly or may have been deleted/taken down. Try the recovery search.",
      });
      return;
    }

    const author = asRecord(
      tweet.author || tweet.user || (tweet.user_name ? { screen_name: tweet.user_screen_name, name: tweet.user_name } : {})
    );
    const videoRecord = video;
    const rawVariants = Array.isArray(videoRecord.variants)
      ? videoRecord.variants
      : [];

    let variants: VideoVariant[] = rawVariants
      .map((item): VideoVariant | null => {
        const variant = asRecord(item);
        const url = asString(variant.url);
        const contentType = asString(variant.content_type);
        if (!url || contentType === "application/x-mpegURL") return null;
        try {
          const parsed = new URL(url);
          if (
            parsed.protocol !== "https:" ||
            !ALLOWED_VIDEO_HOSTS.has(parsed.hostname.toLowerCase())
          ) {
            return null;
          }
        } catch {
          return null;
        }
        return {
          url,
          bitrate: asNumber(variant.bitrate),
          content_type: contentType ?? "video/mp4",
        };
      })
      .filter((item): item is VideoVariant => item !== null)
      .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0));

    // If no variants array but direct url exists
    if (variants.length === 0 && asString(videoRecord.url)) {
      const directUrl = asString(videoRecord.url)!;
      variants = [{
        url: directUrl,
        bitrate: 1500000,
        content_type: "video/mp4",
      }];
    }

    if (variants.length === 0) {
      res.status(404).json({
        error: "This video does not have a downloadable MP4 version available.",
      });
      return;
    }

    const width = asNumber(videoRecord.width);
    const height = asNumber(videoRecord.height);

    const response: RecoveredResult = {
      tweetId: resolvedTweetId,
      canonicalUrl:
        asString(tweet.url) ?? `https://x.com/i/status/${resolvedTweetId}`,
      authorHandle: asString(author.screen_name) ?? asString(tweet.user_screen_name) ?? asString(tweet.screen_name),
      authorName: asString(author.name) ?? asString(tweet.user_name) ?? asString(tweet.name),
      text: asString(tweet.text) ?? asString(tweet.description),
      thumbnailUrl: asString(videoRecord.thumbnail_url) ?? asString(videoRecord.poster),
      durationSeconds: asNumber(videoRecord.duration),
      width,
      height,
      variants: variants.map((variant, index) => ({
        url: variant.url,
        downloadUrl: getDownloadUrl(variant.url),
        label:
          index === 0
            ? "Best quality"
            : variant.bitrate
            ? `${Math.round((variant.bitrate ?? 0) / 1000)} kbps`
            : "Standard quality",
        bitrate: variant.bitrate,
        width,
        height,
      })),
      isArchived: isRecovered,
      recoveryNote,
    };

    // Automatically record every inspected URL into data/urls_log.json on the server
    appendServerUrlLog({
      url: parsedBody.data.url,
      tweetId: resolvedTweetId,
      status: isRecovered ? "archived_recovered" : "inspected",
      authorHandle: asString(author.screen_name) ?? asString(tweet.user_screen_name) ?? asString(tweet.screen_name),
      authorName: asString(author.name) ?? asString(tweet.user_name) ?? asString(tweet.name),
      text: asString(tweet.text) ?? asString(tweet.description),
      thumbnailUrl: asString(videoRecord.thumbnail_url) ?? asString(videoRecord.poster),
      isArchived: isRecovered,
    });

    res.json(response);
  } catch (error) {
    console.error("Unexpected video lookup error:", error);
    res.status(502).json({
      error: "The public video service is unavailable right now. Try again soon.",
    });
  }
});

// Download video proxy route
app.get("/api/videos/download", async (req: Request, res: Response): Promise<void> => {
  const rawUrl = typeof req.query.url === "string" ? req.query.url : "";
  const inline = req.query.inline === "1" || req.query.inline === "true";

  let videoUrl: URL;
  try {
    videoUrl = new URL(rawUrl);
  } catch {
    res.status(400).json({ error: "That download link is not valid." });
    return;
  }

  if (
    (videoUrl.protocol !== "https:" && videoUrl.protocol !== "http:") ||
    !ALLOWED_VIDEO_HOSTS.has(videoUrl.hostname.toLowerCase())
  ) {
    res.status(400).json({ error: "That video host is not supported." });
    return;
  }

  try {
    const upstream = await fetch(videoUrl.toString(), {
      headers: {
        Accept: "video/mp4,video/*;q=0.9,*/*;q=0.1",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      },
      signal: AbortSignal.timeout(120_000),
    });

    if (!upstream.ok || !upstream.body) {
      res.status(502).json({ error: "The video could not be downloaded." });
      return;
    }

    const contentLength = Number(upstream.headers.get("content-length") ?? 0);
    if (contentLength > MAX_DOWNLOAD_BYTES) {
      res.status(413).json({
        error: "That video is too large to download through this app.",
      });
      return;
    }

    const buffer = Buffer.from(await upstream.arrayBuffer());
    if (buffer.byteLength > MAX_DOWNLOAD_BYTES) {
      res.status(413).json({
        error: "That video is too large to download through this app.",
      });
      return;
    }

    // Log download event to server file data/urls_log.json
    appendServerUrlLog({
      url: rawUrl,
      tweetId: videoUrl.pathname.split("/").pop() || "download",
      status: "downloaded",
    });

    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Length", buffer.byteLength);
    res.setHeader(
      "Content-Disposition",
      `${inline ? "inline" : "attachment"}; filename="${safeFilename(videoUrl.pathname)}"`,
    );
    res.setHeader("Cache-Control", "no-store");
    res.send(buffer);
  } catch (error) {
    console.error("Unexpected video download error:", error);
    res.status(502).json({ error: "The video could not be downloaded." });
  }
});

// Admin server-side URL file storage API
app.get("/api/admin/logs", (_req: Request, res: Response) => {
  try {
    if (fs.existsSync(DATA_LOG_FILE)) {
      const raw = fs.readFileSync(DATA_LOG_FILE, "utf-8");
      res.setHeader("Content-Type", "application/json");
      res.send(raw || '{"logs":[]}');
    } else {
      res.json({ logs: [] });
    }
  } catch {
    res.status(500).json({ error: "Could not read log file" });
  }
});

app.delete("/api/admin/logs", (_req: Request, res: Response) => {
  try {
    fs.writeFileSync(DATA_LOG_FILE, JSON.stringify({ logs: [] }, null, 2), "utf-8");
    res.json({ status: "cleared" });
  } catch {
    res.status(500).json({ error: "Could not clear log file" });
  }
});

// Development vs Production serving
async function setupServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req: Request, res: Response) => {
      const indexPath = path.join(distPath, "index.html");
      res.sendFile(indexPath, (err) => {
        if (err) {
          res.status(200).send("ClipKeep is loading...");
        }
      });
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`ClipKeep server running on http://0.0.0.0:${PORT}`);
  });
}

setupServer();
