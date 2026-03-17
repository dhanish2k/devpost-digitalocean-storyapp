'use client';

import { use, useCallback, useEffect, useRef, useState } from 'react';
import API_URL from '@/lib/api';
import StoryLoader from '@/components/StoryLoader';

interface WordTiming {
  word: string;
  start_ms: number;
  end_ms: number;
}

interface StoryPage {
  page_number: number;
  text: string;
  image_url?: string;
  audio_url?: string;
  word_timings?: WordTiming[];
}

export default function StoryReaderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: storyId } = use(params);

  const [pageMap,       setPageMap]       = useState<Record<number, StoryPage>>({});
  const [complete,      setComplete]      = useState(false);
  const [current,       setCurrent]       = useState(1);
  const [audioPlaying,  setAudioPlaying]  = useState(false);
  const [activeWordIdx, setActiveWordIdx] = useState(-1);

  const audioRef         = useRef<HTMLAudioElement | null>(null);
  const rafRef           = useRef<number>(0);
  const autoPlayedRef    = useRef<Set<number>>(new Set());
  const pageMapRef       = useRef<Record<number, StoryPage>>({});
  const activeTimingsRef = useRef<WordTiming[]>([]);

  useEffect(() => { pageMapRef.current = pageMap; }, [pageMap]);

  // ── SSE ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    const es = new EventSource(`${API_URL}/stream/${storyId}`);
    const patch = (n: number, p: Partial<StoryPage>) =>
      setPageMap(prev => ({ ...prev, [n]: { ...prev[n], page_number: n, ...p } }));

    es.addEventListener('story_page',      e => { const d = JSON.parse((e as MessageEvent).data); patch(d.page_number, { text: d.text }); });
    es.addEventListener('image_ready',     e => { const d = JSON.parse((e as MessageEvent).data); patch(d.page_number, { image_url: d.image_url }); });
    es.addEventListener('narration_ready', e => { const d = JSON.parse((e as MessageEvent).data); patch(d.page_number, { audio_url: d.audio_url, word_timings: d.word_timings ?? [] }); });
    es.addEventListener('story_complete',  () => setComplete(true));
    es.addEventListener('stream_done',     () => es.close());
    es.onerror = () => es.close();
    return () => es.close();
  }, [storyId]);

  // ── RAF word-highlight loop ───────────────────────────────────────────────

  const stopRaf = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    setActiveWordIdx(-1);
  }, []);

  const startRaf = useCallback((timings: WordTiming[]) => {
    activeTimingsRef.current = timings;
    const tick = () => {
      if (!audioRef.current) return;
      const nowMs = audioRef.current.currentTime * 1000;
      let idx = -1;
      for (let i = 0; i < timings.length; i++) {
        if (nowMs >= timings[i].start_ms && nowMs <= timings[i].end_ms) { idx = i; break; }
      }
      setActiveWordIdx(idx);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  // ── Audio helpers ─────────────────────────────────────────────────────────

  const startAudio = useCallback((url: string, timings: WordTiming[]) => {
    if (audioRef.current) audioRef.current.pause();
    stopRaf();

    const audio = new Audio(url);
    audioRef.current = audio;
    audio.play().catch(() => {});
    setAudioPlaying(true);
    if (timings.length) startRaf(timings);

    audio.onended = () => {
      stopRaf();
      setAudioPlaying(false);
      setCurrent(p => {
        const total = Object.keys(pageMapRef.current).length;
        return p < total ? p + 1 : p;
      });
    };
  }, [startRaf, stopRaf]);

  // ── Reset on page change ──────────────────────────────────────────────────

  useEffect(() => {
    stopRaf();
    setAudioPlaying(false);
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
  }, [current, stopRaf]);

  // ── Auto-play on asset arrival ────────────────────────────────────────────

  useEffect(() => {
    const p = pageMap[current];
    if (!p?.audio_url || autoPlayedRef.current.has(current)) return;
    autoPlayedRef.current.add(current);
    startAudio(p.audio_url, p.word_timings ?? []);
  }, [pageMap, current, startAudio]);

  // ── Pause / Resume ────────────────────────────────────────────────────────

  const handleTogglePlay = () => {
    const audio = audioRef.current;
    const p = pageMap[current];
    if (!audio) {
      if (p?.audio_url) startAudio(p.audio_url, p.word_timings ?? []);
      return;
    }
    if (audioPlaying) {
      audio.pause();
      stopRaf();
      setAudioPlaying(false);
    } else {
      audio.play().catch(() => {});
      if (activeTimingsRef.current.length) startRaf(activeTimingsRef.current);
      setAudioPlaying(true);
    }
  };

  // ── Derived values ────────────────────────────────────────────────────────

  const narrationEnabled = typeof window !== 'undefined'
    ? localStorage.getItem('storytime_narration') !== 'false'
    : true;

  const totalPages = Object.keys(pageMap).length;
  const page       = pageMap[current];
  const nextReady  = !!pageMap[current + 1]?.text;
  const isLast     = complete && current === totalPages;

  const page1 = pageMap[1];
  const firstPageReady = !!(
    page1?.text && page1?.image_url && (!narrationEnabled || page1?.audio_url)
  );

  // ── Word renderer — only active when real timings are present ─────────────

  const renderText = () => {
    const timings = page?.word_timings;
    if (!timings?.length || !page?.text) return page?.text ?? '';

    const tokens = page.text.split(/(\s+)/);
    let wi = 0;
    return tokens.map((tok, i) => {
      if (/^\s+$/.test(tok)) return tok;
      const isActive = wi++ === activeWordIdx;
      return (
        <span
          key={i}
          className="inline-block origin-bottom"
          style={{
            padding: '0 0.15em',
            transition: 'transform 80ms ease-out, color 80ms ease-out',
            ...(isActive ? {
              color: 'var(--accent)',
              transform: 'scale(1.28)',
              fontWeight: '500',
            } : {}),
          }}
        >
          {tok}
        </span>
      );
    });
  };

  // ── Render ────────────────────────────────────────────────────────────────

  if (!firstPageReady) return <StoryLoader />;

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-6 md:p-16">
      <div className="w-full max-w-2xl flex flex-col items-center gap-8">

        <span className="text-sm text-[--color-muted] tracking-widest uppercase">
          Page {current} of {totalPages}{complete ? '' : '…'}
        </span>

        <div className="w-full aspect-video rounded-2xl overflow-hidden bg-[--color-card]">
          {page.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={page.image_url} alt={`Page ${current}`} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full animate-pulse flex items-center justify-center">
              <span className="text-[--color-muted] text-sm tracking-wide">Illustrating…</span>
            </div>
          )}
        </div>

        <p className="text-2xl md:text-3xl leading-relaxed text-center text-[--color-foreground] font-light min-h-40">
          {renderText()}
        </p>

        {page?.audio_url && (
          <button
            onClick={handleTogglePlay}
            className="flex items-center gap-2.5 px-5 py-2.5 rounded-full border-2 font-medium text-sm transition-all"
            style={audioPlaying ? {
              borderColor: 'var(--accent)',
              backgroundColor: 'rgba(232,168,56,0.12)',
              color: 'var(--accent)',
            } : {
              borderColor: 'var(--border)',
              color: 'var(--muted)',
            }}
          >
            {audioPlaying ? (
              <>
                <svg width="11" height="13" viewBox="0 0 11 13" fill="currentColor">
                  <rect x="0" y="0" width="3.5" height="13" rx="1" />
                  <rect x="7.5" y="0" width="3.5" height="13" rx="1" />
                </svg>
                Pause
              </>
            ) : (
              <>
                <svg width="11" height="13" viewBox="0 0 11 13" fill="currentColor">
                  <path d="M1 0.5l10 6-10 6V0.5z" />
                </svg>
                {audioRef.current ? 'Resume' : 'Listen'}
              </>
            )}
          </button>
        )}

        {isLast && (
          <p className="text-[--color-accent] text-2xl font-bold italic">The End</p>
        )}

        <div className="flex items-center gap-6 mt-4">
          <button
            onClick={() => setCurrent(p => p - 1)}
            disabled={current === 1}
            className="px-6 py-2 rounded-full border border-[--color-border] text-[--color-muted] hover:border-[--color-accent] hover:text-[--color-accent] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Prev
          </button>
          <button
            onClick={() => setCurrent(p => p + 1)}
            disabled={isLast || !nextReady}
            className="px-6 py-2 rounded-full border border-[--color-border] text-[--color-muted] hover:border-[--color-accent] hover:text-[--color-accent] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {!isLast && !nextReady ? (
              <span className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full border border-current border-t-transparent animate-spin" />
                Next
              </span>
            ) : 'Next'}
          </button>
        </div>

      </div>
    </main>
  );
}
