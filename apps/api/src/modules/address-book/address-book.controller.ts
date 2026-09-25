import { Controller, Delete, Get, Header, Post, Put } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { ImportAddressesRequest, UpsertSavedAddressRequest, Uuid } from "@delicate/contracts";
import { AccountRoles, ActiveAccountId, RequireAccount } from "../../auth/decorators.js";
import { Body, Params, Query } from "../../common/zod.js";
import { AddressBookService } from "./address-book.service.js";

const IdParam = z.object({ id: Uuid });
const ListQuery = z.object({
  search: z.string().max(120).optional(),
  includeArchived: z.coerce.boolean().optional(),
});

/** A customer's own list of the places they send to. */
@ApiTags("account")
@ApiBearerAuth()
@Controller("v1/account/address-book")
@RequireAccount()
@AccountRoles("customer_owner", "customer_staff")
export class AddressBookController {
  constructor(private readonly book: AddressBookService) {}

  @Get()
  list(
    @ActiveAccountId() accountId: string,
    @Query(ListQuery) q: { search?: string; includeArchived?: boolean },
  ) {
    return this.book.list(accountId, q);
  }

  @Get("template.csv")
  @Header("content-type", "text/csv; charset=utf-8")
  @Header("content-disposition", 'attachment; filename="delicate-address-template.csv"')
  template() {
    return this.book.template();
  }

  @Get("export.csv")
  @Header("content-type", "text/csv; charset=utf-8")
  @Header("content-disposition", 'attachment; filename="delicate-address-book.csv"')
  exportCsv(@ActiveAccountId() accountId: string) {
    return this.book.export(accountId);
  }

  @Get(":id")
  get(@ActiveAccountId() accountId: string, @Params(IdParam) p: { id: string }) {
    return this.book.get(accountId, p.id);
  }

  @Post()
  create(
    @ActiveAccountId() accountId: string,
    @Body(UpsertSavedAddressRequest) body: UpsertSavedAddressRequest,
  ) {
    return this.book.upsert(accountId, null, body);
  }

  @Put(":id")
  update(
    @ActiveAccountId() accountId: string,
    @Params(IdParam) p: { id: string },
    @Body(UpsertSavedAddressRequest) body: UpsertSavedAddressRequest,
  ) {
    return this.book.upsert(accountId, p.id, body);
  }

  @Delete(":id")
  archive(@ActiveAccountId() accountId: string, @Params(IdParam) p: { id: string }) {
    return this.book.archive(accountId, p.id);
  }

  /**
   * Bulk import. Defaults to a dry run: the customer sees every row's verdict, then repeats the
   * call with `dryRun: false` to commit.
   */
  @Post("import")
  import(
    @ActiveAccountId() accountId: string,
    @Body(ImportAddressesRequest) body: ImportAddressesRequest,
  ) {
    return this.book.import(accountId, body);
  }
}
