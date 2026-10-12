import { useEffect, useRef, useState } from 'react';

type ClientOption = { key: string; label: string };

export default function ClientMultiSelect({ clients, selectedKeys, onChange, appearance = 'compact' }: {
  clients: ClientOption[];
  selectedKeys: string[];
  onChange: (keys: string[]) => void;
  appearance?: 'compact' | 'form';
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const label = selectedKeys.length ? `${selectedKeys.length} client(s)` : 'Tous les clients';

  useEffect(() => {
    if (!open) return;
    const closeMenu = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setOpen(false);
    };
    const handleKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', closeMenu);
    document.addEventListener('keydown', handleKey);
    return () => { document.removeEventListener('mousedown', closeMenu); document.removeEventListener('keydown', handleKey); };
  }, [open]);

  return <div ref={menuRef} className={appearance === 'form' ? 'relative mt-[2px] w-full' : 'relative mt-[2px]'}>
    <button type="button" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((value) => !value)} className={appearance === 'form' ? 'flex w-full items-center justify-between rounded-md border border-[#d0d9e8] bg-white px-[9px] py-[6px] text-left text-[12px] font-medium normal-case text-[#1e3a5f]' : 'flex min-w-[165px] items-center justify-between rounded-md border border-[#d0d9e8] bg-white px-2.5 py-1.5 text-left text-xs font-medium normal-case text-[#1e3a5f]'}>
      <span className="truncate">{label}</span><span aria-hidden="true" className="ml-2 text-[10px]">▾</span>
    </button>
    {open && <div role="listbox" aria-label="Clients" aria-multiselectable="true" className={`z-30 mt-1 max-h-64 overflow-y-auto rounded-lg border border-[#d0d9e8] bg-white p-2 normal-case shadow-lg ${appearance === 'form' ? 'relative w-full' : 'absolute left-0 top-full min-w-[240px]'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-1 text-[11px]">
        <button type="button" className="font-semibold text-[#1e3a5f] hover:underline" title="Sans sélection, le budget inclut tous les clients" onClick={() => onChange([])}>Tout désélectionner</button>
        <button type="button" className="text-slate-500 hover:underline" onClick={() => onChange(clients.map((client) => client.key))}>Tout sélectionner</button>
      </div>
      <p className="px-1.5 py-1 text-[10px] text-slate-500">Sans sélection : tous les clients.</p>
      {clients.length ? clients.map((client) => <label key={client.key} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1.5 text-xs font-medium normal-case text-slate-700 hover:bg-slate-50"><input type="checkbox" checked={selectedKeys.includes(client.key)} onChange={(event) => onChange(event.target.checked ? [...selectedKeys, client.key] : selectedKeys.filter((key) => key !== client.key))} />{client.label}</label>) : <span className="block px-1.5 py-2 text-xs font-medium normal-case text-slate-500">Aucun client disponible.</span>}
    </div>}
  </div>;
}
