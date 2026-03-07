'use client';

import { use, useEffect, useRef, useState } from 'react';
import API_URL from '@/lib/api';
import StoryLoader from '@/components/StoryLoader';

interface StoryPage {
  page_number: number;
  text: string;
  image_url?: string;
  audio_url?: string;
}

export default function StoryReaderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: storyId } = use(params);

  // All received pages keyed by page_number
  const [pageMap, setPageMap] = useState<Record<number, StoryPage>>({});
  const [complete, setComplete] = useState(false);
  const [current, setCurrent] = useState(1); // 1-indexed, matches page_number
  const [audioPlaying, setAudioPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const autoPlayedRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    const es = new EventSource(`${API_URL}/stream/${storyId}`);

    const updatePage = (page_number: number, patch: Partial<StoryPage>) => {
      setPageMap((prev) => ({
        ...prev,
        [page_number]: { ...prev[page_number], page_number, ...patch },
      }));
    };

    es.addEventListener('story_page', (e) => {
      const data = JSON.parse(e.data);
      updatePage(data.page_number, { text: data.text });
    });

    es.addEventListener('image_ready', (e) => {
      const data = JSON.parse(e.data);
      updatePage(data.page_number, { image_url: data.image_url });
    });

    es.addEventListener('narration_ready', (e) => {
      const data = JSON.parse(e.data);
      updatePage(data.page_number, { audio_url: data.audio_url });
    });

    es.addEventListener('story_complete', () => {
      setComplete(true);
      // Keep SSE open — image_ready/narration_ready events still incoming
    });

    es.addEventListener('stream_done', () => es.close());

    es.onerror = () => es.close();
    return () => es.close();
  }, [storyId]);

  // Reset audio when page changes
  useEffect(() => {
    setAudioPlaying(false);
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
  }, [current]);

  // Auto-play when current page becomes fully ready
  useEffect(() => {
    const audioUrl = pageMap[current]?.audio_url;
    if (!audioUrl || autoPlayedRef.current.has(current)) return;
    autoPlayedRef.current.add(current);
    const audio = new Audio(audioUrl);
    audioRef.current = audio;
    audio.play().catch(() => {}); // ignore autoplay policy blocks
    setAudioPlaying(true);
    audio.onended = () => {
      setAudioPlaying(false);
      setCurrent((p) => {
        const totalNow = Object.keys(pageMap).length;
        return p < totalNow ? p + 1 : p;
      });
    };
  }, [pageMap, current]);

  // Read narration preference set at form time — stable for the session
  const narrationEnabled =
    typeof window !== 'undefined'
      ? localStorage.getItem('storytime_narration') !== 'false'
      : true;

  const totalPages = Object.keys(pageMap).length;
  const page = pageMap[current];
  const nextPage = pageMap[current + 1];
  const nextReady = !!nextPage?.text;
  const isLast = complete && current === totalPages;

  // Hold the loader until page 1 has ALL its assets (text + image + audio if narration on).
  // After that, pages 2+ are shown as soon as their text arrives; images/audio load in place.
  const page1 = pageMap[1];
  const firstPageReady = !!(
    page1?.text &&
    page1?.image_url &&
    (!narrationEnabled || page1?.audio_url)
  );

  const handlePlay = () => {
    if (!page?.audio_url) return;
    const audio = new Audio(page.audio_url);
    audioRef.current = audio;
    audio.play();
    setAudioPlaying(true);
    audio.onended = () => {
      setAudioPlaying(false);
      if (!isLast) setCurrent((p) => p + 1);
    };
  };

  if (!firstPageReady) {
    return <StoryLoader />;
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-6 md:p-16">
      <div className="w-full max-w-2xl flex flex-col items-center gap-8">

        <span className="text-sm text-[--color-muted] tracking-widest uppercase">
          Page {current} of {totalPages}{complete ? '' : '...'}
        </span>

        <div className="w-full aspect-video rounded-2xl overflow-hidden bg-[--color-card]">
          {page.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={page.image_url}
              alt={`Page ${current}`}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full animate-pulse flex items-center justify-center">
              <span className="text-[--color-muted] text-sm tracking-wide">Illustrating…</span>
            </div>
          )}
        </div>

        <p className="text-2xl md:text-3xl leading-relaxed text-center text-[--color-foreground] font-light min-h-40">
          {page.text}
        </p>

        {page?.audio_url && (
          <button
            onClick={handlePlay}
            disabled={audioPlaying}
            className="flex items-center gap-2 px-5 py-2 rounded-full border border-[--color-accent] text-[--color-accent] hover:bg-[--color-accent] hover:text-[--color-background] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {audioPlaying ? (
              <>
                <span className="w-2 h-2 rounded-full bg-current animate-pulse" />
                Playing...
              </>
            ) : (
              <>▶ Listen</>
            )}
          </button>
        )}

        {isLast && (
          <p className="text-[--color-accent] text-2xl font-bold italic">The End</p>
        )}

        <div className="flex items-center gap-6 mt-4">
          <button
            onClick={() => setCurrent((p) => p - 1)}
            disabled={current === 1}
            className="px-6 py-2 rounded-full border border-[--color-border] text-[--color-muted] hover:border-[--color-accent] hover:text-[--color-accent] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Prev
          </button>
          <button
            onClick={() => setCurrent((p) => p + 1)}
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
