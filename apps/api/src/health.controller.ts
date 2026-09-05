import { Controller, Get, Inject } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Public } from "./common/current-user";
import { PrismaService } from "./common/prisma.service";

@ApiTags("health")
@Controller()
export class HealthController {
  constructor(@Inject(PrismaService) private prisma: PrismaService) {}

  @Public()
  @Get("/health/live")
  live() {
    return { status: "ok" };
  }

  @Public()
  @Get("/health")
  async health() {
    return this.ready();
  }

  @Public()
  @Get("/health/ready")
  async ready() {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: "ok", database: "reachable" };
  }
}
