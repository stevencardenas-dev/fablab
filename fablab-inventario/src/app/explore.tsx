import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { WebBadge } from '@/components/web-badge';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';

const rooms = ['Sala Coworking', 'Sala IOT', 'Sala Drones', 'Impresión 3D', 'Almacén'];

export default function InventoryScreen() {
  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <SafeAreaView style={styles.content}>
          <ThemedText type="title" style={styles.title}>Inventario</ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.intro}>Espacios y elementos disponibles en el FabLab UFPS.</ThemedText>
          <View style={styles.roomList}>
            {rooms.map((room) => <ThemedView key={room} type="backgroundElement" style={styles.roomCard}>
              <View style={styles.roomAccent} />
              <ThemedText type="subtitle" style={styles.roomTitle}>{room}</ThemedText>
              <ThemedText themeColor="textSecondary" type="small">Ver elementos registrados</ThemedText>
            </ThemedView>)}
          </View>
        </SafeAreaView>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { flexGrow: 1, alignItems: 'center' },
  content: { width: '100%', maxWidth: MaxContentWidth, paddingHorizontal: Spacing.four, paddingBottom: BottomTabInset + Spacing.four },
  title: { color: '#C8102E', marginTop: Spacing.four },
  intro: { marginTop: Spacing.one },
  roomList: { gap: Spacing.three, marginTop: Spacing.five },
  roomCard: { minHeight: 112, borderRadius: 12, padding: Spacing.four, overflow: 'hidden' },
  roomAccent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 6, backgroundColor: '#C8102E' },
  roomTitle: { fontSize: 24, lineHeight: 32 },
});
