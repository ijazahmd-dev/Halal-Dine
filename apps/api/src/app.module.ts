import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { validateEnv } from './common/config/env.validation';
import { parsePositiveInt } from './common/utils/env.util';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
      validate: validateEnv,
    }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        throttlers: [
          {
            name: 'default',
            ttl: parsePositiveInt(String(configService.get('THROTTLE_TTL_MS') ?? ''), 60000),
            limit: parsePositiveInt(String(configService.get('THROTTLE_LIMIT') ?? ''), 60),
          },
        ],
      }),
    }),
    DatabaseModule,
    HealthModule,
    AuthModule,
  ],
})
export class AppModule {}
