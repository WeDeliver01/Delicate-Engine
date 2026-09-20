import { Module } from "@nestjs/common";
import { CatalogService } from "./catalog.service.js";
import { QuoteService } from "./quote.service.js";
import {
  AdminCatalogController,
  PublicCatalogController,
  QuotesController,
} from "./catalog.controller.js";

@Module({
  controllers: [PublicCatalogController, QuotesController, AdminCatalogController],
  providers: [CatalogService, QuoteService],
  exports: [CatalogService, QuoteService],
})
export class CatalogModule {}
