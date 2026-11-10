import { useId, type ReactNode } from 'react';
import { Info } from 'lucide-react';

type InfoTooltipProps = {
  label: string;
  children: ReactNode;
};

export default function InfoTooltip({ label, children }: InfoTooltipProps) {
  const tooltipId = useId();

  return <span className="group relative inline-flex shrink-0">
    <button
      type="button"
      aria-label={label}
      aria-describedby={tooltipId}
      className="inline-flex h-6 w-6 items-center justify-center rounded-full text-[#1e3a5f] hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1e3a5f]"
    >
      <Info size={16} aria-hidden="true" />
    </button>
    <span
      id={tooltipId}
      role="tooltip"
      className="pointer-events-none invisible absolute right-0 top-full z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-slate-200 bg-white p-3 text-left text-xs font-normal leading-relaxed text-slate-700 opacity-0 shadow-lg transition-opacity group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
    >
      {children}
    </span>
  </span>;
}
