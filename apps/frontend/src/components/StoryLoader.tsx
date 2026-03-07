'use client';

import { useEffect, useState } from 'react';

const PHRASES = [
  'Imagining worlds...',
  'Writing once upon a time...',
  'Painting the scenes...',
  'Weaving the magic...',
  'Creating something special...',
  'Dreaming it all up...',
  'Conjuring new adventures...',
  'Sprinkling a little stardust...',
];

// Fixed positions — avoids React hydration mismatch
const STARS = [
  { x: 8,  y: 12, size: 2,   dur: 2.1, delay: 0.3 },
  { x: 15, y: 45, size: 1.5, dur: 1.8, delay: 0.8 },
  { x: 22, y: 8,  size: 2.5, dur: 2.4, delay: 1.2 },
  { x: 35, y: 70, size: 1,   dur: 1.6, delay: 0.1 },
  { x: 42, y: 25, size: 2,   dur: 2.8, delay: 0.5 },
  { x: 55, y: 15, size: 1.5, dur: 2.2, delay: 1.0 },
  { x: 60, y: 60, size: 2,   dur: 1.9, delay: 0.7 },
  { x: 68, y: 35, size: 1,   dur: 2.5, delay: 1.4 },
  { x: 75, y: 80, size: 2.5, dur: 2.0, delay: 0.2 },
  { x: 82, y: 20, size: 1.5, dur: 1.7, delay: 0.9 },
  { x: 88, y: 55, size: 2,   dur: 2.3, delay: 1.1 },
  { x: 92, y: 10, size: 1,   dur: 2.6, delay: 0.4 },
  { x: 30, y: 90, size: 1.5, dur: 1.5, delay: 1.3 },
  { x: 50, y: 85, size: 2,   dur: 2.0, delay: 0.6 },
  { x: 70, y: 92, size: 1,   dur: 2.2, delay: 1.5 },
  { x: 5,  y: 75, size: 1.5, dur: 2.0, delay: 0.4 },
  { x: 95, y: 40, size: 2,   dur: 1.8, delay: 1.0 },
  { x: 48, y: 5,  size: 1,   dur: 2.4, delay: 0.2 },
];

export default function StoryLoader() {
  const [phraseIdx, setPhraseIdx] = useState(0);

  useEffect(() => {
    const t = setInterval(() => {
      setPhraseIdx((i) => (i + 1) % PHRASES.length);
    }, 2800);
    return () => clearInterval(t);
  }, []);

  return (
    <main className="min-h-screen flex flex-col items-center justify-center overflow-hidden relative">
      <style>{`
        @keyframes sl-twinkle {
          0%, 100% { opacity: 0.15; transform: scale(0.7); }
          50%       { opacity: 1;    transform: scale(1.3); }
        }
        @keyframes sl-float {
          0%, 100% { transform: translateY(0px)   rotate(-4deg); }
          50%       { transform: translateY(-16px) rotate(4deg);  }
        }
        @keyframes sl-shoot {
          0%   { opacity: 0; transform: translateX(0)    translateY(0);     }
          8%   { opacity: 1; }
          100% { opacity: 0; transform: translateX(350px) translateY(-350px); }
        }
        @keyframes sl-fade {
          0%   { opacity: 0; transform: translateY(8px);  }
          15%  { opacity: 1; transform: translateY(0);    }
          85%  { opacity: 1; transform: translateY(0);    }
          100% { opacity: 0; transform: translateY(-8px); }
        }
      `}</style>

      {/* Twinkling stars */}
      {STARS.map((s, i) => (
        <span
          key={i}
          className="absolute rounded-full bg-white pointer-events-none"
          style={{
            left: `${s.x}%`,
            top: `${s.y}%`,
            width: `${s.size}px`,
            height: `${s.size}px`,
            animation: `sl-twinkle ${s.dur}s ${s.delay}s ease-in-out infinite`,
          }}
        />
      ))}

      {/* Shooting stars */}
      <span
        className="absolute pointer-events-none rounded-full"
        style={{
          top: '18%', left: '12%',
          width: '80px', height: '1.5px',
          background: 'linear-gradient(to right, transparent, white)',
          animation: 'sl-shoot 5s 0.5s ease-in infinite',
        }}
      />
      <span
        className="absolute pointer-events-none rounded-full"
        style={{
          top: '38%', left: '58%',
          width: '60px', height: '1px',
          background: 'linear-gradient(to right, transparent, #fcd34d)',
          animation: 'sl-shoot 6s 3.2s ease-in infinite',
        }}
      />
      <span
        className="absolute pointer-events-none rounded-full"
        style={{
          top: '65%', left: '30%',
          width: '50px', height: '1px',
          background: 'linear-gradient(to right, transparent, #a5b4fc)',
          animation: 'sl-shoot 7s 5.5s ease-in infinite',
        }}
      />

      {/* Moon */}
      <div
        className="text-8xl mb-8 select-none"
        style={{ animation: 'sl-float 4s ease-in-out infinite' }}
      >
        🌙
      </div>

      {/* Rotating phrase */}
      <p
        key={phraseIdx}
        className="text-[--color-muted] text-base tracking-widest uppercase text-center px-8"
        style={{ animation: 'sl-fade 2.8s ease-in-out forwards' }}
      >
        {PHRASES[phraseIdx]}
      </p>
    </main>
  );
}
