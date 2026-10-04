import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import { EXECUTIVE_ROLES } from "@stoneos/contracts";
import { z } from "zod";
import {
  CurrentUser,
  Roles,
  type AuthenticatedUser,
} from "../../common/current-user";
import { ZodPipe } from "../../common/zod-pipe";
import { AnalyticsService } from "./analytics.service";
import { OpenaiService, type ExtractedDocument } from "./openai.service";
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable()
  .optional();
@Controller("reports/analytics")
export class AnalyticsController {
  constructor(
    @Inject(AnalyticsService) private analytics: AnalyticsService,
    @Inject(OpenaiService) private ai: OpenaiService,
  ) {}
  @Get()
  @Roles(...EXECUTIVE_ROLES)
  snapshot(
    @CurrentUser() u: AuthenticatedUser,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    return this.analytics.snapshot(u.factoryId, from, to);
  }
  @Get("settings") @Roles("owner") settings(
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.ai.settings(u.factoryId);
  }
  @Post("settings") @Roles("owner") save(
    @CurrentUser() u: AuthenticatedUser,
    @Body(
      new ZodPipe(
        z.object({
          targets: z.record(z.number()).optional(),
          apiKey: z.string().max(1000).optional(),
          clearKey: z.boolean().optional(),
        }),
      ),
    )
    b: {
      targets?: Record<string, number>;
      apiKey?: string;
      clearKey?: boolean;
    },
  ) {
    return this.ai.saveSettings(u, b);
  }
  @Post("ask") @Roles("owner") ask(
    @CurrentUser() u: AuthenticatedUser,
    @Body(
      new ZodPipe(
        z.object({
          question: z.string().min(1).max(2000),
          language: z.enum(["en", "hi"]).optional(),
          from: date,
          to: date,
        }),
      ),
    )
    b: { question: string; language?: "en" | "hi"; from?: string; to?: string },
  ) {
    return this.ai.ask(u, b);
  }
  @Post("invoices/:id/terms") @Roles("owner") terms(
    @CurrentUser() u: AuthenticatedUser,
    @Param("id") id: string,
    @Body(
      new ZodPipe(
        z.object({
          dueDate: date,
          promisedPaymentDate: date,
          collectionNote: z.string().max(1000).nullable().optional(),
        }),
      ),
    )
    b: {
      dueDate?: string | null;
      promisedPaymentDate?: string | null;
      collectionNote?: string | null;
    },
  ) {
    return this.analytics.terms(u, id, b);
  }
  @Post("orders/:id/delivery") @Roles("owner") delivery(
    @CurrentUser() u: AuthenticatedUser,
    @Param("id") id: string,
    @Body(
      new ZodPipe(
        z.object({
          date: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .nullable(),
        }),
      ),
    )
    b: { date: string | null },
  ) {
    return this.analytics.delivery(u, id, b.date);
  }
  @Post("blocks/:id/costs") @Roles("owner") costs(
    @CurrentUser() u: AuthenticatedUser,
    @Param("id") id: string,
    @Body(new ZodPipe(z.object({ confirmed: z.boolean() })))
    b: { confirmed: boolean },
  ) {
    return this.analytics.confirmCosts(u, id, b.confirmed);
  }
  @Post("blocks/:id/rates") @Roles("owner") rates(
    @CurrentUser() u: AuthenticatedUser,
    @Param("id") id: string,
    @Body(
      new ZodPipe(
        z.object({
          blockPricePerTon: z.number().nullable(),
          royaltyPerTon: z.number().nullable(),
          transportPerTon: z.number().nullable(),
        }),
      ),
    )
    b: {
      blockPricePerTon: number | null;
      royaltyPerTon: number | null;
      transportPerTon: number | null;
    },
  ) {
    return this.analytics.rates(u, id, b);
  }
  @Post("machines/:id/standard") @Roles("owner") standard(
    @CurrentUser() u: AuthenticatedUser,
    @Param("id") id: string,
    @Body(
      new ZodPipe(
        z.object({
          plannedHoursPerDay: z.number().nullable(),
          idealSqftPerHour: z.number().nullable(),
        }),
      ),
    )
    b: { plannedHoursPerDay: number | null; idealSqftPerHour: number | null },
  ) {
    return this.analytics.standard(u, id, b);
  }
  @Get("documents") @Roles("owner") documents(
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.ai.documents(u.factoryId);
  }
  @Post("documents") @Roles("owner") extract(
    @CurrentUser() u: AuthenticatedUser,
    @Body(
      new ZodPipe(
        z.object({
          fileName: z.string().min(1).max(255),
          contentType: z.string(),
          base64: z.string().max(6e6),
        }),
      ),
    )
    b: { fileName: string; contentType: string; base64: string },
  ) {
    return this.ai.extract(u, b);
  }
  @Post("documents/:id/review") @Roles("owner") review(
    @CurrentUser() u: AuthenticatedUser,
    @Param("id") id: string,
    @Body(
      new ZodPipe(
        z.object({
          kind: z.enum(["supplier_bill", "delivery_note"]),
          partyName: z.string().max(500).nullable(),
          invoiceNumber: z.string().max(200).nullable(),
          invoiceDate: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .nullable(),
          subtotal: z.number().nullable(),
          taxAmount: z.number().nullable(),
          total: z.number().nullable(),
          lines: z
            .array(
              z.object({
                description: z.string().max(1000),
                quantity: z.number().nullable(),
                unit: z.string().nullable(),
                amount: z.number().nullable(),
              }),
            )
            .max(100),
          uncertainFields: z.array(z.string()).max(100),
        }),
      ),
    )
    b: ExtractedDocument,
  ) {
    return this.ai.review(u, id, b);
  }
}
