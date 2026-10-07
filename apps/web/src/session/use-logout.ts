import { logout } from '@evia/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { ApiError, unwrap } from '../api/client.ts';
import { useApi } from '../api/api-context.tsx';
import { LOGIN_PATH } from '../paths.ts';
import { setCsrfToken } from './csrf.ts';
import { clearDrafts } from './draft-store.ts';
import { setLoginFlow, setLoginNotice } from './login-flow.ts';
import { resetStepUp } from './step-up.ts';

/**
 * Logout (AC6, SR-SESS-05): the session is revoked on the server (the answer carries `Clear-Site-Data`), then the query
 * cache, the drafts and the CSRF token of the tab are cleared and the panel leaves for the login page. A session that is already
 * gone (`401`) counts as logged out. Any other failure keeps the page and reports an error — we never pretend.
 */
export function useLogout() {
  const client = useApi();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const mutation = useMutation({
    mutationFn: () => unwrap(logout({ client })),
    onSuccess: () => {
      finish();
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 401) finish();
    },
  });
  function finish() {
    setCsrfToken(null);
    // "Wyloguj" drops the drafts of the tab too (SR-SESS-05, § 4.1) and any notice or unfinished login of this tab.
    clearDrafts();
    setLoginFlow(null);
    setLoginNotice(null);
    // Nothing of the confirmation or of the audit log outlives the session (SR-SESS-05).
    resetStepUp();
    queryClient.clear();
    void navigate({ to: LOGIN_PATH, replace: true });
  }
  const unauthorized = mutation.error instanceof ApiError && mutation.error.status === 401;
  return {
    logout: () => {
      mutation.mutate();
    },
    pending: mutation.isPending,
    failed: mutation.isError && !unauthorized,
  };
}
