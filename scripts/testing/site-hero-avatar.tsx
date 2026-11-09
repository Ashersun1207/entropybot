import { createRoot } from "react-dom/client";
import { useEffect, useRef, useState } from "react";
import { CursorAvatar, type CursorState } from "../../src/components/CursorAvatar";
import { CHROME_EYES, CHROME_GRADIENT } from "../../src/lib/mascot";

const host = document.querySelector<HTMLElement>(".hero-mark");
const sequence: Array<{ state: CursorState; expression: number; ms: number }> = [
  { state: "waking", expression: 13, ms: 2200 },
  { state: "idle", expression: 6, ms: 6800 },
  { state: "happy", expression: 0, ms: 3200 },
  { state: "idle", expression: 6, ms: 7400 },
  { state: "curious", expression: 15, ms: 3600 },
];

function HeroAvatar({ host }: { host: HTMLElement }) {
  const [step, setStep] = useState(0);
  const startedAt = useRef(performance.now());
  const [active, setActive] = useState(!document.hidden);
  const [visible, setVisible] = useState(true);
  const [reduced, setReduced] = useState(matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [gaze, setGaze] = useState({ x: 0, y: 0 });
  const playing = active && visible && !reduced;
  const state = reduced ? "idle" : sequence[step].state;

  useEffect(() => {
    host.dataset.avatar = "ready";
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    const changeMotion = () => setReduced(motion.matches);
    const visibility = () => setActive(!document.hidden);
    const intersection = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting));
    intersection.observe(host);
    motion.addEventListener("change", changeMotion);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      delete host.dataset.avatar;
      intersection.disconnect();
      motion.removeEventListener("change", changeMotion);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [host]);

  useEffect(() => {
    if (!playing) return;
    let timer: ReturnType<typeof setTimeout>;
    const loopMs = sequence.slice(1).reduce((sum, beat) => sum + beat.ms, 0);
    const advance = () => {
      const elapsed = performance.now() - startedAt.current;
      let remaining = elapsed < sequence[0].ms ? elapsed : (elapsed - sequence[0].ms) % loopMs;
      let index = elapsed < sequence[0].ms ? 0 : 1;
      while (remaining >= sequence[index].ms) { remaining -= sequence[index].ms; index += 1; }
      setStep(index);
      timer = setTimeout(advance, sequence[index].ms - remaining + 8);
    };
    advance();
    return () => clearTimeout(timer);
  }, [playing]);

  useEffect(() => {
    if (!playing) return;
    const move = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      const rect = host.getBoundingClientRect();
      setGaze({
        x: Math.max(-1, Math.min(1, (event.clientX - rect.left - rect.width / 2) / (innerWidth / 2))),
        y: Math.max(-1, Math.min(1, (event.clientY - rect.top - rect.height / 2) / (innerHeight / 2))),
      });
    };
    const reset = () => setGaze({ x: 0, y: 0 });
    window.addEventListener("pointermove", move, { passive: true });
    document.documentElement.addEventListener("pointerleave", reset);
    return () => {
      window.removeEventListener("pointermove", move);
      document.documentElement.removeEventListener("pointerleave", reset);
    };
  }, [playing, host]);

  return <span className="hero-avatar" data-face-state={state} data-playing={playing}>
    <CursorAvatar size="100%" state={state} expression={reduced ? 6 : sequence[step].expression}
      autoExpression={false} gradient={CHROME_GRADIENT} eyeColor={CHROME_EYES}
      eyeScale={0.95} mouthStroke={11} gaze={playing ? gaze : { x: 0, y: 0 }}
      lookAround={0.6} effects={false} glyphs={false} paused={!playing} title={null} />
  </span>;
}

if (host) {
  const mount = document.createElement("span");
  mount.className = "hero-avatar-mount";
  host.append(mount);
  const root = createRoot(mount);
  root.render(<HeroAvatar host={host} />);
  window.addEventListener("pagehide", event => { if (!event.persisted) root.unmount(); }, { once: true });
}
