import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { HealthStatusResponse } from '@halal-dine/contracts';
import { PrismaService } from '../../database/prisma.service';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  private readonly startTime = Date.now();

  constructor(private readonly prismaService: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'Check API and Database Health Status' })
  @ApiResponse({
    status: 200,
    description: 'Service is healthy and reachable',
  })
  async check(): Promise<HealthStatusResponse> {
    const dbHealth = await this.prismaService.isHealthy();
    const uptimeSeconds = Math.floor((Date.now() - this.startTime) / 1000);

    return {
      status: dbHealth.status === 'up' ? 'ok' : 'error',
      timestamp: new Date().toISOString(),
      uptime: uptimeSeconds,
      environment: process.env.NODE_ENV || 'development',
      database: dbHealth,
      version: '0.1.0',
    };
  }
}
