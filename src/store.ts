import { useEffect, useReducer, useRef } from 'react';
import { Engine } from './sim/engine';

const engine = new Engine(null);
export function getEngine() {
  // test/debug hook: lets the automated UI suite cross-check displayed numbers
  // against the exact same engine state (no second data source).
  if (typeof window !== 'undefined') (window as any).__SIM_ENGINE__ = engine;
  return engine;
}

/** subscribe React to engine mutations + running clock */
export function useEngineTick(intervalMs = 300) {
  const [, force] = useReducer((x: number) => x + 1, 0);
  const last = useRef<number>(Date.now());
  useEffect(() => {
    const unsub = engine.subscribe(force);
    const iv = setInterval(() => {
      const now = Date.now();
      const dt = Math.min(1000, now - last.current);
      last.current = now;
      engine.tick(dt);
    }, intervalMs);
    return () => { unsub(); clearInterval(iv); };
  }, [intervalMs]);
  return engine;
}

export function useTick() {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => engine.subscribe(force), []);
  return engine;
}
