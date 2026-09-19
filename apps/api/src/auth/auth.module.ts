import { Global, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { TokenVerifier } from "./token-verifier.js";
import { PrincipalService } from "./principal.service.js";
import { AuthGuard } from "./auth.guard.js";

@Global()
@Module({
  providers: [TokenVerifier, PrincipalService, { provide: APP_GUARD, useClass: AuthGuard }],
  exports: [TokenVerifier, PrincipalService],
})
export class AuthModule {}
