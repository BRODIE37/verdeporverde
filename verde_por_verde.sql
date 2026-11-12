-- ============================================================
--  Verde por Verde  ·  Base de datos para XAMPP (MySQL / MariaDB)
--  Importar desde phpMyAdmin:  Importar > Elegir archivo > Continuar
-- ============================================================
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE DATABASE IF NOT EXISTS `verde_por_verde`
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `verde_por_verde`;

-- ------------------------------------------------------------
--  Usuarios  (el PRIMER usuario que se registre queda como admin;
--  los demás se registran como 'usuario'. El admin crea proveedores)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `usuarios` (
  `id`            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `nombre`        VARCHAR(80)  NOT NULL,
  `correo`        VARCHAR(120) NOT NULL,
  `password_hash` VARCHAR(255) NOT NULL,
  `puntos`        INT UNSIGNED NOT NULL DEFAULT 0,
  `rol`           ENUM('usuario','admin','proveedor') NOT NULL DEFAULT 'usuario',
  `creado`        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_usuarios_correo` (`correo`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
--  Materiales reciclables y puntos por kilo (editable en Panel admin)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `materiales` (
  `codigo`        VARCHAR(10) NOT NULL,
  `nombre`        VARCHAR(60) NOT NULL,
  `emoji`         VARCHAR(16) NOT NULL,
  `puntos_por_kg` INT UNSIGNED NOT NULL DEFAULT 1,
  `orden`         TINYINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`codigo`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
--  Productos canjeables e inventario
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `productos` (
  `id`     SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `nombre` VARCHAR(60) NOT NULL,
  `emoji`  VARCHAR(16) NOT NULL,
  `costo`  INT UNSIGNED NOT NULL,
  `stock`  INT UNSIGNED NOT NULL DEFAULT 0,
  `activo` TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
--  Códigos de reciclaje de UN SOLO USO (QR / código alfanumérico).
--  El admin los genera al validar el material; el usuario los canjea.
--  Solo se guarda el hash SHA-256 del código, nunca el código en claro.
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
--  Movimientos: entregas de reciclaje (+puntos) y canjes (-puntos)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `movimientos` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `usuario_id`      INT UNSIGNED NOT NULL,
  `tipo`            ENUM('entrega','canje') NOT NULL,
  `descripcion`     VARCHAR(160) NOT NULL,
  `emoji`           VARCHAR(16) NOT NULL,
  `puntos`          INT NOT NULL,
  `kg`              DECIMAL(8,1) NOT NULL DEFAULT 0.0,
  `material_codigo` VARCHAR(10) NULL,
  `producto_id`     SMALLINT UNSIGNED NULL,
  `folio`           VARCHAR(20) NULL,
  `codigo_id`       INT UNSIGNED NULL,
  `fecha`           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_movimientos_folio` (`folio`),
  KEY `ix_mov_usuario` (`usuario_id`,`id`),
  KEY `ix_mov_tipo` (`tipo`),
  CONSTRAINT `fk_mov_usuario`  FOREIGN KEY (`usuario_id`)      REFERENCES `usuarios`(`id`)    ON DELETE CASCADE,
  CONSTRAINT `fk_mov_material` FOREIGN KEY (`material_codigo`) REFERENCES `materiales`(`codigo`) ON DELETE SET NULL,
  CONSTRAINT `fk_mov_producto` FOREIGN KEY (`producto_id`)     REFERENCES `productos`(`id`)   ON DELETE SET NULL,
  CONSTRAINT `fk_mov_codigo`   FOREIGN KEY (`codigo_id`)       REFERENCES `codigos_reciclaje`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
--  Entregas de víveres de los proveedores (suman al inventario)
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
--  Seguridad: intentos fallidos (bloqueo temporal) y bitácora
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
--  Datos iniciales
-- ------------------------------------------------------------
INSERT IGNORE INTO `materiales` (`codigo`,`nombre`,`emoji`,`puntos_por_kg`,`orden`) VALUES
  ('pet','Plástico PET','🧴',10,1),
  ('car','Cartón','📦',8,2),
  ('alu','Aluminio','🥫',15,3),
  ('vid','Vidrio','🫙',12,4);

INSERT IGNORE INTO `productos` (`id`,`nombre`,`emoji`,`costo`,`stock`) VALUES
  (1,'Manzanas','🍎',40,12),
  (2,'Plátanos','🍌',25,12),
  (3,'Naranjas','🍊',35,12),
  (4,'Aguacate','🥑',50,12),
  (5,'Fresas','🍓',45,12),
  (6,'Zanahorias','🥕',20,12),
  (7,'Espinacas','🥬',30,12);

-- ------------------------------------------------------------
--  Vista de apoyo para consultas desde phpMyAdmin
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW `v_resumen_usuarios` AS
SELECT u.id, u.nombre, u.correo, u.puntos, u.rol,
       COALESCE(SUM(CASE WHEN m.tipo='entrega' THEN m.kg END),0)      AS kg_reciclados,
       COALESCE(SUM(CASE WHEN m.tipo='canje'   THEN 1 END),0)         AS canjes
FROM usuarios u
LEFT JOIN movimientos m ON m.usuario_id = u.id
GROUP BY u.id, u.nombre, u.correo, u.puntos, u.rol;

SET FOREIGN_KEY_CHECKS = 1;
