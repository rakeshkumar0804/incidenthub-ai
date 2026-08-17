import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '../lib/axios';
import type { ApiSuccess } from '@incidenthub/shared';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);
    setIsLoading(true);

    try {
      const { data } = await apiClient.post<ApiSuccess<{ message: string; resetToken?: string }>>(
        '/auth/forgot-password',
        { email },
      );

      if (data.success) {
        let msg = data.data.message;
        if (data.data.resetToken) {
          msg += ` (Dev token: ${data.data.resetToken})`;
        }
        setSuccessMessage(msg);
      }
    } catch (err: unknown) {
      if (typeof err === 'object' && err !== null && 'response' in err) {
        const resErr = err as { response?: { data?: { error?: { message?: string } } } };
        setErrorMessage(resErr.response?.data?.error?.message || 'Failed to send reset link.');
      } else {
        setErrorMessage('Network error.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-950 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-white">Reset your password</h1>
          <p className="mt-1.5 text-sm text-gray-400">
            Enter your email and we&apos;ll send you a link to reset your password
          </p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-8 shadow-2xl backdrop-blur-sm">
          {successMessage && (
            <div className="mb-6 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-400">
              {successMessage}
            </div>
          )}

          {errorMessage && (
            <div className="mb-6 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400">
              {errorMessage}
            </div>
          )}

          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-gray-300">
                Email address
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@company.com"
                className="w-full rounded-xl border border-white/10 bg-gray-900/80 px-4 py-3 text-sm text-white placeholder-gray-500 outline-none transition focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="flex w-full items-center justify-center rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-500/25 transition hover:bg-blue-500 disabled:opacity-50"
            >
              {isLoading ? (
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
              ) : (
                'Send reset link'
              )}
            </button>
          </form>

          <p className="mt-6 text-center text-xs text-gray-400">
            Remembered your password?{' '}
            <Link to="/login" className="font-semibold text-blue-400 hover:text-blue-300">
              Back to sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
