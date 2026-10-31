/** Секрети задаються через `wrangler secret put`, а локально — через .dev.vars. */
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

export type Bindings = Env &
  Secrets & {
    EMAIL?: EmailBinding;
    EMAIL_FROM?: string;
    TURNSTILE_SITE_KEY?: string;
  };

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  password_hash: string | null;
  google_sub: string | null;
  demo: number;
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
