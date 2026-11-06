// Pantalla de una sala (/sala/:id): elementos con miniatura, ficha editable,
// traslado a otra sala, historial, fotos y etiquetas Data Matrix por lote.
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { DataMatrixCode, DataMatrixDownloadButton, DataMatrixSheetButton } from '@/components/data-matrix';
import { prepararFotoParaSubir } from '@/lib/foto-optimizar';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, MaxContentWidthEscritorio, Spacing } from '@/constants/theme';
import { estiloRejilla, useDisposicion } from '@/hooks/use-disposicion';
import { useTheme, useThemeMode } from '@/hooks/use-theme';
import {
  asignarCodigo,
  eliminarFoto,
  filtrarElementos,
  findByRoom,
  generateCodigo,
  historialElemento,
  listarSalas,
  registrarTraslado,
  removeItem,
  subirFoto,
  updateItem,
  urlFoto,
  type CamposEditables,
  type InventoryItem,
  type Room,
  type TrasladoHistorial,
} from '@/lib/inventory';
import { mensajeDeError } from '@/lib/mensajes';

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

export default function SalaScreen() {
  const { nombre, elemento } = useLocalSearchParams<{ nombre: string; elemento?: string }>();
  const salaId = Number(nombre);
  const { height: screenH } = useWindowDimensions();
  const { escritorio, columnas } = useDisposicion();
  const theme = useTheme();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [selected, setSelected] = useState<InventoryItem | null>(null);
  const [confirmCodigo, setConfirmCodigo] = useState<string | null>(null);
  const [salaNombre, setSalaNombre] = useState<string>('');
  const [salaEdificio, setSalaEdificio] = useState<string>('');
  const [salas, setSalas] = useState<Room[]>([]);
  const [cargando, setCargando] = useState(true);
  // Ficha (o tarjeta) bajo el mouse, solo web: el borde se enciende con el tema.
  const [resaltado, setResaltado] = useState<number | null>(null);
  const [edit, setEdit] = useState<CamposEditables>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [traslados, setTraslados] = useState<{ id: number; lista: TrasladoHistorial[] } | null>(null);
  // La foto se reduce en el teléfono antes de subirla: sin eso, cada foto de
  // cámara serían 1-2,5 MB y el inventario completo no cabría en el servidor.
  const [fotoEstado, setFotoEstado] = useState<string | null>(null);
  const [fotoResumen, setFotoResumen] = useState<string | null>(null);

  // Elementos importados de la hoja que quedaron sin N° de inventario: no
  // tienen Data Matrix que imprimir hasta que se les asigne un código.
  const sinCodigo = items.filter((item) => !item.codigo).length;

  // Filtro de la sala: una sala tiene hasta 171 elementos y buscarlos a ojo era
  // bajar y bajar. Usa la misma regla que la búsqueda de Inicio (multi-palabra,
  // sin tildes, por relevancia) pero solo sobre los elementos de esta sala; sin
  // consulta devuelve la lista tal cual.
  const [filtro, setFiltro] = useState('');
  const [filtroEnfocado, setFiltroEnfocado] = useState(false);
  const visibles = useMemo(() => filtrarElementos(items, filtro), [items, filtro]);
  const filtrando = filtro.trim() !== '';

  // Rejilla de fichas: en celular dos columnas — antes eran píldoras de una
  // línea con borde rojo y 171 elementos hacían una pared de bordes; en
  // escritorio va una columna más que la rejilla de salas, que es lo que el
  // ancho extra permite.
  const columnasSala = escritorio ? (columnas >= 3 ? 4 : 3) : 2;

  // Precarga de la foto grande: el modal muestra primero la miniatura (placeholder)
  // y ~200-600 ms después hace el fundido a la foto de 1200 px — se ve "borroso →
  // nítido". onPressIn dispara ~100-300 ms ANTES que onPress (y onHoverIn en web),
  // así la descarga va en camino antes de abrir el modal y casi siempre llega
  // nítido de una. Falla en silencio: el modal ya revalida por su cuenta.
  const precargarFoto = (item: InventoryItem) => {
    const url = urlFoto(item, 'foto');
    if (url) Image.prefetch(url, 'memory-disk').catch(() => {});
  };

  // URL de la foto del elemento abierto (null si no tiene): el listado solo trae
  // `foto_hash`, así que la imagen se pide al mostrarla, no al cargar el inventario.
  // La foto grande tarda ~350-600 ms en llegar (WAN + Render); mientras tanto,
  // el placeholder muestra la miniatura del chip, que ya está en la caché de
  // memoria (memoryCachePolicy): el modal abre con imagen en vez de cuadrado vacío.
  const fotoGrande = urlFoto(selected, 'foto');
  const fotoMiniatura = urlFoto(selected);

  // El elemento que pide la URL se abre una sola vez (ver `load`).
  const elementoPedido = useRef<string | null>(null);
  const load = useCallback(() => {
    if (!Number.isFinite(salaId)) return;
    setCargando(true);
    findByRoom(salaId).then((lista) => {
      setItems(lista);
      setCargando(false);
      // Se llegó desde "Ver ficha" en la búsqueda de Inicio (?elemento=<id>): se
      // abre esa ficha sola. Se consume una sola vez para que, al volver a esta
      // sala, la ficha que ya se abrió no se vuelva a abrir sola.
      if (elemento && elementoPedido.current !== elemento) {
        elementoPedido.current = elemento;
        const pedido = lista.find((item) => String(item.id) === String(elemento));
        if (pedido) setSelected(pedido);
      }
    });
    listarSalas().then((lista) => {
      setSalas(lista);
      const s = lista.find((sl) => sl.id === salaId);
      if (s) {
        setSalaNombre(s.nombre);
        setSalaEdificio(s.edificio);
      }
    });
  }, [salaId, elemento]);

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

  const closeModal = useCallback(() => {
    setSelected(null);
    setConfirmCodigo(null);
    setEdit({});
    setSaveError(null);
    setFotoEstado(null);
    setFotoResumen(null);
  }, []);

  // Escape cierra la ficha: en web, además del clic en el fondo.
  useEffect(() => {
    if (Platform.OS !== 'web' || !selected) return;
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) closeModal();
    };
    window.addEventListener('keydown', alTeclear);
    return () => window.removeEventListener('keydown', alTeclear);
  }, [selected, saving, closeModal]);

  async function handleFoto(asset: ImagePicker.ImagePickerAsset) {
    if (!selected?.id || saving) return;
    setSaving(true);
    setSaveError(null);
    setFotoResumen(null);
    try {
      setFotoEstado('Optimizando foto…');
      const optimizada = await prepararFotoParaSubir({
        uri: asset.uri,
        ancho: asset.width,
        alto: asset.height,
        pesoOriginalBytes: asset.fileSize,
      });
      setFotoEstado('Subiendo foto…');
      const hash = await subirFoto(selected.id, optimizada);
      // El hash nuevo cambia la URL: expo-image pide la imagen nueva sola.
      setSelected((prev) => (prev ? { ...prev, foto_hash: hash } : prev));
      setFotoResumen(`Foto guardada: ${optimizada.resumen}`);
      load();
    } catch (e) {
      setSaveError(mensajeDeError(e, 'No se pudo guardar la foto'));
    } finally {
      setFotoEstado(null);
      setSaving(false);
    }
  }

  async function elegirFoto(origen: 'camara' | 'galeria') {
    if (saving) return;
    const result = origen === 'camara'
      ? await ImagePicker.launchCameraAsync({ allowsEditing: true, aspect: [4, 3] })
      : await ImagePicker.launchImageLibraryAsync({ allowsEditing: true, aspect: [4, 3] });
    if (!result.canceled) await handleFoto(result.assets[0]);
  }

  async function handleQuitarFoto() {
    if (!selected?.id || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await eliminarFoto(selected.id);
      setSelected((prev) => (prev ? { ...prev, foto_hash: undefined } : prev));
      setFotoResumen(null);
      load();
    } catch (e) {
      setSaveError(mensajeDeError(e, 'No se pudo quitar la foto'));
    } finally {
      setSaving(false);
    }
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
      setSaveError(mensajeDeError(e, 'No se pudo guardar'));
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
      setSaveError(mensajeDeError(e, 'No se pudo mover el elemento'));
    } finally {
      setSaving(false);
    }
  }

  // Los importados de la hoja pueden venir sin código; sin código no hay Data
  // Matrix. Se le asigna uno nuevo (mismo formato que el alta desde la app).
  async function handleAsignarCodigo() {
    if (!selected || selected.id == null || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const codigo = generateCodigo();
      await asignarCodigo(selected.id, codigo);
      setSelected((prev) => (prev ? { ...prev, codigo } : prev));
      load();
    } catch (e) {
      setSaveError(mensajeDeError(e, 'No se pudo asignar el código'));
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
      setSaveError(mensajeDeError(e, 'No se pudo eliminar el elemento'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <SafeAreaView style={[styles.content, escritorio && styles.contentEscritorio]}>
          <Pressable
            accessibilityRole="button"
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/explore'))}
            style={styles.backButton}>
            <ThemedText type="smallBold" style={[styles.backLabel, { color: theme.accent }]}>‹ Inventario</ThemedText>
          </Pressable>

          <ThemedText type="title" style={[styles.title, { color: theme.accent }]}>{salaNombre || `Sala ${nombre}`}</ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.subtitle}>
            {filtrando ? `${visibles.length} de ${items.length} elementos` : `${items.length} elemento${items.length === 1 ? '' : 's'}`}
            {salaEdificio ? ` · ${salaEdificio}` : ''}
            {sinCodigo > 0 ? ` · ${sinCodigo} sin código` : ''}
          </ThemedText>

          {/* Reetiquetar la sala completa: una hoja A4 con todas las etiquetas. */}
          {items.length > 0 && (
            <View style={styles.sheetAction}>
              <DataMatrixSheetButton
                codigos={items.map((item) => item.codigo)}
                omitidos={items.filter((item) => !item.codigo).length}
                label={`Imprimir etiquetas de la sala (${items.length - sinCodigo})`}
                archivo={`sala-${salaNombre || nombre}`}
                ayuda="Abre una hoja paginada con todas las etiquetas de esta sala (elige A4 o Carta al imprimir, o guarda el PDF desde el diálogo)."
              />
            </View>
          )}

          {/* Filtro de la sala: aparece cuando la lista es larga. */}
          {items.length > 8 && (
            <View style={[styles.filtro, escritorio && styles.filtroEscritorio]}>
              <TextInput
                accessibilityLabel="Filtrar elementos de esta sala"
                placeholder="Filtrar por nombre, código o serial"
                placeholderTextColor={theme.textSecondary}
                value={filtro}
                onChangeText={setFiltro}
                onFocus={() => setFiltroEnfocado(true)}
                onBlur={() => setFiltroEnfocado(false)}
                style={[
                  styles.filtroCampo,
                  { color: theme.text, backgroundColor: theme.backgroundElement, borderColor: filtroEnfocado ? theme.accent : theme.backgroundSelected },
                ]}
              />
              {filtrando && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Limpiar el filtro"
                  onPress={() => setFiltro('')}
                  style={({ pressed }) => [styles.filtroLimpiar, pressed && styles.presionado]}>
                  <ThemedText type="smallBold" style={{ color: theme.accent }}>Limpiar</ThemedText>
                </Pressable>
              )}
            </View>
          )}

          {filtrando && visibles.length === 0 && (
            <View style={[styles.aviso, styles.avisoFiltro, { borderColor: `${theme.accent}44`, backgroundColor: `${theme.accent}0F` }]}>
              <ThemedText type="smallBold">Sin coincidencias</ThemedText>
              <ThemedText themeColor="textSecondary" type="small" style={styles.avisoTexto}>
                Ningún elemento de esta sala coincide con «{filtro.trim()}».
              </ThemedText>
            </View>
          )}

          {items.length === 0 && cargando && (
            <View style={styles.pillList}>
              {Array.from({ length: columnasSala * 3 }).map((_, i) => (
                <View
                  key={`hueco-${i}`}
                  style={[styles.tile, styles.tileHueco, estiloRejilla(columnasSala), { backgroundColor: theme.backgroundElement }]}
                />
              ))}
            </View>
          )}

          {items.length === 0 && !cargando && (
            <View style={[styles.aviso, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText themeColor="textSecondary">Sin elementos registrados en esta sala.</ThemedText>
            </View>
          )}

          <View style={styles.pillList}>
            {visibles.map((item, idx) => {
              const miniatura = urlFoto(item);
              const activa = resaltado === item.id;
              // El nombre puede faltar (los importados a veces traen solo el
              // código): ahí el código hace de título y no se repite abajo.
              const titulo = item.detalle || item.codigo || 'Sin nombre';
              const sub = item.detalle ? (item.codigo || 'Sin código') : (item.serial || '');
              return (
                <Pressable
                  key={item.id ?? item.codigo ?? `idx-${idx}`}
                  accessibilityRole="button"
                  accessibilityLabel={`Abrir ${titulo}`}
                  onPress={() => setSelected(item)}
                  onPressIn={() => precargarFoto(item)}
                  onHoverIn={() => { precargarFoto(item); setResaltado(item.id ?? null); }}
                  onHoverOut={() => setResaltado((id) => (id === item.id ? null : id))}
                  style={({ pressed }) => [
                    styles.tile,
                    estiloRejilla(columnasSala),
                    { backgroundColor: theme.backgroundElement, borderColor: activa || pressed ? theme.accent : 'transparent' },
                    pressed && styles.tilePressed,
                  ]}>
                  {/* memoryCachePolicy: la miniatura queda viva en RAM, así el
                      placeholder del modal la reutiliza sin re-pedirla. */}
                  {miniatura
                    ? <Image source={{ uri: miniatura }} style={styles.thumb} contentFit="cover" cachePolicy="memory" />
                    : <View style={[styles.thumb, { backgroundColor: theme.backgroundSelected }]} />}
                  <View style={styles.tileTexto}>
                    <ThemedText type="smallBold" numberOfLines={2}>{titulo}</ThemedText>
                    {sub ? (
                      <ThemedText themeColor="textSecondary" type="small" numberOfLines={1} style={styles.tileCodigo}>{sub}</ThemedText>
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
        </SafeAreaView>
      </ScrollView>

      {selected && (
        <Pressable style={[styles.modalBackdrop, { backgroundColor: 'rgba(0,0,0,0.55)' }]} onPress={saving ? undefined : closeModal}>
          {/* Altura máxima en px: en nativo, flex:1 dentro de un padre de altura automática
              colapsa a 0 (Yoga) y el modal queda invisible; en px explícitos nunca colapsa. */}
          <Pressable
            accessibilityViewIsModal
            onPress={(e) => e.stopPropagation()}
            style={[styles.modalCardWrapper, escritorio && styles.modalCardWrapperEscritorio, { maxHeight: Math.round(screenH * 0.85) }]}>
            <ThemedView style={[styles.modalCard, { borderColor: theme.backgroundSelected }]}>
              {/* Encabezado fijo: la ficha puede ser larga y el botón de cerrar
                  no debería irse con el scroll. */}
              <View style={[styles.modalHeader, { borderBottomColor: theme.backgroundSelected }]}>
                <View style={styles.modalHeaderTexto}>
                  <ThemedText type="subtitle" style={styles.modalTitle} numberOfLines={2}>
                    {selected.detalle || selected.codigo || 'Sin nombre'}
                  </ThemedText>
                  <ThemedText style={[styles.codeChip, { backgroundColor: theme.backgroundSelected, color: theme.accent }]} numberOfLines={1}>
                    {selected.codigo || 'Sin código'}
                  </ThemedText>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Cerrar"
                  onPress={closeModal}
                  hitSlop={8}
                  style={[styles.closeButton, { backgroundColor: theme.backgroundSelected }]}>
                  <Svg width={15} height={15} viewBox="0 0 24 24" fill="none">
                    <Path d="M5 5l14 14M19 5L5 19" stroke={theme.text} strokeWidth={2.4} strokeLinecap="round" />
                  </Svg>
                </Pressable>
              </View>

              <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalContent}>

                {fotoGrande ? (
                  <Image
                    source={{ uri: fotoGrande }}
                    style={styles.photo}
                    contentFit="cover"
                    placeholder={fotoMiniatura}
                    placeholderContentFit="cover"
                    transition={150}
                    cachePolicy="memory"
                  />
                ) : (
                  <View style={[styles.photoPlaceholder, { backgroundColor: theme.backgroundSelected }]}>
                    <ThemedText themeColor="textSecondary">Sin foto</ThemedText>
                  </View>
                )}

                {/* La foto se toma aquí y se sube ya reducida (1200 px + miniatura),
                    para que el inventario completo quepa en el servidor. */}
                <View style={styles.photoActions}>
                  <Pressable
                    accessibilityRole="button"
                    disabled={saving || selected.id == null}
                    onPress={() => elegirFoto('camara')}
                    style={[styles.photoButton, styles.photoButtonPrimario, { backgroundColor: theme.accent, borderColor: theme.accent }, (saving || selected.id == null) && styles.buttonDisabled]}>
                    <ThemedText style={styles.photoButtonLabelPrimario}>{fotoGrande ? 'Reemplazar foto' : 'Tomar foto'}</ThemedText>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    disabled={saving || selected.id == null}
                    onPress={() => elegirFoto('galeria')}
                    style={[styles.photoButton, { borderColor: theme.accent }, (saving || selected.id == null) && styles.buttonDisabled]}>
                    <ThemedText style={[styles.photoButtonLabel, { color: theme.accent }]}>Galería</ThemedText>
                  </Pressable>
                  {fotoGrande && (
                    <Pressable
                      accessibilityRole="button"
                      disabled={saving}
                      onPress={handleQuitarFoto}
                      style={[styles.photoButton, { borderColor: theme.backgroundSelected }, saving && styles.buttonDisabled]}>
                      <ThemedText style={[styles.photoButtonLabel, { color: theme.textSecondary }]}>Quitar foto</ThemedText>
                    </Pressable>
                  )}
                </View>
                {fotoEstado && <ThemedText themeColor="textSecondary" type="small">{fotoEstado}</ThemedText>}
                {fotoResumen && <ThemedText themeColor="textSecondary" type="small">{fotoResumen}</ThemedText>}

                <View style={[styles.seccion, { borderTopColor: theme.backgroundSelected }]}>
                  <ThemedText themeColor="textSecondary" type="small" style={styles.seccionTitulo}>Etiqueta Data Matrix</ThemedText>

                {/* La etiqueta original se pierde o se daña: desde la ficha de
                    cualquier elemento se vuelve a descargar el Data Matrix. */}
                {selected.codigo ? (
                  <View style={styles.etiquetaBox}>
                    <DataMatrixCode value={selected.codigo} size={110} />
                    <DataMatrixDownloadButton codigo={selected.codigo} label="Descargar para imprimir" />
                    <ThemedText themeColor="textSecondary" type="small" style={styles.etiquetaHint}>
                      Imprime esta etiqueta si el código del elemento se perdió o se dañó.
                    </ThemedText>
                  </View>
                ) : (
                  <View style={styles.etiquetaBox}>
                    <ThemedText themeColor="textSecondary" type="small" style={styles.etiquetaHint}>
                      Este elemento no tiene código, así que todavía no hay Data Matrix que imprimir.
                    </ThemedText>
                    <Pressable
                      accessibilityRole="button"
                      disabled={saving || selected.id == null}
                      onPress={handleAsignarCodigo}
                      style={[styles.removeButton, styles.saveButton, (saving || selected.id == null) && styles.buttonDisabled]}>
                      {saving
                        ? <ActivityIndicator size="small" color="#FFFFFF" />
                        : <ThemedText style={styles.saveButtonLabel}>Asignar código</ThemedText>}
                    </Pressable>
                    <ThemedText themeColor="textSecondary" type="small" style={styles.etiquetaHint}>
                      Se le asigna un código nuevo; después ya se puede descargar su etiqueta.
                    </ThemedText>
                  </View>
                )}

                </View>

                <View style={[styles.seccion, { borderTopColor: theme.backgroundSelected }]}>
                  <ThemedText themeColor="textSecondary" type="small" style={styles.seccionTitulo}>Datos del elemento</ThemedText>
                  {CAMPOS_TEXTO.map((field) => (
                    <CampoModal
                      key={field}
                      label={LABELS[field]}
                      value={String(edit[field] ?? selected[field] ?? '')}
                      editable={!saving}
                      multiline={field === 'observaciones'}
                      onChangeText={(value) => setEdit((prev) => ({ ...prev, [field]: value }))}
                    />
                  ))}

                <View style={styles.inputGroup}>
                  <ThemedText themeColor="textSecondary" type="small" style={styles.detailLabel}>{LABELS.inventario}</ThemedText>
                  <ThemedText type="smallBold">{selected.inventario || '-'}</ThemedText>
                </View>
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
                            style={[styles.roomChip, { borderColor: theme.accent }]}>
                            <ThemedText style={[styles.roomChipLabel, { color: theme.accent }]}>{s.nombre}</ThemedText>
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

                {saveError && <ThemedText style={[styles.errorText, { color: theme.accent }]}>{saveError}</ThemedText>}
              </ScrollView>

              {/* Pie fijo: con la ficha larga, Guardar quedaba al final del scroll. */}
              <View style={[styles.modalPie, { borderTopColor: theme.backgroundSelected, backgroundColor: theme.backgroundElement }]}>
                <Pressable
                  accessibilityRole="button"
                  disabled={saving}
                  onPress={handleSave}
                  style={[styles.botonGuardar, { backgroundColor: theme.accent }, saving && styles.buttonDisabled]}>
                  {saving
                    ? <ActivityIndicator size="small" color="#FFFFFF" />
                    : <ThemedText style={styles.saveButtonLabel}>Guardar cambios</ThemedText>}
                </Pressable>

                {/* Sin código no hay DELETE posible (la API borra por código), así
                    que el botón no se ofrece: para esos está "Asignar código". */}
                {selected.codigo ? (
                <Pressable
                  accessibilityRole="button"
                  disabled={saving}
                  onPress={() => handleRemove(selected.codigo)}
                  style={[
                    styles.botonEliminar,
                    { borderColor: confirmCodigo === selected.codigo ? theme.accent : theme.backgroundSelected },
                    confirmCodigo === selected.codigo && { backgroundColor: theme.accent },
                    saving && styles.buttonDisabled,
                  ]}>
                  <ThemedText style={[styles.botonEliminarLabel, { color: confirmCodigo === selected.codigo ? '#FFFFFF' : theme.accent }]}>
                    {confirmCodigo === selected.codigo ? '¿Seguro?' : 'Eliminar'}
                  </ThemedText>
                </Pressable>
                ) : null}
              </View>
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
  contentEscritorio: { maxWidth: MaxContentWidthEscritorio },
  backButton: { marginTop: Spacing.six, alignSelf: 'flex-start' },
  backLabel: { color: '#C8102E' },
  title: { color: '#C8102E', marginTop: Spacing.two },
  subtitle: { marginTop: Spacing.one, lineHeight: 21 },
  sheetAction: { width: '100%', marginTop: Spacing.four },
  aviso: { width: '100%', borderRadius: 12, padding: Spacing.four },
  avisoFiltro: { marginTop: Spacing.three, borderWidth: 1, gap: Spacing.half, padding: Spacing.three },
  avisoTexto: { lineHeight: 19 },
  // Filtro de la sala: campo con el anillo del acento al enfocar, como los del
  // resto de la app.
  filtro: { marginTop: Spacing.three, gap: Spacing.two },
  filtroEscritorio: { flexDirection: 'row', alignItems: 'center' },
  filtroCampo: { flex: 1, minHeight: 46, borderRadius: 8, borderWidth: 1, paddingHorizontal: Spacing.three, fontSize: 15 },
  filtroLimpiar: { minHeight: 46, justifyContent: 'center', paddingHorizontal: Spacing.two },
  presionado: { opacity: 0.6 },
  // gap de 8 y no de 16: con el tope del 48.5% por ficha, un gap mayor no deja
  // entrar dos columnas en un celular de 400 px y las fichas caían de a una.
  pillList: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, marginTop: Spacing.four, width: '100%' },
  tile: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderRadius: 12, borderWidth: 1, paddingVertical: Spacing.two, paddingHorizontal: Spacing.two + Spacing.one, minHeight: 64, overflow: 'hidden' },
  tilePressed: { opacity: 0.88 },
  tileHueco: { opacity: 0.5, borderColor: 'transparent' },
  tileTexto: { flex: 1, gap: Spacing.half },
  tileCodigo: { fontSize: 12, lineHeight: 16 },
  thumb: { width: 44, height: 44, borderRadius: 10 },
  photo: { width: '100%', aspectRatio: 4 / 3, borderRadius: 12 },
  photoActions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one, marginTop: Spacing.two },
  photoButton: { minHeight: 36, borderRadius: 18, borderWidth: 1, borderColor: '#C8102E', paddingHorizontal: Spacing.two, alignItems: 'center', justifyContent: 'center' },
  photoButtonPrimario: { paddingHorizontal: Spacing.three },
  photoButtonLabel: { color: '#C8102E', fontSize: 13, fontWeight: '700' },
  photoButtonLabelPrimario: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  photoPlaceholder: { width: '100%', aspectRatio: 4 / 3, borderRadius: 12, backgroundColor: '#C8102E11', alignItems: 'center', justifyContent: 'center' },
  detailLabel: { textTransform: 'uppercase', letterSpacing: 0.5 },
  seccion: { borderTopWidth: 1, paddingTop: Spacing.three, gap: Spacing.two },
  seccionTitulo: { textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: '700' },
  removeButton: { minHeight: 44, borderRadius: 8, borderWidth: 1, borderColor: '#C8102E', alignItems: 'center', justifyContent: 'center', marginTop: Spacing.two },
  saveButton: { backgroundColor: '#C8102E', borderWidth: 0 },
  // Blanco sobre el botón rojo: removeButtonLabel es rojo (botón fantasma) y
  // sobre el fondo rojo dejaba el texto invisible.
  saveButtonLabel: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
  buttonDisabled: { opacity: 0.6 },
  errorText: { color: '#C8102E' },
  // Pie de la ficha: Guardar ocupa dos tercios y Eliminar el resto, así caben
  // en una sola línea en cualquier celular.
  modalPie: { flexDirection: 'row', gap: Spacing.two, padding: Spacing.three, paddingHorizontal: Spacing.four, borderTopWidth: 1 },
  botonGuardar: { flex: 2, minHeight: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  botonEliminar: { flex: 1, minHeight: 44, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  botonEliminarLabel: { fontWeight: '700', fontSize: 14 },
  inputGroup: { gap: Spacing.half },
  input: { minHeight: 42, borderWidth: 1, borderRadius: 8, paddingHorizontal: Spacing.two, paddingVertical: 10, fontSize: 15 },
  inputEnfocado: { boxShadow: '0 0 0 3px rgba(200, 16, 46, 0.16)' },
  inputEnfocadoOscuro: { boxShadow: '0 0 0 3px rgba(240, 90, 110, 0.22)' },
  roomChips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  roomChip: { minHeight: 34, borderRadius: 17, borderWidth: 1, borderColor: '#C8102E', paddingHorizontal: Spacing.two, alignItems: 'center', justifyContent: 'center' },
  roomChipLabel: { color: '#C8102E', fontSize: 13 },
  trasladoRow: { gap: 1, paddingVertical: 2 },
  etiquetaBox: { alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.three, borderRadius: 12 },
  etiquetaHint: { textAlign: 'center' },
  removeButtonConfirm: { backgroundColor: '#C8102E' },
  removeButtonLabelConfirm: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
  modalBackdrop: { position: Platform.OS === 'web' ? ('fixed' as 'absolute') : 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: Spacing.four, zIndex: 1000 },
  modalCardWrapper: { width: '100%', maxWidth: 420, display: 'flex' },
  // Ficha más ancha en escritorio: la foto y los campos respiran.
  modalCardWrapperEscritorio: { maxWidth: 600 },
  // flexShrink: en web (y en Yoga) los hijos no encogen por defecto, así que sin
  // esto la ficha se pasaba del maxHeight del contenedor y el pie quedaba fuera.
  modalCard: { flexShrink: 1, borderRadius: 16, overflow: 'hidden', display: 'flex', borderWidth: 1, boxShadow: '0 18px 48px rgba(0, 0, 0, 0.28)' },
  // flexShrink y no flex:1: con altura automática, flex:1 en nativo colapsa a 0
  // (Yoga) y el cuerpo de la ficha desaparece.
  modalScroll: { flexShrink: 1 },
  modalContent: { padding: Spacing.four, gap: Spacing.three },
  modalHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: Spacing.two, padding: Spacing.four, paddingBottom: Spacing.three, borderBottomWidth: 1 },
  modalHeaderTexto: { flex: 1, gap: Spacing.one },
  codeChip: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: Spacing.two, paddingVertical: Spacing.half, fontSize: 13, fontWeight: '700', letterSpacing: 0.5, overflow: 'hidden' },
  closeButton: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  modalTitle: { fontSize: 24, lineHeight: 30 },
});

/**
 * Campo de la ficha con anillo de foco, igual que los del alta en Inicio: el
 * borde neutro no compite con el rojo de la marca y el foco se nota.
 */
function CampoModal({ label, value, editable, multiline, onChangeText }: {
  label: string;
  value: string;
  editable: boolean;
  multiline?: boolean;
  onChangeText: (value: string) => void;
}) {
  const theme = useTheme();
  const modo = useThemeMode();
  const [enfocado, setEnfocado] = useState(false);
  return (
    <View style={styles.inputGroup}>
      <ThemedText themeColor="textSecondary" type="small" style={styles.detailLabel}>{label}</ThemedText>
      <TextInput
        accessibilityLabel={label}
        value={value}
        editable={editable}
        multiline={multiline}
        onChangeText={onChangeText}
        onFocus={() => setEnfocado(true)}
        onBlur={() => setEnfocado(false)}
        placeholderTextColor={theme.textSecondary}
        style={[
          styles.input,
          { color: theme.text, backgroundColor: theme.backgroundElement, borderColor: enfocado ? theme.accent : theme.backgroundSelected },
          enfocado && styles.inputEnfocado,
          enfocado && modo === 'dark' && styles.inputEnfocadoOscuro,
        ]}
      />
    </View>
  );
}
