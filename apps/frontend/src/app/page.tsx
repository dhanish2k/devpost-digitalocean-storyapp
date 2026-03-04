'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function PromptPage() {
  const router = useRouter();
  const [childName, setChildName] = useState('');
  const [childAge, setChildAge] = useState('');
  const [description, setDescription] = useState('');
  const [values, setValues] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/story`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          child_name: childName,
          child_age: parseInt(childAge),
          description,
          values: values.split(',').map((v) => v.trim()).filter(Boolean),
        }),
      });
      const data = await response.json();
      router.push(`/select?story_id=${data.story_id}`);
    } catch (error) {
      console.error('Failed to start story:', error);
      setLoading(false);
    }
  };

  return (
    <main>
      <h1>Create a story for your child</h1>
      <form onSubmit={handleSubmit}>
        <label>
          Child&apos;s name
          <input
            value={childName}
            onChange={(e) => setChildName(e.target.value)}
            required
          />
        </label>
        <label>
          Age
          <input
            type="number"
            min={2}
            max={12}
            value={childAge}
            onChange={(e) => setChildAge(e.target.value)}
            required
          />
        </label>
        <label>
          What happened today?
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. had a tough day, argued with best friend at school"
            required
          />
        </label>
        <label>
          Values to explore (comma-separated)
          <input
            value={values}
            onChange={(e) => setValues(e.target.value)}
            placeholder="e.g. empathy, forgiveness, courage"
          />
        </label>
        <button type="submit" disabled={loading}>
          {loading ? 'Creating your story...' : 'Create story'}
        </button>
      </form>
    </main>
  );
}
