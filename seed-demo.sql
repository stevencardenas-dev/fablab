-- Datos de demostración para el sistema de inventario FabLab UFPS.
-- Estructura de referencia: ddl-schema.sql (ejecutar antes si la base no existe):
--   docker exec -i fablab-mysql mysql --default-character-set=utf8mb4 -u root -pfablab fablab < ddl-schema.sql
-- Este archivo es idempotente: vacía las tablas y reinicia los AUTO_INCREMENT
-- antes de cargar, para que los ids y las FK de traslados queden estables.

DELETE FROM `traslados`;
DELETE FROM `elementos`;
DELETE FROM `salas`;
DELETE FROM `edificios`;
ALTER TABLE `traslados` AUTO_INCREMENT = 1;
ALTER TABLE `elementos` AUTO_INCREMENT = 1;
ALTER TABLE `salas` AUTO_INCREMENT = 1;
ALTER TABLE `edificios` AUTO_INCREMENT = 1;

-- ─── Edificios (2) ───
INSERT INTO `edificios` (`id`, `nombre`) VALUES
  (1, 'FabLab'),
  (2, 'ViveLab');

-- ─── Salas (11) ───
INSERT INTO `salas` (`id`, `edificio_id`, `nombre`) VALUES
  (1,  1, 'CNC'),
  (2,  1, 'Impresión 3D'),
  (3,  1, 'Electrónica'),
  (4,  1, 'Cortadora Láser'),
  (5,  1, 'Textil'),
  (6,  1, 'Mecatrónica'),
  (7,  2, 'ViveLab 1'),
  (8,  2, 'ViveLab 2'),
  (9,  2, 'Almacén'),
  (10, 2, 'Sala de Reuniones'),
  (11, 2, 'Audiovisual');

