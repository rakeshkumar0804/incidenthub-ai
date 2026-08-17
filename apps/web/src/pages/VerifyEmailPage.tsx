import { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { apiClient } from '../lib/axios';
import type { ApiSuccess } from '@incidenthub/shared';

export function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';

  const [isLoading, setIsLoading] = useState(false);
  const [isVerified, setIsVerified] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;

    const verify = async () => {
      setIsLoading(true);
      setErrorMessage(null);
      try {
        const { data } = await apiClient.post<ApiSuccess<{ message: string }>>('/auth/verify-email', {
          token,
        });
        if (data.success) {
          setIsVerified(true);
        }
      } catch (err: unknown) {
        if (typeof err === 'object' && err !== null && 'response' in err) {
          const resErr = err as { response?: { data?: { error?: { message?: string } } } };
          setErrorMessage(resErr.response?.data?.error?.message || 'Email verification failed.');
        } else {
          setErrorMessage('Network error.');
        }
      } finally {
        setIsLoading(false);
      }
    };

    void verify();
  }, [token]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-950 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-white">Email Verification</h1>
          <p className="mt-1.5 text-sm text-gray-400">Verifying your email address</p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-8 shadow-2xl backdrop-blur-sm text-center">
          {isLoading && (
            <div className="flex flex-col items-center py-6 gap-3">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
              <span className="text-sm font-medium text-gray-400">Verifying email token...</span>
            </div>
          )}

          {isVerified && (
            <div className="py-4">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-lg font-bold text-white">Email verified successfully!</h2>
              <p className="mt-1 text-sm text-gray-400">Your account is now fully verified.</p>
              <Link
                to="/"
                className="mt-6 inline-block w-full rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-500/25 transition hover:bg-blue-500"
              >
                Go to workspace
              </Link>
            </div>
          )}

          {errorMessage && (
            <div className="py-4">
              <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400">
                {errorMessage}
              </div>
              <Link
                to="/login"
                className="inline-block text-sm font-semibold text-blue-400 hover:text-blue-300"
              >
                Back to sign in
              </Link>
            </div>
          )}

          {!token && !isLoading && !isVerified && !errorMessage && (
            <div className="py-4 text-sm text-gray-400">
              No verification token provided in URL.
              <div className="mt-4">
                <Link to="/login" className="font-semibold text-blue-400 hover:text-blue-300">
                  Back to sign in
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
