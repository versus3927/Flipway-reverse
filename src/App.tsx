import { useEffect, useRef, useState } from 'react';
import { Game, HudData } from './game/Game';
import { LOCS, LocId, css, detectLowSpecDefault } from './game/config';
import {
  Play, RotateCcw, Pause, Volume2, VolumeX, Coins, Gauge, Trophy,
  TrainFront, AlertTriangle, Building2,
  Mountain, Snowflake, Dog, Castle, Flame, Home, ChevronRight, Sun,
  Sparkles, Settings2, Smartphone,
} from 'lucide-react';

const LOC_ICONS: Record<LocId, typeof Building2> = {
  metro: Building2, canyon: Mountain, ice: Snowflake, pugs: Dog, castle: Castle, sunny: Sun,
};

interface Banner { t: string; s: string; c: string; key: number; }
interface Results { dist: number; coins: number; score: number; best: number; isRecord: boolean; }

export default function App() {
  const mountRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Game | null>(null);

  const [hud, setHud] = useState<HudData>({ dist: 0, coins: 0, speed: 0, best: 0, onTrain: false });
  const [state, setState] = useState<'menu' | 'play' | 'dead'>('menu');
  const [banner, setBanner] = useState<Banner | null>(null);
  const [warn, setWarn] = useState<{ kind: 'train' | 'dragon' | 'fire'; key: number } | null>(null);
  const [loc, setLoc] = useState<LocId>('metro');
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(() => localStorage.getItem('gr_mute') === '1');
  const [lowSpec, setLowSpec] = useState(() => detectLowSpecDefault());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [results, setResults] = useState<Results | null>(null);
  const [grazeT, setGrazeT] = useState(0);

  useEffect(() => {
    if (!mountRef.current) return;
    const game = new Game(mountRef.current, {
      hud: (d) => setHud(d),
      banner: (t, s, c) => setBanner({ t, s, c, key: Date.now() + Math.random() }),
      state: (s) => setState(s),
      warn: (kind) => setWarn(kind ? { kind, key: Date.now() } : null),
      loc: (l) => setLoc(l),
      over: (r) => setResults(r),
      pauseChange: (p) => setPaused(p),
      graze: (t) => setGrazeT(t),
      perfMode: (low) => setLowSpec(low),
    });
    gameRef.current = game;
    game.setMuted(localStorage.getItem('gr_mute') === '1');
    const savedLow = localStorage.getItem('gr_low');
    if (savedLow === '1' || savedLow === '0') {
      game.setOptimizationMode(savedLow === '1');
    }

    const onVis = () => {
      if (document.hidden) {
        game.pauseIfPlaying();
        game.suspendAudio();
      } else {
        game.resumeAudio();
      }
    };
    document.addEventListener('visibilitychange', onVis);
    // для Capacitor жизненный цикл приложения:
    window.addEventListener('pause', onVis);
    window.addEventListener('resume', onVis);
    
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pause', onVis);
      window.removeEventListener('resume', onVis);
      game.dispose();
      gameRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!banner) return;
    const id = setTimeout(() => setBanner(null), 2900);
    return () => clearTimeout(id);
  }, [banner]);

  useEffect(() => {
    if (!warn) return;
    const id = setTimeout(() => setWarn(null), 2600);
    return () => clearTimeout(id);
  }, [warn]);

  useEffect(() => {
    if (grazeT <= 0) return;
    const id = setInterval(() => {
      setGrazeT((v) => (v <= 1 ? 0 : v - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [grazeT > 0]);

  const start = () => { setResults(null); gameRef.current?.start(); };
  const toMenu = () => { setResults(null); gameRef.current?.toMenu(); };

  const toggleMute = () => {
    const m = !muted;
    setMuted(m);
    localStorage.setItem('gr_mute', m ? '1' : '0');
    gameRef.current?.setMuted(m);
  };

  const toggleLowSpec = () => {
    const v = !lowSpec;
    setLowSpec(v);
    localStorage.setItem('gr_low', v ? '1' : '0');
    gameRef.current?.setOptimizationMode(v);
  };

  const LocIcon = LOC_ICONS[loc];
  const locCfg = LOCS[loc];

  return (
    <div className={`relative h-full w-full overflow-hidden bg-[#04060d] ${lowSpec ? 'low-spec' : ''}`}>
      <div ref={mountRef} className="absolute inset-0" />

      <div className="pointer-events-none absolute inset-0 vignette" />
      {!lowSpec && <div className="pointer-events-none absolute inset-0 scanlines opacity-30" />}
      {grazeT > 0 && state === 'play' && (
        <div
          className="pointer-events-none absolute inset-0 animate-warn"
          style={{ boxShadow: 'inset 0 0 90px rgba(255,190,50,.55), inset 0 0 20px rgba(255,150,0,.4)' }}
        />
      )}

      {settingsOpen && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/65 backdrop-blur-sm px-4 animate-fade">
          <div className="glass w-full max-w-md rounded-3xl p-5 text-white animate-pop">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-display text-2xl tracking-widest" style={{ fontWeight: 800 }}>НАСТРОЙКИ</div>
                <div className="mt-1 font-russo text-xs text-white/60">Подстрой игру под устройство</div>
              </div>
              <button
                onClick={() => setSettingsOpen(false)}
                className="rounded-full glass px-3 py-2 text-white/80 active:scale-95 transition-transform"
              >
                OK
              </button>
            </div>

            <div className="mt-5 flex flex-col gap-3">
              <button
                onClick={toggleMute}
                className="glass flex items-center justify-between rounded-2xl px-4 py-3 text-left active:scale-[0.99] transition-transform"
              >
                <div className="flex items-center gap-3">
                  {muted ? <VolumeX size={18} className="text-cyan-200" /> : <Volume2 size={18} className="text-cyan-200" />}
                  <div>
                    <div className="font-display text-sm" style={{ fontWeight: 700 }}>Звук</div>
                    <div className="font-russo text-[11px] text-white/60">Музыка и эффекты</div>
                  </div>
                </div>
                <div className={`rounded-full px-3 py-1 text-[11px] font-russo ${muted ? 'bg-white/10 text-white/60' : 'bg-cyan-400/20 text-cyan-100'}`}>
                  {muted ? 'ВЫКЛ' : 'ВКЛ'}
                </div>
              </button>

              <button
                onClick={toggleLowSpec}
                className="glass flex items-center justify-between rounded-2xl px-4 py-3 text-left active:scale-[0.99] transition-transform"
              >
                <div className="flex items-center gap-3">
                  <Smartphone size={18} className="text-amber-200" />
                  <div>
                    <div className="font-display text-sm" style={{ fontWeight: 700 }}>Оптимизация для слабых телефонов</div>
                    <div className="font-russo text-[11px] text-white/60">Без теней, меньше частиц и эффектов</div>
                  </div>
                </div>
                <div className={`rounded-full px-3 py-1 text-[11px] font-russo ${lowSpec ? 'bg-amber-400/20 text-amber-100' : 'bg-white/10 text-white/60'}`}>
                  {lowSpec ? 'ВКЛ' : 'ВЫКЛ'}
                </div>
              </button>
            </div>
          </div>
        </div>
      )}

      {state === 'play' && (
        <>
          <div className="pointer-events-none absolute left-3 top-3 flex flex-col gap-2 animate-fade">
            <div className="glass rounded-2xl px-4 py-2.5">
              <div className="text-[10px] font-display tracking-[0.25em] text-cyan-300/70">СЧЁТ</div>
              <div className="font-display text-3xl leading-none text-white" style={{ fontWeight: 800 }}>
                {hud.dist + hud.coins * 25}
              </div>
            </div>
            <div className="glass rounded-2xl px-4 py-2 flex items-center gap-2">
              <Coins size={16} className="text-amber-300" />
              <span className="font-display text-lg text-amber-200" style={{ fontWeight: 600 }}>{hud.coins}</span>
            </div>
            <div className="glass rounded-2xl px-4 py-2 flex items-center gap-2">
              <LocIcon size={16} style={{ color: css(locCfg.accent) }} />
              <span className="font-russo text-xs text-white/85 tracking-wide">{locCfg.name}</span>
            </div>
            {hud.onTrain && (
              <div className="rounded-2xl border border-cyan-300/60 bg-cyan-400/25 px-4 py-2 flex items-center gap-2 backdrop-blur animate-pop">
                <TrainFront size={16} className="text-cyan-100" />
                <span className="font-russo text-[11px] text-white tracking-widest">НА КРЫШЕ</span>
              </div>
            )}
            {grazeT > 0 && (
              <div className="rounded-2xl border-2 border-amber-300 bg-amber-500/25 px-3 py-2 backdrop-blur animate-pop">
                <div className="flex items-center gap-2">
                  <Sparkles size={16} className="text-amber-200 animate-pulse-dot" />
                  <span className="font-display text-lg leading-none text-amber-100" style={{ fontWeight: 800 }}>{grazeT}</span>
                  <span className="font-russo text-[9px] text-amber-200/90 leading-tight">СЕК<br />НА ГРАНИ</span>
                </div>
                <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-black/30">
                  <div className="h-full rounded-full bg-amber-300 transition-all duration-1000 ease-linear" style={{ width: `${(grazeT / 20) * 100}%` }} />
                </div>
              </div>
            )}
          </div>

          <div className="absolute right-3 top-3 flex flex-col items-end gap-2 animate-fade">
            <div className="flex gap-2">
              <button onClick={() => setSettingsOpen(true)} className="glass rounded-full p-3 text-white/90 active:scale-90 transition-transform" aria-label="Настройки">
                <Settings2 size={20} />
              </button>
              <button onClick={() => gameRef.current?.togglePause()} className="glass rounded-full p-3 text-white/90 active:scale-90 transition-transform" aria-label="Пауза">
                {paused ? <Play size={20} /> : <Pause size={20} />}
              </button>
              <button onClick={toggleMute} className="glass rounded-full p-3 text-white/90 active:scale-90 transition-transform" aria-label="Звук">
                {muted ? <VolumeX size={20} /> : <Volume2 size={20} />}
              </button>
            </div>
            <div className="pointer-events-none glass rounded-2xl px-4 py-2 flex items-center gap-2">
              <Gauge size={16} className="text-cyan-300" />
              <span className="font-display text-base text-white/90" style={{ fontWeight: 600 }}>{hud.speed}</span>
              <span className="text-[10px] text-white/50 font-russo">км/ч</span>
            </div>
          </div>

          {warn && (
            <div key={warn.key} className="pointer-events-none absolute bottom-24 left-1/2 -translate-x-1/2 animate-warn">
              <div className="flex items-center gap-3 rounded-2xl border-2 border-red-500 bg-red-950/80 px-5 py-3 backdrop-blur">
                <AlertTriangle size={20} className="text-red-400" />
                <span className="font-display text-lg text-red-200 tracking-widest" style={{ fontWeight: 800 }}>
                  {warn.kind === 'train' ? 'ПОЕЗД!' : warn.kind === 'fire' ? 'ОГОНЬ!' : 'ДРАКОН!'}
                </span>
                {warn.kind === 'train' ? <TrainFront size={22} className="text-red-300" /> : <Flame size={22} className="text-orange-400" />}
              </div>
            </div>
          )}
        </>
      )}

      {banner && state === 'play' && (
        <div key={banner.key} className="pointer-events-none absolute left-1/2 top-[16%] -translate-x-1/2 animate-banner w-full px-4">
          <div className="mx-auto flex max-w-xl flex-col items-center text-center">
            <div className="font-display text-2xl sm:text-4xl tracking-wide text-white" style={{ fontWeight: 900, textShadow: `0 0 24px ${banner.c}, 0 2px 12px rgba(0,0,0,.6)` }}>
              {banner.t}
            </div>
            <div className="mt-1.5 h-[3px] w-40 rounded-full" style={{ background: banner.c, boxShadow: `0 0 14px ${banner.c}` }} />
            <div className="mt-2 font-russo text-sm sm:text-base text-white/85" style={{ textShadow: '0 1px 8px rgba(0,0,0,.8)' }}>
              {banner.s}
            </div>
          </div>
        </div>
      )}

      {state === 'menu' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-b from-[#04060d]/60 via-transparent to-[#04060d]/90 px-4" onPointerDown={(e) => { if (e.target === e.currentTarget) start(); }}>
          <img
            src="/hero-chibi.png"
            alt=""
            className="pointer-events-none absolute bottom-0 right-0 h-[38vh] max-h-72 object-contain opacity-90 animate-floaty mix-blend-screen sm:h-[46vh]"
            style={{ filter: 'drop-shadow(0 0 28px rgba(34,224,255,.45))' }}
          />

          <div className="flex flex-col items-center animate-pop">
            <h1
              className="title-sheen font-display text-center leading-none text-glow-cyan"
              style={{
                fontWeight: 900,
                fontSize: 'clamp(3rem, 10vw, 5.6rem)',
                backgroundImage: 'linear-gradient(100deg,#22e0ff 10%,#7cf7ff 30%,#ff2d95 55%,#ff7ab8 75%,#22e0ff 95%)',
                WebkitBackgroundClip: 'text',
                backgroundClip: 'text',
                color: 'transparent',
              }}
            >
              ГРАВИ-РАН
            </h1>
            {hud.best > 0 && (
              <div className="mt-4 flex items-center gap-2 glass rounded-full px-5 py-2 animate-fade">
                <Trophy size={15} className="text-amber-300" />
                <span className="font-russo text-sm text-amber-200">Рекорд: {hud.best}</span>
              </div>
            )}
          </div>

          <div className="mt-8 flex flex-col items-center gap-3 animate-pop" style={{ animationDelay: '.1s' }}>
            <button
              onClick={start}
              className="group flex items-center gap-3 rounded-full px-12 py-4 font-display text-xl tracking-widest text-white shadow-[0_0_40px_rgba(34,224,255,.45)] transition-transform active:scale-95"
              style={{ fontWeight: 800, background: 'linear-gradient(100deg,#0891b2,#22d3ee 45%,#e11d8f)' }}
            >
              <Play size={24} className="transition-transform group-hover:scale-125" />
              ИГРАТЬ
            </button>
            <button
              onClick={() => setSettingsOpen(true)}
              className="glass flex items-center gap-3 rounded-full px-10 py-4 font-display text-lg tracking-widest text-white/95 transition-transform active:scale-95"
              style={{ fontWeight: 700 }}
            >
              <Settings2 size={21} />
              НАСТРОЙКИ
            </button>
          </div>
        </div>
      )}

      {paused && state === 'play' && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm animate-fade">
          <div className="font-display mb-6 text-3xl tracking-widest text-white" style={{ fontWeight: 800 }}>ПАУЗА</div>
          <div className="flex flex-wrap justify-center gap-3">
            <button onClick={() => gameRef.current?.togglePause()} className="flex items-center gap-2 rounded-full bg-cyan-500 px-7 py-3.5 font-display text-base text-white active:scale-95 transition-transform" style={{ fontWeight: 700 }}>
              <Play size={19} /> ДАЛЬШЕ
            </button>
            <button onClick={() => setSettingsOpen(true)} className="flex items-center gap-2 rounded-full glass px-7 py-3.5 font-display text-base text-white/90 active:scale-95 transition-transform" style={{ fontWeight: 700 }}>
              <Settings2 size={19} /> НАСТРОЙКИ
            </button>
            <button onClick={() => { gameRef.current?.togglePause(); toMenu(); }} className="flex items-center gap-2 rounded-full glass px-7 py-3.5 font-display text-base text-white/90 active:scale-95 transition-transform" style={{ fontWeight: 700 }}>
              <Home size={19} /> МЕНЮ
            </button>
          </div>
        </div>
      )}

      {state === 'dead' && results && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-gradient-to-b from-red-950/50 via-[#04060d]/80 to-[#04060d]/95 px-4">
          <div className="animate-pop flex flex-col items-center">
            <div className="font-display text-4xl sm:text-5xl text-red-400 tracking-wider" style={{ fontWeight: 900, textShadow: '0 0 30px rgba(255,48,64,.5)' }}>
              АВАРИЯ!
            </div>
            {results.isRecord && (
              <div className="mt-3 flex items-center gap-2 rounded-full border border-amber-300/40 bg-amber-400/15 px-4 py-1.5">
                <Trophy size={15} className="text-amber-300" />
                <span className="font-russo text-xs tracking-widest text-amber-200">НОВЫЙ РЕКОРД!</span>
              </div>
            )}
            <div className="mt-6 glass min-w-[260px] rounded-3xl px-8 py-5 flex flex-col items-center">
              <div className="text-[10px] font-display tracking-[0.3em] text-white/50">ИТОГОВЫЙ СЧЁТ</div>
              <div className="mt-1 font-display text-5xl text-white" style={{ fontWeight: 900 }}>{results.score}</div>
              <div className="mt-3 flex items-center gap-5">
                <div className="flex items-center gap-1.5 text-white/80"><ChevronRight size={14} className="text-cyan-300" /><span className="font-russo text-sm">{results.dist} м</span></div>
                <div className="flex items-center gap-1.5 text-white/80"><Coins size={14} className="text-amber-300" /><span className="font-russo text-sm">{results.coins}</span></div>
                <div className="flex items-center gap-1.5 text-white/80"><Trophy size={14} className="text-amber-400" /><span className="font-russo text-sm">{results.best}</span></div>
              </div>
            </div>
            <div className="mt-7 flex gap-3">
              <button onClick={start} className="flex items-center gap-3 rounded-full px-8 py-4 font-display text-lg text-white shadow-[0_0_34px_rgba(34,224,255,.4)] active:scale-95 transition-transform" style={{ fontWeight: 800, background: 'linear-gradient(100deg,#0891b2,#22d3ee 45%,#e11d8f)' }}>
                <RotateCcw size={22} /> ЕЩЁ РАЗ
              </button>
              <button onClick={toMenu} className="flex items-center gap-2 rounded-full glass px-6 py-4 font-display text-base text-white/90 active:scale-95 transition-transform" style={{ fontWeight: 700 }}>
                <Home size={19} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
