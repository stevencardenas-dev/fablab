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
