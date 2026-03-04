'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!storyId) return;

    const eventSource = new EventSource(
      `${process.env.NEXT_PUBLIC_API_URL}/stream/${storyId}`
    );

    eventSource.addEventListener('seed_options', (e) => {
      const data = JSON.parse(e.data);
      setSeeds(data.seeds);
      setLoading(false);
      eventSource.close();
    });

    eventSource.onerror = () => {
      setLoading(false);
      eventSource.close();
    };

    return () => eventSource.close();
  }, [storyId]);

  const handleSelect = async (seedId: string) => {
    await fetch(`${process.env.NEXT_PUBLIC_API_URL}/story/${storyId}/select`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seed_id: seedId }),
    });
    router.push(`/story/${storyId}`);
  };

  if (loading) return <p>Generating story ideas...</p>;

  return (
    <main>
      <h1>Choose a story</h1>
      <ul>
        {seeds.map((seed) => (
          <li key={seed.seed_id}>
            <h2>{seed.title}</h2>
            <p>{seed.setting}</p>
            <p>{seed.synopsis}</p>
            <p>Values: {seed.values.join(', ')}</p>
            <button onClick={() => handleSelect(seed.seed_id)}>
              Choose this story
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}

export default function SelectPage() {
  return (
    <Suspense fallback={<p>Loading...</p>}>
      <SelectPageInner />
    </Suspense>
  );
}
