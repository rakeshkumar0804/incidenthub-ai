import pino from 'pino';

const isDevelopment = process.env['NODE_ENV'] !== 'production';
const isTest = process.env['NODE_ENV'] === 'test';

export const logger = pino({
  level: isTest ? 'silent' : isDevelopment ? 'debug' : 'info',
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
