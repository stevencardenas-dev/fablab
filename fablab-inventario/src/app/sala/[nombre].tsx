import { Image } from 'expo-image';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { findByRoom, listarSalas, removeItem, type InventoryItem } from '@/lib/inventory';

const fieldLabels: Record<string, string> = {
  codigo: 'Código',
  detalle: 'Detalle',
  serial: 'Serial',
  inventario: 'N° Inventario',
  estado: 'Estado',
  observaciones: 'Observaciones',
  cantidad: 'Cantidad',
  foto: 'Foto',
};

export default function SalaScreen() {
  const { nombre } = useLocalSearchParams<{ nombre: string }>();
  const salaId = Number(nombre);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [selected, setSelected] = useState<InventoryItem | null>(null);
  const [confirmCodigo, setConfirmCodigo] = useState<string | null>(null);
  const [salaNombre, setSalaNombre] = useState<string>('');

  const load = useCallback(() => {
    if (!Number.isFinite(salaId)) return;
    findByRoom(salaId).then(setItems);
    listarSalas().then((salas) => {
      const s = salas.find((sl) => sl.id === salaId);
      if (s) setSalaNombre(s.nombre);
    });
  }, [salaId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  function closeModal() {
    setSelected(null);
    setConfirmCodigo(null);
  }

  async function handleRemove(codigo: string) {
    if (confirmCodigo !== codigo) {
      setConfirmCodigo(codigo);
      return;
    }
    await removeItem(codigo);
    closeModal();
    load();
  }

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <SafeAreaView style={styles.content}>
          <Pressable
            accessibilityRole="button"
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/explore'))}
            style={styles.backButton}>
            <ThemedText type="smallBold" style={styles.backLabel}>‹ Inventario</ThemedText>
          </Pressable>

          <ThemedText type="title" style={styles.title}>{salaNombre || nombre}</ThemedText>

          {items.length === 0 && (
            <ThemedText themeColor="textSecondary" style={styles.empty}>
              Sin elementos registrados en esta sala.
            </ThemedText>
          )}

          <View style={styles.pillList}>
            {items.map((item) => (
              <Pressable key={item.codigo} accessibilityRole="button" onPress={() => setSelected(item)} style={styles.pill}>
                {item.foto ? <Image source={{ uri: item.foto }} style={styles.thumb} /> : <View style={styles.thumbPlaceholder} />}
                <ThemedText type="smallBold" style={styles.pillLabel}>{item.detalle || item.codigo}</ThemedText>
              </Pressable>
            ))}
          </View>
        </SafeAreaView>
      </ScrollView>

      {selected && (
        <Pressable style={styles.modalBackdrop} onPress={closeModal}>
          <Pressable onPress={(e) => e.stopPropagation()} style={styles.modalCardWrapper}>
            <ThemedView style={styles.modalCard}>
              <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalContent}>
                <View style={styles.modalHeader}>
                  <ThemedText type="subtitle" style={styles.modalTitle}>{selected.detalle || selected.codigo}</ThemedText>
                  <Pressable accessibilityRole="button" onPress={closeModal} hitSlop={8}>
                    <ThemedText type="smallBold" style={styles.backLabel}>✕</ThemedText>
                  </Pressable>
                </View>

                {selected.foto ? (
                  <Image source={{ uri: selected.foto }} style={styles.photo} contentFit="cover" />
                ) : (
                  <View style={styles.photoPlaceholder}>
                    <ThemedText themeColor="textSecondary">Sin foto</ThemedText>
                  </View>
                )}

                <View style={styles.detailGrid}>
                  {(['codigo', 'serial', 'inventario', 'estado', 'cantidad'] as const).map((field) => (
                    <View key={field} style={styles.detailCell}>
                      <ThemedText themeColor="textSecondary" type="small" style={styles.detailLabel}>{fieldLabels[field]}</ThemedText>
                      <ThemedText type="smallBold">{selected[field] || '-'}</ThemedText>
                    </View>
                  ))}
                </View>

                {selected.observaciones ? (
                  <View style={styles.observaciones}>
                    <ThemedText themeColor="textSecondary" type="small" style={styles.detailLabel}>{fieldLabels.observaciones}</ThemedText>
                    <ThemedText>{selected.observaciones}</ThemedText>
                  </View>
                ) : null}

                <Pressable
                  accessibilityRole="button"
                  onPress={() => handleRemove(selected.codigo)}
                  style={[styles.removeButton, confirmCodigo === selected.codigo && styles.removeButtonConfirm]}>
                  <ThemedText style={confirmCodigo === selected.codigo ? styles.removeButtonLabelConfirm : styles.removeButtonLabel}>
                    {confirmCodigo === selected.codigo ? '¿Seguro? Toca de nuevo' : 'Eliminar'}
                  </ThemedText>
                </Pressable>
              </ScrollView>
            </ThemedView>
          </Pressable>
        </Pressable>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { flexGrow: 1, alignItems: 'center' },
  content: { width: '100%', maxWidth: MaxContentWidth, paddingHorizontal: Spacing.four, paddingBottom: BottomTabInset + Spacing.four },
  backButton: { marginTop: Spacing.six, alignSelf: 'flex-start' },
  backLabel: { color: '#C8102E' },
  title: { color: '#C8102E', marginTop: Spacing.two },
  empty: { marginTop: Spacing.four, lineHeight: 21 },
  pillList: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, marginTop: Spacing.four },
  pill: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, borderRadius: 20, borderWidth: 1, borderColor: '#C8102E', paddingVertical: Spacing.one, paddingHorizontal: Spacing.two, backgroundColor: 'transparent' },
  thumb: { width: 24, height: 24, borderRadius: 12 },
  thumbPlaceholder: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#C8102E22' },
  pillLabel: { color: '#C8102E', fontSize: 14 },
  photo: { width: '100%', aspectRatio: 4 / 3, borderRadius: 12 },
  photoPlaceholder: { width: '100%', aspectRatio: 4 / 3, borderRadius: 12, backgroundColor: '#C8102E11', alignItems: 'center', justifyContent: 'center' },
  detailGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three, marginTop: Spacing.one },
  detailCell: { minWidth: '40%', gap: 2 },
  detailLabel: { textTransform: 'uppercase', letterSpacing: 0.5 },
  observaciones: { gap: 2 },
  removeButton: { minHeight: 44, borderRadius: 8, borderWidth: 1, borderColor: '#C8102E', alignItems: 'center', justifyContent: 'center', marginTop: Spacing.two },
  removeButtonConfirm: { backgroundColor: '#C8102E' },
  removeButtonLabel: { color: '#C8102E', fontWeight: '700', fontSize: 14 },
  removeButtonLabelConfirm: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
  modalBackdrop: { position: Platform.OS === 'web' ? ('fixed' as 'absolute') : 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: Spacing.four, zIndex: 1000 },
  modalCardWrapper: { width: '100%', maxWidth: 420, maxHeight: '85%', flexShrink: 1, display: 'flex' },
  modalCard: { borderRadius: 16, overflow: 'hidden', flex: 1, display: 'flex' },
  modalScroll: { flex: 1 },
  modalContent: { padding: Spacing.four, gap: Spacing.three },
  modalHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: Spacing.two },
  modalTitle: { flex: 1 },
});
