// Tipos del widget de Cloudflare Turnstile (solo existe en el bundle web).
// Declarados a mano: el paquete oficial @challenges/cloudflare-turnstile no es
// dependencia de este proyecto.

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      /** Sitekey PÚBLICO del widget. Se hornea en el bundle (EXPO_PUBLIC_*). */
      EXPO_PUBLIC_TURNSTILE_SITEKEY?: string;
      /** Secreto de siteverify. Solo vive en el server, nunca en el bundle. */
      TURNSTILE_SECRET?: string;
      /** Lista blanca (coma) de hostnames del frontend que siteverify devuelve. */
      TURNSTILE_HOSTNAMES?: string;
    }
  }

  interface Window {
    turnstile?: {
      render: (
        container: string | HTMLElement,
        options: {
          sitekey: string;
          action?: string;
          theme?: 'light' | 'dark';
          callback?: (token: string) => void;
          'expired-callback'?: () => void;
          'error-callback'?: () => void;
        },
      ) => string;
      /** El token es de uso único: reset prepara el widget para otro intento. */
      reset: (widgetId?: string) => void;
    };
  }
}

export {};
