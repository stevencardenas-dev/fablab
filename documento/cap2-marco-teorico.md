# Capítulo 2 — Marco teórico y estado del arte

## 2.1 Línea de tiempo de los antecedentes (2016–2026)

La evolución de la identificación automática aplicada a la gestión de
inventarios, en el periodo relevante para este proyecto, puede organizarse en
cuatro momentos:

**2016–2018 — Consolidación del código bidimensional en entornos industriales.**
El DataMatrix, normalizado desde 2006 en su segunda edición (ISO/IEC 16022:2006),
se consolida como estándar de marcado directo de piezas (DPM, *Direct Part
Marking*) en las industrias aeronáutica, automotriz y de dispositivos médicos,
desplazando al código lineal en la identificación de componentes pequeños.

**2018–2020 — Trazabilidad obligatoria en sectores regulados.** La entrada en
vigor de normativas de serialización farmacéutica en Europa y Estados Unidos
consolida el uso de GS1 DataMatrix como portador de datos para trazabilidad
unitaria. El efecto colateral relevante es la masificación de lectores capaces
de decodificar el símbolo, incluidas las cámaras de teléfonos móviles.

**2020–2023 — Desplazamiento del lector dedicado al dispositivo móvil.** La
mejora de las cámaras y de las bibliotecas de visión por computador hace
innecesario el terminal industrial para tareas de inventario de baja intensidad.
La captura de inventario se convierte en una función de software sobre hardware
de propósito general, lo que reduce drásticamente el costo de entrada para
laboratorios y pymes.

**2023–2026 — Integración con arquitecturas móviles multiplataforma.** La
madurez de marcos como React Native y Expo permite que un mismo desarrollo
atienda Android, iOS y web. Es el escenario tecnológico en el que se inscribe
este proyecto.

## 2.2 Bases teóricas

### 2.2.1 Identificación automática y captura de datos (AIDC)

AIDC designa el conjunto de métodos que permiten identificar objetos y capturar
sus datos sin digitación humana. Su fundamento es la eliminación del error de
transcripción: todo dato ingresado manualmente tiene una tasa de error asociada
que la captura automática reduce en varios órdenes de magnitud. Las familias
principales son el código de barras lineal, el código bidimensional, la
identificación por radiofrecuencia (RFID) y la visión artificial.

### 2.2.2 Simbología DataMatrix (ISO/IEC 16022)

DataMatrix es una simbología matricial bidimensional compuesta por módulos
nominalmente cuadrados dispuestos dentro de un patrón perimetral de
localización. Tres propiedades sustentan su elección en este proyecto:

- **Densidad por área.** Codifica más datos por unidad de superficie que un
  código lineal o un QR de capacidad equivalente, lo que permite marcar
  componentes de pocos milímetros.
- **Corrección de errores Reed-Solomon.** El símbolo se decodifica correctamente
  aun con una fracción del área dañada o cubierta, condición frecuente en
  herramienta sometida a uso y manipulación.
- **Patrón de localización en "L".** Permite la decodificación con independencia
  de la orientación del símbolo respecto del lector, lo que agiliza el escaneo
  en condiciones reales de estantería.

La norma se encuentra en su tercera edición (ISO/IEC 16022:2024).

### 2.2.3 Modelo relacional y normalización

El modelo relacional organiza la información en relaciones (tablas) vinculadas
por claves. Para este proyecto son determinantes dos aportes de la teoría de
normalización de Codd:

- **Eliminación de la redundancia.** Cada hecho se almacena una sola vez, lo que
  impide que dos copias del mismo dato diverjan —exactamente el fallo observado
  en las copias de Excel del diagnóstico.
- **Integridad referencial.** Las claves foráneas impiden estados imposibles,
  como un elemento asignado a una sala inexistente. La restricción la hace
  cumplir el motor de base de datos, no el usuario.

La estructura adoptada —`edificios → salas → elementos`, con una relación
transversal `traslados`— corresponde a una jerarquía de contención con registro
de eventos, y alcanza la tercera forma normal para los atributos gestionados.

### 2.2.4 Arquitectura móvil multiplataforma

