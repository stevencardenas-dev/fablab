# Capítulo 1 — Definición del problema

## 1.1 Planteamiento del problema

El FabLab de la Universidad Francisco de Paula Santander administra actualmente
la totalidad de su inventario —maquinaria, mobiliario, componentes electrónicos
e insumos— mediante hojas de cálculo de Excel. Este mecanismo, adecuado cuando
el laboratorio era pequeño, dejó de serlo al crecer el número de salas y de
elementos bajo custodia.

El diagnóstico realizado sobre los archivos actuales evidencia cuatro problemas
concretos:

**Falta de trazabilidad.** Cuando un elemento se traslada de una sala a otra, la
actualización del archivo depende de que una persona lo recuerde y lo registre.
En la práctica el registro se hace tarde o no se hace, de modo que la ubicación
consignada no corresponde a la ubicación real.

**Proceso manual y propenso a error.** El conteo y la inspección se realizan a
mano, lo que introduce errores de digitación y duplicados. En el libro analizado
se encontraron registros del mismo elemento con códigos distintos, y la columna
`CANTIDAD` mezcla valores numéricos (`12`), guiones (`-`) y la palabra
`INCONTABLE`, lo que impide cualquier operación agregada confiable.

**Componentes de tamaño reducido.** Un microcontrolador, un sensor o una
resistencia no ofrecen superficie suficiente para una etiqueta legible con
código de barras lineal o QR. Esto deja a una fracción significativa del
inventario sin identificación física posible.

**Riesgo de pérdida de información.** Al ser archivos y no un sistema, circulan
múltiples copias por correo, USB y equipos personales. Durante este proyecto se
verificó empíricamente el problema: de cuatro copias del libro de inventario
entregadas por la coordinación del laboratorio, tres carecían de las cantidades
de doce elementos de la sala de recepción que sí estaban registradas en la
cuarta. Ninguna copia declara ser la vigente; no existe fuente única de verdad.

## 1.2 Formulación del problema

¿Cómo garantizar la trazabilidad, la integridad y la identificación automática
de los elementos del inventario del FabLab, superando las limitaciones de un
esquema basado en hojas de cálculo distribuidas?

## 1.3 Objetivo general

Desarrollar e implementar un aplicativo móvil y web, soportado en una base de
datos relacional desplegada, que permita gestionar, controlar e identificar
automáticamente el inventario del FabLab mediante códigos DataMatrix.

## 1.4 Objetivos específicos

1. Diseñar y desplegar la arquitectura de datos del sistema, migrando la
   información actualmente contenida en hojas de cálculo hacia una base de datos
   relacional normalizada.
2. Desarrollar el módulo móvil y web con capacidad de lectura y generación de
   códigos DataMatrix, que permita consultar el stock en tiempo real.
3. Implementar la gestión espacial del inventario: administración de edificios y
   salas, reubicación de elementos y registro histórico de traslados.

Los tres objetivos corresponden a las tres capas del sistema —datos,
identificación y trazabilidad— y son secuenciales: sin la capa de datos no hay
sobre qué identificar, y sin identificación no hay cómo registrar movimientos.

## 1.5 Justificación

**Efectividad operativa.** DataMatrix codifica una cantidad considerable de
información en un área bidimensional muy reducida, con corrección de errores
Reed-Solomon que permite la lectura aun con el símbolo parcialmente dañado
(ISO/IEC 16022). Esta densidad por unidad de área es lo que hace viable etiquetar
componentes que un código lineal o un QR no permitirían marcar.

**Integridad de los datos.** El paso de un archivo sin control de concurrencia a
una base de datos relacional centralizada elimina la posibilidad de versiones
divergentes y permite que varios usuarios operen simultáneamente. La integridad
referencial entre elementos, salas y traslados queda garantizada por el motor y
no por la disciplina de los usuarios.

**Optimización del laboratorio.** Con el stock consultable en tiempo real desde
un dispositivo móvil se agilizan la reposición y las auditorías, que hoy exigen
recorrer físicamente cada sala con una planilla impresa.

**Pertinencia académica.** El proyecto alinea al laboratorio con prácticas de
identificación automática y captura de datos (AIDC) propias de la Industria 4.0,
que constituyen contenido curricular del programa.

## 1.6 Alcances

- Sistema multidispositivo: aplicación móvil para escaneo en sala y módulo web
  para administración.
- Gestión completa de DataMatrix: lectura por cámara y generación del símbolo
  vectorial listo para impresión.
- Gestión de espacios: administración de edificios y salas, reubicación de
  elementos e historial de traslados.
- Migración masiva de los libros de Excel existentes hacia la base de datos.

## 1.7 Limitaciones

- El sistema **no realiza la impresión física** de las etiquetas: genera el
  archivo vectorial, pero la impresión depende del hardware disponible en el
  laboratorio.
- El sistema **requiere conectividad** (red local o internet) para sincronizar
  con la base de datos. La operación completamente desconectada queda fuera del
  alcance; es un compromiso asumido conscientemente a cambio de la trazabilidad
  centralizada.
- El sistema **no automatiza la compra a proveedores**: genera alertas y
  reportes de reabastecimiento, pero la orden de compra la emite una persona.
- El alcance se limita a los inventarios del FabLab y el ViveLab de la
  institución; no contempla otras dependencias.
