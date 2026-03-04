'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

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
  const [selecting, setSelecting] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!storyId) return;

    const es = new EventSource(`${process.env.NEXT_PUBLIC_API_URL}/stream/${storyId}`);

    es.addEventListener('seed_options', (e) => {
      const data = JSON.parse(e.data);
      setSeeds(data.seeds);
      setLoading(false);
      es.close();
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

    return () => es.close();
  }, [storyId]);

  const handleSelect = async (seedId: string) => {
    setSelecting(seedId);
    await fetch(`${process.env.NEXT_PUBLIC_API_URL}/story/${storyId}/select`, {
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
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-4 p-6">
        <div className="w-10 h-10 rounded-full border-2 border-[--color-accent] border-t-transparent animate-spin" />
        <p className="text-[--color-muted]">Dreaming up your story seeds...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen p-6 md:p-12">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-[--color-accent] mb-2 text-center">Choose Your Story</h1>
        <p className="text-[--color-muted] text-center mb-10">
          Pick the adventure that feels just right for tonight
        </p>

        <div className="grid md:grid-cols-3 gap-6">
          {seeds.map((seed) => (
            <div
              key={seed.seed_id}
              className="rounded-2xl bg-[--color-card] border border-[--color-border] p-6 flex flex-col gap-4 hover:border-[--color-accent] transition-colors"
            >
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
          ))}
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
