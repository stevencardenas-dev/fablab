DROP TABLE IF EXISTS `traslados`;
DROP TABLE IF EXISTS `elementos`;
DROP TABLE IF EXISTS `salas`;
DROP TABLE IF EXISTS `edificios`;

CREATE TABLE `edificios` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `nombre` VARCHAR(64) NOT NULL UNIQUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `salas` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `edificio_id` INT NOT NULL,
  `nombre` VARCHAR(64) NOT NULL,
  UNIQUE KEY `uq_sala` (`edificio_id`, `nombre`),
  FOREIGN KEY (`edificio_id`) REFERENCES `edificios`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `elementos` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `sala_id` INT NOT NULL,
  `codigo` VARCHAR(64) NULL,
  `detalle` VARCHAR(255) NULL,
  `serial` VARCHAR(64) NULL,
  `inventario` VARCHAR(64) NULL,
  `estado` VARCHAR(64) NULL,
  `observaciones` VARCHAR(255) NULL,
  `cantidad` VARCHAR(64) NULL,
  KEY `ix_sala` (`sala_id`),
  FOREIGN KEY (`sala_id`) REFERENCES `salas`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `traslados` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `elemento_id` INT NOT NULL,
  `sala_anterior_id` INT NULL,
  `sala_nueva_id` INT NOT NULL,
  `fecha` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `nota` VARCHAR(255) NULL,
  FOREIGN KEY (`elemento_id`) REFERENCES `elementos`(`id`),
  FOREIGN KEY (`sala_anterior_id`) REFERENCES `salas`(`id`),
  FOREIGN KEY (`sala_nueva_id`) REFERENCES `salas`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
