'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import API_URL from '@/lib/api';

export default function HomePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    child_name: '',
    child_age: '5',
    description: '',
    values: '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/story`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          child_name: form.child_name,
          child_age: parseInt(form.child_age),
          description: form.description,
          values: form.values.split(',').map((v) => v.trim()).filter(Boolean),
        }),
      });
      const data = await res.json();
      router.push(`/select?story_id=${data.story_id}`);
    } catch (error) {
      console.error('Failed to start story:', error);
      setLoading(false);
    }
  };

  const field =
    'w-full rounded-lg bg-[--color-card] border border-[--color-border] px-4 py-3 ' +
    'text-[--color-foreground] placeholder:text-[--color-muted] ' +
    'focus:outline-none focus:border-[--color-accent] transition-colors';
  const label = 'block text-sm font-medium text-[--color-muted] mb-1';

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-lg">
        <div className="text-center mb-10">
          <h1 className="text-4xl font-bold text-[--color-accent] mb-2">Storytime</h1>
          <p className="text-[--color-muted]">A personalised bedtime story, just for your child</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className={label}>Child&apos;s name</label>
            <input
              required
              className={field}
              placeholder="Emma"
              value={form.child_name}
              onChange={(e) => setForm({ ...form, child_name: e.target.value })}
            />
          </div>

          <div>
            <label className={label}>Age</label>
            <input
              type="number" min={2} max={12} required
              className={field}
              value={form.child_age}
              onChange={(e) => setForm({ ...form, child_age: e.target.value })}
            />
          </div>

          <div>
            <label className={label}>What happened today?</label>
            <textarea
              required rows={3}
              className={`${field} resize-none`}
              placeholder="She had a tough day, felt left out at lunch and nobody would sit with her."
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>

          <div>
            <label className={label}>
              Values to explore{' '}
              <span className="font-normal">(comma-separated)</span>
            </label>
            <input
              className={field}
              placeholder="kindness, courage, friendship"
              value={form.values}
              onChange={(e) => setForm({ ...form, values: e.target.value })}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-[--color-accent] text-[--color-background] font-semibold py-3 mt-2 hover:opacity-90 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Crafting your story seeds...' : 'Create My Story'}
          </button>
        </form>
      </div>
    </main>
  );
}
