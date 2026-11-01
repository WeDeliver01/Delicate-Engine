import { Module } from "@nestjs/common";
import { MembershipService } from "./membership.service.js";

/** Paid membership. Exported because pricing asks it for a discount on every quote. */
@Module({
  providers: [MembershipService],
  exports: [MembershipService],
})
export class MembershipModule {}
