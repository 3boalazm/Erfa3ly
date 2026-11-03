"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { t, type Lang } from "@/lib/i18n";

interface PreviewFrameProps {
  lang: Lang;
  src: string;
  title: string;
  sandbox: string;
  /** Frame height when not fullscreen. */
  height: number | string;
  /** Remount the iframe when this changes (e.g. a new version). */
  frameKey?: string;
  lazy?: boolean;
}

/**
 * The artifact frame with a real fullscreen mode.
 *
 * The *container* goes fullscreen, not the artifact: the sandboxed document keeps
 * its opaque origin and nothing about the isolation changes — it just gets the
 * whole screen. `allow="fullscreen"` also lets a presentation use its own
 * fullscreen button, which a sandboxed iframe silently refuses without it.
 */
export function PreviewFrame({ lang, src, title, sandbox, height, frameKey, lazy }: PreviewFrameProps) {
  const shell = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);

  useEffect(() => {
    const sync = () => setActive(document.fullscreenElement === shell.current);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  const toggle = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await shell.current?.requestFullscreen({ navigationUI: "hide" });
    } catch {
      /* the browser refused (e.g. iOS Safari); the "open directly" link still works */
    }
  }, []);

  return (
    <div>
      <div className="row" style={{ justifyContent: "flex-end", marginBottom: 8 }}>
        <button type="button" className="btn btn-sm" onClick={() => void toggle()}>
          <ExpandIcon exit={false} />
          {t(lang, "fullscreen")}
        </button>
      </div>
      <div ref={shell} className="frame-shell" data-fullscreen={active}>
        <iframe
          key={frameKey}
          src={src}
          title={title}
          // No allow-same-origin unless a dedicated preview origin is configured:
          // the caller decides, this component never widens the sandbox.
          sandbox={sandbox}
          allow="fullscreen"
          allowFullScreen
          style={{ height: active ? "100%" : height }}
          referrerPolicy="no-referrer"
          loading={lazy ? "lazy" : undefined}
        />
        {/* Only visible in fullscreen (CSS), so it never covers the artifact otherwise. */}
        <button
          type="button"
          className="frame-fullscreen-btn"
          onClick={() => void toggle()}
          aria-label={t(lang, "exitFullscreen")}
          title={t(lang, "exitFullscreen")}
        >
          <ExpandIcon exit />
        </button>
      </div>
    </div>
  );
}

function ExpandIcon({ exit }: { exit: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path
        d={
          exit
            ? "M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"
            : "M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"
        }
      />
    </svg>
  );
}
