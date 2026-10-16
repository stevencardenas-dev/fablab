// Pantalla de entrada: sin sesión de la cuenta del laboratorio no se ve nada más de
// la app (el server también rechaza las lecturas sin credencial). El usuario viene
// escrito porque la cuenta es una sola; solo se teclea la clave.

import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { API_BASE } from '@/lib/inventory';
import { iniciarSesion } from '@/lib/sesion';

const USUARIO_POR_DEFECTO = 'laboratorio';

export function PantallaEntrada() {
  const theme = useTheme();
  const [usuario, setUsuario] = useState(USUARIO_POR_DEFECTO);
  const [clave, setClave] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [entrando, setEntrando] = useState(false);

  async function entrar() {
    if (entrando) return;
    if (!usuario.trim() || !clave) {
      setError('Escribe el usuario y la clave.');
      return;
    }
    setEntrando(true);
    setError(null);
    try {
      await iniciarSesion(API_BASE, usuario.trim(), clave);
      setClave('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo iniciar sesión.');
    } finally {
      setEntrando(false);
    }
  }

  const campo = [styles.campo, { color: theme.text, borderColor: theme.textSecondary }];

  return (
    <ThemedView style={styles.contenedor}>
      <SafeAreaView style={styles.seguro}>
        {/* Con scroll: en pantallas bajas (celular de lado, ventana chica) el contenido
            centrado dejaba el título cortado arriba. */}
        <ScrollView contentContainerStyle={styles.desplazable} keyboardShouldPersistTaps="handled">
        <View style={styles.tarjeta}>
          <ThemedText type="title" style={styles.titulo}>FabLab UFPS</ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.subtitulo}>
            Universidad Francisco de Paula Santander
          </ThemedText>

          <ThemedText type="subtitle" style={styles.encabezado}>Iniciar sesión</ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.ayuda}>
            Ingresa con la cuenta del laboratorio para consultar y modificar el inventario.
          </ThemedText>

          <ThemedText type="smallBold" style={styles.etiqueta}>Usuario</ThemedText>
          <TextInput
            accessibilityLabel="Usuario"
            value={usuario}
            onChangeText={setUsuario}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="username"
            style={campo}
          />

          <ThemedText type="smallBold" style={styles.etiqueta}>Clave</ThemedText>
          <TextInput
            accessibilityLabel="Clave"
            value={clave}
            onChangeText={setClave}
            secureTextEntry
            autoComplete="current-password"
            onSubmitEditing={entrar}
            returnKeyType="go"
            style={campo}
          />

          {error && <ThemedText style={styles.error} accessibilityRole="alert">{error}</ThemedText>}

          <Pressable
            accessibilityRole="button"
            disabled={entrando}
            onPress={entrar}
            style={({ pressed }) => [styles.boton, (pressed || entrando) && styles.botonPresionado]}>
            {entrando
              ? <ActivityIndicator color="#FFFFFF" />
              : <ThemedText style={styles.botonTexto}>Entrar</ThemedText>}
          </Pressable>
        </View>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  contenedor: { flex: 1 },
  seguro: { flex: 1 },
  desplazable: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.four, paddingVertical: Spacing.six },
  tarjeta: { width: '100%', maxWidth: 420 },
  titulo: { color: '#C8102E' },
  subtitulo: { marginTop: Spacing.one, marginBottom: Spacing.six },
  encabezado: { marginBottom: Spacing.one },
  ayuda: { lineHeight: 21, marginBottom: Spacing.three },
  etiqueta: { marginTop: Spacing.three, marginBottom: Spacing.one },
  campo: { minHeight: 48, borderWidth: 1, borderRadius: 8, paddingHorizontal: Spacing.three, fontSize: 16 },
  error: { color: '#C8102E', marginTop: Spacing.three, lineHeight: 21 },
  boton: { minHeight: 48, borderRadius: 8, backgroundColor: '#C8102E', alignItems: 'center', justifyContent: 'center', marginTop: Spacing.four },
  botonPresionado: { opacity: 0.7 },
  botonTexto: { color: '#FFFFFF', fontWeight: '700', fontSize: 16 },
});
