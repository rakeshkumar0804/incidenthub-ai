import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center">
      <p className="text-8xl font-bold text-gray-800">404</p>
      <h1 className="mt-4 text-xl font-semibold text-gray-300">Page not found</h1>
      <p className="mt-2 text-sm text-gray-500">This route has not been implemented yet.</p>
      <Link
        to="/"
        className="mt-6 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500"
      >
        Go to dashboard
      </Link>
    </div>
  );
}
