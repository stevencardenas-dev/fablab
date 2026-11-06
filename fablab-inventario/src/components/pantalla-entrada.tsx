// Pantalla de entrada: sin sesión de la cuenta del laboratorio no se ve nada más de
// la app (el server también rechaza las lecturas sin credencial). El usuario viene
// escrito porque la cuenta es una sola; solo se teclea la clave.
//
// En web, el login va detrás de un captcha de Cloudflare Turnstile: el widget se
// monta en #turnstile-container y el token (uso único) viaja como turnstileToken
// en POST /api/login, donde el server lo valida contra siteverify. El captcha solo
// está activo si hay sitekey horneado (EXPO_PUBLIC_TURNSTILE_SITEKEY); el server
// solo lo exige si tiene TURNSTILE_SECRET. En nativo no hay navegador, así que el
// captcha no aplica (el login nativo queda como antes).

import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, Line, Path } from 'react-native-svg';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useDisposicion } from '@/hooks/use-disposicion';
import { useTheme, useThemeMode } from '@/hooks/use-theme';
import { API_BASE } from '@/lib/inventory';
import { mensajeDeError } from '@/lib/mensajes';
import { iniciarSesion } from '@/lib/sesion';

const USUARIO_POR_DEFECTO = 'laboratorio';
const ES_WEB = Platform.OS === 'web';
// Sitekey PÚBLICO (se hornea en el bundle; el secreto vive solo en el server).
const SITIO_TURNSTILE = process.env.EXPO_PUBLIC_TURNSTILE_SITEKEY || '';
// Con sitekey y sin widget cargado no se pide captcha: si el script de Cloudflare
// no llega (sin internet), el usuario podría quedarse sin poder entrar.
const CAPTCHA_ACTIVO = ES_WEB && !!SITIO_TURNSTILE;

// Paleta propia de la pantalla de entrada. Las pantallas internas van sobre fondo
// plano, pero acá no hay barra de pestañas que enmarque nada: sin un fondo con
// algo de carácter y una tarjeta con volumen, el formulario quedaba perdido en el
// centro de una pantalla de 1920 px (parecía una app de celular estirada).
const SUPERFICIE = {
  light: {
    pagina: '#F2F2F5',
    tarjeta: '#FFFFFF',
    campo: '#F6F6F9',
    borde: '#E5E5EA',
    anillo: 'rgba(200, 16, 46, 0.16)',
    sombraTarjeta: '0 30px 70px -22px rgba(15, 17, 26, 0.24)',
    sombraBoton: 'rgba(200, 16, 46, 0.45)',
    ok: '#1EA34D',
    okTexto: '#12803F',
    tenue: '#787C85',
    errorFondo: 'rgba(200, 16, 46, 0.08)',
    errorTexto: '#C8102E',
  },
  dark: {
    pagina: '#0C0C0E',
    tarjeta: '#17181B',
    campo: '#1E1F23',
    borde: '#2C2D33',
    anillo: 'rgba(240, 90, 110, 0.22)',
    sombraTarjeta: '0 30px 70px -22px rgba(0, 0, 0, 0.85)',
    sombraBoton: 'rgba(200, 16, 46, 0.5)',
    ok: '#3DDC84',
    okTexto: '#6EE7A5',
    tenue: '#93979F',
    errorFondo: 'rgba(240, 90, 110, 0.14)',
    errorTexto: '#F4A0B0',
  },
} as const;

// Rojo del panel lateral: entero en claro, apagado en oscuro (sobre negro un rojo
// saturado vibra y se ve ajeno al tema).
const ROJO_PANEL = { light: '#C8102E', dark: '#9E0D24' } as const;

// El botón sí mantiene el rojo de la marca en ambos temas: el acento oscuro del
// tema (#F05A6E) está pensado para texto sobre negro y con blanco encima queda con
// poco contraste.
const ROJO_BOTON = '#C8102E';

// Ojo para mostrar/ocultar la clave (mismo trazo que los íconos de index.tsx).
// `visible` = la clave se está mostrando: el trazo tachado invita a ocultarla.
function EyeIcon({ color, visible }: { color: string; visible: boolean }) {
  return (
    <Svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <Path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <Circle cx="12" cy="12" r="3" stroke={color} strokeWidth="2" />
      {visible && <Line x1="3" y1="3" x2="21" y2="21" stroke={color} strokeWidth="2" strokeLinecap="round" />}
    </Svg>
  );
}

