import { Global, Module } from "@nestjs/common";
import { AuditService } from "./audit.service";
import { IdempotencyService } from "./idempotency";
import { PrismaService } from "./prisma.service";

@Global()
@Module({
  providers: [PrismaService, AuditService, IdempotencyService],
  exports: [PrismaService, AuditService, IdempotencyService],
})
export class CommonModule {}
