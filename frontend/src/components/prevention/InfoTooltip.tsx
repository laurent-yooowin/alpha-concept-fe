import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Info } from 'lucide-react';

type InfoTooltipProps = {
  label: string;
  title: string;
  children: ReactNode;
};

export default function InfoTooltip({ label, title, children }: InfoTooltipProps) {
  const tooltipId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 16, top: 16, width: 380 });

  const updatePosition = useCallback(() => {
    const button = buttonRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    const width = Math.max(0, Math.min(380, window.innerWidth - 32));
    const height = panelRef.current?.offsetHeight ?? 0;
    const left = Math.max(16, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 16));
    const below = rect.bottom + 10;
    const top = below + height > window.innerHeight - 16 && rect.top - height - 10 >= 16
      ? rect.top - height - 10
      : Math.max(16, Math.min(below, window.innerHeight - height - 16));
    setPosition({ left, top, width });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open, updatePosition]);

  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  const show = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const hideAfterPointerLeaves = () => {
    if (document.activeElement === buttonRef.current) return;
    closeTimer.current = setTimeout(() => setOpen(false), 150);
  };

  return <span className="inline-flex align-middle">
    <button
      ref={buttonRef}
      type="button"
      aria-label={label}
      aria-describedby={open ? tooltipId : undefined}
      onMouseEnter={show}
      onMouseLeave={hideAfterPointerLeaves}
      onFocus={show}
      onBlur={() => setOpen(false)}
      onClick={show}
      onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false); }}
      className="ml-1.5 inline-flex h-7 w-7 items-center justify-center rounded-full border border-blue-200 bg-blue-50 text-blue-700 shadow-sm transition-colors hover:border-blue-400 hover:bg-blue-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
    >
      <Info size={17} strokeWidth={2.25} aria-hidden="true" />
    </button>
    {open && typeof document !== 'undefined' && createPortal(
      <div
        ref={panelRef}
        id={tooltipId}
        role="tooltip"
        style={position}
        onMouseEnter={show}
        onMouseLeave={hideAfterPointerLeaves}
        className="fixed z-[100] max-h-[70vh] overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 text-left text-sm font-normal leading-relaxed text-slate-700 shadow-[0_18px_45px_rgba(15,23,42,0.18)]"
      >
        <div className="flex items-center gap-2 border-b border-slate-100 pb-3 text-[#1e3a5f]">
          <Info size={17} aria-hidden="true" />
          <strong className="font-semibold">{title}</strong>
        </div>
        <div className="space-y-4 pt-3">{children}</div>
      </div>,
      document.body,
    )}
  </span>;
}
