<?php
/* Verde por Verde – API (PHP + MySQL/MariaDB)
   Roles: usuario · admin · proveedor  (cada acción valida el rol en el servidor) */

// ---- Configuración de XAMPP (valores por defecto) ----
const DB_HOST = '127.0.0.1';
const DB_NAME = 'verde_por_verde';
const DB_USER = 'root';
const DB_PASS = '';

// ---- Seguridad ----
const SESION_INACTIVIDAD = 1200;   // 20 min sin actividad cierra la sesión
const SESION_MAXIMA      = 28800;  // 8 h máximo aunque haya actividad
const MAX_INTENTOS       = 5;      // intentos fallidos por correo / por usuario (código)
const MAX_INTENTOS_IP    = 20;     // intentos fallidos por IP
const VENTANA_MIN        = 15;     // minutos de bloqueo
const CODIGO_VIGENCIA_MIN = 60;    // vigencia de un código de reciclaje

const ROLES = ['usuario', 'admin', 'proveedor'];

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('Referrer-Policy: no-referrer');
header("Content-Security-Policy: default-src 'none'; frame-ancestors 'none'");

$https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off');
ini_set('session.use_strict_mode', '1');
ini_set('session.use_only_cookies', '1');
session_name('VXVSESS');
session_set_cookie_params(['lifetime' => 0, 'path' => '/', 'secure' => $https, 'httponly' => true, 'samesite' => 'Strict']);
session_start();

$db = null;

function out($d, $c = 200) { http_response_code($c); echo json_encode($d, JSON_UNESCAPED_UNICODE); exit; }
function fail($m, $f = null, $c = 400) {
  global $db;
  if ($db && $db->inTransaction()) $db->rollBack();
  out(['ok' => false, 'error' => $m, 'field' => $f], $c);
}
function ip() { return substr((string)($_SERVER['REMOTE_ADDR'] ?? ''), 0, 45); }

// ---- Sesión: expira por inactividad y por tiempo máximo ----
$ahora = time();
if (!empty($_SESSION['uid'])) {
  if ($ahora - ($_SESSION['last'] ?? 0) > SESION_INACTIVIDAD || $ahora - ($_SESSION['ini'] ?? $ahora) > SESION_MAXIMA) {
    $_SESSION = [];
    session_regenerate_id(true);
  } else {
    $_SESSION['last'] = $ahora;
  }
}
if (empty($_SESSION['csrf'])) $_SESSION['csrf'] = bin2hex(random_bytes(32));

