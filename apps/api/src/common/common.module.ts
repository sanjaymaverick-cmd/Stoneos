import { Global, Module } from "@nestjs/common";
import { AuditService } from "./audit.service";
import { PrismaService } from "./prisma.service";

@Global()
@Module({
  providers: [PrismaService, AuditService],
  exports: [PrismaService, AuditService],
})
export class CommonModule {}
