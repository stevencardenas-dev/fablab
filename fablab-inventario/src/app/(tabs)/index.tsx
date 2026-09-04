import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DataMatrixCode } from '@/components/data-matrix';
import { Scanner } from '@/components/scanner';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme, useThemeMode, useToggleTheme } from '@/hooks/use-theme';
import { addItem, findByCodigo, findByDetalle, generateCodigo, Rooms, type InventoryItem } from '@/lib/inventory';

function newElement(): InventoryItem {
  return {
    codigo: generateCodigo(),
    detalle: '',
    serial: '',
    inventario: '',
    estado: '',
    observaciones: '',
    cantidad: '',
    foto: undefined,
  };
}

export default function HomeScreen() {
  const theme = useTheme();
  const themeMode = useThemeMode();
  const toggleTheme = useToggleTheme();
  const [openAction, setOpenAction] = useState<'scan' | 'add' | 'search' | null>(null);
  const [element, setElement] = useState<InventoryItem>(newElement);
  const [addError, setAddError] = useState<string | null>(null);
  const [savedCodigo, setSavedCodigo] = useState<string | null>(null);
  const [scannedItem, setScannedItem] = useState<InventoryItem | null | undefined>(undefined);
  const [searchName, setSearchName] = useState('');
  const [searchResults, setSearchResults] = useState<InventoryItem[] | null>(null);

  function openPanel(panel: 'scan' | 'add' | 'search') {
    const next = openAction === panel ? null : panel;
    setOpenAction(next);
    setScannedItem(undefined);
    setSearchResults(null);
    setSearchName('');
    setAddError(null);
    setSavedCodigo(null);
    if (next === 'add') setElement(newElement());
  }

  async function handleScanned(codigo: string) {
    const found = await findByCodigo(codigo);
    setScannedItem(found ?? null);
  }

  async function handleAdd() {
    if (!element.detalle || !element.inventario) {
      setAddError('Detalle y sala son obligatorios.');
      return;
    }
    setAddError(null);
    await addItem(element);
    setSavedCodigo(element.codigo);
    setElement(newElement());
  }

  async function handleSearch() {
    setSearchResults(await findByDetalle(searchName));
  }

  async function handleTakePhoto() {
    const result = await ImagePicker.launchCameraAsync({ quality: 0.6, allowsEditing: true, aspect: [4, 3] });
    if (!result.canceled) setElement((current) => ({ ...current, foto: result.assets[0].uri }));
  }

  async function handlePickPhoto() {
    const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.6, allowsEditing: true, aspect: [4, 3] });
    if (!result.canceled) setElement((current) => ({ ...current, foto: result.assets[0].uri }));
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel="Cambiar modo claro u oscuro" onPress={toggleTheme} style={styles.themeButton}>
            {themeMode === 'dark' ? <SunIcon color={theme.accent} /> : <MoonIcon color={theme.accent} />}
          </Pressable>
        </View>
        <ThemedText type="title" style={styles.title}>FabLab UFPS</ThemedText>
        <ThemedText themeColor="textSecondary" style={styles.subtitle}>Universidad Francisco de Paula Santander</ThemedText>
        <View style={styles.actionList}>
          <ActionButton icon="qrcode.viewfinder" label="Escanear elemento" isOpen={openAction === 'scan'} onPress={() => openPanel('scan')} />
          {openAction === 'scan' && <ActionPanel>
            <ThemedText themeColor="textSecondary" style={styles.description}>Escanea el código del elemento para consultar sus datos en el inventario.</ThemedText>
            <Scanner onScanned={handleScanned} />
            {scannedItem === null && <ThemedText themeColor="textSecondary" style={styles.description}>No se encontró ningún elemento con ese código.</ThemedText>}
            {scannedItem && (
              <View style={styles.resultBox}>
                {(['codigo', 'detalle', 'serial', 'inventario', 'estado', 'observaciones', 'cantidad'] as const).map((field) => (
                  <ThemedText key={field} style={styles.resultLine}>{field.toUpperCase()}: {scannedItem[field] || '-'}</ThemedText>
                ))}
              </View>
            )}
          </ActionPanel>}

          <ActionButton icon="plus" label="Agregar elemento" isOpen={openAction === 'add'} onPress={() => openPanel('add')} />
          {openAction === 'add' && <ActionPanel>
            <ThemedText themeColor="textSecondary" style={styles.description}>Inserta un elemento nuevo en el inventario. El código y su Data Matrix se generan automáticamente.</ThemedText>

            <View style={styles.codePreview}>
              <DataMatrixCode value={element.codigo} size={120} />
              <ThemedText type="smallBold" style={styles.codeLabel}>{element.codigo}</ThemedText>
            </View>

            <View style={styles.inputGroup}>
              <ThemedText type="smallBold" style={styles.inputLabel}>FOTO (opcional)</ThemedText>
              {element.foto && <Image source={{ uri: element.foto }} style={styles.photoPreview} contentFit="cover" />}
              <View style={styles.roomChips}>
                <Pressable accessibilityRole="button" onPress={handleTakePhoto} style={styles.photoButton}>
                  <ThemedText style={styles.photoButtonLabel}>Tomar foto</ThemedText>
                </Pressable>
                <Pressable accessibilityRole="button" onPress={handlePickPhoto} style={styles.photoButton}>
                  <ThemedText style={styles.photoButtonLabel}>Elegir de galería</ThemedText>
                </Pressable>
                {element.foto && (
                  <Pressable accessibilityRole="button" onPress={() => setElement({ ...element, foto: undefined })} style={styles.photoButton}>
                    <ThemedText style={styles.photoButtonLabel}>Quitar</ThemedText>
                  </Pressable>
                )}
              </View>
            </View>

            {(['detalle', 'serial'] as const).map((field) => (
              <FormInput key={field} label={field.toUpperCase()} value={element[field]} onChangeText={(value) => setElement({ ...element, [field]: value })} theme={theme} />
            ))}
            <View style={styles.inputGroup}>
              <ThemedText type="smallBold" style={styles.inputLabel}>INVENTARIO</ThemedText>
              <View style={styles.roomChips}>
                {Rooms.map((room) => (
                  <Pressable
                    key={room}
                    accessibilityRole="button"
                    accessibilityState={{ selected: element.inventario === room }}
                    onPress={() => setElement({ ...element, inventario: room })}
                    style={[styles.roomChip, element.inventario === room && styles.roomChipSelected]}>
                    <ThemedText style={element.inventario === room ? styles.roomChipLabelSelected : styles.roomChipLabel}>{room}</ThemedText>
                  </Pressable>
                ))}
              </View>
            </View>
            {(['estado', 'observaciones', 'cantidad'] as const).map((field) => (
              <FormInput key={field} label={field.toUpperCase()} value={element[field]} onChangeText={(value) => setElement({ ...element, [field]: value })} theme={theme} />
            ))}
            <PanelButton label="Agregar" onPress={handleAdd} />

            {addError && (
              <ThemedText style={styles.errorText}>{addError}</ThemedText>
            )}
            {savedCodigo && (
              <View style={styles.codePreview}>
                <ThemedText themeColor="textSecondary" style={styles.description}>
                  Guardado. Imprime este Data Matrix y pégalo en el elemento:
                </ThemedText>
                <DataMatrixCode value={savedCodigo} size={120} />
                <ThemedText type="smallBold" style={styles.codeLabel}>{savedCodigo}</ThemedText>
              </View>
            )}
          </ActionPanel>}

          <ActionButton icon="magnifyingglass" label="Buscar elemento" isOpen={openAction === 'search'} onPress={() => openPanel('search')} />
          {openAction === 'search' && <ActionPanel>
            <ThemedText themeColor="textSecondary" style={styles.description}>Busca un elemento por su nombre.</ThemedText>
            <FormInput label="NOMBRE" value={searchName} onChangeText={setSearchName} theme={theme} />
            <PanelButton label="Buscar" onPress={handleSearch} />
            {searchResults?.map((item) => (
              <View key={item.codigo} style={styles.resultBox}>
                {(['codigo', 'detalle', 'serial', 'inventario', 'estado', 'observaciones', 'cantidad'] as const).map((field) => (
                  <ThemedText key={field} style={styles.resultLine}>{field.toUpperCase()}: {item[field] || '-'}</ThemedText>
                ))}
              </View>
            ))}
            {searchResults?.length === 0 && (
              <ThemedText themeColor="textSecondary" style={styles.description}>Sin resultados.</ThemedText>
            )}
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

function ActionButton({ icon, label, isOpen, onPress }: { icon: 'qrcode.viewfinder' | 'plus' | 'magnifyingglass'; label: string; isOpen: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ expanded: isOpen }} onPress={onPress} style={({ pressed }) => [styles.actionButton, pressed && styles.pressed]}><View style={styles.actionIcon}>{icon === 'plus' ? <PlusIcon /> : icon === 'qrcode.viewfinder' ? <ScanIcon /> : <SearchIcon />}</View><ThemedText style={styles.actionLabel} numberOfLines={1}>{label}</ThemedText><ThemedText style={styles.chevron}>{isOpen ? '⌃' : '⌄'}</ThemedText></Pressable>;
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

function ActionPanel({ children }: { children: React.ReactNode }) {
  return <ThemedView type="backgroundElement" style={styles.actionPanel}>{children}</ThemedView>;
}

function PanelButton({ label, onPress }: { label: string; onPress?: () => void }) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.panelButton, pressed && styles.pressed]}><ThemedText style={styles.panelButtonLabel}>{label}</ThemedText></Pressable>;
}

