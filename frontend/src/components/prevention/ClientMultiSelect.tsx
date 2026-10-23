import MultiSelect from './MultiSelect';

type ClientOption = { key: string; label: string };

export default function ClientMultiSelect({ clients, selectedKeys, onChange, appearance = 'compact', label = 'Clients', allLabel = 'Tous les clients' }: {
  clients: ClientOption[];
  selectedKeys: string[];
  onChange: (keys: string[]) => void;
  appearance?: 'compact' | 'form';
  label?: string;
  allLabel?: string;
}) {
  const noun = label.toLocaleLowerCase('fr-FR').startsWith('entreprise') ? 'entreprise' : 'client';
  return <MultiSelect options={clients} selectedKeys={selectedKeys} onChange={onChange} label={label} allLabel={allLabel} selectedLabel={(count) => `${count} ${noun}(s)`} emptyLabel={`Aucun${noun === 'entreprise' ? 'e' : ''} ${noun} disponible.`} appearance={appearance} />;
}
