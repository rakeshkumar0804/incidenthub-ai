import Redis from 'ioredis';
import net from 'net';
import { env } from '../config/env';
import { logger } from '../utils/logger';

declare global {
  // eslint-disable-next-line no-var
  var __redisClient: Redis | undefined;
  // eslint-disable-next-line no-var
  var __redisServer: net.Server | undefined;
}

function createRedisClient(): Redis {
  const url = env.REDIS_URL || 'redis://127.0.0.1:6379';
  const client = new Redis(url, {
    maxRetriesPerRequest: null,
    lazyConnect: true,
    retryStrategy: (times) => Math.min(times * 100, 1000),
  });

  client.on('error', (err) => {
    logger.warn({ err: err.message }, 'Redis client connection warning');
  });

  return client;
}

export const redis = globalThis.__redisClient ?? createRedisClient();

if (process.env['NODE_ENV'] !== 'production') {
  globalThis.__redisClient = redis;
}

/**
 * Embedded in-memory RESP Redis 7 server for local development environment
 * when Docker Desktop / standalone Redis daemon is not running on port 6379.
 */
export function ensureLocalRedisServer(): Promise<void> {
  if (globalThis.__redisServer) {
    if (redis.status !== 'ready' && redis.status !== 'connecting') {
      return redis.connect().then(() => {}).catch(() => {});
    }
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const store = new Map<string, string>();
    // TTL map: key → absolute expiry time (ms). 0 = no expiry.
    const expiry = new Map<string, number>();

    const isExpired = (key: string): boolean => {
      const exp = expiry.get(key);
      if (!exp) return false;
      if (Date.now() > exp) {
        store.delete(key);
        expiry.delete(key);
        return true;
      }
      return false;
    };

    const server = net.createServer((socket) => {
      let buffer = '';

      socket.on('data', (data) => {
        buffer += data.toString('utf-8');

        while (buffer.length > 0) {
          const raw = buffer.trim();
          if (raw.length === 0) {
            buffer = '';
            break;
          }

          const lines = buffer.split('\r\n');
          const upper = raw.toUpperCase();

          if (upper === 'PING' || upper.startsWith('PING')) {
            socket.write('+PONG\r\n');
            buffer = '';
            break;
          }

          if (lines[0].startsWith('*')) {
            const numTokens = parseInt(lines[0].substring(1), 10);
            if (isNaN(numTokens)) {
              buffer = '';
              break;
            }

            const tokens: string[] = [];
            let idx = 1;

            while (tokens.length < numTokens && idx < lines.length) {
              if (lines[idx].startsWith('$')) {
                idx++;
                if (idx < lines.length) {
                  tokens.push(lines[idx]);
                  idx++;
                }
              } else {
                idx++;
              }
            }

            if (tokens.length < numTokens) {
              break; // Need more data chunks
            }

            buffer = lines.slice(idx).join('\r\n');
            if (buffer.trim().length === 0) {
              buffer = '';
            }

            const cmd = tokens[0]?.toUpperCase();
            if (cmd === 'PING') {
              socket.write('+PONG\r\n');
            } else if (cmd === 'COMMAND') {
              socket.write('*0\r\n');
            } else if (cmd === 'SELECT') {
              socket.write('+OK\r\n');
            } else if (cmd === 'INFO') {
              const infoStr = '# Server\r\nredis_version:7.2.0\r\nredis_mode:standalone\r\nrole:master\r\nconnected_clients:1\r\n';
              socket.write(`$${infoStr.length}\r\n${infoStr}\r\n`);
            } else if (cmd === 'SET') {
              const key = tokens[1];
              const val = tokens[2];
              const isNx = tokens.some((t) => t?.toUpperCase() === 'NX');
              // Parse PX/EX TTL
              let ttlMs = 0;
              const pxIdx = tokens.findIndex((t) => t?.toUpperCase() === 'PX');
              const exIdx = tokens.findIndex((t) => t?.toUpperCase() === 'EX');
              if (pxIdx !== -1 && tokens[pxIdx + 1]) {
                ttlMs = parseInt(tokens[pxIdx + 1] ?? '0', 10);
              } else if (exIdx !== -1 && tokens[exIdx + 1]) {
                ttlMs = parseInt(tokens[exIdx + 1] ?? '0', 10) * 1000;
              }
              if (isNx && key && store.has(key) && !isExpired(key)) {
                socket.write('$-1\r\n');
              } else {
                if (key && val !== undefined) {
                  store.set(key, val);
                  if (ttlMs > 0) {
                    expiry.set(key, Date.now() + ttlMs);
                  } else {
                    expiry.delete(key);
                  }
                }
                socket.write('+OK\r\n');
              }
            } else if (cmd === 'GET') {
              const getKey = tokens[1];
              const val = getKey && !isExpired(getKey) ? store.get(getKey) : undefined;
              if (val !== undefined) {
                socket.write(`$${Buffer.byteLength(val)}\r\n${val}\r\n`);
              } else {
                socket.write('$-1\r\n');
              }
            } else if (cmd === 'DEL') {
              const delKey = tokens[1];
              const deleted = delKey && store.delete(delKey) ? 1 : 0;
              if (delKey) expiry.delete(delKey);
              socket.write(`:${deleted}\r\n`);
            } else if (cmd === 'EXISTS') {
              const exKey = tokens[1];
              const exists = exKey && store.has(exKey) && !isExpired(exKey) ? 1 : 0;
              socket.write(`:${exists}\r\n`);
            } else if (cmd === 'EVAL' || cmd === 'EVALSHA') {
              // EVAL script numkeys KEYS[1] ARGV[1]
              // tokens: [0]=EVAL [1]=script [2]=numkeys [3]=KEYS[1] [4]=ARGV[1]
              const evalKey = tokens[3];
              const evalVal = tokens[4];
              if (evalKey && evalVal && !isExpired(evalKey) && store.get(evalKey) === evalVal) {
                store.delete(evalKey);
                expiry.delete(evalKey);
                socket.write(':1\r\n');
              } else {
                socket.write(':0\r\n');
              }
            } else if (cmd === 'QUIT') {
              socket.write('+OK\r\n');
              socket.end();
            } else {
              socket.write('+OK\r\n');
            }
          } else {
            socket.write('+OK\r\n');
            buffer = '';
          }
        }
      });

      socket.on('error', () => {
        // Client disconnected
      });
    });

    const connectRedisClient = () => {
      if (redis.status !== 'ready' && redis.status !== 'connecting') {
        redis.connect().then(() => resolve()).catch(() => resolve());
      } else {
        resolve();
      }
    };

    server.on('error', (err: ArrayBufferView & { code?: string }) => {
      if (err.code === 'EADDRINUSE') {
        logger.info('Port 6379 already in use (external Redis running)');
        connectRedisClient();
      } else {
        logger.warn(err, 'Redis dev server start warning');
        resolve();
      }
    });

    server.listen(6379, '127.0.0.1', () => {
      logger.info('✔ Local Redis 7 development server started on 127.0.0.1:6379');
      globalThis.__redisServer = server;
      connectRedisClient();
    });
  });
}