function FormInput({ label, value, onChangeText, theme }: { label: string; value: string; onChangeText: (value: string) => void; theme: ReturnType<typeof useTheme> }) {
  return <View style={styles.inputGroup}><ThemedText type="smallBold" style={styles.inputLabel}>{label}</ThemedText><TextInput accessibilityLabel={label} value={value} onChangeText={onChangeText} placeholder={label} placeholderTextColor={theme.textSecondary} style={[styles.input, { color: theme.text, borderColor: theme.textSecondary }]} /></View>;
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
    maxWidth: MaxContentWidth,
  },
  scrollView: { flex: 1, width: '100%' },
  scrollContent: { flexGrow: 1, width: '100%', paddingBottom: BottomTabInset + Spacing.four },
  header: { width: '100%', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: Spacing.six },
  themeButton: { width: 48, height: 48, borderRadius: 24, borderWidth: 2, borderColor: '#C8102E', alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-end' },
  title: { marginTop: Spacing.two, color: '#C8102E', alignSelf: 'flex-start' },
  subtitle: { alignSelf: 'flex-start', marginTop: Spacing.one },
  actionList: { width: '100%', gap: Spacing.three, marginTop: Spacing.six },
  actionButton: { minHeight: 58, borderRadius: 12, backgroundColor: '#C8102E', flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.four, gap: Spacing.three },
  actionLabel: { flex: 1, color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
  actionIcon: { width: 24, alignItems: 'center', justifyContent: 'center' },
  chevron: { color: '#FFFFFF', fontSize: 22, fontWeight: '700', marginLeft: 'auto' },
  actionPanel: { borderRadius: 12, padding: Spacing.three, gap: Spacing.three, marginTop: -Spacing.two },
  description: { lineHeight: 21 },
  errorText: { color: '#C8102E', lineHeight: 21 },
  inputGroup: { gap: Spacing.one },
  inputLabel: { color: '#C8102E' },
  input: { minHeight: 46, borderWidth: 1, borderRadius: 8, paddingHorizontal: Spacing.two, fontSize: 16 },
  roomChips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  photoPreview: { width: '100%', aspectRatio: 4 / 3, borderRadius: 8, marginBottom: Spacing.one },
  photoButton: { minHeight: 36, borderRadius: 18, borderWidth: 1, borderColor: '#C8102E', paddingHorizontal: Spacing.two, alignItems: 'center', justifyContent: 'center' },
  photoButtonLabel: { color: '#C8102E', fontSize: 13, fontWeight: '700' },
  codePreview: { alignItems: 'center', gap: Spacing.one, paddingVertical: Spacing.two },
  codeLabel: { letterSpacing: 1 },
  roomChip: { minHeight: 36, borderRadius: 18, borderWidth: 1, borderColor: '#C8102E', paddingHorizontal: Spacing.two, alignItems: 'center', justifyContent: 'center' },
  roomChipSelected: { backgroundColor: '#C8102E' },
  roomChipLabel: { color: '#C8102E', fontSize: 14 },
  roomChipLabelSelected: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  resultBox: { gap: Spacing.half, paddingTop: Spacing.two },
  resultLine: { fontSize: 14 },
  panelButton: { minHeight: 48, borderRadius: 8, backgroundColor: '#C8102E', alignItems: 'center', justifyContent: 'center', marginTop: Spacing.one },
  panelButtonLabel: { color: '#FFFFFF', fontWeight: '700', fontSize: 16 },
  pressed: { opacity: 0.78 },
});
