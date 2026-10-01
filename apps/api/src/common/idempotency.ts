import {
  CallHandler,
  ConflictException,
  ExecutionContext,
  Inject,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { from, of, switchMap, type Observable } from "rxjs";
import type { AuthenticatedUser } from "./current-user";
import { PrismaService } from "./prisma.service";

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const CLIENT_OP_ID = /^[A-Za-z0-9.:_-]{8,128}$/;

export interface StoredOperation {
  statusCode: number;
  response: unknown;
}

/**
 * Remembers what every keyed write returned, so a replay gets the same answer.
 *
 * An offline device cannot tell "the server never got it" from "the server did it
 * and the reply was lost" — both look like a dropped connection. It therefore
 * resends, and without this a dropped reply on, say, a cutting completion would
 * cut the block twice. Some services already guard their own writes; this makes
 * every write that carries a `clientOpId` safe to send again.
 */
@Injectable()
export class IdempotencyService {
  constructor(@Inject(PrismaService) private prisma: PrismaService) {}

  /**
   * The earlier result for this key, or null if it has not run.
   *
   * A key is a promise from one person about one request. Reusing it for a
   * different user or a different route is refused rather than answered, because
   * answering would hand back someone else's response.
   */
  async lookup(
    user: AuthenticatedUser,
    clientOpId: string,
    method: string,
    path: string,
  ): Promise<StoredOperation | null> {
    const row = await this.prisma.syncOperation.findUnique({
      where: { factoryId_clientOpId: { factoryId: user.factoryId, clientOpId } },
    });
    if (!row) return null;
    if (row.actorId !== user.id || row.method !== method || stripQuery(row.path) !== stripQuery(path)) {
      throw new ConflictException({
        code: "CLIENT_OP_ID_REUSED",
        message: "This clientOpId was already used for a different request",
      });
    }
    return { statusCode: row.statusCode, response: row.response };
  }

  /** Record a result. A service that already recorded this key wins. */
  async remember(
    user: AuthenticatedUser,
    clientOpId: string,
    method: string,
    path: string,
    statusCode: number,
    response: unknown,
  ): Promise<void> {
    try {
      await this.prisma.syncOperation.create({
        data: {
          factoryId: user.factoryId,
          clientOpId,
          actorId: user.id,
          method,
          path: stripQuery(path),
          requestHash: clientOpId,
          statusCode,
          response: toJson(response),
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return;
      throw error;
    }
  }
}

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(@Inject(IdempotencyService) private store: IdempotencyService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== "http") return next.handle();
    const http = context.switchToHttp();
    const req = http.getRequest();
    const res = http.getResponse();
    const key = keyOf(req);
    if (!key) return next.handle();
    const { user, clientOpId, method, path } = key;

    return from(this.store.lookup(user, clientOpId, method, path)).pipe(
      switchMap((earlier) => {
        if (earlier) {
          // Nest applies the route's status after this returns, so a replay answers
          // with the same code the original call did.
          res.setHeader("Idempotent-Replay", "true");
          return of(earlier.response);
        }
        return next.handle().pipe(
          switchMap((body) =>
            from(
              this.store
                .remember(user, clientOpId, method, path, method === "POST" ? 201 : 200, body)
                .then(() => body),
            ),
          ),
        );
      }),
    );
  }
}

function keyOf(req: {
  method?: string;
  originalUrl?: string;
  url?: string;
  body?: unknown;
  user?: AuthenticatedUser;
}): { user: AuthenticatedUser; clientOpId: string; method: string; path: string } | null {
  const method = (req.method ?? "").toUpperCase();
  if (!WRITE_METHODS.has(method)) return null;
  const user = req.user;
  if (!user?.factoryId || !user.id) return null;
  const path = req.originalUrl ?? req.url ?? "";
  if (path.includes("/auth/")) return null;
  const body = req.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const clientOpId = (body as Record<string, unknown>).clientOpId;
  if (typeof clientOpId !== "string" || !CLIENT_OP_ID.test(clientOpId)) return null;
  return { user, clientOpId, method, path };
}

function stripQuery(path: string): string {
  return path.split("?")[0] ?? path;
}

function toJson(value: unknown): Prisma.InputJsonValue {
  if (value === undefined) return {};
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
