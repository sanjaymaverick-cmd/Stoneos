import { INestApplication, ValidationPipe } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { rateLimit, securityHeaders } from "./common/http-security";

export async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, { logger: ["error", "warn", "log"] });
  app.setGlobalPrefix("api/v1", { exclude: ["health", "health/live", "health/ready"] });
  app.use(securityHeaders);
  app.use(rateLimit);
  app.enableCors({
    origin: (process.env.FRONTEND_URL ?? "http://localhost:3000").split(","),
    credentials: true,
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle("StoneOS API")
      .setDescription("Granite factory operations API")
      .setVersion("1.0")
      .addBearerAuth()
      .build(),
  );
  SwaggerModule.setup("api/docs", app, document);
  return app;
}
