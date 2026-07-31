"use client";

// Applying design.md Amendments, revision C: the board keeps its natural
// proportions and scales down uniformly to fit the card, stamped with its
// reduction, with a 1:1 control for close reading.

import { useEffect, useRef, useState } from "react";
import styles from "./BoardScaler.module.css";

export function BoardScaler({
  active,
  naturalWidth,
  children,
}: {
  active: boolean;
  /** The board's designed layout width; wrapping happens at this width, then the whole board scales */
  naturalWidth?: number;
  children: React.ReactNode;
}) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [oneToOne, setOneToOne] = useState(false);
  const [fitHeight, setFitHeight] = useState<number | null>(null);

  useEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner || !active) return;
    const measure = () => {
      const natural = inner.offsetWidth;
      const available = outer.clientWidth;
      if (available <= 0 || natural <= 0) return;
      const next = natural > available ? available / natural : 1;
      setScale(next);
      setFitHeight(next < 1 ? inner.offsetHeight * next : null);
    };
    measure();
    const raf = requestAnimationFrame(measure);
    const ro = new ResizeObserver(measure);
    ro.observe(outer);
    ro.observe(inner);
    // emulated viewports can resize without firing the observer
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [active]);

  const scaled = !oneToOne && scale < 1;

  return (
    <div>
      {scale < 1 ? (
        <div className={`${styles.stamp} no-print`}>
          <span>scale {(oneToOne ? 1 : scale).toFixed(2)}:1</span>
          <button type="button" aria-pressed={oneToOne} onClick={() => setOneToOne(!oneToOne)}>
            {oneToOne ? "fit width" : "view 1:1"}
          </button>
        </div>
      ) : null}
      <div
        ref={outerRef}
        className={oneToOne ? styles.scroll : styles.fit}
        style={scaled && fitHeight !== null ? { height: fitHeight } : undefined}
      >
        <div
          ref={innerRef}
          className={styles.inner}
          style={{
            ...(naturalWidth ? { width: naturalWidth } : {}),
            ...(scaled ? { transform: `scale(${scale})` } : {}),
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