React Native permite escribir la lógica e interfaz una sola vez y ejecutarla
sobre las APIs nativas de cada sistema operativo. Expo añade sobre ese marco el
acceso gestionado a capacidades del dispositivo —cámara, almacenamiento— sin
escribir código nativo. La pertinencia para el proyecto es directa: el
laboratorio no puede sostener dos desarrollos paralelos para Android e iOS.

## 2.3 Marco conceptual

**Inventario.** Conjunto de bienes bajo custodia del laboratorio, sujetos a
control administrativo, incluyendo maquinaria, mobiliario, equipos de cómputo,
componentes electrónicos e insumos consumibles.

**Elemento.** Unidad mínima de inventario, identificada por un código único y
caracterizada por detalle, serial, número de inventario institucional, estado,
observaciones y cantidad.

**Sala.** Espacio físico delimitado dentro de un edificio, que contiene
elementos. En este sistema constituye la unidad de ubicación.

**Edificio.** Agrupación de salas correspondiente a una unidad institucional.
El sistema contempla dos: FabLab y ViveLab.

**Traslado.** Evento que registra el cambio de sala de un elemento, conservando
la sala de origen, la de destino y la marca temporal. Es el mecanismo que
materializa la trazabilidad.

**Trazabilidad.** Capacidad de reconstruir la historia de ubicaciones de un
elemento a lo largo del tiempo.

**Stock en tiempo real.** Estado del inventario consultable en el momento, sin
necesidad de un proceso previo de consolidación manual.

## 2.4 Estado del arte y decisiones de diseño

### 2.4.1 DataMatrix frente a QR y código lineal

El QR posee mayor reconocimiento entre usuarios finales y mayor capacidad
máxima, pero requiere tres patrones de localización cuadrados que consumen área
útil. Para cargas útiles cortas —un identificador de inventario— DataMatrix
produce un símbolo físicamente menor a igual tamaño de módulo. Dado que el
requisito crítico es etiquetar componentes de pocos milímetros, la decisión
favorece a DataMatrix. El código lineal queda descartado por requerir longitud
horizontal incompatible con dichos componentes.

### 2.4.2 DataMatrix frente a RFID

RFID permite lectura sin línea de vista y captura masiva simultánea, ventajas
sustantivas en conteo de grandes volúmenes. Sin embargo, el costo por unidad
etiquetada es significativamente mayor que el de una etiqueta impresa, y exige
lectores dedicados. La práctica documentada en laboratorios consiste en un
esquema híbrido: RFID a nivel de contenedor o estante, y código bidimensional a
nivel de unidad individual. Para el alcance y el presupuesto de este proyecto se
adopta exclusivamente la vía del código impreso, cuyo costo marginal por
elemento es el del papel y la tinta.

### 2.4.3 Base de datos relacional frente a NoSQL

El dominio presenta relaciones explícitas y estables —un elemento pertenece a
una sala, una sala a un edificio, un traslado vincula dos salas y un elemento—
que se expresan naturalmente en claves foráneas. No existen requisitos de
esquema flexible ni de escala horizontal que justifiquen un motor documental. Se
adopta MySQL.

## 2.5 Referencias

- ISO/IEC 16022:2006. *Information technology — Automatic identification and
  data capture techniques — Data Matrix bar code symbology specification*.
  Ginebra: ISO. Recuperado de https://www.iso.org/standard/44230.html
- ISO/IEC 16022:2024. *Information technology — Automatic identification and
  data capture techniques — Data Matrix bar code symbology specification*
  (3.ª ed.). Ginebra: ISO. Recuperado de https://www.iso.org/standard/80926.html
- GS1. *GS1 DataMatrix Guideline: Overview and technical introduction to the use
  of GS1 DataMatrix*. Recuperado de
  https://www.gs1.org/docs/barcodes/GS1_DataMatrix_Guideline.pdf

> **Pendiente de normalización APA.** Las referencias anteriores están
> verificadas en su fuente pero deben ajustarse al formato APA 7 exigido, y debe
> completarse la referenciación de los apartados 2.2.3 (Codd) y 2.2.4 (React
> Native/Expo), para los que aún no se ha fijado la fuente citable.