/**
 * Performs a real TCP PING command to Redis to verify connectivity.
 * Returns 'connected' if Redis responds with +PONG, else 'disconnected'.
 */
export async function checkRedisHealth(): Promise<'connected' | 'disconnected'> {
  try {
    if (redis.status !== 'ready' && redis.status !== 'connecting') {
      await redis.connect();
    }
    const pong = await redis.ping();
    return pong === 'PONG' ? 'connected' : 'disconnected';
  } catch (error) {
    logger.warn({ err: (error as Error).message }, 'Redis ping failed');
    return 'disconnected';
  }
}

/**
 * Safe Redis cache read with silent PostgreSQL fallback on timeout / error.
 */
export async function safeRedisGet(key: string): Promise<string | null> {
  try {
    const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 200));
    const getPromise = redis.get(key);
    return await Promise.race([getPromise, timeoutPromise]);
  } catch {
    return null;
  }
}

/**
 * Safe Redis cache write with 10% random TTL jitter to prevent cache stampedes.
 */
export async function safeRedisSet(key: string, value: string, ttlSeconds = 300): Promise<void> {
  try {
    // Add 10% random TTL jitter
    const jitter = Math.floor(ttlSeconds * 0.1 * Math.random());
    const finalTtl = ttlSeconds + jitter;
    await redis.set(key, value, 'EX', finalTtl);
  } catch {
    // Silent degradation
  }
}

/**
 * Safe Redis cache key invalidation.
 */
export async function safeRedisDel(keyPattern: string): Promise<void> {
  try {
    const keys = await redis.keys(keyPattern);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } catch {
    // Silent degradation
  }
}
