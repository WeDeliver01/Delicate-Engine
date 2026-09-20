import { Injectable } from "@nestjs/common";

/** The engine's single source of "now". Tests pin it; production reads the system clock. */
@Injectable()
export class Clock {
  now: () => Date = () => new Date();
}
