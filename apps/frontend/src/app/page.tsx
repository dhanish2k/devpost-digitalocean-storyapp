'use client';

import { useSyncExternalStore } from 'react';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import API_URL from '@/lib/api';

const AVATARS = [
  { id: 'knight',   emoji: '🤺',  label: 'Knight',   gender: 'boy',     archetype: 'brave knight'         },
  { id: 'hero',     emoji: '🦸',  label: 'Hero',     gender: 'boy',     archetype: 'daring superhero'      },
  { id: 'fairy',    emoji: '🧚',  label: 'Fairy',    gender: 'girl',    archetype: 'magical fairy'         },
  { id: 'princess', emoji: '👸',  label: 'Princess', gender: 'girl',    archetype: 'adventurous princess'  },
  { id: 'wizard',   emoji: '🧙',  label: 'Wizard',   gender: 'neutral', archetype: 'wise young wizard'     },
  { id: 'explorer', emoji: '🧑‍🚀', label: 'Explorer', gender: 'neutral', archetype: 'curious explorer'      },
] as const;

const LENGTHS = [
  { id: 'short',  label: 'Short',  hint: '~2 min',  pages: 3 },
  { id: 'medium', label: 'Medium', hint: '~5 min',  pages: 5 },
  { id: 'long',   label: 'Long',   hint: '~10 min', pages: 8 },
] as const;

const LANGUAGES = [
  { id: 'en', label: 'English',  flag: '🇬🇧' },
  { id: 'es', label: 'Español', flag: '🇪🇸' },
] as const;


const LS_NAME      = 'storytime_child_name';
const LS_AGE       = 'storytime_child_age';
const LS_AVATAR    = 'storytime_child_avatar';
const LS_LENGTH    = 'storytime_story_length';
const LS_NARRATION = 'storytime_narration';
const LS_LANGUAGE  = 'storytime_language';

// ---------------------------------------------------------------------------
// useSyncExternalStore-based localStorage hooks
// Avoids setState-in-effect, avoids hydration mismatch (server snapshot = default)
// ---------------------------------------------------------------------------
const _subs = new Map<string, Set<() => void>>();

function lsSubscribe(key: string, cb: () => void) {
  if (!_subs.has(key)) _subs.set(key, new Set());
  _subs.get(key)!.add(cb);
  const onStorage = (e: StorageEvent) => { if (e.key === key) cb(); };
  window.addEventListener('storage', onStorage);
  return () => {
    _subs.get(key)?.delete(cb);
    window.removeEventListener('storage', onStorage);
  };
}

function lsNotify(key: string) { _subs.get(key)?.forEach(fn => fn()); }

function useLsString(key: string, def: string): [string, (v: string) => void] {
  const value = useSyncExternalStore(
    cb  => lsSubscribe(key, cb),
    ()  => localStorage.getItem(key) ?? def,
    ()  => def,   // server snapshot — always returns default, no hydration mismatch
  );
  const set = (v: string) => { localStorage.setItem(key, v); lsNotify(key); };
  return [value, set];
}

function useLsNumber(key: string, def: number): [number, (n: number) => void] {
  const [str, setStr] = useLsString(key, String(def));
  return [parseInt(str, 10) || def, (n) => setStr(String(n))];
}

function useLsBool(key: string, def: boolean): [boolean, (b: boolean) => void] {
  const [str, setStr] = useLsString(key, String(def));
  return [str !== 'false', (b) => setStr(String(b))];
}

// ---------------------------------------------------------------------------

const inputClass =
  'w-full rounded-lg bg-[--color-background] border border-[--color-border] px-4 py-3 ' +
  'text-[--color-foreground] placeholder:text-[--color-muted] ' +
  'focus:outline-none focus:border-[--color-accent] transition-colors';
const labelClass = 'block text-sm font-medium text-[--color-muted] mb-1';

