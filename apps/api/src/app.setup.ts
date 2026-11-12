import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { parseCorsOrigins, resolveExpressTrustProxy } from './common/config/env.validation';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

export interface AppRuntimeConfig {
  port: number;
  apiPrefix: string;
}

export function configureApp(
  app: NestExpressApplication,
  options: { enableLoggingInterceptor?: boolean } = {},
): AppRuntimeConfig {
  const configService = app.get(ConfigService);

  const nodeEnv = configService.get<string>('NODE_ENV', 'development');
  const port = Number(configService.get('PORT', 3001));
  const apiPrefix = configService.get<string>('API_PREFIX', 'api');
  const rawCorsOrigin = configService.get<string>('CORS_ORIGIN', 'http://localhost:3000');
  const rawTrustProxy = configService.get<string>('TRUST_PROXY', 'false');

  // Reverse proxy awareness: never blindly trusts arbitrary forwarded headers
  const trustProxy = resolveExpressTrustProxy(rawTrustProxy);
  app.set('trust proxy', trustProxy);

  // HTTP security headers (keep Swagger UI working outside production)
  app.use(
    helmet({
      contentSecurityPolicy: nodeEnv === 'production' ? undefined : false,
    }),
  );

  // Explicit CORS origins only (no wildcard '*' with credentialed requests)
  const allowedOrigins = parseCorsOrigins(rawCorsOrigin);
  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
  });

  app.setGlobalPrefix(apiPrefix);
  app.useGlobalFilters(new AllExceptionsFilter());

  if (options.enableLoggingInterceptor !== false) {
    app.useGlobalInterceptors(new LoggingInterceptor());
  }

  return { port, apiPrefix };
}