export function PantallaEntrada() {
  const theme = useTheme();
  const modo = useThemeMode();
  const sup = SUPERFICIE[modo];
  // En escritorio la tarjeta se parte en dos paneles y se usa el ancho; en celular
  // queda la columna de siempre (bajo el punto de corte no cambia nada).
  const { escritorio } = useDisposicion();
  const [usuario, setUsuario] = useState(USUARIO_POR_DEFECTO);
  const [clave, setClave] = useState('');
  // El ojo del campo Clave: empieza oculta (secureTextEntry) y alterna.
  const [verClave, setVerClave] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [entrando, setEntrando] = useState(false);
  // Campo con el anillo de foco puesto (uno a la vez) y hover del botón.
  const [foco, setFoco] = useState<'usuario' | 'clave' | null>(null);
  const [sobreBoton, setSobreBoton] = useState(false);
  const [captchaResuelto, setCaptchaResuelto] = useState(false);
  // Si el script de Cloudflare nunca carga (sin internet, bloqueado), el captcha
  // se rinde: se puede intentar entrar y manda el server (si exige secret, 403).
  const [captchaCaido, setCaptchaCaido] = useState(false);
  // El token es de USO ÚNICO: se canjea en siteverify y luego se resetea el widget.
  const tokenCaptcha = useRef('');
  const widgetId = useRef<string | null>(null);

  // El captcha solo se exige si hay sitekey, el script cargó y hay token.
  const exigirCaptcha = CAPTCHA_ACTIVO && !captchaCaido;

  // Carga el script de Turnstile y monta el widget en #turnstile-container cuando
  // está listo (el contenedor ya existe al montar este efecto, así que no hace
  // falta ningún setState solo para redibujar). Si el script ya viene cargado de
  // otra parte, se monta directo; si no llega (sin internet), no hay widget y el
  // captcha queda desactivado en esta sesión.
  useEffect(() => {
    if (!CAPTCHA_ACTIVO || typeof window === 'undefined') return;
    let cancelado = false;

    const montar = () => {
      if (cancelado || !window.turnstile) return;
      const contenedor = document.getElementById('turnstile-container');
      if (!contenedor) return;
      widgetId.current = window.turnstile.render(contenedor, {
        sitekey: SITIO_TURNSTILE,
        action: 'login',
        // El widget se monta con el tema de la app (que al entrar arranca del
        // esquema del sistema): en oscuro no queda un recuadro blanco en medio.
        theme: modo === 'dark' ? 'dark' : 'light',
        callback: (token) => {
          tokenCaptcha.current = token;
          setCaptchaResuelto(true);
        },
        'expired-callback': () => {
          tokenCaptcha.current = '';
          setCaptchaResuelto(false);
        },
        'error-callback': () => {
          tokenCaptcha.current = '';
          setCaptchaResuelto(false);
        },
      });
    };

    if (window.turnstile) {
      montar();
      return () => {
        cancelado = true;
        const contenedor = document.getElementById('turnstile-container');
        if (contenedor) contenedor.innerHTML = '';
        widgetId.current = null;
      };
    }

    let script = document.querySelector<HTMLScriptElement>('script[src*="challenges.cloudflare.com/turnstile"]');
    if (!script) {
      script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
      script.async = true;
      script.defer = true;
      script.onerror = () => { if (!cancelado) setCaptchaCaido(true); };
      document.head.appendChild(script);
    }
    script.addEventListener('load', montar);
    return () => {
      cancelado = true;
      script?.removeEventListener('load', montar);
      const contenedor = document.getElementById('turnstile-container');
      if (contenedor) contenedor.innerHTML = '';
      widgetId.current = null;
    };
  }, [modo]);

  /** Tras cada intento fallido el token ya no sirve: reset para poder reintentar. */
  function reiniciarCaptcha() {
    if (!CAPTCHA_ACTIVO) return;
    tokenCaptcha.current = '';
    setCaptchaResuelto(false);
    if (widgetId.current && typeof window !== 'undefined' && window.turnstile) {
      window.turnstile.reset(widgetId.current);
    }
  }

  async function entrar() {
    if (entrando) return;
    if (!usuario.trim() || !clave) {
      setError('Escribe el usuario y la clave.');
      return;
    }
    if (exigirCaptcha && !captchaResuelto) {
      setError('Completa la verificación para continuar.');
      return;
    }
    setEntrando(true);
    setError(null);
    try {
      await iniciarSesion(API_BASE, usuario.trim(), clave, exigirCaptcha ? tokenCaptcha.current : undefined);
      setClave('');
      reiniciarCaptcha();
    } catch (e) {
      setError(mensajeDeError(e, 'No se pudo iniciar sesión. Revisa tu conexión e intenta de nuevo.'));
      reiniciarCaptcha();
    } finally {
      setEntrando(false);
    }
  }

  /** Campo en reposo (relleno tenue) y con foco (blanco, borde y anillo de la marca). */
  function estiloCampo(nombre: 'usuario' | 'clave') {
    const activo = foco === nombre;
    return [
      styles.campo,
      {
        color: theme.text,
        backgroundColor: activo ? sup.tarjeta : sup.campo,
        borderColor: activo ? theme.accent : sup.borde,
      },
      activo && { boxShadow: `0 0 0 3px ${sup.anillo}` },
    ];
  }

  return (
    <ThemedView style={[styles.contenedor, escritorio && { backgroundColor: sup.pagina }]}>
      <SafeAreaView style={styles.seguro}>
        {/* Con scroll: en pantallas bajas (celular de lado, ventana chica) el contenido
            centrado dejaba el título cortado arriba. */}
        <ScrollView contentContainerStyle={styles.desplazable} keyboardShouldPersistTaps="handled">
        <View
          style={[
            styles.tarjeta,
            escritorio && styles.tarjetaEscritorio,
            escritorio && { backgroundColor: sup.tarjeta, borderColor: sup.borde, boxShadow: sup.sombraTarjeta },
          ]}>
          {/* Panel de identidad (solo escritorio). El lockup del logo no va acá: sus
              grises y negros no contrastan sobre el rojo (sobre rojo el cubo pierde
              su cara roja y el wordmark se ensucia). La marca va como texto y el
              mosaico UFPS en blanco, que sí contrasta sobre los dos rojos del tema. */}
          {escritorio && (
            <View style={[styles.panel, { backgroundColor: ROJO_PANEL[modo] }]}>
              {/* Geometría técnica de fondo: círculo, cuadrado girado y un halo
                  tenue, todo recortado por el panel. */}
              <View style={[styles.panelHalo, styles.panelFigura]} />
              <View style={[styles.panelCirculo, styles.panelFigura]} />
              <View style={[styles.panelCuadro, styles.panelFigura]} />

              <View style={styles.panelEtiqueta}>
                <ThemedText style={styles.panelEtiquetaTexto}>Sistema de inventario</ThemedText>
              </View>

              <View style={styles.panelTextos}>
                <ThemedText style={styles.panelNombre}>FabLab UFPS</ThemedText>
                <ThemedText style={styles.panelDescripcion}>
                  Universidad Francisco de Paula Santander
                </ThemedText>
              </View>

              <View style={styles.panelPie}>
                <View style={styles.panelRegla} />
                <View style={styles.panelPieFila}>
                  <Image accessibilityLabel="Universidad Francisco de Paula Santander" source={require('@/assets/images/ufps-marca.png')} style={styles.panelPieLogo} resizeMode="contain" />
                  <ThemedText style={styles.panelPieTexto}>Laboratorio de fabricación digital</ThemedText>
                </View>
              </View>
            </View>
          )}

          <View style={[styles.formulario, escritorio && styles.formularioEscritorio]}>
          <View style={styles.formularioInterior}>
          {/* En celular la marca va arriba del formulario: el cubo solo (el lockup
              completo, a 150 px, quedaba embutido e ilegible) con el nombre, y el
              mosaico UFPS junto a la universidad. */}
          {!escritorio && (
            <View style={styles.marcaMovil}>
              <Image accessibilityLabel="FabLab UFPS" source={require('@/assets/images/cubo-fablab.png')} style={styles.marcaCubo} resizeMode="contain" />
              <ThemedText style={[styles.marcaNombre, { color: theme.accent }]}>FabLab UFPS</ThemedText>
              <View style={styles.marcaInstitucion}>
                <Image accessibilityLabel="Universidad Francisco de Paula Santander" source={require('@/assets/images/ufps-logo.png')} style={styles.marcaUfps} resizeMode="contain" />
                <ThemedText themeColor="textSecondary" type="small">Universidad Francisco de Paula Santander</ThemedText>
              </View>
            </View>
          )}

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
            onFocus={() => setFoco('usuario')}
            onBlur={() => setFoco(null)}
            style={estiloCampo('usuario')}
          />

          <ThemedText type="smallBold" style={styles.etiqueta}>Clave</ThemedText>
          {/* El ojo va superpuesto (absolute) dentro del campo, así el input es
              dueño del borde y del anillo de foco, igual que el campo Usuario. */}
          <View style={styles.campoClave}>
            <TextInput
              accessibilityLabel="Clave"
              value={clave}
              onChangeText={setClave}
              secureTextEntry={!verClave}
              autoComplete="current-password"
              onSubmitEditing={entrar}
              returnKeyType="go"
              onFocus={() => setFoco('clave')}
              onBlur={() => setFoco(null)}
              style={[estiloCampo('clave'), styles.claveEntrada]}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={verClave ? 'Ocultar la clave' : 'Mostrar la clave'}
              onPress={() => setVerClave((v) => !v)}
              hitSlop={8}
              style={styles.ojo}>
              <EyeIcon color={foco === 'clave' ? theme.accent : theme.textSecondary} visible={verClave} />
            </Pressable>
          </View>

          {CAPTCHA_ACTIVO && !captchaCaido && (
            <View style={styles.verificacion}>
              <View style={styles.verificacionCabecera}>
                <View style={[styles.verificacionPunto, { backgroundColor: captchaResuelto ? sup.ok : sup.tenue }]} />
                <ThemedText style={[styles.verificacionTexto, { color: captchaResuelto ? sup.okTexto : sup.tenue }]}>
                  {captchaResuelto ? 'Verificación completada' : 'Verificación de seguridad'}
                </ThemedText>
              </View>
              <div id="turnstile-container" style={{ marginTop: Spacing.two }} />
            </View>
          )}

          {error && (
            <View style={[styles.errorCaja, { backgroundColor: sup.errorFondo }]} accessibilityRole="alert">
              <View style={[styles.errorBarra, { backgroundColor: sup.errorTexto }]} />
              <ThemedText style={[styles.errorTexto, { color: sup.errorTexto }]}>{error}</ThemedText>
            </View>
          )}

          <Pressable
            accessibilityRole="button"
            disabled={entrando}
            onPress={entrar}
            onHoverIn={() => setSobreBoton(true)}
            onHoverOut={() => setSobreBoton(false)}
            style={({ pressed }) => [
              styles.boton,
              { backgroundColor: ROJO_BOTON },
              sobreBoton && !entrando && styles.botonHover,
              sobreBoton && !entrando && { boxShadow: `0 12px 26px -10px ${sup.sombraBoton}` },
              (pressed || entrando) && styles.botonPresionado,
            ]}>
            {entrando
              ? <ActivityIndicator color="#FFFFFF" />
              : <ThemedText style={styles.botonTexto}>Entrar</ThemedText>}
          </Pressable>

          <ThemedText themeColor="textSecondary" style={styles.pie}>
            ¿Problemas para entrar? Contacta al administrador del laboratorio.
          </ThemedText>
          </View>
          </View>
        </View>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  contenedor: { flex: 1 },
  seguro: { flex: 1 },
  desplazable: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.four, paddingVertical: Spacing.five },

  // Celular: una columna suelta sobre el fondo de la app (como antes).
  tarjeta: { width: '100%', maxWidth: 420 },
  // Escritorio: tarjeta de dos paneles (identidad | formulario).
  tarjetaEscritorio: { maxWidth: 940, flexDirection: 'row', alignItems: 'stretch', borderRadius: 22, borderWidth: 1, overflow: 'hidden' },

  // --- Panel de identidad (solo escritorio) ---
  panel: { flexBasis: 340, flexGrow: 1, padding: Spacing.five, justifyContent: 'space-between', overflow: 'hidden' },
  panelFigura: { position: 'absolute' },
  panelHalo: { width: 380, height: 380, borderRadius: 190, backgroundColor: 'rgba(255, 255, 255, 0.06)', bottom: -170, right: -130 },
  panelCirculo: { width: 320, height: 320, borderRadius: 160, borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.16)', top: -120, right: -110 },
  panelCuadro: { width: 190, height: 190, borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.14)', bottom: -70, left: -60, transform: [{ rotate: '18deg' }] },
  panelEtiqueta: { alignSelf: 'flex-start', paddingVertical: 5, paddingHorizontal: Spacing.two + 2, borderRadius: 999, backgroundColor: 'rgba(255, 255, 255, 0.16)' },
  panelEtiquetaTexto: { color: '#FFFFFF', fontSize: 11, lineHeight: 15, fontWeight: '700', letterSpacing: 1.1, textTransform: 'uppercase' },
  panelTextos: { marginTop: Spacing.five, gap: Spacing.two },
  panelNombre: { color: '#FFFFFF', fontSize: 34, lineHeight: 40, fontWeight: '800', letterSpacing: -0.8 },
  panelDescripcion: { color: 'rgba(255, 255, 255, 0.82)', fontSize: 14, lineHeight: 20 },
  panelPie: { gap: Spacing.two },
  panelPieFila: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  panelPieLogo: { width: 26, height: 26, opacity: 0.9 },
  panelRegla: { width: 44, height: 2, backgroundColor: 'rgba(255, 255, 255, 0.55)' },
  panelPieTexto: { color: 'rgba(255, 255, 255, 0.75)', fontSize: 11, lineHeight: 15, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' },

  // --- Formulario ---
  formulario: { flexGrow: 1 },
  formularioEscritorio: { flexBasis: 420, flexGrow: 2, padding: Spacing.five, justifyContent: 'center' },
  // Deja los campos en una medida cómoda aunque la columna sea más ancha.
  formularioInterior: { width: '100%', maxWidth: 400, alignSelf: 'center' },

  // El PNG va con fondo transparente, así que se apoya directo en el fondo de la
  // pantalla (claro u oscuro) sin recuadro blanco alrededor.
  marcaMovil: { alignSelf: 'center', alignItems: 'center', gap: Spacing.one, marginBottom: Spacing.four },
  marcaCubo: { width: 64, height: 73 },
  marcaNombre: { fontSize: 22, lineHeight: 28, fontWeight: '800', letterSpacing: -0.4 },
  marcaInstitucion: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  marcaUfps: { width: 18, height: 18 },
  encabezado: { fontSize: 30, lineHeight: 38, fontWeight: '800', letterSpacing: -0.6, marginTop: Spacing.two },
  ayuda: { fontSize: 14, lineHeight: 21, marginTop: Spacing.one, marginBottom: Spacing.two },
  etiqueta: { fontSize: 11, lineHeight: 15, letterSpacing: 1, textTransform: 'uppercase', marginTop: Spacing.four, marginBottom: Spacing.one },
  campo: { minHeight: 52, borderWidth: 1, borderRadius: 12, paddingHorizontal: Spacing.three, fontSize: 16, fontWeight: '500' },
  campoClave: { justifyContent: 'center' },
  claveEntrada: { paddingRight: 46 },
  ojo: { position: 'absolute', right: Spacing.two, top: 0, bottom: 0, justifyContent: 'center', alignItems: 'center', padding: Spacing.one },

  verificacion: { marginTop: Spacing.four },
  verificacionCabecera: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  verificacionPunto: { width: 8, height: 8, borderRadius: 4 },
  verificacionTexto: { fontSize: 11, lineHeight: 15, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },

  errorCaja: { flexDirection: 'row', alignItems: 'stretch', gap: Spacing.two, marginTop: Spacing.four, paddingVertical: Spacing.two + 2, paddingHorizontal: Spacing.three, borderRadius: 10 },
  errorBarra: { width: 3, borderRadius: 2 },
  errorTexto: { flex: 1, fontSize: 14, lineHeight: 20 },

  boton: { minHeight: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: Spacing.four },
  botonHover: { transform: [{ translateY: -1 }] },
  botonPresionado: { opacity: 0.85, transform: [{ translateY: 0 }] },
  botonTexto: { color: '#FFFFFF', fontWeight: '700', fontSize: 16, letterSpacing: 0.3 },
  pie: { fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: Spacing.four },
});
