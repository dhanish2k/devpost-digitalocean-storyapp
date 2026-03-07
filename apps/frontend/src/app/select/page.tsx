'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import API_URL from '@/lib/api';
import StoryLoader from '@/components/StoryLoader';

interface SeedOption {
  seed_id: string;
  title: string;
  setting: string;
  values: string[];
  synopsis: string;
}

function SelectPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const storyId = searchParams.get('story_id');

  const [seeds, setSeeds] = useState<SeedOption[]>([]);
  const [seedImages, setSeedImages] = useState<Record<string, string>>({});
  const [selecting, setSelecting] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!storyId) return;

    const es = new EventSource(`${API_URL}/stream/${storyId}`);

    es.addEventListener('seed_options', (e) => {
      const data = JSON.parse(e.data);
      setSeeds(data.seeds);
      // Stay on loader — wait for images before revealing tiles
    });

    es.addEventListener('seed_image_ready', (e) => {
      const data = JSON.parse(e.data);
      setSeedImages((prev) => {
        const next = { ...prev, [data.seed_id]: data.image_url };
        if (Object.keys(next).length >= 3) {
          setLoading(false);
          es.close();
        }
        return next;
      });
    });

    es.addEventListener('error', (e) => {
      const data = JSON.parse((e as MessageEvent).data);
      setErrorMsg(data.message ?? 'Something went wrong generating story seeds.');
      setLoading(false);
      es.close();
    });

    es.onerror = () => {
      setErrorMsg('Lost connection to the server. Please go back and try again.');
      setLoading(false);
      es.close();
    };

    // Safety: if seeds arrived but some images failed, show after 30s anyway
    const fallback = setTimeout(() => {
      setSeeds((s) => { if (s.length > 0) setLoading(false); return s; });
    }, 30_000);

    return () => { es.close(); clearTimeout(fallback); };
  }, [storyId]);

  const handleSelect = async (seedId: string) => {
    setSelecting(seedId);
    await fetch(`${API_URL}/story/${storyId}/select`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seed_id: seedId }),
    });
    router.push(`/story/${storyId}`);
  };

  if (errorMsg) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-4 p-6">
        <p className="text-red-400 text-center max-w-md">{errorMsg}</p>
      </main>
    );
  }

  if (loading) {
    return <StoryLoader />;
  }

  return (
    <main className="min-h-screen p-6 md:p-12">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-[--color-accent] mb-2 text-center">Choose Your Story</h1>
        <p className="text-[--color-muted] text-center mb-10">
          Pick the adventure that feels just right for tonight
        </p>

        <div className="grid md:grid-cols-3 gap-6">
          {seeds.map((seed) => {
            const imageUrl = seedImages[seed.seed_id];
            return (
              <div
                key={seed.seed_id}
                className="rounded-2xl bg-[--color-card] border border-[--color-border] flex flex-col hover:border-[--color-accent] transition-colors overflow-hidden"
              >
                {/* Image area */}
                <div className="w-full aspect-video bg-[--color-border] relative overflow-hidden">
                  {imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={imageUrl}
                      alt={seed.title}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full animate-pulse bg-gradient-to-br from-[--color-border] to-[--color-card]" />
                  )}
                </div>

                {/* Content */}
                <div className="p-6 flex flex-col gap-4 flex-1">
                  <div>
                    <span className="text-xs font-medium text-[--color-accent] uppercase tracking-wider">
                      {seed.setting}
                    </span>
                    <h2 className="text-xl font-bold text-[--color-foreground] mt-1">{seed.title}</h2>
                  </div>

                  <p className="text-[--color-muted] text-sm leading-relaxed flex-1">{seed.synopsis}</p>

                  <div className="flex flex-wrap gap-1">
                    {seed.values.map((v) => (
                      <span
                        key={v}
                        className="text-xs px-2 py-0.5 rounded-full bg-[--color-border] text-[--color-muted]"
                      >
                        {v}
                      </span>
                    ))}
                  </div>

                  <button
                    onClick={() => handleSelect(seed.seed_id)}
                    disabled={selecting !== null}
                    className="w-full rounded-lg bg-[--color-accent] text-[--color-background] font-semibold py-2.5 hover:opacity-90 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {selecting === seed.seed_id ? 'Starting...' : 'Choose this story'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </main>
  );
}

export default function SelectPage() {
  return (
    <Suspense fallback={
      <main className="min-h-screen flex items-center justify-center">
        <p className="text-[--color-muted]">Loading...</p>
      </main>
    }>
      <SelectPageInner />
    </Suspense>
  );
}
