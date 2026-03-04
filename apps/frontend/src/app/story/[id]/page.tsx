'use client';

import { useEffect, useRef, useState } from 'react';
import { use } from 'react';

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
  const [currentPage, setCurrentPage] = useState(0);
  const [complete, setComplete] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const eventSource = new EventSource(
      `${process.env.NEXT_PUBLIC_API_URL}/stream/${storyId}`
    );
    eventSourceRef.current = eventSource;

    eventSource.addEventListener('story_page', (e) => {
      const data = JSON.parse(e.data);
      setPages((prev) => [...prev, { page_number: data.page_number, text: data.text }]);
    });

    eventSource.addEventListener('image_ready', (e) => {
      const data = JSON.parse(e.data);
      setAssets((prev) => ({
        ...prev,
        [data.page_number]: { ...prev[data.page_number], image_url: data.image_url },
      }));
    });

    eventSource.addEventListener('narration_ready', (e) => {
      const data = JSON.parse(e.data);
      setAssets((prev) => ({
        ...prev,
        [data.page_number]: { ...prev[data.page_number], audio_url: data.audio_url },
      }));
    });

    eventSource.addEventListener('story_complete', () => {
      setComplete(true);
      eventSource.close();
    });

    eventSource.onerror = () => eventSource.close();

    return () => eventSource.close();
  }, [storyId]);

  const page = pages[currentPage];
  const pageAssets = page ? assets[page.page_number] : undefined;

  return (
    <main>
      {pages.length === 0 ? (
        <p>Your story is being created...</p>
      ) : (
        <>
          {pageAssets?.image_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={pageAssets.image_url} alt={`Page ${page.page_number}`} />
          )}
          <p>{page?.text}</p>
          {pageAssets?.audio_url && (
            <audio
              src={pageAssets.audio_url}
              autoPlay
              onEnded={() => setCurrentPage((p) => Math.min(p + 1, pages.length - 1))}
            />
          )}
          <div>
            <button
              onClick={() => setCurrentPage((p) => Math.max(p - 1, 0))}
              disabled={currentPage === 0}
            >
              Previous
            </button>
            <span>Page {currentPage + 1} of {pages.length}</span>
            <button
              onClick={() => setCurrentPage((p) => Math.min(p + 1, pages.length - 1))}
              disabled={currentPage === pages.length - 1}
            >
              Next
            </button>
          </div>
          {complete && currentPage === pages.length - 1 && <p>The End</p>}
        </>
      )}
    </main>
  );
}
