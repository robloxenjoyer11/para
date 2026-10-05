import { useEffect, useRef, useState } from 'react';

/** Аватарка: фото или буква имени. Плавно проявляется после загрузки картинки. */
export function Avatar({ src, name, size = 44, className = '' }: { src?: string | null; name?: string | null; size?: number; className?: string }) {
  const [ok, setOk] = useState(false);
  useEffect(() => setOk(false), [src]);
  const letter = (name || 'П').trim().slice(0, 1).toUpperCase();
  return (
    <div className={`av ${className}`} style={{ width: size, height: size, fontSize: size * 0.4, borderRadius: size * 0.32 }}>
      <span>{letter}</span>
      {src && <img src={src} alt="" onLoad={() => setOk(true)} className={ok ? 'on' : ''} onError={() => setOk(false)} />}
    </div>
  );
}

/** Скелетон-заглушка пока грузятся данные */
export function Skeleton({ h = 72, r = 18, className = '' }: { h?: number; r?: number; className?: string }) {
  return <div className={`skel ${className}`} style={{ height: h, borderRadius: r }} />;
}
export function SkeletonList({ n = 3, h = 78 }: { n?: number; h?: number }) {
  return (
    <div className="stagger">
      {Array.from({ length: n }, (_, i) => (
        <Skeleton key={i} h={h} className="skel-row" />
      ))}
    </div>
  );
}

/** Число, которое «набегает» от 0 до значения */
export function CountUp({ to, decimals = 0, ms = 700 }: { to: number; decimals?: number; ms?: number }) {
  const [v, setV] = useState(0);
  const raf = useRef(0);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return setV(to);
    const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      setV(to * (1 - Math.pow(1 - k, 3)));
      if (k < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [to, ms]);
  return <>{v.toFixed(decimals)}</>;
}

/** Из «Александр Новгородов» → «Александр» для коротких мест */
export const firstName = (name?: string | null) => name?.trim().split(/\s+/)[0] || 'студент';
