# Sistema de gestión y control de inventario para el FabLab UFPS mediante identificación automática con códigos DataMatrix

**Seminario Integrador II**
Universidad Francisco de Paula Santander

---

## Tabla de contenido

- **Capítulo 1 — Definición del problema**
  - 1.1 Planteamiento del problema
  - 1.2 Formulación del problema
  - 1.3 Objetivo general
  - 1.4 Objetivos específicos
  - 1.5 Justificación
  - 1.6 Alcances
  - 1.7 Limitaciones
- **Capítulo 2 — Marco teórico y estado del arte**
  - 2.1 Línea de tiempo de los antecedentes (2016–2026)
  - 2.2 Bases teóricas
  - 2.3 Marco conceptual
  - 2.4 Estado del arte y decisiones de diseño
- **Capítulo 3 — Marco metodológico**
  - 3.1 Tipo de investigación
  - 3.2 Población y muestra
  - 3.3 Método: técnicas e instrumentos
  - 3.4 Fases metodológicas
  - 3.5 Limitaciones metodológicas
- **Referencias**

---

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

---

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

---

# Capítulo 3 — Marco metodológico

## 3.1 Tipo de investigación

La investigación es de **enfoque cuantitativo** y **alcance descriptivo con
componente experimental**, de tipo **aplicada**.

Es cuantitativa porque las variables de interés se miden numéricamente: tiempo
de registro de un elemento, tasa de error en la captura de datos, porcentaje de
elementos con ubicación correctamente reflejada en el sistema, y tasa de lectura
exitosa del código DataMatrix.

Es aplicada porque no persigue generar conocimiento teórico nuevo, sino resolver
un problema operativo concreto y verificable del FabLab mediante un artefacto de
software.

El componente experimental se concreta en la comparación **pre-test / post-test**
sobre el mismo laboratorio: se miden los indicadores bajo el procedimiento actual
(hoja de cálculo, registro manual) y se vuelven a medir bajo el sistema
propuesto, siendo la introducción del sistema la variable independiente
manipulada.

> **Observación metodológica.** Al tratarse de un diseño **pre-experimental** —un
> solo grupo, sin grupo de control ni asignación aleatoria— no permite descartar
> por completo explicaciones alternativas como el efecto de aprendizaje del
> operario. Se declara explícitamente como limitación en el apartado 3.5. Un
> diseño cuasi-experimental con un segundo laboratorio como control sería más
> robusto, pero excede los recursos disponibles.

## 3.2 Población y muestra

**Población.** La totalidad de los elementos inventariados del FabLab y el
ViveLab de la institución, junto con el personal que ejecuta los procesos de
inventario.

La población de elementos quedó cuantificada durante la fase de migración de
datos de este proyecto:

| Edificio | Sala | Elementos |
|---|---|---|
| FabLab | CNC | 171 |
| FabLab | Impresión 3D | 126 |
| FabLab | Almacén | 99 |
| FabLab | RV y Drones | 92 |
| FabLab | IoT | 84 |
| FabLab | Recepción | 67 |
| FabLab | Coworking | 61 |
| ViveLab | Lab Imagen (305) | 69 |
| ViveLab | Aula 303 | 49 |
| ViveLab | Aula 304 | 49 |
| ViveLab | Bodega | 49 |
| **Total** | **11 salas** | **916** |

*Fuente: migración del libro de inventario institucional, verificada contra las
hojas de origen.*

**Muestra.** Para las pruebas de rendimiento del sistema se emplea un **muestreo
no probabilístico por conveniencia**, estratificado por sala y por tipo de
elemento, garantizando la inclusión de:

- elementos de gran formato (maquinaria, mobiliario), donde la etiqueta no
  presenta restricción de tamaño;
- elementos de formato reducido (componentes electrónicos), que constituyen el
  caso crítico que motiva la elección de DataMatrix;
- elementos con los tres tipos de valor problemático hallados en la columna
  `CANTIDAD` (numérico, guion, `INCONTABLE`).

Para la medición de tiempos y errores de proceso, la muestra es el personal que
opera el inventario, que por el tamaño de la planta se aborda de forma censal.

## 3.3 Método: técnicas e instrumentos

### 3.3.1 Técnicas de recolección

- **Análisis documental.** Examen de los libros de Excel vigentes para
  caracterizar la estructura de datos real y sus inconsistencias. Ya ejecutado;
  sus hallazgos alimentan el capítulo 1.
- **Observación directa con cronometraje.** Medición del tiempo requerido para
  registrar y para localizar un elemento, bajo el procedimiento actual y bajo el
  sistema propuesto.
- **Entrevista semiestructurada.** Aplicada al personal del laboratorio para
  identificar puntos de fricción del procedimiento vigente.
- **Pruebas de software.** Ejecución de casos de prueba automatizados sobre la
  lógica de inventario y de generación/lectura de DataMatrix.

### 3.3.2 Instrumentos

- Ficha de análisis documental de la estructura de las hojas de cálculo.
- Formato de registro de tiempos (pre-test / post-test).
- Guion de entrevista semiestructurada.
- Suite de pruebas automatizadas del repositorio del proyecto.

### 3.3.3 Variables e indicadores

| Variable | Indicador | Instrumento |
|---|---|---|
| Tiempo de registro | segundos por elemento registrado | Registro de tiempos |
| Tiempo de localización | segundos hasta ubicar un elemento | Registro de tiempos |
| Integridad de datos | n.º de registros duplicados o inconsistentes | Consulta SQL sobre la base |
| Exactitud de ubicación | % de elementos cuya sala registrada coincide con la real | Auditoría física por muestra |
| Fiabilidad de lectura | % de lecturas exitosas al primer intento | Prueba de escaneo |

### 3.3.4 Herramientas

| Capa | Herramienta |
|---|---|
| Aplicación móvil y web | React Native, Expo, TypeScript |
| Base de datos | MySQL / MariaDB |
| Migración de datos | Node.js, biblioteca `xlsx` |
| Identificación | DataMatrix (ISO/IEC 16022) |
| Control de versiones | Git |
| Pruebas | Jest |

## 3.4 Fases metodológicas

1. **Diagnóstico.** Análisis documental del inventario vigente y caracterización
   de sus inconsistencias. *(Ejecutada.)*
2. **Diseño de la arquitectura de datos.** Modelado relacional normalizado y
   definición del esquema. *(Ejecutada.)*
3. **Migración.** Carga masiva de los libros de Excel a la base de datos, con
   verificación de conteos contra las hojas de origen. *(Ejecutada: 916
   elementos, 11 salas, 2 edificios.)*
4. **Desarrollo del módulo de identificación.** Generación y lectura de
   DataMatrix. *(En curso.)*
5. **Desarrollo de la gestión espacial.** Traslados e historial de movimientos.
   *(Esquema de datos implementado; interfaz pendiente.)*
6. **Pruebas y medición post-test.** Aplicación de los instrumentos y
   comparación con la línea base.
7. **Análisis de resultados y conclusiones.**

## 3.5 Limitaciones metodológicas

- El diseño es pre-experimental de un solo grupo; no aísla completamente el
  efecto de aprendizaje del operario respecto del efecto del sistema.
- El muestreo para pruebas es por conveniencia, por lo que los resultados no son
  estadísticamente generalizables a otros laboratorios.
- La medición post-test depende de que el sistema alcance despliegue operativo
  dentro del cronograma académico.
- El tamaño del personal del laboratorio impide un análisis inferencial sobre la
  variable humana; su tratamiento es descriptivo.

---

# Referencias

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
