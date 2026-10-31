import { Controller, Get } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { type AccountAddresses, Uuid } from "@delicate/contracts";
import { PlatformRoles } from "../../auth/decorators.js";
import { Params } from "../../common/zod.js";
import { AddressBookService } from "./address-book.service.js";

const AccountParam = z.object({ id: Uuid });

/**
 * An account's addresses, for the ops console.
 *
 * Separate from the customer's own controller because the account is named in the path rather
 * than taken from the active account header — ops is looking at somebody else's book, and that
 * difference should be visible in the route rather than hidden in a guard.
 */
@ApiTags("admin")
@ApiBearerAuth()
@Controller("v1/admin/accounts")
@PlatformRoles("super_admin", "finance", "dispatcher")
export class AdminAddressBookController {
  constructor(private readonly book: AddressBookService) {}

  @Get(":id/addresses")
  async addresses(@Params(AccountParam) p: { id: string }): Promise<AccountAddresses> {
    const [saved, booked] = await Promise.all([
      this.book.list(p.id, { includeArchived: false }),
      this.book.booked(p.id),
    ]);
    return { saved, booked };
  }
}
