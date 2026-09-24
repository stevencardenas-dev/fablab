import { Image } from 'expo-image';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DataMatrixCode, DataMatrixDownloadButton, DataMatrixSheetButton } from '@/components/data-matrix';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import {
  findByRoom,
  historialElemento,
  listarSalas,
  registrarTraslado,
  removeItem,
  updateItem,
  type CamposEditables,
  type InventoryItem,
  type Room,
  type TrasladoHistorial,
} from '@/lib/inventory';

// Los mismos campos que el server acepta por PUT (CAMPOS_EDITABLES). El codigo
// no se edita (es lo impreso en el Data Matrix); mover de sala es un traslado.
type CampoTexto = 'detalle' | 'serial' | 'estado' | 'observaciones' | 'cantidad';
const CAMPOS_TEXTO: CampoTexto[] = ['detalle', 'serial', 'estado', 'observaciones', 'cantidad'];
const LABELS: Record<CampoTexto | 'inventario', string> = {
  detalle: 'Detalle',
  serial: 'Serial',
  estado: 'Estado',
  observaciones: 'Observaciones',
  cantidad: 'Cantidad',
  inventario: 'N° Inventario',
};

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
  const { height: screenH } = useWindowDimensions();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [selected, setSelected] = useState<InventoryItem | null>(null);
  const [confirmCodigo, setConfirmCodigo] = useState<string | null>(null);
  const [salaNombre, setSalaNombre] = useState<string>('');
  const [salas, setSalas] = useState<Room[]>([]);
  const [edit, setEdit] = useState<CamposEditables>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [traslados, setTraslados] = useState<{ id: number; lista: TrasladoHistorial[] } | null>(null);

  const load = useCallback(() => {
    if (!Number.isFinite(salaId)) return;
    findByRoom(salaId).then(setItems);
    listarSalas().then((lista) => {
      setSalas(lista);
      const s = lista.find((sl) => sl.id === salaId);
      if (s) setSalaNombre(s.nombre);
    });
  }, [salaId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // Historial del elemento seleccionado: se pide al abrir el modal (una query
  // pequeña). Se guarda junto al id del elemento: si otro modal se abre antes
  // de que resuelva, el render descarta el historial viejo sin resets manuales.
  useEffect(() => {
    const id = selected?.id;
    if (id == null) return;
    let viva = true;
    historialElemento(id)
      .then((lista) => { if (viva) setTraslados({ id, lista }); })
      .catch(() => { if (viva) setTraslados({ id, lista: [] }); });
    return () => { viva = false; };
  }, [selected?.id]);

  function closeModal() {
    setSelected(null);
    setConfirmCodigo(null);
    setEdit({});
    setSaveError(null);
  }

  // Solo los campos que el usuario tocó van al PUT: el server rechaza un
  // update sin ningún campo editable ("Campos editables: ...").
  async function handleSave() {
    if (!selected || saving) return;
    const campos = Object.fromEntries(
      Object.entries(edit).filter(([k, v]) => v !== (selected as Record<string, unknown>)[k]),
    ) as CamposEditables;
    if (!Object.keys(campos).length) {
      closeModal();
      return;
    }
    if (selected.id == null) {
      setSaveError('Este elemento no tiene id (no está en la base); no se puede editar.');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await updateItem(selected.id, campos);
      setEdit({});
      setSelected((prev) => (prev ? { ...prev, ...campos } : prev));
      load();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  }

  async function handleMover(salaNuevaId: number) {
    if (!selected || selected.id == null || saving) return;
    if (salaNuevaId === selected.sala_id) return;
    setSaving(true);
    setSaveError(null);
    try {
      await registrarTraslado({ elementoId: selected.id, salaNuevaId, nota: null });
      setSelected(null);
      load();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'No se pudo mover el elemento');
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove(codigo: string) {
    if (saving) return;
    if (confirmCodigo !== codigo) {
      setConfirmCodigo(codigo);
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await removeItem(codigo);
      closeModal();
      load();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'No se pudo eliminar el elemento');
    } finally {
      setSaving(false);
    }
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

          {/* Reetiquetar la sala completa: una hoja A4 con todas las etiquetas. */}
          {items.length > 0 && (
            <View style={styles.sheetAction}>
              <DataMatrixSheetButton
                codigos={items.map((item) => item.codigo)}
                label={`Imprimir etiquetas de la sala (${items.length})`}
                archivo={`sala-${salaNombre || nombre}`}
                ayuda="Abre una hoja A4 con todas las etiquetas de esta sala (o guarda el PDF desde el diálogo de impresión)."
              />
            </View>
          )}

          {items.length === 0 && (
            <ThemedText themeColor="textSecondary" style={styles.empty}>
              Sin elementos registrados en esta sala.
            </ThemedText>
          )}

          <View style={styles.pillList}>
            {items.map((item, idx) => (
              <Pressable key={item.id ?? item.codigo ?? `idx-${idx}`} accessibilityRole="button" onPress={() => setSelected(item)} style={styles.pill}>
                {item.foto ? <Image source={{ uri: item.foto }} style={styles.thumb} /> : <View style={styles.thumbPlaceholder} />}
                <ThemedText type="smallBold" style={styles.pillLabel}>{item.detalle || item.codigo}</ThemedText>
              </Pressable>
            ))}
          </View>
        </SafeAreaView>
      </ScrollView>

      {selected && (
        <Pressable style={styles.modalBackdrop} onPress={saving ? undefined : closeModal}>
          {/* Altura máxima en px: en nativo, flex:1 dentro de un padre de altura automática
              colapsa a 0 (Yoga) y el modal queda invisible; en px explícitos nunca colapsa. */}
          <Pressable onPress={(e) => e.stopPropagation()} style={[styles.modalCardWrapper, { maxHeight: Math.round(screenH * 0.85) }]}>
            <ThemedView style={styles.modalCard}>
              <ScrollView style={[styles.modalScroll, { maxHeight: Math.round(screenH * 0.85) }]} contentContainerStyle={styles.modalContent}>
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

                <ThemedText type="smallBold" style={styles.detailLabel}>{fieldLabels.codigo}</ThemedText>
                <ThemedText style={styles.codigoValue}>{selected.codigo}</ThemedText>

                {/* La etiqueta original se pierde o se daña: desde la ficha de
                    cualquier elemento se vuelve a descargar el Data Matrix. */}
                {selected.codigo && (
                  <View style={styles.etiquetaBox}>
                    <DataMatrixCode value={selected.codigo} size={110} />
                    <DataMatrixDownloadButton codigo={selected.codigo} label="Descargar para imprimir" />
                    <ThemedText themeColor="textSecondary" type="small" style={styles.etiquetaHint}>
                      Imprime esta etiqueta si el código del elemento se perdió o se dañó.
                    </ThemedText>
                  </View>
                )}

                {CAMPOS_TEXTO.map((field) => (
                  <View key={field} style={styles.inputGroup}>
                    <ThemedText themeColor="textSecondary" type="small" style={styles.detailLabel}>{LABELS[field]}</ThemedText>
                    <TextInput
                      accessibilityLabel={LABELS[field]}
                      value={edit[field] ?? selected[field] ?? ''}
                      editable={!saving}
                      onChangeText={(value) => setEdit((prev) => ({ ...prev, [field]: value }))}
                      style={styles.input}
                      multiline={field === 'observaciones'}
                    />
                  </View>
                ))}

                <View style={styles.inputGroup}>
                  <ThemedText themeColor="textSecondary" type="small" style={styles.detailLabel}>{LABELS.inventario}</ThemedText>
                  <ThemedText type="smallBold">{selected.inventario || '-'}</ThemedText>
                </View>

                {salas.length > 1 && (
                  <View style={styles.inputGroup}>
                    <ThemedText themeColor="textSecondary" type="small" style={styles.detailLabel}>Mover a sala</ThemedText>
                    <View style={styles.roomChips}>
                      {salas
                        .filter((s) => s.id !== selected.sala_id)
                        .map((s) => (
                          <Pressable
                            key={s.id}
                            accessibilityRole="button"
                            disabled={saving}
                            onPress={() => handleMover(s.id)}
                            style={styles.roomChip}>
                            <ThemedText style={styles.roomChipLabel}>{s.nombre}</ThemedText>
                          </Pressable>
                        ))}
                    </View>
                  </View>
                )}

                {traslados && traslados.id === selected.id && traslados.lista.length > 0 && (
                  <View style={styles.inputGroup}>
                    <ThemedText themeColor="textSecondary" type="small" style={styles.detailLabel}>Historial de traslados</ThemedText>
                    {traslados.lista.map((t) => (
                      <View key={t.id} style={styles.trasladoRow}>
                        <ThemedText type="small">
                          {t.salaAnterior ? `${t.salaAnterior} → ${t.salaNueva}` : `→ ${t.salaNueva}`}
                        </ThemedText>
                        <ThemedText themeColor="textSecondary" type="small">
                          {t.fecha.slice(0, 10)}{t.nota ? ` · ${t.nota}` : ''}
                        </ThemedText>
                      </View>
                    ))}
                  </View>
                )}

                {saveError && <ThemedText style={styles.errorText}>{saveError}</ThemedText>}

                <Pressable
                  accessibilityRole="button"
                  disabled={saving}
                  onPress={handleSave}
                  style={[styles.removeButton, styles.saveButton, saving && styles.buttonDisabled]}>
                  {saving
                    ? <ActivityIndicator size="small" color="#FFFFFF" />
                    : <ThemedText style={styles.saveButtonLabel}>Guardar cambios</ThemedText>}
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  disabled={saving}
                  onPress={() => handleRemove(selected.codigo)}
                  style={[styles.removeButton, confirmCodigo === selected.codigo && styles.removeButtonConfirm, saving && styles.buttonDisabled]}>
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
  sheetAction: { width: '100%', marginTop: Spacing.four },
  empty: { marginTop: Spacing.four, lineHeight: 21 },
  pillList: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, marginTop: Spacing.four },
  pill: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, borderRadius: 20, borderWidth: 1, borderColor: '#C8102E', paddingVertical: Spacing.one, paddingHorizontal: Spacing.two, backgroundColor: 'transparent' },
  thumb: { width: 24, height: 24, borderRadius: 12 },
  thumbPlaceholder: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#C8102E22' },
  pillLabel: { color: '#C8102E', fontSize: 14 },
  photo: { width: '100%', aspectRatio: 4 / 3, borderRadius: 12 },
  photoPlaceholder: { width: '100%', aspectRatio: 4 / 3, borderRadius: 12, backgroundColor: '#C8102E11', alignItems: 'center', justifyContent: 'center' },
  detailLabel: { textTransform: 'uppercase', letterSpacing: 0.5 },
  removeButton: { minHeight: 44, borderRadius: 8, borderWidth: 1, borderColor: '#C8102E', alignItems: 'center', justifyContent: 'center', marginTop: Spacing.two },
  saveButton: { backgroundColor: '#C8102E', borderWidth: 0 },
  // Blanco sobre el botón rojo: removeButtonLabel es rojo (botón fantasma) y
  // sobre el fondo rojo dejaba el texto invisible.
  saveButtonLabel: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
  buttonDisabled: { opacity: 0.6 },
  errorText: { color: '#C8102E' },
  inputGroup: { gap: 2 },
  input: { minHeight: 42, borderWidth: 1, borderRadius: 8, borderColor: '#C8102E55', paddingHorizontal: Spacing.two, paddingVertical: 10, fontSize: 15 },
  roomChips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  roomChip: { minHeight: 34, borderRadius: 17, borderWidth: 1, borderColor: '#C8102E', paddingHorizontal: Spacing.two, alignItems: 'center', justifyContent: 'center' },
  roomChipLabel: { color: '#C8102E', fontSize: 13 },
  trasladoRow: { gap: 1, paddingVertical: 2 },
  codigoValue: { letterSpacing: 1, fontWeight: '700' },
  etiquetaBox: { alignItems: 'center', gap: Spacing.one, paddingVertical: Spacing.two },
  etiquetaHint: { textAlign: 'center' },
  removeButtonConfirm: { backgroundColor: '#C8102E' },
  removeButtonLabel: { color: '#C8102E', fontWeight: '700', fontSize: 14 },
  removeButtonLabelConfirm: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
  modalBackdrop: { position: Platform.OS === 'web' ? ('fixed' as 'absolute') : 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: Spacing.four, zIndex: 1000 },
  modalCardWrapper: { width: '100%', maxWidth: 420, display: 'flex' },
  modalCard: { borderRadius: 16, overflow: 'hidden', display: 'flex' },
  modalScroll: {},
  modalContent: { padding: Spacing.four, gap: Spacing.three },
  modalHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: Spacing.two },
  modalTitle: { flex: 1 },
});
