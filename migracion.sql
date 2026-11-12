-- ============================================================
--  Verde por Verde · MIGRACIÓN para una base de datos YA importada
--  (si la base está vacía, mejor importa verde_por_verde.sql completo)
--  phpMyAdmin > base verde_por_verde > Importar > este archivo
--  Requiere MariaDB (el que trae XAMPP).
-- ============================================================
SET NAMES utf8mb4;
USE `verde_por_verde`;

-- 1) Nuevo rol: proveedor
ALTER TABLE `usuarios`
  MODIFY `rol` ENUM('usuario','admin','proveedor') NOT NULL DEFAULT 'usuario';

-- 2) Códigos de reciclaje de un solo uso
CREATE TABLE IF NOT EXISTS `codigos_reciclaje` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `codigo_hash` CHAR(64) NOT NULL,
  `terminacion` CHAR(4)  NOT NULL,
  `admin_id`    INT UNSIGNED NOT NULL,
  `usuario_id`  INT UNSIGNED NULL,
  `puntos`      INT UNSIGNED NOT NULL,
  `kg`          DECIMAL(8,1) NOT NULL,
  `estado`      ENUM('pendiente','canjeado','anulado') NOT NULL DEFAULT 'pendiente',
  `creado`      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expira`      DATETIME NOT NULL,
  `canjeado_en` DATETIME NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_codigo_hash` (`codigo_hash`),
  KEY `ix_codigo_estado` (`estado`,`expira`),
  CONSTRAINT `fk_cod_admin`   FOREIGN KEY (`admin_id`)   REFERENCES `usuarios`(`id`),
  CONSTRAINT `fk_cod_usuario` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `codigo_items` (
  `id`              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `codigo_id`       INT UNSIGNED NOT NULL,
  `material_codigo` VARCHAR(10) NOT NULL,
  `kg`              DECIMAL(8,1) NOT NULL,
  `puntos`          INT UNSIGNED NOT NULL,
  PRIMARY KEY (`id`),
  KEY `ix_item_codigo` (`codigo_id`),
  CONSTRAINT `fk_item_codigo`   FOREIGN KEY (`codigo_id`)       REFERENCES `codigos_reciclaje`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_item_material` FOREIGN KEY (`material_codigo`) REFERENCES `materiales`(`codigo`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3) Cada movimiento recuerda de qué código vino
ALTER TABLE `movimientos`
  ADD COLUMN IF NOT EXISTS `codigo_id` INT UNSIGNED NULL AFTER `folio`;
ALTER TABLE `movimientos`
  ADD CONSTRAINT `fk_mov_codigo` FOREIGN KEY (`codigo_id`) REFERENCES `codigos_reciclaje`(`id`) ON DELETE SET NULL;

-- 4) Entregas de proveedores
CREATE TABLE IF NOT EXISTS `abastecimientos` (
  `id`           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `proveedor_id` INT UNSIGNED NOT NULL,
  `producto_id`  SMALLINT UNSIGNED NOT NULL,
  `cantidad`     INT UNSIGNED NOT NULL,
  `fecha`        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `ix_abast_prov` (`proveedor_id`,`id`),
  CONSTRAINT `fk_abast_prov` FOREIGN KEY (`proveedor_id`) REFERENCES `usuarios`(`id`),
  CONSTRAINT `fk_abast_prod` FOREIGN KEY (`producto_id`)  REFERENCES `productos`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5) Seguridad: intentos fallidos y bitácora
CREATE TABLE IF NOT EXISTS `intentos` (
  `id`    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tipo`  VARCHAR(12)  NOT NULL,
  `clave` VARCHAR(160) NOT NULL,
  `fecha` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `ix_intentos` (`tipo`,`clave`,`fecha`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `bitacora` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `usuario_id` INT UNSIGNED NULL,
  `accion`     VARCHAR(40)  NOT NULL,
  `detalle`    VARCHAR(255) NOT NULL DEFAULT '',
  `ip`         VARCHAR(45)  NOT NULL DEFAULT '',
  `fecha`      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `ix_bit_fecha` (`fecha`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
