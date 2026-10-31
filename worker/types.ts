/** Секрети задаються через `wrangler secret put`, а локально — через .dev.vars. Будь-якого з них може не бути. */
export type Secrets = {
  PASSWORD_PEPPER?: string;
  TOKEN_KEY?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  TURNSTILE_SECRET?: string;
};

export type EmailBinding = {
  send(message: {
    to: string;
    from: { email: string; name: string };
    subject: string;
    html: string;
    text: string;
  }): Promise<unknown>;
};

export type Bindings = Omit<Env, keyof Secrets> &
  Secrets & {
    EMAIL?: EmailBinding;
    EMAIL_FROM?: string;
  };

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  password_hash: string | null;
  google_sub: string | null;
  demo: number;
  rev: number;
  cars_count: number;
  service_count: number;
  fuel_count: number;
  reminders_count: number;
  photos_count: number;
};

export type AppEnv = {
  Bindings: Bindings;
  Variables: { user: SessionUser; sessionHash: string };
};

export class ApiError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 409 | 413 | 415 | 429 | 502 | 503,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}