function cerrar_sesion() {
  $_SESSION = [];
  if (ini_get('session.use_cookies')) {
    $p = session_get_cookie_params();
    setcookie(session_name(), '', ['expires' => time() - 3600, 'path' => $p['path'], 'secure' => $p['secure'], 'httponly' => true, 'samesite' => 'Strict']);
  }
  session_destroy();
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') fail('Método no permitido.', null, 405);

// Solo se aceptan peticiones que vengan de esta misma página
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($origin !== '') {
  $oh = (string)parse_url($origin, PHP_URL_HOST);
  $op = parse_url($origin, PHP_URL_PORT);
  if ($op) $oh .= ':' . $op;
  if (!hash_equals(strtolower($_SERVER['HTTP_HOST'] ?? ''), strtolower($oh))) fail('Origen no permitido.', null, 403);
}

try {
  $db = new PDO('mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=utf8mb4', DB_USER, DB_PASS, [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    PDO::ATTR_EMULATE_PREPARES => false,
  ]);
} catch (Throwable $e) {
  fail('No se pudo conectar a la base de datos. Enciende MySQL en XAMPP e importa verde_por_verde.sql.', null, 500);
}

$in = json_decode(file_get_contents('php://input') ?: '{}', true);
if (!is_array($in)) $in = [];
$action = (string)($_GET['action'] ?? '');

// Token anti-CSRF: obligatorio en todo menos init / login / registro
if (!in_array($action, ['init', 'login', 'registro'], true)) {
  $tk = (string)($_SERVER['HTTP_X_CSRF_TOKEN'] ?? '');
  if (!hash_equals($_SESSION['csrf'], $tk)) {
    if (empty($_SESSION['uid'])) fail('Tu sesión expiró. Inicia sesión de nuevo.', null, 401);
    fail('Solicitud no válida. Recarga la página.', null, 403);
  }
}

// ---------------- Utilidades ----------------
function bit($db, $uid, $accion, $det = '') {
  try {
    $db->prepare('INSERT INTO bitacora (usuario_id, accion, detalle, ip) VALUES (?,?,?,?)')
       ->execute([$uid ?: null, substr($accion, 0, 40), substr($det, 0, 255), ip()]);
  } catch (Throwable $e) { error_log('[verde-por-verde] bitacora: ' . $e->getMessage()); }
}
function intentos($db, $tipo, $clave, $min = VENTANA_MIN) {
  $st = $db->prepare('SELECT COUNT(*) FROM intentos WHERE tipo = ? AND clave = ? AND fecha > (NOW() - INTERVAL ' . (int)$min . ' MINUTE)');
  $st->execute([$tipo, substr($clave, 0, 160)]);
  return (int)$st->fetchColumn();
}
function fallo($db, $tipo, $clave) {
  $db->prepare('INSERT INTO intentos (tipo, clave) VALUES (?,?)')->execute([$tipo, substr($clave, 0, 160)]);
  if (random_int(1, 20) === 1) $db->exec('DELETE FROM intentos WHERE fecha < (NOW() - INTERVAL 1 DAY)');
}
function limpiar($db, $tipo, $clave) {
  $db->prepare('DELETE FROM intentos WHERE tipo = ? AND clave = ?')->execute([$tipo, substr($clave, 0, 160)]);
}
function pass_ok($p) {
  return strlen($p) >= 8 && strlen($p) <= 200 && preg_match('/[A-Z]/', $p) && preg_match('/[a-z]/', $p)
      && preg_match('/\d/', $p) && preg_match('/[^A-Za-z0-9]/', $p);
}
function crear_usuario($db, $n, $e, $p, $rol) {
  if (mb_strlen($n) < 2 || mb_strlen($n) > 80) fail('Escribe el nombre (mínimo 2 letras).', 'n');
  if (strlen($e) > 120 || !filter_var($e, FILTER_VALIDATE_EMAIL)) fail('Eso no parece un correo. Ejemplo: nombre@correo.com', 'e');
  if (!pass_ok($p)) fail('La contraseña debe cumplir todos los requisitos de la lista.', 'p');
  $st = $db->prepare('SELECT id FROM usuarios WHERE correo = ?');
  $st->execute([$e]);
  if ($st->fetch()) fail('Ese correo ya está registrado.', 'e');
  try {
    $db->prepare('INSERT INTO usuarios (nombre, correo, password_hash, rol) VALUES (?,?,?,?)')
       ->execute([$n, $e, password_hash($p, PASSWORD_DEFAULT), $rol]);
  } catch (PDOException $x) {
    if ($x->getCode() === '23000') fail('Ese correo ya está registrado.', 'e');
    throw $x;
  }
  return (int)$db->lastInsertId();
}
function iniciar_sesion($id) {
  session_regenerate_id(true);
  $_SESSION['uid'] = $id;
  $_SESSION['ini'] = $_SESSION['last'] = time();
  $_SESSION['csrf'] = bin2hex(random_bytes(32));
}

function catalogo($db) {
  $m = $db->query("SELECT codigo, nombre, emoji, puntos_por_kg AS pts FROM materiales ORDER BY orden, codigo")->fetchAll();
  $p = $db->query("SELECT id, nombre, emoji, costo, stock FROM productos WHERE activo = 1 ORDER BY id")->fetchAll();
  return ['materiales' => $m, 'productos' => $p];
}

function hist($db, $id, $limit) {
  $st = $db->prepare("SELECT tipo, descripcion, emoji, puntos, kg, folio, UNIX_TIMESTAMP(fecha)*1000 AS ts
                      FROM movimientos WHERE usuario_id = ? ORDER BY id DESC LIMIT " . (int)$limit);
  $st->execute([$id]);
  return array_map(fn($r) => [
    't' => $r['tipo'] === 'entrega' ? 'e' : 'c',
    'n' => $r['descripcion'], 'e' => $r['emoji'],
    'p' => (int)$r['puntos'], 'kg' => (float)$r['kg'], 'd' => (int)$r['ts'], 'f' => $r['folio'],
  ], $st->fetchAll());
}

function user_data($db, $id) {
  $st = $db->prepare('SELECT nombre, correo, puntos, rol FROM usuarios WHERE id = ?');
  $st->execute([$id]);
  $u = $st->fetch();
  if (!$u) return null;

  $st = $db->prepare("SELECT COALESCE(SUM(kg),0) AS kg,
                             COALESCE(SUM(CASE WHEN puntos > 0 THEN puntos END),0) AS ganados,
                             COUNT(DISTINCT CASE WHEN tipo='entrega' THEN DATE(fecha) END) AS dias
                      FROM movimientos WHERE usuario_id = ?");
  $st->execute([$id]);
  $s = $st->fetch();

  return [
    'n' => $u['nombre'], 'e' => $u['correo'], 'b' => (int)$u['puntos'],
    'rol' => $u['rol'], 'admin' => $u['rol'] === 'admin',
    'kg' => (float)$s['kg'], 'earn' => (int)$s['ganados'], 'days' => (int)$s['dias'],
    'h' => hist($db, $id, 5),
  ];
}

// Perfil completo: todo lo que el usuario ha reciclado y canjeado
function perfil_data($db, $id) {
  $d = user_data($db, $id);
  if (!$d) return null;
  $st = $db->prepare("SELECT COALESCE(t.nombre, m.material_codigo) AS nombre, COALESCE(t.emoji, '♻️') AS emoji,
                             SUM(m.kg) AS kg, SUM(m.puntos) AS pts
                      FROM movimientos m LEFT JOIN materiales t ON t.codigo = m.material_codigo
                      WHERE m.usuario_id = ? AND m.tipo = 'entrega' AND m.material_codigo IS NOT NULL
                      GROUP BY m.material_codigo, t.nombre, t.emoji ORDER BY kg DESC");
  $st->execute([$id]);
  $d['mats'] = array_map(fn($r) => ['n' => $r['nombre'], 'e' => $r['emoji'], 'kg' => (float)$r['kg'], 'p' => (int)$r['pts']], $st->fetchAll());
  $st = $db->prepare("SELECT COUNT(*) FROM movimientos WHERE usuario_id = ? AND tipo = 'canje'");
  $st->execute([$id]);
  $d['canjes'] = (int)$st->fetchColumn();
  $d['hist'] = hist($db, $id, 100);
  return $d;
}

function need_user($db) {
  $id = (int)($_SESSION['uid'] ?? 0);
  if (!$id) fail('Tu sesión expiró. Inicia sesión de nuevo.', null, 401);
  $st = $db->prepare('SELECT id, rol, nombre FROM usuarios WHERE id = ?');
  $st->execute([$id]);
  $u = $st->fetch();
  if (!$u) { $_SESSION = []; fail('Tu sesión expiró. Inicia sesión de nuevo.', null, 401); }
  return $u;
}
// Cada acción declara qué roles pueden usarla; todo lo demás se rechaza aquí, en el servidor.
function need_role($db, ...$roles) {
  $u = need_user($db);
  if (!in_array($u['rol'], $roles, true)) {
    bit($db, $u['id'], 'acceso_denegado', ($_GET['action'] ?? '') . ' (rol ' . $u['rol'] . ')');
    fail('No tienes permiso para entrar a esta sección.', null, 403);
  }
  return $u;
}

// ---- Códigos de reciclaje de un solo uso ----
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin I, O, 0, 1 para no confundir
function nuevo_codigo() {
  $s = '';
  for ($i = 0; $i < 10; $i++) $s .= ALFABETO[random_int(0, strlen(ALFABETO) - 1)];
  return $s;
}
function norm_codigo($c) { return strtoupper(preg_replace('/[^A-Za-z0-9]/', '', (string)$c)); }
function hash_codigo($c) { return hash('sha256', $c); }

// ---------------- Acciones ----------------
try {
  switch ($action) {

    // ===== Sesión (todos los roles) =====
    case 'init': {
      $id = (int)($_SESSION['uid'] ?? 0);
      $u = $id ? user_data($db, $id) : null;
      if ($id && !$u) { $_SESSION = []; }
      out(['ok' => true, 'csrf' => $_SESSION['csrf'], 'catalogo' => catalogo($db), 'user' => $u]);
    }

    case 'registro': {
      // El registro público SIEMPRE crea un usuario. Solo el primero de todos queda como admin.
      if (intentos($db, 'registro', 'ip:' . ip(), 60) >= 10) fail('Demasiados registros desde este equipo. Intenta más tarde.', null, 429);
      $n = trim((string)($in['n'] ?? ''));
      $e = strtolower(trim((string)($in['e'] ?? '')));
      $p = (string)($in['p'] ?? '');
      $rol = ((int)$db->query('SELECT COUNT(*) FROM usuarios')->fetchColumn() === 0) ? 'admin' : 'usuario';
      $id = crear_usuario($db, $n, $e, $p, $rol);
      fallo($db, 'registro', 'ip:' . ip());
      iniciar_sesion($id);
      bit($db, $id, 'registro', $rol);
      out(['ok' => true, 'csrf' => $_SESSION['csrf'], 'user' => user_data($db, $id)]);
    }

    case 'login': {
      $e = strtolower(trim((string)($in['e'] ?? '')));
      $p = (string)($in['p'] ?? '');
      $kc = 'c:' . $e; $ki = 'ip:' . ip();
      if (intentos($db, 'login', $kc) >= MAX_INTENTOS || intentos($db, 'login', $ki) >= MAX_INTENTOS_IP)
        fail('Demasiados intentos fallidos. Espera ' . VENTANA_MIN . ' minutos e inténtalo de nuevo.', 'p', 429);
      $st = $db->prepare('SELECT id, password_hash FROM usuarios WHERE correo = ?');
      $st->execute([$e]);
      $r = $st->fetch();
      // Siempre se verifica un hash, exista o no el correo (evita saber qué correos están registrados)
      $ok = password_verify($p, $r ? $r['password_hash'] : '$2y$10$abcdefghijklmnopqrstuuVwUqxkq6G0v1Yw5q3x6G0m1c3o9m8dK');
      if (!$r || !$ok) {
        fallo($db, 'login', $kc); fallo($db, 'login', $ki);
        bit($db, $r ? $r['id'] : null, 'login_fallido', substr($e, 0, 120));
        fail('Correo o contraseña incorrectos.', 'p');
      }
      limpiar($db, 'login', $kc);
      if (password_needs_rehash($r['password_hash'], PASSWORD_DEFAULT))
        $db->prepare('UPDATE usuarios SET password_hash = ? WHERE id = ?')->execute([password_hash($p, PASSWORD_DEFAULT), $r['id']]);
      iniciar_sesion((int)$r['id']);
      bit($db, (int)$r['id'], 'login');
      out(['ok' => true, 'csrf' => $_SESSION['csrf'], 'user' => user_data($db, (int)$r['id'])]);
    }

    case 'logout': {
      $id = (int)($_SESSION['uid'] ?? 0);
      if ($id) bit($db, $id, 'logout');
      cerrar_sesion();
      out(['ok' => true]);
    }

    // ===== USUARIO =====
    case 'perfil': {
      $u = need_role($db, 'usuario');
      out(['ok' => true, 'perfil' => perfil_data($db, (int)$u['id'])]);
    }

    case 'canjear_codigo': {
      $u = need_role($db, 'usuario');
      $k = 'u:' . $u['id'];
      if (intentos($db, 'codigo', $k) >= MAX_INTENTOS)
        fail('Demasiados códigos incorrectos. Espera ' . VENTANA_MIN . ' minutos e inténtalo de nuevo.', 'c', 429);

      $c = norm_codigo($in['c'] ?? '');
      $malo = function ($m) use ($db, $k, $u) {
        if ($db->inTransaction()) $db->rollBack();
        fallo($db, 'codigo', $k);
        bit($db, $u['id'], 'codigo_invalido', $m);
        fail($m, 'c');
      };
      if (strlen($c) !== 10) $malo('El código tiene 10 letras y números. Revísalo.');

      $db->beginTransaction();
      $st = $db->prepare('SELECT id, puntos, estado, (expira > NOW()) AS vigente FROM codigos_reciclaje WHERE codigo_hash = ? FOR UPDATE');
      $st->execute([hash_codigo($c)]);
      $cod = $st->fetch();
      if (!$cod) $malo('Código no válido.');
      if ($cod['estado'] === 'canjeado') $malo('Este código ya fue usado.');
      if ($cod['estado'] === 'anulado') $malo('Este código fue cancelado. Pide uno nuevo al administrador.');
      if (!(int)$cod['vigente']) $malo('Este código venció. Pide uno nuevo al administrador.');

      $st = $db->prepare('SELECT ci.material_codigo, ci.kg, ci.puntos, m.nombre, m.emoji
                          FROM codigo_items ci JOIN materiales m ON m.codigo = ci.material_codigo WHERE ci.codigo_id = ?');
      $st->execute([$cod['id']]);
      $items = $st->fetchAll();

      $ins = $db->prepare("INSERT INTO movimientos (usuario_id, tipo, descripcion, emoji, puntos, kg, material_codigo, codigo_id)
                           VALUES (?, 'entrega', ?, ?, ?, ?, ?, ?)");
      $total = 0; $res = [];
      foreach ($items as $it) {
        $desc = $it['nombre'] . ' – ' . number_format((float)$it['kg'], 1, '.', '') . ' kg';
        $ins->execute([$u['id'], $desc, $it['emoji'], (int)$it['puntos'], $it['kg'], $it['material_codigo'], $cod['id']]);
        $total += (int)$it['puntos'];
        $res[] = ['n' => $it['nombre'], 'e' => $it['emoji'], 'kg' => (float)$it['kg'], 'p' => (int)$it['puntos']];
      }
      $db->prepare('UPDATE usuarios SET puntos = puntos + ? WHERE id = ?')->execute([$total, $u['id']]);
      $db->prepare("UPDATE codigos_reciclaje SET estado = 'canjeado', usuario_id = ?, canjeado_en = NOW() WHERE id = ?")->execute([$u['id'], $cod['id']]);
      $db->commit();
      limpiar($db, 'codigo', $k);
      bit($db, $u['id'], 'codigo_canjeado', '#' . $cod['id'] . ' +' . $total . ' pts');
      out(['ok' => true, 'puntos' => $total, 'items' => $res, 'user' => user_data($db, (int)$u['id'])]);
    }

    case 'canje': {
      $u = need_role($db, 'usuario');
      $pid = (int)($in['producto'] ?? 0);

      $db->beginTransaction();
      $st = $db->prepare('SELECT puntos FROM usuarios WHERE id = ? FOR UPDATE');
      $st->execute([$u['id']]);
      $prev = (int)$st->fetchColumn();

      $st = $db->prepare('SELECT nombre, emoji, costo, stock FROM productos WHERE id = ? AND activo = 1 FOR UPDATE');
      $st->execute([$pid]);
      $p = $st->fetch();
      if (!$p) fail('Producto no encontrado.');
      if ((int)$p['stock'] < 1) fail('Producto agotado.');
      $costo = (int)$p['costo'];
      if ($prev < $costo) fail('Puntos insuficientes.');

      $db->prepare('UPDATE productos SET stock = stock - 1 WHERE id = ?')->execute([$pid]);
      $db->prepare('UPDATE usuarios SET puntos = puntos - ? WHERE id = ?')->execute([$costo, $u['id']]);

      $chk = $db->prepare('SELECT 1 FROM movimientos WHERE folio = ?');
      do {
        $folio = 'VV-' . random_int(100000, 999999);
        $chk->execute([$folio]);
      } while ($chk->fetch());

      $db->prepare("INSERT INTO movimientos (usuario_id, tipo, descripcion, emoji, puntos, kg, producto_id, folio)
                    VALUES (?, 'canje', ?, ?, ?, 0, ?, ?)")
         ->execute([$u['id'], 'Canjeaste: ' . $p['nombre'], $p['emoji'], -$costo, $pid, $folio]);
      $db->commit();

      out(['ok' => true,
        'user' => user_data($db, (int)$u['id']),
        'catalogo' => catalogo($db),
        'recibo' => ['n' => $p['nombre'], 'e' => $p['emoji'], 'c' => $costo, 'a' => $prev, 'f' => $folio, 'd' => (int)round(microtime(true) * 1000)],
      ]);
    }

    // ===== ADMINISTRADOR =====
    case 'admin': {
      need_role($db, 'admin');
      $nu = (int)$db->query("SELECT COUNT(*) FROM usuarios WHERE rol = 'usuario'")->fetchColumn();
      $s = $db->query("SELECT COALESCE(SUM(CASE WHEN tipo='entrega' THEN kg END),0) AS kg, COALESCE(SUM(tipo='canje'),0) AS cj FROM movimientos")->fetch();
      $pend = (int)$db->query("SELECT COUNT(*) FROM codigos_reciclaje WHERE estado = 'pendiente' AND expira > NOW()")->fetchColumn();
      out(['ok' => true, 'catalogo' => catalogo($db),
           'admin' => ['nu' => $nu, 'kg' => (float)$s['kg'], 'cj' => (int)$s['cj'], 'pend' => $pend]]);
    }

    case 'tasa': {
      $u = need_role($db, 'admin');
      $v = min(1000, max(1, (int)($in['v'] ?? 1)));
      $mat = (string)($in['mat'] ?? '');
      $st = $db->prepare('UPDATE materiales SET puntos_por_kg = ? WHERE codigo = ?');
      $st->execute([$v, $mat]);
      bit($db, $u['id'], 'tasa', $mat . '=' . $v);
      out(['ok' => true]);
    }

    case 'stock': {
      $u = need_role($db, 'admin');
      $n = min(100000, max(0, (int)($in['n'] ?? 0)));
      $id = (int)($in['id'] ?? 0);
      $st = $db->prepare('UPDATE productos SET stock = ? WHERE id = ?');
      $st->execute([$n, $id]);
      bit($db, $u['id'], 'stock', 'producto ' . $id . '=' . $n);
      out(['ok' => true]);
    }

    case 'entrega_crear': {
      $u = need_role($db, 'admin');
      $items = $in['items'] ?? [];
      if (!is_array($items) || !count($items) || count($items) > 20) fail('Agrega al menos un material.');

      $rates = [];
      foreach ($db->query('SELECT codigo, puntos_por_kg FROM materiales')->fetchAll() as $r) $rates[$r['codigo']] = (int)$r['puntos_por_kg'];

      $sum = []; // se juntan los renglones del mismo material
      foreach ($items as $it) {
        $m = (string)($it['mat'] ?? '');
        $kg = round((float)($it['kg'] ?? 0), 1);
        if (!isset($rates[$m])) fail('Material no válido.');
        if ($kg <= 0 || $kg > 1000) fail('Peso no válido.');
        $sum[$m] = round(($sum[$m] ?? 0) + $kg, 1);
      }
      $filas = []; $total = 0; $tkg = 0;
      foreach ($sum as $m => $kg) {
        $pts = (int)round($kg * $rates[$m]);
        $filas[] = [$m, $kg, $pts]; $total += $pts; $tkg += $kg;
      }
      if ($total < 1) fail('Los puntos de esta entrega serían 0. Revisa los pesos.');

      $db->beginTransaction();
      $codigo = null;
      for ($i = 0; $i < 5 && !$codigo; $i++) {
        $c = nuevo_codigo();
        try {
          $db->prepare('INSERT INTO codigos_reciclaje (codigo_hash, terminacion, admin_id, puntos, kg, expira)
                        VALUES (?,?,?,?,?, DATE_ADD(NOW(), INTERVAL ' . CODIGO_VIGENCIA_MIN . ' MINUTE))')
             ->execute([hash_codigo($c), substr($c, -4), $u['id'], $total, $tkg]);
          $codigo = $c;
        } catch (PDOException $x) { if ($x->getCode() !== '23000') throw $x; }
      }
      if (!$codigo) fail('No se pudo generar el código. Intenta de nuevo.', null, 500);
      $cid = (int)$db->lastInsertId();
      $ins = $db->prepare('INSERT INTO codigo_items (codigo_id, material_codigo, kg, puntos) VALUES (?,?,?,?)');
      foreach ($filas as $f) $ins->execute([$cid, $f[0], $f[1], $f[2]]);
      $st = $db->prepare('SELECT UNIX_TIMESTAMP(expira)*1000 FROM codigos_reciclaje WHERE id = ?');
      $st->execute([$cid]);
      $exp = (int)$st->fetchColumn();
      $db->commit();
      bit($db, $u['id'], 'codigo_creado', '#' . $cid . ' ' . $tkg . ' kg, ' . $total . ' pts');
      out(['ok' => true, 'codigo' => ['id' => $cid, 'c' => $codigo, 'pts' => $total, 'kg' => $tkg, 'exp' => $exp, 'min' => CODIGO_VIGENCIA_MIN]]);
    }

    case 'entrega_anular': {
      $u = need_role($db, 'admin');
      $id = (int)($in['id'] ?? 0);
      $st = $db->prepare("UPDATE codigos_reciclaje SET estado = 'anulado' WHERE id = ? AND estado = 'pendiente'");
      $st->execute([$id]);
      if (!$st->rowCount()) fail('Ese código ya no se puede anular (ya se usó o ya estaba cancelado).');
      bit($db, $u['id'], 'codigo_anulado', '#' . $id);
      out(['ok' => true]);
    }

    case 'entregas': {
      need_role($db, 'admin');
      $rows = $db->query("SELECT c.id, c.terminacion, c.puntos, c.kg, c.estado,
                                 (c.estado = 'pendiente' AND c.expira <= NOW()) AS venc,
                                 UNIX_TIMESTAMP(c.creado)*1000 AS ts, u.nombre AS por,
                                 (SELECT GROUP_CONCAT(CONCAT(ci.kg, ' kg ', COALESCE(mt.nombre, ci.material_codigo)) SEPARATOR ', ')
                                    FROM codigo_items ci LEFT JOIN materiales mt ON mt.codigo = ci.material_codigo
                                   WHERE ci.codigo_id = c.id) AS det
                          FROM codigos_reciclaje c LEFT JOIN usuarios u ON u.id = c.usuario_id
                          ORDER BY c.id DESC LIMIT 20")->fetchAll();
      out(['ok' => true, 'entregas' => array_map(fn($r) => [
        'id' => (int)$r['id'], 'fin' => $r['terminacion'], 'p' => (int)$r['puntos'], 'kg' => (float)$r['kg'],
        'st' => (int)$r['venc'] ? 'vencido' : $r['estado'], 'd' => (int)$r['ts'], 'por' => $r['por'], 'det' => $r['det'],
      ], $rows)]);
    }

    case 'usuarios': {
      need_role($db, 'admin');
      $rows = $db->query("SELECT u.id, u.nombre, u.correo, u.puntos, u.rol,
                                 COALESCE(SUM(CASE WHEN m.tipo='entrega' THEN m.kg END),0) AS kg
                          FROM usuarios u LEFT JOIN movimientos m ON m.usuario_id = u.id
                          GROUP BY u.id, u.nombre, u.correo, u.puntos, u.rol ORDER BY u.id")->fetchAll();
      out(['ok' => true, 'me' => (int)$_SESSION['uid'], 'usuarios' => array_map(fn($r) => [
        'id' => (int)$r['id'], 'n' => $r['nombre'], 'e' => $r['correo'], 'b' => (int)$r['puntos'], 'rol' => $r['rol'], 'kg' => (float)$r['kg'],
      ], $rows)]);
    }

    case 'usuario_detalle': {
      need_role($db, 'admin');
      $d = perfil_data($db, (int)($in['id'] ?? 0));
      if (!$d) fail('Usuario no encontrado.', null, 404);
      out(['ok' => true, 'perfil' => $d]);
    }

    case 'usuario_rol': {
      $u = need_role($db, 'admin');
      $id = (int)($in['id'] ?? 0);
      $rol = (string)($in['rol'] ?? '');
      if (!in_array($rol, ROLES, true)) fail('Rol no válido.');
      if ($id === (int)$u['id']) fail('No puedes cambiar tu propio rol.');
      $st = $db->prepare('UPDATE usuarios SET rol = ? WHERE id = ?');
      $st->execute([$rol, $id]);
      bit($db, $u['id'], 'cambio_rol', 'usuario ' . $id . ' → ' . $rol);
      out(['ok' => true]);
    }

    case 'usuario_crear': {
      $u = need_role($db, 'admin');
      $rol = (string)($in['rol'] ?? '');
      if (!in_array($rol, ROLES, true)) fail('Elige un rol.', 'r');
      $id = crear_usuario($db, trim((string)($in['n'] ?? '')), strtolower(trim((string)($in['e'] ?? ''))), (string)($in['p'] ?? ''), $rol);
      bit($db, $u['id'], 'usuario_creado', 'usuario ' . $id . ' (' . $rol . ')');
      out(['ok' => true]);
    }

    // ===== PROVEEDOR (y admin: ve todo) =====
    case 'abastecer': {
      $u = need_role($db, 'proveedor');
      $pid = (int)($in['id'] ?? 0);
      $n = (int)($in['n'] ?? 0);
      if ($n < 1 || $n > 10000) fail('Escribe una cantidad entre 1 y 10,000.');
      $db->beginTransaction();
      $st = $db->prepare('UPDATE productos SET stock = stock + ? WHERE id = ? AND activo = 1');
      $st->execute([$n, $pid]);
      if (!$st->rowCount()) fail('Producto no encontrado.');
      $db->prepare('INSERT INTO abastecimientos (proveedor_id, producto_id, cantidad) VALUES (?,?,?)')->execute([$u['id'], $pid, $n]);
      $db->commit();
      bit($db, $u['id'], 'abastecimiento', 'producto ' . $pid . ' +' . $n);
      out(['ok' => true, 'catalogo' => catalogo($db)]);
    }

    case 'abastecimientos': {
      $u = need_role($db, 'proveedor', 'admin');
      $sql = "SELECT a.cantidad, p.nombre, p.emoji, us.nombre AS prov, UNIX_TIMESTAMP(a.fecha)*1000 AS ts
              FROM abastecimientos a JOIN productos p ON p.id = a.producto_id JOIN usuarios us ON us.id = a.proveedor_id";
      if ($u['rol'] === 'admin') { $st = $db->query($sql . ' ORDER BY a.id DESC LIMIT 50'); }
      else { $st = $db->prepare($sql . ' WHERE a.proveedor_id = ? ORDER BY a.id DESC LIMIT 30'); $st->execute([$u['id']]); }
      out(['ok' => true, 'catalogo' => catalogo($db), 'lista' => array_map(fn($r) => [
        'n' => $r['nombre'], 'e' => $r['emoji'], 'q' => (int)$r['cantidad'], 'prov' => $r['prov'], 'd' => (int)$r['ts'],
      ], $st->fetchAll())]);
    }

    default:
      fail('Acción desconocida.', null, 404);
  }
} catch (Throwable $e) {
  error_log('[verde-por-verde] ' . $e->getMessage());
  fail('Error del servidor. Revisa el log de errores de Apache/PHP.', null, 500);
}
