import { createParamDecorator, ExecutionContext, SetMetadata } from "@nestjs/common";

export type UserType = "OWNER" | "OFFICE" | "YARD";

export interface PublicUser {
  id: string;
  username: string;
  name: string;
  userType: UserType;
  factoryId: string;
  factoryName: string;
}

export const IS_PUBLIC = "isPublic";
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): PublicUser => {
    return ctx.switchToHttp().getRequest().user as PublicUser;
  },
);
