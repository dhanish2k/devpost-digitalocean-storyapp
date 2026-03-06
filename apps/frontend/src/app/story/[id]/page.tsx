'use client';

import { use, useEffect, useRef, useState } from 'react';
import API_URL from '@/lib/api';

interface StoryPage {
  page_number: number;
  text: string;
}

interface PageAssets {
  image_url?: string;
  audio_url?: string;
}

export default function StoryReaderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: storyId } = use(params);
  const [pages, setPages] = useState<StoryPage[]>([]);
  const [assets, setAssets] = useState<Record<number, PageAssets>>({});
  const [current, setCurrent] = useState(0);
  const [complete, setComplete] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const es = new EventSource(`${API_URL}/stream/${storyId}`);
    esRef.current = es;

    es.addEventListener('story_page', (e) => {
      const data = JSON.parse(e.data);
      setPages((prev) => [...prev, { page_number: data.page_number, text: data.text }]);
    });

    es.addEventListener('image_ready', (e) => {
      const data = JSON.parse(e.data);
      setAssets((prev) => ({
        ...prev,
        [data.page_number]: { ...prev[data.page_number], image_url: data.image_url },
      }));
    });

    es.addEventListener('narration_ready', (e) => {
      const data = JSON.parse(e.data);
      setAssets((prev) => ({
        ...prev,
        [data.page_number]: { ...prev[data.page_number], audio_url: data.audio_url },
      }));
    });

    es.addEventListener('story_complete', () => {
      setComplete(true);
      es.close();
    });

    es.onerror = () => es.close();

    return () => es.close();
  }, [storyId]);

  const page = pages[current];
  const pageAssets = page ? assets[page.page_number] : undefined;
  const isFirst = current === 0;
  const isLast = current === pages.length - 1;

  if (pages.length === 0) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-4 p-6">
        <div className="w-10 h-10 rounded-full border-2 border-[--color-accent] border-t-transparent animate-spin" />
        <p className="text-[--color-muted]">Your story is being written...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-6 md:p-16">
      <div className="w-full max-w-2xl flex flex-col items-center gap-8">

        <span className="text-sm text-[--color-muted] tracking-widest uppercase">
          Page {current + 1} of {pages.length}{complete ? '' : '...'}
        </span>

        {pageAssets?.image_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={pageAssets.image_url}
            alt={`Page ${page.page_number}`}
            className="w-full rounded-2xl object-cover max-h-72"
          />
        )}

        <p className="text-2xl md:text-3xl leading-relaxed text-center text-[--color-foreground] font-light min-h-40">
          {page?.text}
        </p>

        {pageAssets?.audio_url && (
          <audio
            src={pageAssets.audio_url}
            autoPlay
            onEnded={() => setCurrent((p) => Math.min(p + 1, pages.length - 1))}
          />
        )}

        {complete && isLast && (
          <p className="text-[--color-accent] text-2xl font-bold italic">The End</p>
        )}

        <div className="flex items-center gap-6 mt-4">
          <button
            onClick={() => setCurrent((p) => Math.max(p - 1, 0))}
            disabled={isFirst}
            className="px-6 py-2 rounded-full border border-[--color-border] text-[--color-muted] hover:border-[--color-accent] hover:text-[--color-accent] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Prev
          </button>
          <button
            onClick={() => setCurrent((p) => Math.min(p + 1, pages.length - 1))}
            disabled={isLast}
            className="px-6 py-2 rounded-full border border-[--color-border] text-[--color-muted] hover:border-[--color-accent] hover:text-[--color-accent] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Next
          </button>
        </div>
      </div>
    </main>
  );
}
