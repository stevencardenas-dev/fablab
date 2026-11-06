// Disposición según el ancho de la ventana. En web la ventana puede medir tanto
// como el monitor: una sola columna de 800 px ahí se ve como un celular
// estirado, así que desde Breakpoints.escritorio el contenido se ensancha y las
// listas pasan a varias columnas. En celular no cambia nada.
import { useWindowDimensions } from 'react-native';

import { Breakpoints } from '@/constants/theme';

export function useDisposicion() {
  const ancho = useWindowDimensions().width;
  const escritorio = ancho >= Breakpoints.escritorio;
  // Columnas para las rejillas de tarjetas (salas, resultados). En 1240 px (el
  // ancho máximo del contenido) tres columnas de ~370 px entran cómodas.
  const columnas = !escritorio ? 1 : ancho >= 1180 ? 3 : 2;
  return { ancho, escritorio, columnas };
}

/**
 * Ancho de una tarjeta dentro de una rejilla de `columnas` columnas: crece para
 * llenar la suya, pero no más — sin el tope, la última fila (la que queda
 * incompleta) estiraría una sola tarjeta de lado a lado.
 */
export function estiloRejilla(columnas: number) {
  if (columnas <= 1) return null;
  const porFila = Math.min(Math.max(Math.round(columnas), 2), 4);
  // El tope en % (y no en px) es lo que hace que la última fila no estire una
  // sola tarjeta de lado a lado; el ancho base la deja crecer hasta su tope.
  return {
    flexBasis: porFila === 4 ? 280 : porFila === 3 ? 300 : 340,
    flexGrow: 1,
    maxWidth: porFila === 4 ? '23.5%' : porFila === 3 ? '32%' : '48%',
  } as const;
}
