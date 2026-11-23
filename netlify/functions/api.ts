import serverless from 'serverless-http';
import { createApiApp } from '../../server/app';

const app = createApiApp();

const serverlessHandler = serverless(app, {
  binary: ['image/*', 'application/octet-stream'],
});

export const handler = async (event: any, context: any) => {
  if (context && typeof context === 'object') {
    context.callbackWaitsForEmptyEventLoop = false;
  }

  if (event && typeof event.path === 'string' && event.path.startsWith('/.netlify/functions/api')) {
    const stripped = event.path.slice('/.netlify/functions/api'.length);
    event.path = `/api${stripped.startsWith('/') ? stripped : stripped ? `/${stripped}` : ''}`;
  }

  if (event && typeof event.rawUrl === 'string' && event.rawUrl.includes('/.netlify/functions/api')) {
    try {
      const parsed = new URL(event.rawUrl);
      if (parsed.pathname.startsWith('/.netlify/functions/api')) {
        const stripped = parsed.pathname.slice('/.netlify/functions/api'.length);
        parsed.pathname = `/api${stripped.startsWith('/') ? stripped : stripped ? `/${stripped}` : ''}`;
        event.rawUrl = parsed.toString();
      }
    } catch {
      // Preserve rawUrl if unparseable
    }
  }

  return serverlessHandler(event, context);
};
