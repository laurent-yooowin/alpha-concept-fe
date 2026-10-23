import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { filterOptionsBySearch } from './filterSearch';
import { formMultiSelectPlacement } from './MultiSelect';

type Option<T extends string> = { value: T; label: string };
const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export default function SearchableSelect<T extends string>({ options, value, onChange, label, appearance = 'compact' }: {
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  appearance?: 'compact' | 'form';
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [placement, setPlacement] = useState<ReturnType<typeof formMultiSelectPlacement> | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const focusedOnOpen = useRef(false);
  const menuId = useId();
  const visibleOptions = filterOptionsBySearch(options, search);
  const selectedLabel = options.find((option) => option.value === value)?.label || label;

  useEffect(() => {
    if (!open) { setSearch(''); setPlacement(null); focusedOnOpen.current = false; return; }
    const inside = (target: EventTarget | null) => target instanceof Node &&
      (Boolean(rootRef.current?.contains(target)) || Boolean(popoverRef.current?.contains(target)));
    const onMouseDown = (event: MouseEvent) => { if (!inside(event.target)) setOpen(false); };
    const onFocusIn = (event: FocusEvent) => { if (!inside(event.target)) setOpen(false); };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); buttonRef.current?.focus(); }
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  useBrowserLayoutEffect(() => {
    if (!open || appearance !== 'form') return;
    const reposition = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (rect) setPlacement(formMultiSelectPlacement(rect, { width: window.innerWidth, height: window.innerHeight }));
    };
    reposition();
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [appearance, open]);

  useEffect(() => {
    if (open && (appearance !== 'form' || placement) && !focusedOnOpen.current) {
      popoverRef.current?.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
      focusedOnOpen.current = true;
    }
  }, [appearance, open, placement]);

  const select = (next: T) => {
    onChange(next);
    setOpen(false);
    buttonRef.current?.focus();
  };
  const focusOption = (index: number) => {
    const choices = popoverRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]');
    if (choices?.length) choices[Math.max(0, Math.min(choices.length - 1, index))]?.focus();
  };
  const menu = open && (appearance !== 'form' || placement) ? <div ref={popoverRef}
    style={appearance === 'form' && placement ? {
      left: placement.left, top: placement.top, width: placement.width, maxHeight: placement.maxHeight,
      transform: placement.above ? 'translateY(-100%)' : undefined,
    } : undefined}
    className={`z-[60] max-h-64 overflow-y-auto rounded-lg border border-[#d0d9e8] bg-white p-2 normal-case shadow-lg ${appearance === 'form' ? 'fixed' : 'absolute left-0 top-full mt-1 min-w-[190px]'}`}>
      <input type="search" value={search} onChange={(event) => setSearch(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'ArrowDown') { event.preventDefault(); focusOption(0); } }}
        aria-label={`Rechercher dans ${label}`} placeholder="Rechercher…"
        className="mb-2 block w-full rounded-md border border-[#d0d9e8] bg-white px-2 py-1.5 text-xs font-medium text-[#1e3a5f] outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200" />
      <div id={menuId} role="listbox" aria-label={label}>
        {visibleOptions.length ? visibleOptions.map((option, index) => <button key={option.value} type="button" role="option"
          aria-selected={option.value === value} onClick={() => select(option.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault(); focusOption(index + (event.key === 'ArrowDown' ? 1 : -1));
            }
          }}
          className={`block w-full rounded px-2 py-1.5 text-left text-xs normal-case hover:bg-slate-50 focus:bg-slate-100 ${option.value === value ? 'font-bold text-[#1e3a5f]' : 'font-medium text-slate-700'}`}>
          {option.label}
        </button>) : <p className="px-2 py-1.5 text-xs text-slate-500">Aucun résultat.</p>}
      </div>
    </div> : null;
  const portalTarget = appearance === 'form' && open && typeof document !== 'undefined'
    ? rootRef.current?.closest('[role="dialog"]') ?? document.body : null;
  return <div ref={rootRef} className={appearance === 'form' ? 'relative mt-[2px] w-full' : 'relative mt-[2px]'}>
    <button ref={buttonRef} type="button" aria-label={`${label} : ${selectedLabel}`} aria-haspopup="listbox" aria-controls={open ? menuId : undefined} aria-expanded={open}
      onClick={() => setOpen((current) => !current)}
      onKeyDown={(event) => { if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) { event.preventDefault(); setOpen(true); } }}
      className={appearance === 'form'
        ? 'flex w-full items-center justify-between rounded-md border border-[#d0d9e8] bg-white px-[9px] py-[6px] text-left text-[12px] font-medium normal-case text-[#1e3a5f]'
        : 'flex min-w-[165px] max-w-[190px] items-center justify-between rounded-md border border-[#d0d9e8] bg-white px-[9px] py-[6px] text-left text-[12px] font-medium normal-case text-[#1e3a5f]'}>
      <span className="truncate">{selectedLabel}</span><span aria-hidden="true" className="ml-2 text-[10px]">▾</span>
    </button>
    {portalTarget && menu ? createPortal(menu, portalTarget) : appearance !== 'form' ? menu : null}
  </div>;
}
