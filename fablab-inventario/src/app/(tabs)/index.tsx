// Pantalla Inicio: agregar elemento (con foto y Data Matrix), escanear un
// código, buscar, exportar (CSV/JSON) e importar inventario (solo web).
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { useState, useEffect, useCallback } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DataMatrixCode, DataMatrixDownloadButton, DataMatrixSheetButton, descargarDataMatrix } from '@/components/data-matrix';
import { Scanner } from '@/components/scanner';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxAnchoControlEscritorio, MaxContentWidth, MaxContentWidthEscritorio, Spacing } from '@/constants/theme';
import { useDisposicion } from '@/hooks/use-disposicion';
import { useSesion } from '@/hooks/use-sesion';
import { useTheme, useThemeMode, useToggleTheme } from '@/hooks/use-theme';
import { prepararFotoParaSubir, type FotoOptimizada } from '@/lib/foto-optimizar';
import { addItem, buscarElementos, descargarExportacion, exportarUrl, findByCodigo, generateCodigo, importarInventario, listarSalas, resetCache, resumenImportacion, subirFoto, type InventoryItem, type Room } from '@/lib/inventory';
import { mensajeDeError } from '@/lib/mensajes';
import { cerrarSesion } from '@/lib/sesion';

function newElement(): InventoryItem {
  return {
    codigo: generateCodigo(),
    detalle: '',
    serial: '',
    inventario: '',
    estado: '',
    observaciones: '',
    cantidad: '',
  };
}

// Solo web: abre el selector de archivos del navegador. En nativo no hay picker.
function elegirArchivo(alElegir: (archivo: ArrayBuffer) => void) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.csv,.xlsx,.xls,.ods';
  input.onchange = async () => {
    const archivo = input.files?.[0];
    if (archivo) alElegir(await archivo.arrayBuffer());
  };
  input.click();
}

