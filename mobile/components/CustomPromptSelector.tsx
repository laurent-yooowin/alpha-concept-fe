import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Modal,
  Pressable,
  View,
} from 'react-native';
import { Check, Square, ChevronDown, Search, X } from 'lucide-react-native';
import { CustomPrompt, customPromptService } from '@/services/customPromptService';

interface Props {
  missionType?: string;
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}

export default function CustomPromptSelector({
  missionType,
  selectedIds,
  onChange,
  disabled = false,
}: Props) {
  const [prompts, setPrompts] = useState<CustomPrompt[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!missionType) {
      setPrompts([]);
      return;
    }
    setLoading(true);
    setError('');
    customPromptService.getAvailable(missionType).then((response) => {
      if (cancelled) return;
      if (response.error) {
        setError(response.error);
        setPrompts([]);
        return;
      }
      const available = response.data || [];
      setPrompts(available);
      const availableIds = new Set(available.map((prompt) => prompt.id));
      const validSelection = selectedIds.filter((id) => availableIds.has(id));
      if (validSelection.length !== selectedIds.length) onChange(validSelection);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [missionType]);

  const selectedPrompts = useMemo(
    () => selectedIds
      .map((id) => prompts.find((prompt) => prompt.id === id))
      .filter(Boolean) as CustomPrompt[],
    [prompts, selectedIds],
  );
  const combinedContent = selectedPrompts.map((prompt) => prompt.content).join('\n\n');
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const filteredPrompts = prompts.filter((prompt) => !normalizedSearch || prompt.name.toLocaleLowerCase().includes(normalizedSearch));

  const toggle = (id: string) => {
    if (disabled) return;
    onChange(selectedIds.includes(id)
      ? selectedIds.filter((selectedId) => selectedId !== id)
      : [...selectedIds, id]);
  };

  const selectAll = () => {
    if (!disabled) onChange(Array.from(new Set([...selectedIds, ...prompts.map((prompt) => prompt.id)])));
  };

  const unselectAll = () => {
    if (!disabled) {
      const promptIds = new Set(prompts.map((prompt) => prompt.id));
      onChange(selectedIds.filter((id) => !promptIds.has(id)));
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>PROMPTS PERSONNALISÉS</Text>
        {loading && <ActivityIndicator size="small" color="#818CF8" />}
      </View>
      {!!error && <Text style={styles.error}>{error}</Text>}
      {!loading && !error && prompts.length === 0 && (
        <Text style={styles.empty}>Aucun prompt disponible pour {missionType || 'ce chantier'}.</Text>
      )}
      {prompts.length > 0 && (
        <>
          <TouchableOpacity style={[styles.trigger, disabled && styles.disabled]} onPress={() => !disabled && setOpen((value) => !value)} disabled={disabled}>
            <Text style={styles.triggerText}>{selectedPrompts.length ? String(selectedPrompts.length) + ' prompt(s) sélectionné(s)' : 'Sélectionner des prompts'}</Text>
            <ChevronDown size={18} color="#CBD5E1" />
          </TouchableOpacity>
          <Modal
            visible={open && !disabled}
            transparent
            animationType="fade"
            statusBarTranslucent
            onRequestClose={() => setOpen(false)}
          >
            <Pressable style={styles.dropdownOverlay} onPress={() => setOpen(false)}>
              <Pressable style={styles.modalMenu} onPress={(event) => event.stopPropagation()}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Sélectionner des prompts</Text>
                  <TouchableOpacity onPress={() => setOpen(false)}><X size={20} color="#CBD5E1" /></TouchableOpacity>
                </View>
                <View style={styles.actions}>
                  <TouchableOpacity style={styles.actionButton} onPress={selectAll}><Text style={styles.actionText}>Tout sélectionner</Text></TouchableOpacity>
                  <TouchableOpacity style={[styles.actionButton, styles.secondaryAction]} onPress={unselectAll}><Text style={styles.secondaryActionText}>Tout désélectionner</Text></TouchableOpacity>
                </View>
                <View style={styles.searchBox}>
                  <Search size={16} color="#94A3B8" />
                  <TextInput value={search} onChangeText={setSearch} placeholder="Rechercher un prompt..." placeholderTextColor="#64748B" style={styles.searchInput} autoCorrect={false} />
                </View>
                <ScrollView style={styles.optionsList} nestedScrollEnabled={true} scrollEnabled={true} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={true}>
                  {filteredPrompts.length === 0 ? <Text style={styles.empty}>Aucun résultat.</Text> : filteredPrompts.map((prompt) => {
                    const selected = selectedIds.includes(prompt.id);
                    return <TouchableOpacity key={prompt.id} style={[styles.option, selected && styles.optionSelected]} onPress={() => toggle(prompt.id)}>
                      {selected ? <View style={styles.check}><Check size={14} color="#FFFFFF" /></View> : <Square size={20} color="#94A3B8" />}
                      <Text style={styles.optionName}>{prompt.name}</Text>
                    </TouchableOpacity>;
                  })}
                </ScrollView>
              </Pressable>
            </Pressable>
          </Modal>
          {selectedPrompts.length > 0 && (
            <View style={styles.selectedList}>
              {selectedPrompts.map((prompt) => (
                <View key={prompt.id} style={styles.selectedChip}>
                  <Text style={styles.selectedChipText}>{prompt.name}</Text>
                  {!disabled && <TouchableOpacity onPress={() => toggle(prompt.id)}><X size={14} color="#C7D2FE" /></TouchableOpacity>}
                </View>
              ))}
            </View>
          )}
        </>
      )}
      {prompts.length > 0 && (
        <>
          <Text style={styles.previewLabel}>CONTENU INJECTÉ — LECTURE SEULE</Text>
          <ScrollView
            style={styles.preview}
            contentContainerStyle={styles.previewContent}
            nestedScrollEnabled={true}
            scrollEnabled={true}
            showsVerticalScrollIndicator={true}
            persistentScrollbar={true}
          >
            <Text style={combinedContent ? styles.previewText : styles.previewPlaceholder}>
              {combinedContent || 'Sélectionnez un ou plusieurs prompts.'}
            </Text>
          </ScrollView>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#312E81',
    borderColor: '#6366F1',
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  title: { color: '#C7D2FE', fontSize: 12, fontFamily: 'Inter-Bold', letterSpacing: 0.8 },
  error: { color: '#FCA5A5', fontSize: 12 },
  empty: { color: '#CBD5E1', fontSize: 12 },
  trigger: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#0F172A', borderWidth: 1, borderColor: '#475569', borderRadius: 10, padding: 12, marginBottom: 8 },
  triggerText: { color: '#E2E8F0', fontSize: 13, fontFamily: 'Inter-Regular' },
  dropdownOverlay: { flex: 1, backgroundColor: 'rgba(2, 6, 23, 0.65)', justifyContent: 'center', padding: 20 },
  modalMenu: { maxHeight: '75%', backgroundColor: '#0F172A', borderColor: '#6366F1', borderWidth: 1, borderRadius: 14, padding: 14 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  modalTitle: { color: '#F8FAFC', fontSize: 14, fontFamily: 'Inter-Bold' },
  actions: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  actionButton: { flex: 1, alignItems: 'center', borderRadius: 8, borderWidth: 1, borderColor: '#818CF8', paddingVertical: 8 },
  secondaryAction: { borderColor: '#64748B' },
  actionText: { color: '#C7D2FE', fontSize: 11, fontFamily: 'Inter-SemiBold' },
  secondaryActionText: { color: '#CBD5E1', fontSize: 11, fontFamily: 'Inter-SemiBold' },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#1E293B', borderColor: '#475569', borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, marginBottom: 8 },
  searchInput: { flex: 1, color: '#E2E8F0', fontSize: 13, paddingVertical: 9 },
  optionsList: { height: 220 },
  selectedList: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
  selectedChip: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#4338CA', borderRadius: 20, paddingHorizontal: 9, paddingVertical: 5 },
  selectedChipText: { color: '#EEF2FF', fontSize: 11, fontFamily: 'Inter-SemiBold' },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#1E293B',
    borderColor: '#475569',
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
  },
  optionSelected: { borderColor: '#818CF8', backgroundColor: '#3730A3' },
  disabled: { opacity: 0.6 },
  check: {
    width: 20,
    height: 20,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#6366F1',
  },
  optionName: { color: '#F8FAFC', fontSize: 13, fontFamily: 'Inter-SemiBold' },
  optionType: { color: '#94A3B8', fontSize: 10, marginTop: 2 },
  previewLabel: { color: '#A5B4FC', fontSize: 10, fontFamily: 'Inter-Bold', marginTop: 6, marginBottom: 6 },
  preview: {
    height: 200,
    backgroundColor: '#0F172A',
    borderRadius: 10,
  },
  previewContent: { padding: 12, flexGrow: 1 },
  previewText: { color: '#E2E8F0', fontSize: 12, lineHeight: 18 },
  previewPlaceholder: { color: '#64748B', fontSize: 12, lineHeight: 18 },
});
