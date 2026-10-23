import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { filterOptionsBySearch, normalizedFilterSearch, selectAllVisibleKeys } from './filterSearch';

export type MultiSelectOption = { key: string; label: string };
export const MAX_MULTISELECT_OPTIONS = 50;
const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export function formMultiSelectPlacement(
  anchor: { left: number; top: number; bottom: number; width: number },
  viewport: { width: number; height: number },
) {
  const margin = 8;
  const gap = 4;
  const below = Math.max(0, viewport.height - anchor.bottom - margin - gap);
  const above = Math.max(0, anchor.top - margin - gap);
  const opensAbove = below < 256 && above > below;
  const width = Math.min(anchor.width, Math.max(1, viewport.width - margin * 2));
  return {
    left: Math.max(margin, Math.min(anchor.left, viewport.width - margin - width)),
    top: opensAbove ? anchor.top - gap : anchor.bottom + gap,
    width,
    maxHeight: Math.min(256, opensAbove ? above : below),
    above: opensAbove,
  };
}

export default function MultiSelect({ options, selectedKeys, onChange, label, allLabel, emptyLabel = 'Aucune option disponible.', appearance = 'compact', selectedLabel }: {
  options: MultiSelectOption[];
  selectedKeys: string[];
  onChange: (keys: string[]) => void;
  label: string;
  allLabel: string;
  emptyLabel?: string;
  appearance?: 'compact' | 'form';
  selectedLabel?: (count: number) => string;
}) {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const [placement, setPlacement] = useState<ReturnType<typeof formMultiSelectPlacement> | null>(null);
  const focusedOnOpen = useRef(false);
  const buttonLabel = selectedKeys.length ? (selectedLabel ? selectedLabel(selectedKeys.length) : `${selectedKeys.length} sélection${selectedKeys.length > 1 ? 's' : ''}`) : allLabel;
  const selectionLimitReached = selectedKeys.length >= MAX_MULTISELECT_OPTIONS;
  const visibleOptions = filterOptionsBySearch(options, search);
  const hasSearch = Boolean(normalizedFilterSearch(search));
  const selectAllKeys = selectAllVisibleKeys(options, selectedKeys, search, MAX_MULTISELECT_OPTIONS);

  useEffect(() => {
    if (!open) return;
    const closeMenu = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node) && !popoverRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); buttonRef.current?.focus(); }
    };
    document.addEventListener('mousedown', closeMenu);
    document.addEventListener('keydown', handleKey);
    return () => { document.removeEventListener('mousedown', closeMenu); document.removeEventListener('keydown', handleKey); };
  }, [open]);

  useEffect(() => {
    if (!open) { focusedOnOpen.current = false; setSearch(''); return; }
    if ((appearance !== 'form' || placement) && !focusedOnOpen.current) {
      popoverRef.current?.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
      focusedOnOpen.current = true;
    }
  }, [appearance, open, placement]);

  useBrowserLayoutEffect(() => {
    if (!open || appearance !== 'form') return;
    const positionMenu = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPlacement(formMultiSelectPlacement(rect, { width: window.innerWidth, height: window.innerHeight }));
    };
    positionMenu();
    window.addEventListener('resize', positionMenu);
    window.addEventListener('scroll', positionMenu, true);
    return () => {
      window.removeEventListener('resize', positionMenu);
      window.removeEventListener('scroll', positionMenu, true);
    };
  }, [appearance, open]);

  const rootClass = appearance === 'form' ? 'relative mt-[2px] w-full' : 'relative mt-[2px]';
  const buttonClass = appearance === 'form'
    ? 'flex w-full items-center justify-between rounded-md border border-[#d0d9e8] bg-white px-[9px] py-[6px] text-left text-[12px] font-medium normal-case text-[#1e3a5f]'
    : 'flex min-w-[165px] items-center justify-between rounded-md border border-[#d0d9e8] bg-white px-2.5 py-1.5 text-left text-xs font-medium normal-case text-[#1e3a5f]';
  const menu = open && (appearance !== 'form' || placement) ? <div
    ref={popoverRef}
    style={appearance === 'form' && placement ? {
      left: placement.left, top: placement.top, width: placement.width, maxHeight: placement.maxHeight,
      transform: placement.above ? 'translateY(-100%)' : undefined,
    } : undefined}
    className={`z-[60] max-h-64 overflow-y-auto rounded-lg border border-[#d0d9e8] bg-white p-2 normal-case shadow-lg ${appearance === 'form' ? 'fixed' : 'absolute left-0 top-full mt-1 min-w-[240px]'}`}>
      <input type="search" value={search} onChange={(event) => setSearch(event.target.value)}
        aria-label={`Rechercher dans ${label}`} placeholder="Rechercher…"
        className="mb-2 block w-full rounded-md border border-[#d0d9e8] bg-white px-2 py-1.5 text-xs font-medium text-[#1e3a5f] outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200" />
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-1 text-[11px]">
        <button type="button" className="font-semibold text-[#1e3a5f] hover:underline" onClick={() => onChange([])}>Tout désélectionner</button>
        <button type="button" disabled={!selectAllKeys} title={!selectAllKeys && visibleOptions.length ? `La sélection est limitée à ${MAX_MULTISELECT_OPTIONS} éléments.` : undefined} className="text-slate-500 hover:underline disabled:cursor-not-allowed disabled:opacity-50" onClick={() => { if (selectAllKeys) onChange(selectAllKeys); }}>Tout sélectionner</button>
      </div>
      <p className="px-1.5 py-1 text-[10px] text-slate-500">Sans sélection : tous.</p>
      {!selectAllKeys && visibleOptions.length > 0 && <p className="rounded bg-amber-50 px-1.5 py-1 text-[10px] text-amber-800">Sélectionnez au maximum {MAX_MULTISELECT_OPTIONS} éléments. « Tout sélectionner » est désactivé{hasSearch ? ' pour ces résultats.' : '.'}</p>}
      {notice && <p role="alert" className="rounded bg-amber-50 px-1.5 py-1 text-[10px] text-amber-800">{notice}</p>}
      <div id={menuId} role="listbox" aria-label={label} aria-multiselectable="true">
      {visibleOptions.length ? visibleOptions.map((option) => { const checked = selectedKeys.includes(option.key); return <label key={option.key} role="option" aria-selected={checked} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1.5 text-xs font-medium normal-case text-slate-700 hover:bg-slate-50"><input type="checkbox" checked={checked} onChange={(event) => {
        if (event.target.checked && !checked && selectionLimitReached) { setNotice(`La sélection est limitée à ${MAX_MULTISELECT_OPTIONS} éléments.`); return; }
        setNotice(null);
        onChange(event.target.checked ? [...selectedKeys, option.key] : selectedKeys.filter((key) => key !== option.key));
      }} />{option.label}</label>; }) : <span className="block px-1.5 py-2 text-xs font-medium normal-case text-slate-500">{options.length ? 'Aucun résultat.' : emptyLabel}</span>}
      </div>
    </div> : null;
  const portalTarget = appearance === 'form' && open && typeof document !== 'undefined'
    ? menuRef.current?.closest('[role="dialog"]') ?? document.body : null;
  return <div ref={menuRef} className={rootClass}>
    <button ref={buttonRef} type="button" aria-haspopup="listbox" aria-controls={open ? menuId : undefined} aria-label={label} aria-expanded={open} onClick={() => setOpen((value) => !value)} className={buttonClass}>
      <span className="truncate">{buttonLabel}</span><span aria-hidden="true" className="ml-2 text-[10px]">▾</span>
    </button>
    {portalTarget && menu ? createPortal(menu, portalTarget) : appearance !== 'form' ? menu : null}
  </div>;
}
