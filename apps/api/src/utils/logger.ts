import pino from 'pino';

const isDevelopment = process.env['NODE_ENV'] !== 'production';
const isTest = process.env['NODE_ENV'] === 'test';

export const logger = pino({
  level: isTest ? 'silent' : isDevelopment ? 'debug' : 'info',
  redact: {
    paths: [
      'password',
      'token',
      'secret',
      'authorization',
      'cookie',
      'jwt',
      'apiKey',
      'key',
      '*.password',
      '*.token',
      '*.secret',
      '*.apiKey',
      'headers.authorization',
      'headers.cookie',
    ],
    censor: '[REDACTED]',
  },
  transport:
    isDevelopment && !isTest
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:HH:MM:ss',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
});