export default function HomeScreen() {
  const [mensajeImport, setMensajeImport] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportEstado, setExportEstado] = useState<string | null>(null);
  const importarArchivoInventario = () => elegirArchivo(async (archivo) => {
    setMensajeImport('Importando…');
    try {
      const r = await importarInventario(archivo);
      setMensajeImport(resumenImportacion(r).join('\n'));
    } catch (e) {
      setMensajeImport(`No se pudo importar: ${mensajeDeError(e)}`);
    }
  });

  const theme = useTheme();
  const themeMode = useThemeMode();
  const toggleTheme = useToggleTheme();
  const { usuario } = useSesion();
  // En pantallas angostas (celular) las fichas van en filas; en anchas, en tres columnas.
  const { escritorio } = useDisposicion();
  const [openAction, setOpenAction] = useState<'scan' | 'add' | 'search' | 'export' | null>(null);
  const [element, setElement] = useState<InventoryItem>(newElement);
  // Sala de destino: la BD la guarda como FK (sala_id), NO dentro del campo
  // `inventario` (ese es el "N° INVENTARIO" de la hoja). Sin sala_id el server
  // rechaza el POST con 400.
  const [salaId, setSalaId] = useState<number | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [addSaving, setAddSaving] = useState(false);
  const [savedCodigo, setSavedCodigo] = useState<string | null>(null);
  // La foto se optimiza al capturarla, no al guardar: el usuario ve de una
  // cuánto pasó a pesar (una foto de móvil pasa de MB a decenas o cientos de KB)
  // y el momento de guardar no se alarga con una espera de conversión.
  const [foto, setFoto] = useState<FotoOptimizada | null>(null);
  const [fotoEstado, setFotoEstado] = useState<string | null>(null);
  const [fotoError, setFotoError] = useState<string | null>(null);
  const [scannedItem, setScannedItem] = useState<InventoryItem | null | undefined>(undefined);
  // Mientras se resuelve el código leído: la consulta puede ir a la red y sin
  // aviso la cámara parece no haber leído nada.
  const [buscandoCodigo, setBuscandoCodigo] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [searchName, setSearchName] = useState('');
  const [searchResults, setSearchResults] = useState<InventoryItem[] | null>(null);
  // La búsqueda tiene estado propio: en la primera búsqueda hay que bajar el
  // inventario de la red (≈1 s) y sin aviso la pantalla parece no responder.
  const [buscando, setBuscando] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [salas, setSalas] = useState<Room[]>([]);

  useEffect(() => {
    listarSalas().then((s) => {
      if (s.length) setSalas(s);
    });
  }, []);

  async function salir() {
    await cerrarSesion();
    await resetCache(); // que no quede el inventario guardado en este dispositivo
  }

  function openPanel(panel: 'scan' | 'add' | 'search' | 'export') {
    const next = openAction === panel ? null : panel;
    setOpenAction(next);
    // La búsqueda —que va siempre visible arriba— y el último código escaneado
    // se conservan al cambiar de panel: antes, abrir otro panel borraba la
    // consulta y sus resultados, y había que teclear de nuevo. El formulario de
    // alta sí se rehace (abajo) porque es una captura nueva.
    setExportEstado(null);
    setAddError(null);
    setSavedCodigo(null);
    setFotoError(null);
    if (next === 'add') {
      setElement(newElement());
      setSalaId(null);
      setFoto(null);
      setFotoEstado(null);
    }
  }

  async function handleScanned(codigo: string) {
    setBuscandoCodigo(true);
    setScanError(null);
    try {
      const leido = (await findByCodigo(codigo)) ?? null;
      setScannedItem(leido);
      // Escanear es "ir al elemento", no "leer una tarjeta y dar un clic más":
      // si el código existe, su ficha se abre sola (mismo camino que el botón
      // "Ver ficha") y el panel vuelve a la cámara para la siguiente etiqueta,
      // que es como se recorre el laboratorio. Si el código no existe o no trae
      // sala, queda la tarjeta con el aviso de siempre.
      if (leido && leido.id != null && leido.sala_id != null) {
        setScannedItem(undefined);
        abrirFicha(leido);
      }
    } catch (e) {
      // Sin respuesta (sin red) no se puede afirmar que el código no exista: se
      // deja la cámara lista para volver a intentar y se explica el fallo.
      setScannedItem(undefined);
      setScanError(mensajeDeError(e, 'No se pudo consultar el código. Revisa tu conexión e intenta de nuevo.'));
    } finally {
      setBuscandoCodigo(false);
    }
  }

  async function handleAdd() {
    if (!element.detalle || salaId == null) {
      setAddError('Detalle y sala son obligatorios.');
      return;
    }
    if (addSaving) return;
    setAddSaving(true);
    setAddError(null);
    const fotoPendiente = foto;
    try {
      const guardado = await addItem({ ...element, sala_id: salaId });
      const codigo = guardado.codigo || element.codigo;
      // La foto se sube DESPUÉS del alta porque necesita el id que asigna la
      // base. Si falla, el elemento ya está guardado: se avisa y no se finge
      // que todo salió bien (pero tampoco se pierde el elemento).
      if (fotoPendiente && guardado.id != null) {
        try {
          await subirFoto(guardado.id, fotoPendiente);
        } catch (e) {
          setFotoError(
            `El elemento se guardó, pero la foto no se pudo subir. ${mensajeDeError(e)}`,
          );
        }
      }
      // El bloque de "Guardado" sale cuando ya no queda nada pendiente (tampoco
      // la foto): si apareciera antes, el botón diría "Guardando…" debajo del
      // cartel de éxito.
      setSavedCodigo(codigo);
      setElement(newElement());
      setSalaId(null);
      setFoto(null);
      // En web el archivo se entrega solo: el usuario acaba de crear el elemento
      // y necesita la etiqueta ya, sin un clic extra. En nativo la descarga abre
      // la hoja de compartir, y abrirla sin que la pidan interrumpe el flujo:
      // ahí queda el botón. Si esta descarga automática falla, el botón sigue
      // ahí como respaldo (por eso no se reporta el error aquí).
      if (Platform.OS === 'web') descargarDataMatrix(codigo).catch(() => {});
    } catch (e) {
      setAddError(mensajeDeError(e, 'No se pudo guardar. Revisa tu conexión e intenta de nuevo.'));
    } finally {
      setAddSaving(false);
    }
  }

  /**
   * Busca ya (botón o Enter). La búsqueda viva espera 250 ms a que se deje de
   * teclear; esto no espera nada. Una consulta vacía no busca: deja el panel
   * como estaba en vez de mostrar "sin resultados" de algo que nadie escribió.
   */
  const buscarAhora = useCallback(async (consulta: string) => {
    const texto = consulta.trim();
    if (!texto) {
      setSearchResults(null);
      setBuscando(false);
      setSearchError(null);
      return;
    }
    setBuscando(true);
    setSearchError(null);
    try {
      setSearchResults(await buscarElementos(texto));
    } catch (e) {
      setSearchResults(null);
      setSearchError(mensajeDeError(e, 'No se pudo buscar. Revisa tu conexión e intenta de nuevo.'));
    } finally {
      setBuscando(false);
    }
  }, []);

  // Búsqueda viva: al escribir se busca solo, 250 ms después de la última tecla.
  // En PC apuntarle al botón después de teclear era un paso de más; el botón
  // sigue ahí para forzarla y el campo responde a Enter.
  useEffect(() => {
    const t = setTimeout(() => { void buscarAhora(searchName); }, 250);
    return () => clearTimeout(t);
  }, [searchName, buscarAhora]);

  function limpiarBusqueda() {
    setSearchName('');
    setSearchResults(null);
    setSearchError(null);
  }

  /**
   * Abre la ficha del elemento en su sala (la ficha vive en /sala/[nombre]) y la
   * sala la abre sola al llegar. Sin esto, la búsqueda solo dejaba descargar la
   * etiqueta: no había forma de ver, corregir o mover lo que se encontró.
   */
  function abrirFicha(item: InventoryItem) {
    if (item.id == null || item.sala_id == null) return;
    router.push({ pathname: '/sala/[nombre]', params: { nombre: String(item.sala_id), elemento: String(item.id) } });
  }

  /**
   * Descarga una exportación. En web se baja por fetch (y no abriendo la URL en
   * una pestaña) para poder avisar en pantalla si el server responde error: el
   * enlace directo mostraría el JSON crudo. En nativo se deja que el sistema
   * abra la URL, que es como se guarda o comparte el archivo.
   */
  async function descargarExport(recurso: 'elementos' | 'traslados', formato: 'csv' | 'json') {
    setExportError(null);
    setExportEstado('Preparando la descarga…');
    if (Platform.OS !== 'web') {
      void Linking.openURL(exportarUrl(recurso, formato));
      return;
    }
    try {
      const { contenido, nombre } = await descargarExportacion(recurso, formato);
      const tipo = formato === 'csv' ? 'text/csv;charset=utf-8' : 'application/json';
      const url = URL.createObjectURL(new Blob([contenido], { type: tipo }));
      const enlace = document.createElement('a');
      enlace.href = url;
      enlace.download = nombre;
      document.body.appendChild(enlace);
      enlace.click();
      enlace.remove();
      URL.revokeObjectURL(url);
      // Confirmación en pantalla: la descarga del navegador puede quedar abajo,
      // en la barra de descargas, y así el usuario sabe que sí se hizo.
      setExportEstado(`Listo: ${nombre}`);
    } catch (e) {
      setExportEstado(null);
      setExportError(mensajeDeError(e, 'No se pudo descargar el archivo. Revisa tu conexión e intenta de nuevo.'));
    }
  }

  // Sin `quality` en el selector: el original entra tal cual y la única
  // compresión con pérdida la hace nuestra reducción a 1200 px (comprimir dos
  // veces solo acumula artefactos sin bajar el peso final).
  async function optimizarFoto(asset: ImagePicker.ImagePickerAsset) {
    setFotoError(null);
    setFotoEstado('Optimizando foto…');
    try {
      setFoto(
        await prepararFotoParaSubir({
          uri: asset.uri,
          ancho: asset.width,
          alto: asset.height,
          pesoOriginalBytes: asset.fileSize,
        }),
      );
    } catch (e) {
      setFoto(null);
      setFotoError(mensajeDeError(e, 'No se pudo procesar la foto.'));
    } finally {
      setFotoEstado(null);
    }
  }

  async function handleTakePhoto() {
    const result = await ImagePicker.launchCameraAsync({ allowsEditing: true, aspect: [4, 3] });
    if (!result.canceled) await optimizarFoto(result.assets[0]);
  }

  async function handlePickPhoto() {
    const result = await ImagePicker.launchImageLibraryAsync({ allowsEditing: true, aspect: [4, 3] });
    if (!result.canceled) await optimizarFoto(result.assets[0]);
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView style={styles.scrollView} contentContainerStyle={[styles.scrollContent, escritorio && styles.scrollContentEscritorio]} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Cerrar la sesión de ${usuario ?? 'la cuenta'}`}
            onPress={salir}
            style={({ pressed }) => [styles.cuentaPildora, { borderColor: theme.textSecondary }, pressed && styles.pressed]}>
            <PersonIcon color={theme.textSecondary} />
            <ThemedText type="small" themeColor="textSecondary">{usuario}</ThemedText>
            <ThemedText type="smallBold" style={styles.cuentaSalir}>Salir</ThemedText>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Cambiar modo claro u oscuro" onPress={toggleTheme} style={styles.themeButton}>
            {themeMode === 'dark' ? <SunIcon color={theme.accent} /> : <MoonIcon color={theme.accent} />}
          </Pressable>
        </View>
        <View style={styles.marca}>
          <Image source={require('@/assets/images/cubo-fablab.png')} style={styles.marcaCubo} contentFit="contain" accessibilityLabel="FabLab UFPS" />
          <ThemedText type="title" style={[styles.title, styles.marcaTitulo]}>FabLab UFPS</ThemedText>
        </View>
        <View style={styles.institucion}>
          <Image source={require('@/assets/images/ufps-logo.png')} style={styles.marcaUfps} contentFit="contain" accessibilityLabel="Universidad Francisco de Paula Santander" />
          <ThemedText themeColor="textSecondary" style={[styles.subtitle, styles.institucionTexto]}>Universidad Francisco de Paula Santander</ThemedText>
        </View>
        <View style={styles.actionList}>
          {salas.length > 0 && (
            <View style={styles.resumen}>
              <ThemedView type="backgroundElement" style={styles.resumenTarjeta}>
                <ThemedText style={styles.resumenNumero}>{salas.reduce((n, sala) => n + sala.elementos, 0).toLocaleString('es')}</ThemedText>
                <ThemedText themeColor="textSecondary" type="small">elementos</ThemedText>
              </ThemedView>
              <ThemedView type="backgroundElement" style={styles.resumenTarjeta}>
                <ThemedText style={styles.resumenNumero}>{salas.length}</ThemedText>
                <ThemedText themeColor="textSecondary" type="small">salas</ThemedText>
              </ThemedView>
            </View>
          )}

          <ActionPanel>
          <View style={styles.panelTitulo}>
            <View style={styles.panelIcono}><SearchIcon /></View>
            <ThemedText type="subtitle" style={styles.panelTituloTexto}>Buscar elemento</ThemedText>
          </View>
            <View style={styles.inputGroup}>
              <ThemedText type="smallBold" style={styles.inputLabel}>CÓDIGO, NOMBRE O SERIAL</ThemedText>
              <View style={[styles.searchRow, escritorio && styles.searchRowEscritorio]}>
                <FormInput sinEtiqueta sinTope label="CÓDIGO, NOMBRE O SERIAL" placeholder="Ej. CNC-137, taladro, aire" value={searchName} onChangeText={setSearchName} onEnviar={() => void buscarAhora(searchName)} theme={theme} contenedorStyle={styles.searchCampo} />
                <PanelButton label="Buscar" onPress={() => void buscarAhora(searchName)} disabled={!searchName.trim()} enFila />
                {(searchName !== '' || searchResults !== null) && (
                  <Pressable accessibilityRole="button" onPress={limpiarBusqueda} style={({ pressed }) => [styles.limpiar, pressed && styles.pressed]}>
                    <ThemedText type="smallBold" style={[styles.limpiarLabel, { color: theme.accent }]}>Limpiar</ThemedText>
                  </Pressable>
                )}
              </View>
            </View>
            {buscando && <ThemedText themeColor="textSecondary" style={styles.buscando}>Buscando…</ThemedText>}
            {!buscando && searchResults !== null && searchResults.length > 0 && (
              <ThemedText style={styles.searchCount}>
                {searchResults.length} resultad{searchResults.length === 1 ? 'o' : 'os'}
              </ThemedText>
            )}
            {searchError && <ThemedText style={styles.errorText}>{searchError}</ThemedText>}
            {searchResults !== null && searchResults.length > 0 && (
              <DataMatrixSheetButton
                codigos={searchResults.map((item) => item.codigo)}
                omitidos={searchResults.filter((item) => !item.codigo).length}
                label={`Imprimir etiquetas de los resultados (${searchResults.filter((item) => item.codigo).length})`}
                archivo={`busqueda-${searchName}`}
                ayuda="Repone las etiquetas perdidas de estos resultados en una sola hoja paginada, en A4 o Carta."
              />
            )}
            <View style={escritorio ? styles.searchResultsGrid : undefined}>
            {searchResults?.map((item, idx) => (
              <TarjetaElemento
                key={item.id ?? item.codigo ?? `sr-${idx}`}
                item={item}
                sala={salas.find((s) => s.id === item.sala_id)}
                onAbrir={item.id != null && item.sala_id != null ? () => abrirFicha(item) : undefined}
                theme={theme}
                estilo={escritorio ? styles.searchCardEscritorio : undefined}
              />
            ))}
            </View>
            {!buscando && searchResults?.length === 0 && (
              <View style={styles.searchEmpty}>
                <ThemedText style={styles.searchEmptyIcon}>🔍</ThemedText>
                <ThemedText themeColor="textSecondary" style={styles.searchEmptyText}>Sin resultados para &ldquo;{searchName.trim()}&rdquo;</ThemedText>
                <ThemedText themeColor="textSecondary" type="small" style={styles.searchEmptyHint}>Prueba con palabras clave, códigos o seriales</ThemedText>
              </View>
            )}
          </ActionPanel>

          <View style={[styles.fichas, !escritorio && styles.fichasColumna]}>
            <ActionTile icon="qrcode.viewfinder" label="Escanear" hint="Lee la etiqueta" isOpen={openAction === 'scan'} onPress={() => openPanel('scan')} />
            <ActionTile icon="plus" label="Agregar" hint="Nuevo elemento" isOpen={openAction === 'add'} onPress={() => openPanel('add')} />
            <ActionTile icon="export" label="Exportar" hint="CSV, JSON o Excel" isOpen={openAction === 'export'} onPress={() => openPanel('export')} />
          </View>

          {openAction === 'scan' && <ActionPanel>
            {scannedItem === undefined && !scanError && (
              <>
                <ThemedText themeColor="textSecondary" style={styles.description}>Apunta la cámara al Data Matrix del elemento: se busca el código y su ficha se abre sola.</ThemedText>
                <Scanner onScanned={handleScanned} />
              </>
            )}
            {buscandoCodigo && <ThemedText themeColor="textSecondary" style={styles.buscando}>Buscando el elemento…</ThemedText>}
            {scannedItem === null && (
              <View style={[styles.aviso, { borderColor: `${theme.accent}44`, backgroundColor: `${theme.accent}0F` }]}>
                <ThemedText type="smallBold">Sin coincidencias</ThemedText>
                <ThemedText themeColor="textSecondary" type="small" style={styles.avisoTexto}>
                  Ese código no pertenece a ningún elemento del inventario. Revisa que la etiqueta sea la correcta, o búscalo por nombre.
                </ThemedText>
              </View>
            )}
            {scanError && <ThemedText style={styles.errorText}>{scanError}</ThemedText>}
            {scannedItem && (
              <TarjetaElemento
                item={scannedItem}
                sala={salas.find((s) => s.id === scannedItem.sala_id)}
                onAbrir={scannedItem.id != null && scannedItem.sala_id != null ? () => abrirFicha(scannedItem) : undefined}
                theme={theme}
              />
            )}
            {scannedItem !== undefined && <PanelButton label="Escanear otro" onPress={() => { setScannedItem(undefined); setScanError(null); }} />}
          </ActionPanel>}

          {openAction === 'add' && <ActionPanel>
            <ThemedText themeColor="textSecondary" style={styles.description}>Inserta un elemento nuevo en el inventario. El código y su Data Matrix se generan automáticamente.</ThemedText>

            <View style={styles.codePreview}>
              <DataMatrixCode value={element.codigo} size={120} />
              <ThemedText type="smallBold" style={styles.codeLabel}>{element.codigo}</ThemedText>
            </View>

            <View style={styles.inputGroup}>
              <ThemedText type="smallBold" style={styles.inputLabel}>FOTO (opcional)</ThemedText>
              {foto && <Image source={{ uri: foto.uri }} style={styles.photoPreview} contentFit="cover" />}
              {foto && (
                <ThemedText themeColor="textSecondary" type="small" style={styles.photoMeta}>
                  Optimizada en el teléfono: {foto.resumen} · {foto.ancho}×{foto.alto} · miniatura de lista incluida
                </ThemedText>
              )}
              {fotoEstado && <ThemedText themeColor="textSecondary" type="small">{fotoEstado}</ThemedText>}
              <View style={styles.roomChips}>
                <Pressable accessibilityRole="button" disabled={Boolean(fotoEstado)} onPress={handleTakePhoto} style={styles.photoButton}>
                  <ThemedText style={styles.photoButtonLabel}>Tomar foto</ThemedText>
                </Pressable>
                <Pressable accessibilityRole="button" disabled={Boolean(fotoEstado)} onPress={handlePickPhoto} style={styles.photoButton}>
                  <ThemedText style={styles.photoButtonLabel}>Elegir de galería</ThemedText>
                </Pressable>
                {foto && (
                  <Pressable accessibilityRole="button" onPress={() => { setFoto(null); setFotoError(null); }} style={styles.photoButton}>
                    <ThemedText style={styles.photoButtonLabel}>Quitar</ThemedText>
                  </Pressable>
                )}
              </View>
              {fotoError && <ThemedText style={styles.errorText}>{fotoError}</ThemedText>}
            </View>

            <View style={[styles.pareja, escritorio && styles.parejaEscritorio]}>
              {(['detalle', 'serial'] as const).map((field) => (
                <FormInput key={field} label={field === 'detalle' ? 'DETALLE (obligatorio)' : 'SERIAL'} value={element[field]} onChangeText={(value) => setElement({ ...element, [field]: value })} theme={theme} contenedorStyle={escritorio ? styles.campoRejilla : undefined} />
              ))}
            </View>
            <View style={styles.inputGroup}>
              <ThemedText type="smallBold" style={styles.inputLabel}>SALA (obligatorio)</ThemedText>
              <View style={styles.roomChips}>
                {salas.map((sala) => (
                  <Pressable
                    key={sala.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected: salaId === sala.id }}
                    onPress={() => setSalaId(sala.id)}
                    style={[styles.roomChip, salaId === sala.id && styles.roomChipSelected]}>
                    <ThemedText style={salaId === sala.id ? styles.roomChipLabelSelected : styles.roomChipLabel}>{sala.nombre}</ThemedText>
                  </Pressable>
                ))}
                {!salas.length && <ThemedText themeColor="textSecondary" type="small">Cargando salas…</ThemedText>}
              </View>
            </View>
            <View style={[styles.pareja, escritorio && styles.parejaEscritorio]}>
              {(['inventario', 'estado'] as const).map((field) => (
                <FormInput key={field} label={field.toUpperCase()} value={element[field]} onChangeText={(value) => setElement({ ...element, [field]: value })} theme={theme} contenedorStyle={escritorio ? styles.campoRejilla : undefined} />
              ))}
            </View>
            <View style={[styles.pareja, escritorio && styles.parejaEscritorio]}>
              {(['observaciones', 'cantidad'] as const).map((field) => (
                <FormInput key={field} label={field.toUpperCase()} value={element[field]} onChangeText={(value) => setElement({ ...element, [field]: value })} theme={theme} contenedorStyle={escritorio ? styles.campoRejilla : undefined} />
              ))}
            </View>
            <PanelButton label={addSaving ? 'Guardando…' : 'Agregar'} onPress={handleAdd} disabled={addSaving} />

            {addError && (
              <ThemedText style={styles.errorText}>{addError}</ThemedText>
            )}
            {savedCodigo && (
              <View style={styles.codePreview}>
                <ThemedText themeColor="textSecondary" style={styles.description}>
                  {Platform.OS === 'web'
                    ? 'Guardado. El archivo para imprimir ya se descargó; si lo necesitas de nuevo, está aquí:'
                    : 'Guardado. Descarga el Data Matrix para imprimirlo y pegarlo en el elemento:'}
                </ThemedText>
                <DataMatrixCode value={savedCodigo} size={120} />
                <ThemedText type="smallBold" style={styles.codeLabel}>{savedCodigo}</ThemedText>
                <DataMatrixDownloadButton codigo={savedCodigo} label="Descargar para imprimir" />
              </View>
            )}
          </ActionPanel>}

          {openAction === 'export' && <ActionPanel>
            <ThemedText themeColor="textSecondary" style={styles.description}>
              Descarga el inventario completo o el historial de traslados. El CSV abre directo en Excel (con acentos correctos); el JSON es para otros programas.
            </ThemedText>
            <View style={styles.exportRow}>
              <Pressable accessibilityRole="button" onPress={() => descargarExport('elementos', 'csv')} style={({ pressed }) => [styles.exportButton, pressed && styles.pressed]}>
                <ThemedText style={styles.exportButtonLabel}>Inventario (CSV)</ThemedText>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => descargarExport('traslados', 'csv')} style={({ pressed }) => [styles.exportButton, pressed && styles.pressed]}>
                <ThemedText style={styles.exportButtonLabel}>Traslados (CSV)</ThemedText>
              </Pressable>
            </View>
            <View style={styles.exportRow}>
              <Pressable accessibilityRole="button" onPress={() => descargarExport('elementos', 'json')} style={({ pressed }) => [styles.exportButtonGhost, pressed && styles.pressed]}>
                <ThemedText style={styles.exportButtonGhostLabel}>Inventario (JSON)</ThemedText>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => descargarExport('traslados', 'json')} style={({ pressed }) => [styles.exportButtonGhost, pressed && styles.pressed]}>
                <ThemedText style={styles.exportButtonGhostLabel}>Traslados (JSON)</ThemedText>
              </Pressable>
            </View>
            {exportEstado && <ThemedText themeColor="textSecondary" type="small" style={styles.exportEstado}>{exportEstado}</ThemedText>}
            {exportError && <ThemedText style={styles.errorText}>{exportError}</ThemedText>}
            {Platform.OS === 'web' && <>
              <ThemedText themeColor="textSecondary" style={styles.description}>
                Importar: sube el inventario en CSV o Excel (xlsx, xls, ods). En un libro, cada hoja es una sala y su nombre debe coincidir con el de la sala. Solo agrega códigos nuevos; lo demás se reporta abajo.
              </ThemedText>
              <View style={styles.exportRow}>
                <Pressable accessibilityRole="button" onPress={importarArchivoInventario} style={({ pressed }) => [styles.exportButtonGhost, escritorio && styles.exportButtonGhostEscritorio, pressed && styles.pressed]}>
                  <ThemedText style={styles.exportButtonGhostLabel}>Importar inventario</ThemedText>
                </Pressable>
              </View>
              {mensajeImport && <ThemedText themeColor="textSecondary" style={styles.description}>{mensajeImport}</ThemedText>}
            </>}
          </ActionPanel>}
        </View>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function SunIcon({ color }: { color: string }) {
  return (
    <Svg width="24" height="24" viewBox="0 0 24 24" fill="none" accessibilityLabel="Modo claro">
      <Circle cx="12" cy="12" r="4" stroke={color} strokeWidth="2" />
      <Line x1="12" y1="2" x2="12" y2="5" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <Line x1="12" y1="19" x2="12" y2="22" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <Line x1="2" y1="12" x2="5" y2="12" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <Line x1="19" y1="12" x2="22" y2="12" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <Line x1="4.9" y1="4.9" x2="7" y2="7" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <Line x1="17" y1="17" x2="19.1" y2="19.1" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <Line x1="17" y1="7" x2="19.1" y2="4.9" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <Line x1="4.9" y1="19.1" x2="7" y2="17" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </Svg>
  );
}

function MoonIcon({ color }: { color: string }) {
  return (
    <Svg width="24" height="24" viewBox="0 0 24 24" fill="none" accessibilityLabel="Modo oscuro">
      <Path d="M20.5 15.3A8.5 8.5 0 0 1 8.7 3.5 8.5 8.5 0 1 0 20.5 15.3Z" fill={color} />
    </Svg>
  );
}

// Ficha de acción: icono, título y pista en una fila, con chevron y borde de
// acento al pasar el mouse o cuando el panel está abierto. La ficha entera es
// el botón.
function ActionTile({ icon, label, hint, isOpen, onPress }: { icon: 'qrcode.viewfinder' | 'plus' | 'export'; label: string; hint: string; isOpen: boolean; onPress: () => void }) {
  const theme = useTheme();
  const [sobre, setSobre] = useState(false);
  const activa = sobre || isOpen;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: isOpen }}
      onPress={onPress}
      onHoverIn={() => setSobre(true)}
      onHoverOut={() => setSobre(false)}
      style={({ pressed }) => [styles.ficha, { backgroundColor: isOpen ? theme.backgroundSelected : theme.backgroundElement, borderColor: activa ? theme.accent : 'transparent' }, pressed && styles.pressed]}>
      <View style={styles.fichaIcono}>{icon === 'plus' ? <PlusIcon /> : icon === 'qrcode.viewfinder' ? <ScanIcon /> : <ExportIcon />}</View>
      <View style={styles.fichaTexto}>
        <ThemedText style={styles.fichaTitulo} numberOfLines={1}>{label}</ThemedText>
        <ThemedText themeColor="textSecondary" type="small" style={styles.fichaPista} numberOfLines={1}>{hint}</ThemedText>
      </View>
      <ChevronIcon color={activa ? theme.accent : theme.textSecondary} />
    </Pressable>
  );
}

function ChevronIcon({ color }: { color: string }) {
  return (
    <Svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <Path d="M9 5l7 7-7 7" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function PersonIcon({ color }: { color: string }) {
  return (
    <Svg width="22" height="22" viewBox="0 0 24 24" fill="none" accessibilityLabel="Cuenta">
      <Circle cx="12" cy="8" r="4" stroke={color} strokeWidth="2" />
      <Path d="M4 21c0-4 3.6-6 8-6s8 2 8 6" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </Svg>
  );
}

function ScanIcon() {
  return (
    <Svg width="22" height="22" viewBox="0 0 24 24" fill="none" accessibilityLabel="Escanear">
      <Path d="M4 8V5a1 1 0 0 1 1-1h3M20 8V5a1 1 0 0 0-1-1h-3M4 16v3a1 1 0 0 0 1 1h3M20 16v3a1 1 0 0 1-1 1h-3" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <Line x1="4" y1="12" x2="20" y2="12" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" />
    </Svg>
  );
}

function PlusIcon() {
  return (
    <Svg width="22" height="22" viewBox="0 0 24 24" fill="none" accessibilityLabel="Agregar">
      <Line x1="12" y1="5" x2="12" y2="19" stroke="#FFFFFF" strokeWidth="2.5" strokeLinecap="round" />
      <Line x1="5" y1="12" x2="19" y2="12" stroke="#FFFFFF" strokeWidth="2.5" strokeLinecap="round" />
    </Svg>
  );
}

function SearchIcon() {
  return (
    <Svg width="22" height="22" viewBox="0 0 24 24" fill="none" accessibilityLabel="Buscar">
      <Circle cx="11" cy="11" r="6" stroke="#FFFFFF" strokeWidth="2" />
      <Line x1="20" y1="20" x2="15.5" y2="15.5" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" />
    </Svg>
  );
}

function ExportIcon() {
  return (
    <Svg width="22" height="22" viewBox="0 0 24 24" fill="none" accessibilityLabel="Exportar">
      <Path d="M12 3v12M12 3l-4 4M12 3l4 4" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M4 15v3a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-3" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" />
    </Svg>
  );
}

/**
 * Tarjeta de un elemento del inventario. La comparten la búsqueda y el
 * resultado del escaneo: los dos muestran lo mismo (código, sala, estado,
 * serial, cantidad) y ofrecen las mismas acciones — abrir la ficha, que es
 * donde se edita, se mueve o se le asigna código, y bajar la etiqueta. Antes
 * el escaneo volcaba una lista de "CAMPO: valor" y la búsqueda no dejaba hacer
 * nada con lo que encontraba.
 */
function TarjetaElemento({ item, sala, onAbrir, theme, estilo }: { item: InventoryItem; sala?: Room; onAbrir?: () => void; theme: ReturnType<typeof useTheme>; estilo?: StyleProp<ViewStyle> }) {
  const estadoBueno = (item.estado || '').toLowerCase().includes('bueno');
  return (
    <View style={[styles.searchCard, { borderColor: `${theme.accent}22` }, estilo]}>
      <View style={styles.searchCardHeader}>
        <ThemedText type="smallBold" style={styles.searchCardCode}>{item.codigo || 'Sin código'}</ThemedText>
        {sala && (
          <View style={styles.roomBadge}>
            <ThemedText style={styles.roomBadgeText}>{sala.nombre}</ThemedText>
          </View>
        )}
      </View>
      <ThemedText style={styles.searchCardDetalle} numberOfLines={1}>{item.detalle || item.codigo || '-'}</ThemedText>
      <View style={styles.searchCardMeta}>
        <View style={[styles.estadoBadge, { backgroundColor: estadoBueno ? '#22c55e22' : '#ef444422' }]}>
          <ThemedText style={[styles.estadoText, { color: estadoBueno ? '#22c55e' : '#ef4444' }]}>
            {item.estado || 'Sin estado'}
          </ThemedText>
        </View>
        {item.serial && (
          <ThemedText themeColor="textSecondary" type="small">SN: {item.serial}</ThemedText>
        )}
        {item.cantidad && (
          <ThemedText themeColor="textSecondary" type="small">× {item.cantidad}</ThemedText>
        )}
      </View>
      {item.observaciones ? (
        <ThemedText themeColor="textSecondary" type="small" numberOfLines={2} style={styles.searchCardNota}>{item.observaciones}</ThemedText>
      ) : null}
      {(onAbrir || item.codigo) && (
        <View style={styles.searchCardAcciones}>
          {onAbrir && (
            <Pressable accessibilityRole="button" onPress={onAbrir} style={({ pressed }) => [styles.fichaButton, { borderColor: theme.accent }, pressed && styles.pressed]}>
              <ThemedText type="smallBold" style={[styles.fichaButtonLabel, { color: theme.accent }]}>Ver ficha</ThemedText>
            </Pressable>
          )}
          {item.codigo && <DataMatrixDownloadButton codigo={item.codigo} compacta label="Data Matrix" />}
        </View>
      )}
    </View>
  );
}

function ActionPanel({ children }: { children: React.ReactNode }) {
  return <ThemedView type="backgroundElement" style={styles.actionPanel}>{children}</ThemedView>;
}

function PanelButton({ label, onPress, disabled, enFila }: { label: string; onPress?: () => void; disabled?: boolean; enFila?: boolean }) {
  // En escritorio el botón se pone compacto a la izquierda en vez de estirarse a
  // lo ancho del panel como una franja roja. `enFila` lo alinea con el campo
  // cuando va a su lado (barra de búsqueda).
  const { escritorio } = useDisposicion();
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.panelButton, escritorio && styles.panelButtonEscritorio, escritorio && enFila && styles.panelButtonEnFila, disabled && styles.panelButtonDisabled, pressed && !disabled && styles.pressed]}><ThemedText style={styles.panelButtonLabel}>{label}</ThemedText></Pressable>;
}

// Campo de texto con su etiqueta. `sinEtiqueta` lo deja solo (la etiqueta ya va
// fuera, en la barra de búsqueda), `sinTope` le quita el tope de 720 px para que
// llene su fila, `contenedorStyle` deja que esa fila lo estire y `onEnviar` hace
// que Enter dispare la acción del campo (la búsqueda).
function FormInput({ label, value, onChangeText, theme, placeholder, sinEtiqueta, sinTope, contenedorStyle, onEnviar }: { label: string; value: string; onChangeText: (value: string) => void; theme: ReturnType<typeof useTheme>; placeholder?: string; sinEtiqueta?: boolean; sinTope?: boolean; contenedorStyle?: StyleProp<ViewStyle>; onEnviar?: () => void }) {
  const { escritorio } = useDisposicion();
  const modo = useThemeMode();
  /** Anillo de foco, igual que en la pantalla de entrada. */
  const [enfocado, setEnfocado] = useState(false);
  return <View style={[styles.inputGroup, contenedorStyle]}>{!sinEtiqueta && <ThemedText type="smallBold" style={styles.inputLabel}>{label}</ThemedText>}<TextInput accessibilityLabel={label} value={value} onChangeText={onChangeText} onSubmitEditing={onEnviar} returnKeyType={onEnviar ? 'search' : 'default'} onFocus={() => setEnfocado(true)} onBlur={() => setEnfocado(false)} placeholder={placeholder} placeholderTextColor={theme.textSecondary} style={[styles.input, { color: theme.text, borderColor: enfocado ? theme.accent : theme.textSecondary }, escritorio && !sinTope && styles.inputEscritorio, enfocado && styles.inputEnfocado, enfocado && modo === 'dark' && styles.inputEnfocadoOscuro]} /></View>;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    width: '100%',
    alignSelf: 'center',
    paddingHorizontal: Spacing.four,
    alignItems: 'center',
    gap: Spacing.two,
  },
  scrollView: { flex: 1, width: '100%' },
  // El tope de ancho va en el contenido y no en el SafeAreaView: así el
  // contenedor que hace scroll llega hasta el borde de la ventana y su barra de
  // desplazamiento no se dibuja encima del contenido (en PC se solapaba).
  scrollContent: { flexGrow: 1, width: '100%', alignSelf: 'center', maxWidth: MaxContentWidth, paddingBottom: BottomTabInset + Spacing.four },
  scrollContentEscritorio: { maxWidth: MaxContentWidthEscritorio },
  header: { width: '100%', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: Spacing.six },
  themeButton: { width: 48, height: 48, borderRadius: 24, borderWidth: 2, borderColor: '#C8102E', alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-end' },
  title: { marginTop: Spacing.two, color: '#C8102E', alignSelf: 'flex-start' },
  subtitle: { alignSelf: 'flex-start', marginTop: Spacing.one },
  // Marca en el encabezado: el cubo (la parte del logo que sí se lee a tamaño
  // chico) junto al nombre, y el mosaico UFPS junto a la universidad.
  marca: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginTop: Spacing.two, width: '100%' },
  marcaCubo: { width: 40, height: 46 },
  marcaTitulo: { marginTop: 0, alignSelf: 'center' },
  institucion: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, marginTop: Spacing.one, width: '100%' },
  marcaUfps: { width: 20, height: 20 },
  institucionTexto: { marginTop: 0, alignSelf: 'center' },
  actionList: { width: '100%', gap: Spacing.three, marginTop: Spacing.six },
  resumen: { flexDirection: 'row', gap: Spacing.three },
  resumenTarjeta: { flex: 1, borderRadius: 12, paddingVertical: Spacing.three, paddingHorizontal: Spacing.four },
  resumenNumero: { fontSize: 28, lineHeight: 34, fontWeight: '700', color: '#C8102E' },
  panelTitulo: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  panelIcono: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#C8102E', alignItems: 'center', justifyContent: 'center' },
  panelTituloTexto: { fontSize: 22, lineHeight: 28 },
  fichas: { flexDirection: 'row', gap: Spacing.three },
  fichasColumna: { flexDirection: 'column' },
  fichaTexto: { flex: 1, minWidth: 0 },
  // La ficha entera es el botón: icono, texto y chevron en una sola fila.
  ficha: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: Spacing.three, borderRadius: 12, borderWidth: 2, padding: Spacing.three },
  fichaIcono: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#C8102E', alignItems: 'center', justifyContent: 'center' },
  fichaTitulo: { fontSize: 17, fontWeight: '700' },
  fichaPista: { lineHeight: 17 },
  actionPanel: { borderRadius: 12, padding: Spacing.three, gap: Spacing.three },
  description: { lineHeight: 21 },
  errorText: { color: '#C8102E', lineHeight: 21 },
  inputGroup: { gap: Spacing.one },
  // Campos del formulario de alta: en celular van uno debajo del otro y en
  // escritorio de a dos por fila (una sola columna de 720 px obligaba a bajar
  // media pantalla para llegar al botón Agregar).
  pareja: { gap: Spacing.three },
  parejaEscritorio: { flexDirection: 'row', gap: Spacing.two },
  campoRejilla: { flexBasis: 440, flexGrow: 1, maxWidth: '48.5%' },
  inputLabel: { color: '#C8102E' },
  input: { minHeight: 46, borderWidth: 1, borderRadius: 8, paddingHorizontal: Spacing.two, fontSize: 16 },
  // De lado a lado (1100 px) el campo se ve como una franja vacía.
  inputEscritorio: { maxWidth: MaxAnchoControlEscritorio },
  // Barra de búsqueda: en escritorio el campo llena la fila y el botón va a su
  // lado; en celular quedan apilados.
  searchRow: { gap: Spacing.two },
  searchRowEscritorio: { flexDirection: 'row', alignItems: 'flex-start' },
  searchCampo: { flex: 1, minWidth: 0 },
  limpiar: { minHeight: 46, justifyContent: 'center', paddingHorizontal: Spacing.two },
  limpiarLabel: { fontSize: 14 },
  buscando: { marginTop: Spacing.two, alignSelf: 'flex-start' },
  // El contorno nativo del navegador mide ~0.7 px y en escritorio no se ve: el
  // mismo anillo de la pantalla de entrada (0.16 claro / 0.22 oscuro).
  inputEnfocado: { boxShadow: '0 0 0 3px rgba(200, 16, 46, 0.16)' },
  inputEnfocadoOscuro: { boxShadow: '0 0 0 3px rgba(240, 90, 110, 0.22)' },
  cuentaPildora: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minHeight: 40, paddingHorizontal: Spacing.three, borderWidth: 1, borderRadius: 20 },
  cuentaSalir: { color: '#C8102E' },
  roomChips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  photoPreview: { width: '100%', aspectRatio: 4 / 3, borderRadius: 8, marginBottom: Spacing.one },
  photoMeta: { lineHeight: 18 },
  photoButton: { minHeight: 36, borderRadius: 18, borderWidth: 1, borderColor: '#C8102E', paddingHorizontal: Spacing.two, alignItems: 'center', justifyContent: 'center' },
  photoButtonLabel: { color: '#C8102E', fontSize: 13, fontWeight: '700' },
  codePreview: { alignItems: 'center', gap: Spacing.one, paddingVertical: Spacing.two },
  codeLabel: { letterSpacing: 1 },
  roomChip: { minHeight: 36, borderRadius: 18, borderWidth: 1, borderColor: '#C8102E', paddingHorizontal: Spacing.two, alignItems: 'center', justifyContent: 'center' },
  roomChipSelected: { backgroundColor: '#C8102E' },
  roomChipLabel: { color: '#C8102E', fontSize: 14 },
  roomChipLabelSelected: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  // Aviso con el acento del tema (código sin coincidencias): el borde y el fondo
  // salen del acento, así en modo oscuro se ve igual de bien que en claro.
  aviso: { gap: Spacing.half, borderWidth: 1, borderRadius: 12, padding: Spacing.three },
  avisoTexto: { lineHeight: 19 },
  searchCount: { marginTop: Spacing.two, alignSelf: 'flex-start', color: '#C8102E', fontSize: 13, fontWeight: '600' },
  searchCard: { width: '100%', borderRadius: 10, borderWidth: 1, borderColor: '#C8102E22', padding: Spacing.three, gap: Spacing.one, marginTop: Spacing.one },
  // En escritorio las fichas de resultado van en dos columnas (una fila de 1160 px
  // por resultado desperdiciaba la mitad del panel).
  searchResultsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  searchCardEscritorio: { width: 'auto', flexBasis: 440, flexGrow: 1, maxWidth: '48.5%' },
  searchCardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.one },
  searchCardCode: { fontSize: 15, color: '#C8102E', letterSpacing: 0.5 },
  roomBadge: { backgroundColor: '#C8102E15', borderRadius: 6, paddingHorizontal: Spacing.two, paddingVertical: 2 },
  roomBadgeText: { fontSize: 11, color: '#C8102E', fontWeight: '600' },
  searchCardDetalle: { fontSize: 15, fontWeight: '600' },
  searchCardMeta: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginTop: Spacing.half },
  searchCardNota: { marginTop: Spacing.half },
  // Acciones de la tarjeta: "Ver ficha" (donde se edita, mueve o asigna código)
  // y la descarga del Data Matrix.
  searchCardAcciones: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two, marginTop: Spacing.one },
  fichaButton: { minHeight: 36, borderRadius: 18, borderWidth: 1, paddingHorizontal: Spacing.three, alignItems: 'center', justifyContent: 'center' },
  fichaButtonLabel: { fontSize: 14 },
  estadoBadge: { borderRadius: 6, paddingHorizontal: Spacing.two, paddingVertical: 2 },
  estadoText: { fontSize: 11, fontWeight: '600' },
  searchEmpty: { alignItems: 'center', paddingVertical: Spacing.four, gap: Spacing.one },
  searchEmptyIcon: { fontSize: 32 },
  searchEmptyText: { marginTop: Spacing.two, textAlign: 'center' },
  searchEmptyHint: { textAlign: 'center' },
  exportRow: { flexDirection: 'row', gap: Spacing.two },
  exportButton: { flex: 1, minHeight: 48, borderRadius: 8, backgroundColor: '#C8102E', alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.two },
  exportButtonLabel: { color: '#FFFFFF', fontWeight: '700', fontSize: 14, textAlign: 'center' },
  exportEstado: { lineHeight: 19 },
  exportButtonGhost: { flex: 1, minHeight: 44, borderRadius: 8, borderWidth: 1, borderColor: '#C8102E', alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.two },
  exportButtonGhostEscritorio: { maxWidth: MaxAnchoControlEscritorio },
  exportButtonGhostLabel: { color: '#C8102E', fontWeight: '700', fontSize: 14, textAlign: 'center' },
  panelButton: { minHeight: 48, borderRadius: 8, backgroundColor: '#C8102E', alignItems: 'center', justifyContent: 'center', marginTop: Spacing.one },
  // En escritorio el botón no se estira a lo ancho: mide lo que su texto y queda
  // a la izquierda (en celular sí ocupa todo, que es lo que se alcanza con el
  // pulgar). `panelButtonEnFila` le quita el margen de arriba para alinearse con
  // el campo que tiene al lado en la barra de búsqueda.
  panelButtonEscritorio: { alignSelf: 'flex-start', minWidth: 200, paddingHorizontal: Spacing.five },
  panelButtonEnFila: { marginTop: 0 },
  panelButtonDisabled: { opacity: 0.6 },
  panelButtonLabel: { color: '#FFFFFF', fontWeight: '700', fontSize: 16 },
  pressed: { opacity: 0.78 },
});
