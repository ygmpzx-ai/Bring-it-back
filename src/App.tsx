import { type FormEvent, type ReactNode, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import {
  AlertCircle,
  Archive,
  ArchiveRestore,
  ArrowDownToLine,
  Check,
  CircleHelp,
  ClipboardPaste,
  Clock,
  Download,
  FileVideo,
  History,
  Info,
  Link2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import {
  getDownloadVideoQueryKey,
  useDownloadVideo,
  useInspectVideo,
  type VideoInspection,
  type VideoVariant,
} from '@/lib/api';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';

const queryClient = new QueryClient();

function Home() {
  const [url, setUrl] = useState('');
  const [inspection, setInspection] = useState<VideoInspection | null>(null);
  const [selectedVariant, setSelectedVariant] = useState<VideoVariant | null>(null);
  const [downloadError, setDownloadError] = useState('');
  const [recoveryUsed, setRecoveryUsed] = useState(false);

  const inspectVideo = useInspectVideo();
  const downloadTarget = selectedVariant?.url ?? '';
  const downloadQuery = useDownloadVideo(
    { url: downloadTarget },
    {
      query: {
        enabled: false,
        queryKey: getDownloadVideoQueryKey({ url: downloadTarget }),
      },
    },
  );

  const isValidXUrl = useMemo(() => {
    if (!url.trim()) return false;
    try {
      const parsed = new URL(url.trim());
      return /(^|\.)((x|twitter|fixupx|fxtwitter|vxtwitter)\.com)$/i.test(parsed.hostname) && parsed.pathname.includes('/');
    } catch {
      return /^\d{5,30}$/.test(url.trim());
    }
  }, [url]);

  const runInspection = (recovery = false) => {
    if (!isValidXUrl || inspectVideo.isPending) return;
    setInspection(null);
    setSelectedVariant(null);
    setDownloadError('');
    inspectVideo.mutate(
      { data: recovery ? { url: url.trim(), recovery: true } : { url: url.trim() } },
      {
        onSuccess: (result) => {
          setInspection(result);
          setSelectedVariant(result.variants[0] ?? null);
        },
      },
    );
  };

  const handleInspect = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    runInspection();
  };

  const handleRecovery = () => {
    setRecoveryUsed(true);
    runInspection(true);
  };

  const handleDownload = async () => {
    if (!selectedVariant) return;
    setDownloadError('');
    try {
      const result = await downloadQuery.refetch();
      if (!result.data) throw new Error('The video could not be prepared right now.');
      const objectUrl = URL.createObjectURL(result.data);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = `x-video-${inspection?.tweetId ?? 'saved'}.mp4`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (error) {
      setDownloadError(getErrorMessage(error));
    }
  };

  const reset = () => {
    setUrl('');
    setInspection(null);
    setSelectedVariant(null);
    setDownloadError('');
    setRecoveryUsed(false);
    inspectVideo.reset();
  };

  return (
    <main className="app-shell">
      <header className="site-header animate-in">
        <a href="/" className="brand-lockup" data-testid="link-home">
          <span className="brand-mark" aria-hidden="true"><ArrowDownToLine size={21} strokeWidth={2.4} /></span>
          <span>
            <span className="brand-name">clipkeep</span>
            <span className="brand-subtitle">for public & archived X videos</span>
          </span>
        </a>
        <div className="flex items-center gap-3">
          <div className="header-note hidden sm:flex">
            <span className="status-dot" aria-hidden="true" />
            <span>Multi-Source & Archive Recovery</span>
          </div>
        </div>
      </header>

      <div className="page-content">
        <section className="hero-grid" aria-labelledby="page-title">
          <div className="animate-in animate-delay-1">
            <div className="eyebrow"><span className="eyebrow-line" /> personal utility / 01</div>
            <h1 className="hero-title" id="page-title">Keep the good<br /><em>bits.</em></h1>
            <p className="hero-copy">
              Save a video from a <strong>public X post</strong> to your device in seconds.
              Includes automatic public archive checks for deleted or taken-down posts.
            </p>
          </div>

          <form className="paste-panel animate-in animate-delay-2" onSubmit={handleInspect} data-testid="form-inspect">
            <div className="panel-label">
              <span>Start with a link</span>
              <span className="public-chip"><ShieldCheck size={12} /> public & archived posts</span>
            </div>
            <div className="url-input-wrap">
              <Link2 size={17} color="hsl(var(--muted-foreground))" aria-hidden="true" />
              <input
                className="url-input"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="Paste an x.com link"
                aria-label="Public X video link"
                data-testid="input-video-url"
                autoComplete="url"
                spellCheck={false}
              />
              {url && (
                <button type="button" className="clear-button" onClick={reset} aria-label="Clear link" data-testid="button-clear-url">
                  <X size={14} />
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <button className="inspect-button flex-1" type="submit" disabled={!isValidXUrl || inspectVideo.isPending} data-testid="button-inspect-video">
                {inspectVideo.isPending ? <><RefreshCw size={17} className="spin" /> Searching media & archives</> : <><Sparkles size={17} /> Inspect link</>}
              </button>
              <button
                type="button"
                className="recovery-button"
                style={{ padding: '0.75rem 1rem', fontSize: '0.85rem' }}
                onClick={handleRecovery}
                disabled={!isValidXUrl || inspectVideo.isPending}
                title="Deep Archive & Takedown Recovery"
                data-testid="button-deep-recover"
              >
                <History size={16} />
                <span>Archive Scan</span>
              </button>
            </div>
            <div className="input-hint">
              <CircleHelp size={14} />
              <span>If a post was removed or taken down, we search public web archive snapshots (Wayback Machine).</span>
            </div>
            {inspectVideo.isError && (
              <div className="error-message" role="alert" data-testid="status-inspect-error">
                <AlertCircle size={16} />
                <span>{getErrorMessage(inspectVideo.error)}</span>
              </div>
            )}
            {inspectVideo.isError && !recoveryUsed && (
              <button
                type="button"
                className="recovery-button w-full"
                onClick={handleRecovery}
                disabled={inspectVideo.isPending}
                data-testid="button-recover-video"
              >
                <ArchiveRestore size={16} />
                Scan Web Archives & Public Cache Snapshots
              </button>
            )}
          </form>
        </section>

        <section className="results-wrap animate-in animate-delay-3" aria-live="polite" aria-labelledby="results-title">
          <div className="section-head">
            <div>
              <div className="eyebrow"><span className="eyebrow-line" /> your workspace / 02</div>
              <h2 className="section-title" id="results-title">{inspection ? (inspection.isArchived ? 'Archived Video Recovered.' : 'Video found.') : 'Ready when you are.'}</h2>
            </div>
            <p className="section-caption">{inspection ? 'Choose a size that feels right for your device, then save a local copy.' : 'Paste one public X link above. We check live feeds and public web archive caches before preparing your download.'}</p>
          </div>

          {inspectVideo.isPending && <LoadingState />}
          {!inspectVideo.isPending && !inspection && <EmptyState />}
          {!inspectVideo.isPending && inspection && (
            <InspectionResult
              inspection={inspection}
              selectedVariant={selectedVariant}
              onSelectVariant={setSelectedVariant}
              onDownload={handleDownload}
              isDownloading={downloadQuery.isFetching}
              downloadError={downloadError}
            />
          )}
        </section>

        <section className="trust-strip animate-in animate-delay-3" aria-label="How Clipkeep handles links">
          <div className="trust-item">
            <ShieldCheck className="trust-icon" size={19} />
            <div className="trust-title">Public by design</div>
            <div className="trust-text">Inspects public feeds, syndication caches, and quotes.</div>
          </div>
          <div className="trust-item">
            <Archive className="trust-icon" size={19} />
            <div className="trust-title">Wayback Archive Recovery</div>
            <div className="trust-text">Automatically checks public web archive snapshots if a post is missing or taken down.</div>
          </div>
          <div className="trust-item">
            <Download className="trust-icon" size={19} />
            <div className="trust-title">Your phone, your copy</div>
            <div className="trust-text">The selected file is prepared for a direct download straight to your device.</div>
          </div>
        </section>

        <footer className="footer">
          <span>Use saved media responsibly and respect creator rights.</span>
          <span className="footer-mono">CLIPKEEP / PUBLIC & ARCHIVED LINKS</span>
        </footer>
      </div>
    </main>
  );
}

function LoadingState() {
  return (
    <div className="result-grid" data-testid="status-inspect-loading">
      <div className="preview-card">
        <div className="skeleton video-frame" />
        <div className="preview-meta">
          <div className="author-line"><span className="skeleton author-avatar" /><span className="skeleton" style={{ width: '9rem', height: '1.5rem', borderRadius: '.35rem' }} /></div>
          <span className="skeleton" style={{ width: '7rem', height: '1rem', borderRadius: '.35rem' }} />
        </div>
      </div>
      <div className="details-card">
        <span className="skeleton" style={{ display: 'block', width: '10rem', height: '1.2rem', borderRadius: '.35rem' }} />
        <span className="skeleton" style={{ display: 'block', width: '15rem', height: '.85rem', marginTop: '.65rem', borderRadius: '.35rem' }} />
        <div className="quality-list">{[1, 2, 3].map((item) => <span className="skeleton" key={item} style={{ height: '3.5rem', borderRadius: '.85rem' }} />)}</div>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="empty-state" data-testid="status-empty-workspace">
      <div className="empty-copy">
        <div className="empty-title">Nothing here yet.</div>
        <p className="empty-text">Your next saved moment starts with an X post link. We scan live feeds and public web archives to find the highest-quality video.</p>
      </div>
      <div className="empty-art" aria-hidden="true">
        <div className="empty-card-icon"><ClipboardPaste size={28} strokeWidth={1.8} /></div>
      </div>
    </div>
  );
}

function InspectionResult({
  inspection,
  selectedVariant,
  onSelectVariant,
  onDownload,
  isDownloading,
  downloadError,
}: {
  inspection: VideoInspection;
  selectedVariant: VideoVariant | null;
  onSelectVariant: (variant: VideoVariant) => void;
  onDownload: () => void;
  isDownloading: boolean;
  downloadError: string;
}) {
  const authorName = inspection.authorName || inspection.authorHandle || (inspection.isArchived ? 'Archived post' : 'X creator');
  const initials = authorName.replace('@', '').slice(0, 2).toUpperCase() || 'AR';
  return (
    <div className="result-grid" data-testid={`card-video-result-${inspection.tweetId}`}>
      <div className="preview-card">
        <div className="video-frame">
          {selectedVariant?.url ? (
            <video
              controls
              playsInline
              poster={inspection.thumbnailUrl ?? undefined}
              src={`${selectedVariant.downloadUrl}&inline=1`}
              data-testid="video-preview"
            >
              Your browser cannot play this video preview.
            </video>
          ) : inspection.thumbnailUrl ? (
            <img src={inspection.thumbnailUrl} alt="Video thumbnail" style={{ width: '100%', height: '100%', objectFit: 'cover' }} data-testid="img-video-thumbnail" />
          ) : (
            <div className="video-fallback"><FileVideo size={46} strokeWidth={1.3} /></div>
          )}
          <span className="preview-badge">
            {inspection.isArchived ? (
              <span className="flex items-center gap-1 text-amber-300 font-medium">
                <History size={12} /> Archived Snapshot
              </span>
            ) : (
              <span className="flex items-center gap-1">
                <Check size={12} /> Inspected
              </span>
            )}
          </span>
        </div>

        {inspection.isArchived && (
          <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg text-xs text-amber-200 flex items-start gap-2">
            <Info size={16} className="shrink-0 text-amber-400 mt-0.5" />
            <div>
              <p className="font-semibold text-amber-300">Recovered Public Archive Copy</p>
              <p className="opacity-90">{inspection.recoveryNote || 'Preserved from public internet archive snapshot.'}</p>
              {inspection.archiveDate && <p className="mt-1 flex items-center gap-1 opacity-75"><Clock size={11} /> Snapshot date: {inspection.archiveDate}</p>}
            </div>
          </div>
        )}

        <div className="preview-meta">
          <div className="author-line">
            <span className="author-avatar" aria-hidden="true">{initials}</span>
            <span>
              <div className="author-name" data-testid="text-author-name">{authorName}</div>
              <div className="author-handle" data-testid="text-author-handle">{inspection.authorHandle ? `@${inspection.authorHandle.replace(/^@/, '')}` : (inspection.isArchived ? 'public archive' : 'public post')}</div>
            </span>
          </div>
          <div className="video-meta">
            <span data-testid="text-video-dimensions">{formatDimensions(inspection.width, inspection.height)}</span>
            <span data-testid="text-video-duration">{formatDuration(inspection.durationSeconds)}</span>
          </div>
        </div>
        {inspection.text && <p className="tweet-copy" data-testid="text-post-copy">{inspection.text}</p>}
      </div>

      <div className="details-card">
        <div className="details-card-header">
          <div>
            <h3 className="details-title">Pick your quality</h3>
            <p className="details-label">
              {inspection.isArchived ? 'Available archived video stream options.' : 'Larger files look sharper. Smaller files save space.'}
            </p>
          </div>
          <span className="eyebrow" style={{ marginTop: '.25rem' }}>03 / save</span>
        </div>
        {inspection.variants.length > 0 ? (
          <div className="quality-list" role="listbox" aria-label="Video quality options">
            {inspection.variants.map((variant, index) => {
              const isSelected = selectedVariant?.downloadUrl === variant.downloadUrl;
              return (
                <button
                  type="button"
                  className={`quality-option ${isSelected ? 'selected' : ''}`}
                  key={`${variant.downloadUrl}-${index}`}
                  onClick={() => onSelectVariant(variant)}
                  aria-selected={isSelected}
                  role="option"
                  data-testid={`button-quality-${index}`}
                >
                  <span className="quality-option-main">
                    <span className="radio-dot" aria-hidden="true" />
                    <span><span className="quality-label">{variant.label || formatDimensions(variant.width, variant.height)}</span><span className="quality-size">{formatDimensions(variant.width, variant.height)}</span></span>
                  </span>
                  <span className="quality-bitrate">{formatBitrate(variant.bitrate)}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="error-message" role="status" data-testid="status-no-variants"><AlertCircle size={16} /><span>No downloadable qualities were returned for this post.</span></div>
        )}
        <button className="download-button" type="button" disabled={!selectedVariant || isDownloading} onClick={onDownload} data-testid="button-download-video">
          {isDownloading ? <><RefreshCw size={17} className="spin" /> Preparing file</> : <><Download size={17} /> Download {selectedVariant?.label || 'video'}</>}
        </button>
        <div className="download-note"><ShieldCheck size={13} /> No account needed. The file goes straight to your device.</div>
        {downloadError && <div className="error-message" role="alert" data-testid="status-download-error"><AlertCircle size={16} /><span>{downloadError}</span></div>}
      </div>
    </div>
  );
}

function formatDuration(seconds: number | null) {
  if (seconds === null || !Number.isFinite(seconds)) return 'duration unknown';
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.round(seconds % 60).toString().padStart(2, '0');
  return `${minutes}:${remaining}`;
}

function formatDimensions(width: number | null, height: number | null) {
  return width && height ? `${width} × ${height}` : 'size unknown';
}

function formatBitrate(bitrate: number | null) {
  if (!bitrate) return 'adaptive';
  return bitrate > 1000 ? `${Math.round(bitrate / 1000)} kbps` : `${bitrate} bps`;
}

function getErrorMessage(error: unknown) {
  if (error && typeof error === 'object') {
    const responseError = error as { error?: string; message?: string };
    if (responseError.error) return responseError.error;
    if (responseError.message) return responseError.message;
  }
  return 'We could not inspect that link.';
}

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={Home} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL ? import.meta.env.BASE_URL.replace(/\/$/, '') : ''}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;

