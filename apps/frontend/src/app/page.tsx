'use client';

import { useSyncExternalStore } from 'react';
import { useState, useEffect, useRef } from 'react';
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
  { id: 'short',  label: 'Short',  duration: '2-minute',  pages: 3 },
  { id: 'medium', label: 'Medium', duration: '5-minute',  pages: 5 },
  { id: 'long',   label: 'Long',   duration: '10-minute', pages: 8 },
] as const;

const LANGUAGES = [
  { id: 'en', label: 'English', flag: '🇬🇧' },
  { id: 'es', label: 'Español', flag: '🇪🇸' },
] as const;

const LS_NAME      = 'storytime_child_name';
const LS_AGE       = 'storytime_child_age';
const LS_AVATAR    = 'storytime_child_avatar';
const LS_LENGTH    = 'storytime_story_length';
const LS_NARRATION = 'storytime_narration';
const LS_LANGUAGE  = 'storytime_language';

// ---------------------------------------------------------------------------
// useSyncExternalStore localStorage hooks — no hydration mismatch
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
    cb => lsSubscribe(key, cb),
    ()  => localStorage.getItem(key) ?? def,
    ()  => def,
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

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="14" height="14" viewBox="0 0 16 16" fill="none"
      className={`shrink-0 transition-transform duration-200 text-[--color-muted] ${open ? 'rotate-180' : ''}`}
    >
      <path d="M3 6l5 5 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

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
  const [childIsHero, setChildIsHero] = useState(false);
  const [heroGender,  setHeroGender]  = useState<'boy' | 'girl'>('boy');

  const [dayOpen,    setDayOpen]    = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [hintOpen,   setHintOpen]   = useState(false);
  const hintRef = useRef<HTMLDivElement>(null);

  // Always pick a fresh random hero each session
  useEffect(() => {
    const pick = AVATARS[Math.floor(Math.random() * AVATARS.length)];
    localStorage.setItem(LS_AVATAR, pick.id);
    lsNotify(LS_AVATAR);
  }, []);

  // When heroGender changes, swap to a gender-compatible avatar if current one doesn't match
  useEffect(() => {
    if (!childIsHero) return;
    const current = AVATARS.find(a => a.id === avatar);
    if (current && current.gender !== 'neutral' && current.gender !== heroGender) {
      const compatible = AVATARS.filter(a => a.gender === heroGender || a.gender === 'neutral');
      const pick = compatible[Math.floor(Math.random() * compatible.length)];
      setAvatar(pick.id);
    }
  }, [heroGender, childIsHero]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close hint tooltip on outside click
  useEffect(() => {
    if (!hintOpen) return;
    const handler = (e: MouseEvent) => {
      if (hintRef.current && !hintRef.current.contains(e.target as Node)) {
        setHintOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [hintOpen]);

  const selectedAvatar = AVATARS.find(a => a.id === avatar);
  const selectedLength = LENGTHS.find(l => l.id === storyLength) ?? LENGTHS[1];
  // When childIsHero is on, gender comes from the explicit picker; otherwise from avatar
  const gender    = childIsHero ? heroGender : (selectedAvatar?.gender ?? null);
  const archetype = selectedAvatar?.archetype ?? null;
  // Filter archetypes to gender-compatible ones when childIsHero is set
  const visibleAvatars = childIsHero
    ? AVATARS.filter(av => av.gender === heroGender || av.gender === 'neutral')
    : AVATARS;
  const sliderFill = ((age - 4) / (11 - 4)) * 100;

  // Natural-language summary for the collapsed Customise row
  const langLabel = language === 'es' ? 'Spanish' : 'English';
  const storySummary = [
    `A ${selectedLength.duration} adventure`,
    selectedAvatar ? `with the ${selectedAvatar.label}` : null,
    narration ? `narrated aloud in ${langLabel}` : `in ${langLabel}`,
  ].filter(Boolean).join(', ') + '.';

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
      <div className="w-full max-w-md">

        <div className="text-center mb-10">
          <div className="text-5xl mb-3">🌙</div>
          <h1 className="text-4xl font-bold text-[--color-accent] mb-2">Storytime</h1>
          <p className="text-[--color-muted]">A personalised bedtime ritual, just for your child</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">

          {/* ── Primary card ── */}
          <div className="rounded-xl bg-[--color-card] border border-[--color-border] p-5 space-y-5">

            {/* Name */}
            <div>
              <label className="block text-sm font-medium text-[--color-muted] mb-1">Child&apos;s name</label>
              <input
                required
                className={inputClass}
                placeholder="Emma"
                value={name}
                onChange={e => setName(e.target.value)}
              />
              {/* Hero checkbox */}
              <label className="flex items-center gap-2.5 mt-2.5 cursor-pointer select-none w-fit">
                <input
                  type="checkbox"
                  checked={childIsHero}
                  onChange={e => setChildIsHero(e.target.checked)}
                  className="w-4 h-4 rounded accent-[--color-accent] cursor-pointer"
                />
                <span className="text-xs text-[--color-muted]">
                  Make <span className="text-[--color-foreground] font-medium">{name || 'your child'}</span> the hero of the story
                </span>
              </label>
              {childIsHero && (
                <div className="mt-3 rounded-lg border border-[--color-border] bg-[--color-background] p-3">
                  <p className="text-[11px] text-[--color-muted] uppercase tracking-wider mb-2">Pronouns for the story</p>
                  <div className="grid grid-cols-2 gap-2">
                    {(['boy', 'girl'] as const).map(g => (
                      <button
                        key={g}
                        type="button"
                        onClick={() => setHeroGender(g)}
                        className="py-2 rounded-lg border-2 text-sm font-medium transition-all"
                        style={heroGender === g ? {
                          borderColor: 'var(--accent)',
                          backgroundColor: 'rgba(232,168,56,0.15)',
                          color: 'var(--accent)',
                          boxShadow: '0 0 10px rgba(232,168,56,0.15)',
                        } : {
                          borderColor: 'var(--border)',
                          color: 'var(--muted)',
                        }}
                      >
                        {g === 'boy' ? '👦  He / Boy' : '👧  She / Girl'}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Age slider */}
            <div>
              <div className="flex justify-between items-baseline mb-3">
                <label className="text-sm font-medium text-[--color-muted]">Age</label>
                <span className="text-xl font-bold text-[--color-accent] tabular-nums">
                  {age} <span className="text-sm font-normal text-[--color-muted]">yrs</span>
                </span>
              </div>
              <input
                type="range" min={4} max={11} step={1}
                value={age}
                onChange={e => setAge(parseInt(e.target.value, 10))}
                className="storytime-slider w-full"
                style={{ background: `linear-gradient(to right, var(--accent) ${sliderFill}%, var(--border) ${sliderFill}%)` }}
              />
              <div className="flex justify-between mt-1.5 px-0.5">
                {[4,5,6,7,8,9,10,11].map(n => (
                  <span key={n} className={`text-[10px] transition-colors ${n === age ? 'text-[--color-accent] font-bold' : 'text-[--color-muted]'}`}>
                    {n}
                  </span>
                ))}
              </div>
            </div>

            {/* What happened today — collapsible, amber-accented to signal importance */}
            <div className="rounded-lg" style={{
              border: '1px solid rgba(232,168,56,0.35)',
              borderLeft: '3px solid var(--accent)',
              backgroundColor: 'rgba(232,168,56,0.04)',
            }}>
              <div
                role="button"
                tabIndex={0}
                onClick={() => setDayOpen(o => !o)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setDayOpen(o => !o); }}
                className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-white/[0.02] transition-colors text-left gap-3 rounded-lg cursor-pointer"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[--color-foreground] flex items-center gap-2">
                    Had a significant day?
                    {description && <span className="w-1.5 h-1.5 rounded-full bg-[--color-accent] shrink-0" />}
                  </p>
                  <p className="text-xs mt-0.5 truncate" style={{ color: 'rgba(232,168,56,0.7)' }}>
                    {description
                      ? description.slice(0, 52) + (description.length > 52 ? '…' : '')
                      : 'Add details to weave today into the story'}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {/* Hint button */}
                  <div ref={hintRef} className="relative">
                    <button
                      type="button"
                      onClick={e => { e.stopPropagation(); setHintOpen(o => !o); }}
                      aria-label="About this field"
                      className="w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold border-2 transition-all"
                      style={hintOpen ? {
                        borderColor: 'var(--accent)',
                        backgroundColor: 'rgba(232,168,56,0.2)',
                        color: 'var(--accent)',
                      } : {
                        borderColor: 'rgba(232,168,56,0.4)',
                        color: 'rgba(232,168,56,0.6)',
                        backgroundColor: 'transparent',
                      }}
                    >
                      ?
                    </button>
                    {hintOpen && (
                      <div
                        className="absolute bottom-full right-0 mb-3 w-72 rounded-2xl text-left z-20"
                        style={{
                          backgroundColor: '#1e1c2e',
                          border: '1px solid rgba(232,168,56,0.25)',
                          boxShadow: '0 12px 40px rgba(0,0,0,0.7), 0 0 0 1px rgba(232,168,56,0.08)',
                        }}
                      >
                        <div className="px-4 pt-4 pb-3 border-b" style={{ borderColor: 'rgba(232,168,56,0.15)' }}>
                          <div className="flex items-center gap-2">
                            <span className="text-base">📖</span>
                            <p className="text-sm font-semibold text-[--color-accent]">Story journal</p>
                          </div>
                        </div>
                        <p className="px-4 py-3 text-xs text-[--color-muted] leading-relaxed">
                          What you share here weaves directly into tonight&apos;s story. Over time these notes
                          build a journal — the story creator draws from it to make each story feel like it truly
                          belongs to <span className="text-[--color-foreground]">your child</span>.
                        </p>
                        <span
                          className="absolute -bottom-1.5 right-3 w-3 h-3 rotate-45"
                          style={{
                            backgroundColor: '#1e1c2e',
                            borderRight: '1px solid rgba(232,168,56,0.25)',
                            borderBottom: '1px solid rgba(232,168,56,0.25)',
                          }}
                        />
                      </div>
                    )}
                  </div>
                  <Chevron open={dayOpen} />
                </div>
              </div>

              {dayOpen && (
                <div className="px-4 pb-4 pt-1" style={{ borderTop: '1px solid rgba(232,168,56,0.15)' }}>
                  <textarea
                    rows={3}
                    className={`${inputClass} resize-none mt-2`}
                    placeholder="She had a tough day at school — felt left out at lunch and nobody sat with her."
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    autoFocus
                  />
                </div>
              )}
            </div>

          </div>

          {/* ── Customise — collapsible ── */}
          <div className="rounded-xl bg-[--color-card] border border-[--color-border] overflow-hidden">
            <button
              type="button"
              onClick={() => setCustomOpen(o => !o)}
              className="w-full flex items-center justify-between px-5 py-4 hover:bg-white/[0.03] transition-colors text-left gap-3"
            >
              <div className="min-w-0">
                <p className="text-sm text-[--color-foreground] leading-snug">{storySummary}</p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--accent)', opacity: 0.75 }}>
                  {customOpen ? 'Hide options' : 'Choose a different journey here? →'}
                </p>
              </div>
              <Chevron open={customOpen} />
            </button>

            {customOpen && (
              <div className="px-5 pb-5 border-t border-[--color-border] space-y-5 pt-4">

                {/* Hero picker */}
                <div>
                  <p className="text-sm font-medium text-[--color-muted] mb-2">
                    Tonight&apos;s hero
                    {selectedAvatar && (
                      <span className="ml-2 font-semibold text-[--color-accent]">{selectedAvatar.label}</span>
                    )}
                  </p>
                  <div className="grid grid-cols-6 gap-2">
                    {visibleAvatars.map(av => {
                      const selected = avatar === av.id;
                      return (
                        <button
                          key={av.id}
                          type="button"
                          onClick={() => setAvatar(av.id)}
                          title={av.label}
                          className="flex flex-col items-center gap-1.5 rounded-xl pt-3 pb-2.5 border-2 transition-all duration-150"
                          style={selected ? {
                            borderColor: 'var(--accent)',
                            backgroundColor: 'rgba(232,168,56,0.18)',
                            boxShadow: '0 0 0 1px rgba(232,168,56,0.35), 0 0 14px rgba(232,168,56,0.18)',
                            transform: 'scale(1.06)',
                          } : { borderColor: 'var(--border)' }}
                        >
                          <span className="text-3xl leading-none">{av.emoji}</span>
                          <span className="text-[10px] leading-none tracking-wide font-medium"
                            style={{ color: selected ? 'var(--accent)' : 'var(--muted)' }}>
                            {av.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Story length */}
                <div>
                  <p className="text-sm font-medium text-[--color-muted] mb-2">Story length</p>
                  <div className="grid grid-cols-3 gap-2">
                    {LENGTHS.map(opt => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setStoryLength(opt.id)}
                        className="flex flex-col items-center py-3 rounded-lg border-2 transition-all"
                        style={storyLength === opt.id ? {
                          borderColor: 'var(--color-accent)',
                          backgroundColor: 'rgba(232,168,56,0.15)',
                          boxShadow: '0 0 10px rgba(232,168,56,0.2)',
                        } : { borderColor: 'var(--color-border)' }}
                      >
                        <span className="text-sm font-semibold"
                          style={{ color: storyLength === opt.id ? 'var(--color-accent)' : 'var(--color-muted)' }}>
                          {opt.label}
                        </span>
                        <span className="text-[11px] text-[--color-muted] mt-0.5">{opt.duration}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Narration */}
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
                    className="relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200"
                    style={{ backgroundColor: narration ? 'var(--color-accent)' : 'var(--color-border)' }}
                  >
                    <span className={[
                      'pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow',
                      'transform transition-transform duration-200',
                      narration ? 'translate-x-5' : 'translate-x-0',
                    ].join(' ')} />
                  </button>
                </div>

                {/* Language */}
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-[--color-foreground]">Language</p>
                    <p className="text-[11px] text-[--color-muted]">Story text &amp; narration</p>
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
            )}
          </div>

          {/* ── CTA ── */}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl font-bold py-4 mt-1 transition-all duration-200 text-lg tracking-wide flex items-center justify-center gap-2 disabled:cursor-not-allowed"
            style={{
              backgroundColor: 'var(--accent)',
              color: 'var(--background)',
              boxShadow: loading ? 'none' : '0 4px 28px rgba(232,168,56,0.45), inset 0 1px 0 rgba(255,255,255,0.15)',
              opacity: loading ? 0.6 : 1,
            }}
            onMouseEnter={e => { if (!loading) e.currentTarget.style.boxShadow = '0 6px 36px rgba(232,168,56,0.6), inset 0 1px 0 rgba(255,255,255,0.15)'; }}
            onMouseLeave={e => { if (!loading) e.currentTarget.style.boxShadow = '0 4px 28px rgba(232,168,56,0.45), inset 0 1px 0 rgba(255,255,255,0.15)'; }}
          >
            {loading ? (
              <>
                <span className="w-4 h-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
                Crafting your story seeds…
              </>
            ) : (
              <>
                Begin Tonight&apos;s Story
                <span className="text-xl leading-none">→</span>
              </>
            )}
          </button>

        </form>
      </div>
    </main>
  );
}
