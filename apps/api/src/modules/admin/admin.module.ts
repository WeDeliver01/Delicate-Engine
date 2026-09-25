import { Module } from "@nestjs/common";
import { AdminController } from "./admin.controller.js";
import { AdminSettingsController } from "./settings.controller.js";

@Module({ controllers: [AdminController, AdminSettingsController] })
export class AdminModule {}