-- ─── Elementos ───
INSERT INTO `elementos` (`sala_id`, `codigo`, `detalle`, `serial`, `inventario`, `estado`, `observaciones`, `cantidad`) VALUES
  (1, 'FAB-CNC-001', 'Router CNC 6040', 'SN-CNC6040-2211', 'INV-2026-0001', 'Operativo', NULL, '1'),
  (1, 'FAB-CNC-002', 'Fresadora manual', 'SN-FR2205-0917', 'INV-2026-0002', 'Operativo', 'Fresas incluidas', '1'),
  (1, 'FAB-CNC-003', 'Kit fresas router (10 pzas)', NULL, 'INV-2026-0003', 'Operativo', NULL, '10'),
  (2, 'FAB-3D-001', 'Impresora 3D Prusa MK4', 'SN-PRUSA-MK4-8841', 'INV-2026-0010', 'Operativo', 'Calibrada 2026-08', '1'),
  (2, 'FAB-3D-002', 'Impresora 3D Ender 3 V2', 'SN-ENDER3V2-5520', 'INV-2026-0011', 'En mantenimiento', 'Cama desnivelada', '1'),
  (2, 'FAB-3D-003', 'Filamento PLA 1kg (negro)', NULL, 'INV-2026-0012', 'Operativo', NULL, '6'),
  (2, 'FAB-3D-004', 'Filamento PLA 1kg (blanco)', NULL, 'INV-2026-0013', 'Operativo', NULL, '4'),
  (2, 'FAB-3D-005', 'Resina UV 1L', NULL, 'INV-2026-0014', 'Operativo', 'Guardar en lugar oscuro', '2'),
  (3, 'FAB-ELE-001', 'Estación de soldadura Hakko', 'SN-HK936-7712', 'INV-2026-0020', 'Operativo', NULL, '2'),
  (3, 'FAB-ELE-002', 'Multímetro digital Fluke', 'SN-FLK117-3390', 'INV-2026-0021', 'Operativo', NULL, '3'),
  (3, 'FAB-ELE-003', 'Osciloscopio Rigol DS1054Z', 'SN-RGL-DS1054-0213', 'INV-2026-0022', 'Operativo', NULL, '1'),
  (3, 'FAB-ELE-004', 'Kit protoboard y jumpers', NULL, 'INV-2026-0023', 'Operativo', NULL, '15'),
  (3, 'FAB-ELE-005', 'Fuente de laboratorio 30V 5A', 'SN-FU30V-6641', 'INV-2026-0024', 'Operativo', NULL, '2'),
  (4, 'FAB-LAS-001', 'Cortadora láser CO2 80W', 'SN-LS80W-1470', 'INV-2026-0030', 'Operativo', 'Requiere ventilación', '1'),
  (4, 'FAB-LAS-002', 'MDF 3mm (planchas)', NULL, 'INV-2026-0031', 'Operativo', NULL, '24'),
  (4, 'FAB-LAS-003', 'Acrílico transparente 3mm', NULL, 'INV-2026-0032', 'Operativo', NULL, '12'),
  (5, 'FAB-TXT-001', 'Máquina de coser industrial', 'SN-JUKI-8700-4415', 'INV-2026-0040', 'Operativo', NULL, '1'),
  (5, 'FAB-TXT-002', 'Bordadora computarizada', 'SN-BRD-2210-9931', 'INV-2026-0041', 'Operativo', NULL, '1'),
  (5, 'FAB-TXT-003', 'Hilo poliéster (rollo)', NULL, 'INV-2026-0042', 'Operativo', 'Varios colores', '30'),
  (6, 'FAB-MEC-001', 'Brazo robótico educativo', 'SN-ARM-EDU-3327', 'INV-2026-0050', 'Operativo', NULL, '2'),
  (6, 'FAB-MEC-002', 'Arduino Uno R4', 'SN-AR4-55120', 'INV-2026-0051', 'Operativo', NULL, '10'),
  (6, 'FAB-MEC-003', 'ESP32 DevKit', 'SN-ESP32-88341', 'INV-2026-0052', 'Operativo', NULL, '12'),
  (6, 'FAB-MEC-004', 'Kit sensores (20 módulos)', NULL, 'INV-2026-0053', 'Operativo', NULL, '5'),
  (7, 'VIV-VL1-001', 'PC de escritorio i5', 'SN-PCI5-2026-1147', 'INV-2026-0060', 'Operativo', 'Con doble monitor', '8'),
  (7, 'VIV-VL1-002', 'Silla ergonómica', NULL, 'INV-2026-0061', 'Operativo', NULL, '8'),
  (8, 'VIV-VL2-001', 'Laptop HP ProBook', 'SN-HPB450-6620', 'INV-2026-0070', 'Prestado', 'Prestada a docente', '1'),
  (8, 'VIV-VL2-002', 'Proyector Epson', 'SN-EPSPR-1174', 'INV-2026-0071', 'Operativo', NULL, '1'),
  (9, 'VIV-ALM-001', 'Cajas de almacenamiento', NULL, 'INV-2026-0080', 'Operativo', NULL, '20'),
  (9, 'VIV-ALM-002', 'Herramienta manual (set)', NULL, 'INV-2026-0081', 'Operativo', 'Destornilladores, alicates', '6'),
  (10, 'VIV-SAL-001', 'Mesa de reuniones 10 puestos', NULL, 'INV-2026-0090', 'Operativo', NULL, '1'),
  (10, 'VIV-SAL-002', 'Pantalla interactiva 65"', 'SN-SCR65-9012', 'INV-2026-0091', 'Operativo', NULL, '1'),
  (11, 'VIV-AUD-001', 'Cámara DSLR', 'SN-DSLR-4471', 'INV-2026-0100', 'Operativo', 'Incluye trípode', '2'),
  (11, 'VIV-AUD-002', 'Micrófono inalámbrico (par)', 'SN-MIC-W2-2231', 'INV-2026-0101', 'Operativo', NULL, '3'),
  (11, 'VIV-AUD-003', 'Kit de iluminación LED', NULL, 'INV-2026-0102', 'En mantenimiento', 'Falta repuesto', '2');

-- ─── Traslados de ejemplo ───
INSERT INTO `traslados` (`elemento_id`, `sala_anterior_id`, `sala_nueva_id`, `fecha`, `nota`) VALUES
  (5,  9, 2, '2026-08-03 09:15:00', 'Impresora enviada a mantenimiento de sala'),
  (26, 9, 8, '2026-08-20 14:40:00', 'Laptop asignada temporalmente a ViveLab 2'),
  (13, 9, 3, '2026-07-11 11:05:00', 'Fuente instalada en banco de electrónica'),
  (24, 9, 7, '2026-06-28 16:20:00', 'Equipos instalados en puestos ViveLab 1');
