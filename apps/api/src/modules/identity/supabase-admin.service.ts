import { Inject, Injectable } from "@nestjs/common";
import { ENV, type Env } from "../../config/env.js";
import { AppError } from "../../common/errors.js";

/**
 * The few things only the identity provider can do.
 *
 * Supabase owns credentials; we own the profile, the roles and the memberships. That line is
 * worth keeping — it means a password never exists in our database and cannot leak from it —
 * but it leaves a real gap for whoever is on the phone to a customer who cannot get in. This
 * is that gap, and nothing more: a reset link, a corrected address, a sign-in switched off,
 * and, when somebody genuinely cannot receive email, a password set by hand.
 *
 * It needs the service-role key, which can do anything to any user in the project. It is
 * optional on purpose: an environment without it simply cannot reach these endpoints, and
 * says so, rather than half-working.
 */
@Injectable()
export class SupabaseAdminService {
  constructor(@Inject(ENV) private readonly env: Env) {}

  /** False when this deployment has no service-role key, which is most of them. */
  get available(): boolean {
    return Boolean(this.env.SUPABASE_URL && this.env.SUPABASE_SERVICE_ROLE_KEY);
  }

  /** Ask Supabase to email them a link. We never see it, which is the point. */
  async sendPasswordReset(email: string, redirectTo: string): Promise<void> {
    await this.call("POST", `/auth/v1/recover?redirect_to=${encodeURIComponent(redirectTo)}`, {
      email,
    });
  }

  /**
   * Change the address they sign in with.
   *
   * Confirmed on the spot rather than sent for confirmation: this is staff correcting a typo
   * for somebody on the phone, and a confirmation email to an address that was wrong is a
   * loop with no way out of it.
   */
  async setEmail(authUserId: string, email: string): Promise<void> {
    await this.call("PUT", `/auth/v1/admin/users/${authUserId}`, { email, email_confirm: true });
  }

  async setPassword(authUserId: string, password: string): Promise<void> {
    await this.call("PUT", `/auth/v1/admin/users/${authUserId}`, { password });
  }

  /**
   * Stop or restore somebody's sign-in.
   *
   * A hundred years, which is Supabase's own way of saying indefinitely. Their data, their
   * bookings and their history are untouched — this is a door, not a delete.
   */
  async setSignInBlocked(authUserId: string, blocked: boolean): Promise<void> {
    await this.call("PUT", `/auth/v1/admin/users/${authUserId}`, {
      ban_duration: blocked ? "876000h" : "none",
    });
  }

  private async call(method: "POST" | "PUT", path: string, body: unknown): Promise<void> {
    if (!this.available) {
      throw new AppError(
        "identity_provider_unavailable",
        "this environment has no Supabase service-role key, so credentials cannot be managed here",
        503,
      );
    }
    const key = this.env.SUPABASE_SERVICE_ROLE_KEY!;
    const res = await fetch(`${this.env.SUPABASE_URL!.replace(/\/$/, "")}${path}`, {
      method,
      headers: {
        apikey: key,
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      // Their words, not ours: "a user with this email address has already been registered"
      // is worth passing on, and inventing a friendlier version of it would hide which.
      const detail = await res.text().catch(() => "");
      throw new AppError(
        "identity_provider_error",
        `the identity provider refused that (${res.status})`,
        res.status === 400 || res.status === 422 ? 422 : 502,
        { detail: detail.slice(0, 500) },
      );
    }
  }
}
