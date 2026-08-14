/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE: string;
  readonly VITE_ENTRA_CLIENT_ID: string;
  readonly VITE_ENTRA_TENANT_ID: string;
  readonly VITE_API_SCOPE: string;
  /** "mock" enables the dev-only mock sign-in (ignored in production builds). */
  readonly VITE_AUTH_MODE?: string;
  readonly VITE_PRIVILEGED_AUTH_CONTEXT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