export default function HomePage() {
  const router = useRouter();
  const [loading, setLoading]         = useState(false);
  const [name, setName]               = useLsString(LS_NAME,      '');
  const [age,  setAge]                = useLsNumber(LS_AGE,       7);
  const [avatar, setAvatar]           = useLsString(LS_AVATAR,    '');
  const [storyLength, setStoryLength] = useLsString(LS_LENGTH,    'medium');
  const [narration, setNarration]     = useLsBool  (LS_NARRATION, true);
  const [language,  setLanguage]      = useLsString(LS_LANGUAGE,  'en');
  const [description, setDescription] = useState('');

  const selectedAvatar = AVATARS.find(a => a.id === avatar);
  const gender    = selectedAvatar?.gender    ?? null;
  const archetype = selectedAvatar?.archetype ?? null;
  const sliderFill = ((age - 4) / (11 - 4)) * 100;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/story`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          child_name: name,
          child_age: age,
          description,
          values: [],
          child_gender: gender,
          child_archetype: archetype,
          story_length: storyLength,
          narration_enabled: narration,
          language,
        }),
      });
      const data = await res.json();
      router.push(`/select?story_id=${data.story_id}`);
    } catch (error) {
      console.error('Failed to start story:', error);
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-xl">

        <div className="text-center mb-10">
          <div className="text-5xl mb-3">🌙</div>
          <h1 className="text-4xl font-bold text-[--color-accent] mb-2">Storytime</h1>
          <p className="text-[--color-muted]">A personalised bedtime story, just for your child</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">

          {/* Child profile card */}
          <div className="rounded-xl bg-[--color-card] border border-[--color-border] p-5 space-y-5">

            {/* Name */}
            <div>
              <label className={labelClass}>Child&apos;s name</label>
              <input
                required
                className={inputClass}
                placeholder="Emma"
                value={name}
                onChange={e => setName(e.target.value)}
              />
            </div>

            {/* Avatar picker */}
            <div>
              <label className={labelClass}>
                Tonight&apos;s hero
                {selectedAvatar && (
                  <span className="ml-2 font-semibold text-[--color-accent]">
                    — {selectedAvatar.label}
                  </span>
                )}
              </label>
              <div className="grid grid-cols-6 gap-2 mt-2">
                {AVATARS.map(av => (
                  <button
                    key={av.id}
                    type="button"
                    onClick={() => setAvatar(av.id)}
                    title={av.label}
                    className={[
                      'flex flex-col items-center gap-1 rounded-xl p-3 border transition-all',
                      avatar === av.id
                        ? 'border-[--color-accent] bg-[--color-accent]/10 scale-105 shadow-[0_0_12px_rgba(232,168,56,0.25)]'
                        : 'border-[--color-border] hover:border-[--color-accent]/40 hover:bg-[--color-accent]/5',
                    ].join(' ')}
                  >
                    <span className="text-2xl leading-none">{av.emoji}</span>
                    <span className="text-[10px] text-[--color-muted] leading-none tracking-wide">
                      {av.label}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Age slider */}
            <div>
              <div className="flex justify-between items-baseline mb-3">
                <label className={labelClass.replace(' mb-1', '')}>Age</label>
                <span className="text-xl font-bold text-[--color-accent] tabular-nums">
                  {age}{' '}
                  <span className="text-sm font-normal text-[--color-muted]">yrs</span>
                </span>
              </div>
              <input
                type="range"
                min={4} max={11} step={1}
                value={age}
                onChange={e => setAge(parseInt(e.target.value, 10))}
                className="storytime-slider w-full"
                style={{
                  background: `linear-gradient(to right, var(--accent) ${sliderFill}%, var(--border) ${sliderFill}%)`,
                }}
              />
              <div className="flex justify-between mt-1.5 px-0.5">
                {[4,5,6,7,8,9,10,11].map(n => (
                  <span
                    key={n}
                    className={`text-[10px] transition-colors ${
                      n === age ? 'text-[--color-accent] font-bold' : 'text-[--color-muted]'
                    }`}
                  >
                    {n}
                  </span>
                ))}
              </div>
            </div>

          </div>

          {/* Story details card */}
          <div className="rounded-xl bg-[--color-card] border border-[--color-border] p-5 space-y-5">

            <div>
              <label className={labelClass}>What happened today?</label>
              <textarea
                required
                rows={3}
                className={`${inputClass} resize-none`}
                placeholder="She had a tough day at school — felt left out at lunch and nobody sat with her."
                value={description}
                onChange={e => setDescription(e.target.value)}
              />
            </div>

            {/* Story length */}
            <div>
              <label className={labelClass}>Story length</label>
              <div className="grid grid-cols-3 gap-2 mt-1">
                {LENGTHS.map(opt => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setStoryLength(opt.id)}
                    className="flex flex-col items-center py-3 rounded-lg border-2 transition-all"
                    style={storyLength === opt.id ? {
                      borderColor: 'var(--color-accent)',
                      backgroundColor: 'rgba(232,168,56,0.15)',
                      boxShadow: '0 0 10px rgba(232,168,56,0.25)',
                    } : {
                      borderColor: 'var(--color-border)',
                    }}
                  >
                    <span className="text-sm font-semibold" style={{ color: storyLength === opt.id ? 'var(--color-accent)' : 'var(--color-muted)' }}>
                      {opt.label}
                    </span>
                    <span className="text-[11px] text-[--color-muted] mt-0.5">{opt.hint}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Narration toggle */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-[--color-foreground]">Auto-narration</p>
                <p className="text-[11px] text-[--color-muted]">Read the story aloud as it generates</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={narration}
                onClick={() => setNarration(!narration)}
                className="relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none"
                style={{ backgroundColor: narration ? 'var(--color-accent)' : 'var(--color-border)' }}
              >
                <span
                  className={[
                    'pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow',
                    'transform transition-transform duration-200',
                    narration ? 'translate-x-5' : 'translate-x-0',
                  ].join(' ')}
                />
              </button>
            </div>

            {/* Language selector */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-[--color-foreground]">Story language</p>
                <p className="text-[11px] text-[--color-muted]">Narration &amp; text language</p>
              </div>
              <div className="flex gap-2">
                {LANGUAGES.map(lang => (
                  <button
                    key={lang.id}
                    type="button"
                    onClick={() => setLanguage(lang.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border-2 text-sm font-medium transition-all"
                    style={language === lang.id ? {
                      borderColor: 'var(--color-accent)',
                      backgroundColor: 'var(--color-accent)',
                      color: 'var(--color-background)',
                    } : {
                      borderColor: 'var(--color-border)',
                      color: 'var(--color-muted)',
                    }}
                  >
                    <span>{lang.flag}</span>
                    <span>{lang.label}</span>
                  </button>
                ))}
              </div>
            </div>

          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-[--color-accent] text-[--color-background] font-semibold py-4 mt-2 hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed text-lg tracking-wide"
          >
            {loading ? 'Crafting your story seeds...' : 'Create My Story'}
          </button>

        </form>
      </div>
    </main>
  );
}
