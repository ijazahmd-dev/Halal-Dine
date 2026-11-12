import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  const { port, apiPrefix } = configureApp(app);

  // Swagger Documentation Setup
  const config = new DocumentBuilder()
    .setTitle('Halal Dine API')
    .setDescription(
      'REST API powering Halal Dine — Location-based Halal Restaurant Discovery and Verification Platform',
    )
    .setVersion('0.1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'Authorization',
        description: 'Enter your Bearer token',
        in: 'header',
      },
      'JWT-auth',
    )
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup(`${apiPrefix}/docs`, app, document);

  await app.listen(port);
  logger.log(`🚀 Halal Dine API is running on: http://localhost:${port}/${apiPrefix}`);
  logger.log(`📚 Swagger documentation available at: http://localhost:${port}/${apiPrefix}/docs`);
}

bootstrap();
