import mysql from 'mysql2/promise';

/**
 * Conexión de solo lectura a la base de la plataforma (tuterapiaweb, MariaDB).
 *
 * Es la misma base y el mismo usuario de solo lectura que usa el dashboard de
 * marketing. Una conexión corta por invocación, a propósito: las funciones de
 * Vercel se congelan entre invocaciones y un pool dejaría sockets colgados.
 *
 * Las variables se leen adentro de la función y nunca al importar el módulo:
 * CI compila sin secretos, y un `requireEnv` a nivel de módulo rompería el
 * build.
 */
export async function withMysql<T>(fn: (conn: mysql.Connection) => Promise<T>): Promise<T> {
  const conn = await mysql.createConnection({
    host: requireEnv('MYSQL_HOST'),
    port: Number(process.env.MYSQL_PORT ?? 3306),
    user: requireEnv('MYSQL_USER'),
    password: requireEnv('MYSQL_PASSWORD'),
    database: requireEnv('MYSQL_DATABASE'),
    ssl: process.env.MYSQL_SSL === 'true' ? {} : undefined,
    // La función tiene 60 segundos. Mejor fallar fuerte que quedar colgada.
    connectTimeout: 10_000,
    // Las fechas vuelven como texto: la base guarda UTC y el negocio lee el
    // día en UTC−3, así que la conversión la hace cada consulta, no el driver.
    dateStrings: true,
  });

  try {
    return await fn(conn);
  } finally {
    await conn.end();
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable de entorno ${name}`);
  return value;
}
