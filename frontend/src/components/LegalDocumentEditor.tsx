import { useRef, type ReactNode } from 'react';
import {
  Bold,
  Eye,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  List,
  ListOrdered,
} from 'lucide-react';

type LegalDocumentEditorProps = {
  value: string;
  onChange: (value: string) => void;
  rows?: number;
};

type ToolbarAction = {
  label: string;
  icon: ReactNode;
  onClick: () => void;
};

const blockPrefixRegex = /^(#{1,3}\s+|[-*]\s+|\d+\.\s+)/;

function renderInline(text: string): ReactNode[] {
  const tokens = text.split(/(\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*)/g);

  return tokens.map((token, index) => {
    if ((token.startsWith('**') && token.endsWith('**')) || (token.startsWith('__') && token.endsWith('__'))) {
      return <strong key={index}>{token.slice(2, -2)}</strong>;
    }

    if (token.startsWith('*') && token.endsWith('*')) {
      return <em key={index}>{token.slice(1, -1)}</em>;
    }

    return token;
  });
}

export function LegalDocumentView({ content }: { content: string }) {
  const lines = content.split(/\r?\n/);
  const blocks: ReactNode[] = [];
  let listItems: string[] = [];
  let listType: 'ul' | 'ol' | null = null;

  const flushList = () => {
    if (!listType || listItems.length === 0) return;

    const ListTag = listType;
    blocks.push(
      <ListTag key={`list-${blocks.length}`} className={`pl-6 space-y-1 ${listType === 'ul' ? 'list-disc' : 'list-decimal'}`}>
        {listItems.map((item, index) => (
          <li key={index}>{renderInline(item)}</li>
        ))}
      </ListTag>,
    );
    listItems = [];
    listType = null;
  };

  lines.forEach((line, lineIndex) => {
    const trimmed = line.trim();

    if (!trimmed) {
      flushList();
      return;
    }

    const orderedMatch = trimmed.match(/^\d+\.\s+(.+)$/);
    const bulletMatch = trimmed.match(/^[-*]\s+(.+)$/);

    if (orderedMatch) {
      const nextMeaningfulLine = lines.slice(lineIndex + 1).find((nextLine) => nextLine.trim());
      const isStandaloneNumberedHeading = !listType && !nextMeaningfulLine?.trim().match(/^\d+\.\s+/);

      if (isStandaloneNumberedHeading) {
        flushList();
        blocks.push(
          <h3 key={`legacy-h-${blocks.length}`} className="text-xl font-semibold text-slate-900 mt-5 first:mt-0">
            {renderInline(trimmed)}
          </h3>,
        );
        return;
      }
    }

    if (orderedMatch || bulletMatch) {
      const nextType = orderedMatch ? 'ol' : 'ul';
      if (listType && listType !== nextType) {
        flushList();
      }
      listType = nextType;
      listItems.push((orderedMatch || bulletMatch)?.[1] || trimmed);
      return;
    }

    flushList();

    const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2];
      if (level === 1) {
        blocks.push(<h2 key={`h1-${blocks.length}`} className="text-2xl font-bold text-slate-900 mt-6 first:mt-0">{renderInline(text)}</h2>);
      } else if (level === 2) {
        blocks.push(<h3 key={`h2-${blocks.length}`} className="text-xl font-semibold text-slate-900 mt-5 first:mt-0">{renderInline(text)}</h3>);
      } else {
        blocks.push(<h4 key={`h3-${blocks.length}`} className="text-lg font-semibold text-slate-800 mt-4 first:mt-0">{renderInline(text)}</h4>);
      }
      return;
    }

    blocks.push(<p key={`p-${blocks.length}`} className="text-slate-700">{renderInline(trimmed)}</p>);
  });

  flushList();

  if (blocks.length === 0) {
    return <p className="text-slate-500 italic">Aucun contenu renseigné.</p>;
  }

  return <div className="space-y-3">{blocks}</div>;
}

export default function LegalDocumentEditor({ value, onChange, rows = 22 }: LegalDocumentEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const focusTextarea = (selectionStart?: number, selectionEnd?: number) => {
    window.setTimeout(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus();
      if (typeof selectionStart === 'number' && typeof selectionEnd === 'number') {
        textarea.setSelectionRange(selectionStart, selectionEnd);
      }
    }, 0);
  };

  const wrapSelection = (before: string, after: string, placeholder: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = value.slice(start, end) || placeholder;
    const nextValue = `${value.slice(0, start)}${before}${selected}${after}${value.slice(end)}`;

    onChange(nextValue);
    focusTextarea(start + before.length, start + before.length + selected.length);
  };

  const prefixSelectedLines = (prefix: string, placeholder: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const selectionStart = textarea.selectionStart;
    const selectionEnd = textarea.selectionEnd;
    const lineStart = value.lastIndexOf('\n', Math.max(selectionStart - 1, 0)) + 1;
    const lineEnd = selectionEnd > selectionStart
      ? selectionEnd
      : value.indexOf('\n', selectionEnd) === -1
        ? value.length
        : value.indexOf('\n', selectionEnd);
    const selectedBlock = value.slice(lineStart, lineEnd) || placeholder;
    const lines = selectedBlock.split('\n');
    const nextBlock = lines
      .map((line) => {
        if (!line.trim()) return line;
        return `${prefix}${line.replace(blockPrefixRegex, '')}`;
      })
      .join('\n');
    const nextValue = `${value.slice(0, lineStart)}${nextBlock}${value.slice(lineEnd)}`;

    onChange(nextValue);
    focusTextarea(lineStart, lineStart + nextBlock.length);
  };

  const actions: ToolbarAction[] = [
    {
      label: 'Titre principal',
      icon: <Heading1 className="w-4 h-4" />,
      onClick: () => prefixSelectedLines('# ', 'Titre principal'),
    },
    {
      label: 'Sous-titre',
      icon: <Heading2 className="w-4 h-4" />,
      onClick: () => prefixSelectedLines('## ', 'Sous-titre'),
    },
    {
      label: 'Titre de section',
      icon: <Heading3 className="w-4 h-4" />,
      onClick: () => prefixSelectedLines('### ', 'Titre de section'),
    },
    {
      label: 'Gras',
      icon: <Bold className="w-4 h-4" />,
      onClick: () => wrapSelection('**', '**', 'texte en gras'),
    },
    {
      label: 'Italique',
      icon: <Italic className="w-4 h-4" />,
      onClick: () => wrapSelection('*', '*', 'texte en italique'),
    },
    {
      label: 'Liste à puces',
      icon: <List className="w-4 h-4" />,
      onClick: () => prefixSelectedLines('- ', 'Élément de liste'),
    },
    {
      label: 'Liste numérotée',
      icon: <ListOrdered className="w-4 h-4" />,
      onClick: () => prefixSelectedLines('1. ', 'Élément de liste'),
    },
  ];

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      <div className="border border-slate-300 rounded-lg overflow-hidden bg-white">
        <div className="flex flex-wrap items-center gap-1 p-2 border-b border-slate-200 bg-slate-50">
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              title={action.label}
              onClick={action.onClick}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-700 hover:bg-white hover:text-prosps-blue hover:shadow-sm"
            >
              {action.icon}
            </button>
          ))}
        </div>
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={rows}
          className="w-full resize-y px-4 py-3 focus:outline-none font-mono text-sm leading-6"
        />
      </div>

      <div className="border border-slate-200 rounded-lg bg-white p-4 min-h-[360px]">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-600 mb-4">
          <Eye className="w-4 h-4" />
          Aperçu
        </div>
        <LegalDocumentView content={value} />
      </div>
    </div>
  );
}
