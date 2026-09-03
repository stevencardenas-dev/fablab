import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme, useThemeMode, useToggleTheme } from '@/hooks/use-theme';

export default function HomeScreen() {
  const theme = useTheme();
  const themeMode = useThemeMode();
  const toggleTheme = useToggleTheme();
  const [openAction, setOpenAction] = useState<'scan' | 'add' | 'search' | null>(null);
  const [element, setElement] = useState({
    codigo: '',
    detalle: '',
    serial: '',
    inventario: '',
    estado: '',
    observaciones: '',
    cantidad: '',
  });
  const [searchName, setSearchName] = useState('');

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
          <ActionButton icon="qrcode.viewfinder" label="Escanear elemento" isOpen={openAction === 'scan'} onPress={() => setOpenAction(openAction === 'scan' ? null : 'scan')} />
          {openAction === 'scan' && <ActionPanel>
            <ThemedText themeColor="textSecondary" style={styles.description}>Escanea el código del elemento para consultar sus datos en el inventario.</ThemedText>
            <PanelButton label="Escanear" />
          </ActionPanel>}

          <ActionButton icon="plus" label="Agregar elemento" isOpen={openAction === 'add'} onPress={() => setOpenAction(openAction === 'add' ? null : 'add')} />
          {openAction === 'add' && <ActionPanel>
            <ThemedText themeColor="textSecondary" style={styles.description}>Inserta un elemento nuevo en el inventario.</ThemedText>
            {(['codigo', 'detalle', 'serial', 'inventario', 'estado', 'observaciones', 'cantidad'] as const).map((field) => (
              <FormInput key={field} label={field.toUpperCase()} value={element[field]} onChangeText={(value) => setElement({ ...element, [field]: value })} theme={theme} />
            ))}
            <PanelButton label="Agregar" />
          </ActionPanel>}

          <ActionButton icon="magnifyingglass" label="Buscar elemento" isOpen={openAction === 'search'} onPress={() => setOpenAction(openAction === 'search' ? null : 'search')} />
          {openAction === 'search' && <ActionPanel>
            <ThemedText themeColor="textSecondary" style={styles.description}>Busca un elemento por su nombre.</ThemedText>
            <FormInput label="NOMBRE" value={searchName} onChangeText={setSearchName} theme={theme} />
            <PanelButton label="Buscar" />
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
  return <Pressable accessibilityRole="button" accessibilityState={{ expanded: isOpen }} onPress={onPress} style={({ pressed }) => [styles.actionButton, pressed && styles.pressed]}><ThemedText style={styles.actionIcon}>{icon === 'plus' ? '+' : icon === 'qrcode.viewfinder' ? '[]' : '?'}</ThemedText><ThemedText style={styles.actionLabel}>{label}</ThemedText><ThemedText style={styles.chevron}>{isOpen ? '⌃' : '⌄'}</ThemedText></Pressable>;
}

function ActionPanel({ children }: { children: React.ReactNode }) {
  return <ThemedView type="backgroundElement" style={styles.actionPanel}>{children}</ThemedView>;
}

function PanelButton({ label }: { label: string }) {
  return <Pressable accessibilityRole="button" style={({ pressed }) => [styles.panelButton, pressed && styles.pressed]}><ThemedText style={styles.panelButtonLabel}>{label}</ThemedText></Pressable>;
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
  header: { width: '100%', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: Spacing.two },
  themeButton: { width: 48, height: 48, borderRadius: 24, borderWidth: 2, borderColor: '#C8102E', alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-end' },
  title: { marginTop: Spacing.six, color: '#C8102E', alignSelf: 'flex-start' },
  subtitle: { alignSelf: 'flex-start', marginTop: Spacing.one },
  actionList: { width: '100%', gap: Spacing.three, marginTop: Spacing.six },
  actionButton: { minHeight: 58, borderRadius: 12, backgroundColor: '#C8102E', flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.four, gap: Spacing.three },
  actionLabel: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
  actionIcon: { color: '#FFFFFF', fontSize: 22, fontWeight: '800', width: 24, textAlign: 'center' },
  chevron: { color: '#FFFFFF', fontSize: 22, fontWeight: '700', marginLeft: 'auto' },
  actionPanel: { borderRadius: 12, padding: Spacing.three, gap: Spacing.three, marginTop: -Spacing.two },
  description: { lineHeight: 21 },
  inputGroup: { gap: Spacing.one },
  inputLabel: { color: '#C8102E' },
  input: { minHeight: 46, borderWidth: 1, borderRadius: 8, paddingHorizontal: Spacing.two, fontSize: 16 },
  panelButton: { minHeight: 48, borderRadius: 8, backgroundColor: '#C8102E', alignItems: 'center', justifyContent: 'center', marginTop: Spacing.one },
  panelButtonLabel: { color: '#FFFFFF', fontWeight: '700', fontSize: 16 },
  pressed: { opacity: 0.78 },
});
