import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { signInWithGoogle } from '@/services/authService';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/Button';
import toast from 'react-hot-toast';

const Login: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { user, householdId, loading: authLoading, accessDeniedEmail, clearAccessError } = useAuth();
  const location = useLocation();

  // Check for test mode activation via query parameter
  useEffect(() => {
    // Only allow in development mode with explicit env var
    if (!import.meta.env.DEV || import.meta.env.VITE_ENABLE_TEST_MODE !== 'true') {
      return;
    }

    // Check for ?test=true in URL (works with HashRouter)
    const searchParams = new URLSearchParams(location.search);
    const hashParams = location.hash.includes('?')
      ? new URLSearchParams(location.hash.substring(location.hash.indexOf('?')))
      : null;

    const testParam = searchParams.get('test') === 'true' || hashParams?.get('test') === 'true';

    if (testParam) {
      // Activate test mode for this session only
      sessionStorage.setItem('LIFEBALANCE_TEST_MODE', 'true');

      // Navigate to root to reload with mock providers
      // Force full reload to ensure App.tsx re-initializes with MockProviders
      window.location.href = '/';
    }
  }, [location]);

  // Redirect if already authenticated
  useEffect(() => {
    if (!authLoading && user) {
      if (householdId) {
        navigate('/');
      } else {
        navigate('/setup');
      }
    }
  }, [user, householdId, authLoading, navigate]);

  const handleGoogleSignIn = async () => {
    setLoading(true);
    // Clear any prior "access restricted" notice so a fresh attempt starts clean.
    // The Google provider is configured with prompt: 'select_account', so the
    // account chooser always appears and the user can pick a different account.
    clearAccessError();
    try {
      await signInWithGoogle();
      // No success toast here: signInWithGoogle resolves as soon as Firebase
      // authenticates, but the Private Alpha guard in AuthContext runs
      // asynchronously afterwards and may still deny access. The real outcome
      // is reflected by navigation (success) or the access-denied banner.
    } catch (error: unknown) {
      console.error('Sign-in error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to sign in';
      toast.error(errorMessage);
    } finally {
      // Always re-enable the button. On success we navigate away; on denial
      // the user stays on /login and must be able to try another account.
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-100 via-brand-50 to-money-50 dark:from-brand-900 dark:via-brand-900 dark:to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl p-8 space-y-6">
          {/* Logo/Brand */}
          <div className="text-center">
            <div className="inline-flex items-center justify-center w-24 h-24 mb-4">
              <img
                src="/lifebalance_icon.png"
                alt="LifeBalance"
                className="w-full h-full object-contain rounded-2xl"
              />
            </div>
            <h1 className="text-3xl font-bold text-brand-800 dark:text-slate-100 mb-2">LifeBalance</h1>
            <p className="text-brand-500 dark:text-slate-400 text-sm">
              Manage your household finances, habits, and goals
            </p>
          </div>

          {/* Access restricted notice */}
          {accessDeniedEmail && (
            <div
              role="alert"
              className="rounded-xl border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/15 p-4 text-sm text-amber-800 dark:text-amber-200"
            >
              <p className="font-semibold">Access restricted for this account</p>
              <p className="mt-1">
                <span className="font-medium break-all">{accessDeniedEmail}</span> doesn&apos;t
                have access to LifeBalance. If you have another account, choose it below.
              </p>
            </div>
          )}

          {/* Divider */}
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-brand-200 dark:border-slate-700"></div>
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-white dark:bg-slate-800 px-2 text-brand-400 dark:text-slate-400 font-medium">
                {accessDeniedEmail ? 'Try a different account' : 'Sign in to continue'}
              </span>
            </div>
          </div>

          {/* Google Sign-In Button */}
          <Button
            onClick={handleGoogleSignIn}
            disabled={loading}
            variant="secondary"
            size="lg"
            isLoading={loading}
            className="w-full text-brand-800 dark:text-slate-100"
            leftIcon={
              !loading && (
                <svg className="w-5 h-5" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    fill="#4285F4"
                  />
                  <path
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    fill="#34A853"
                  />
                  <path
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                    fill="#FBBC05"
                  />
                  <path
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    fill="#EA4335"
                  />
                </svg>
              )
            }
          >
            {loading
              ? 'Signing in...'
              : accessDeniedEmail
                ? 'Use a different account'
                : 'Continue with Google'}
          </Button>

          {/* Footer */}
          <p className="text-center text-xs text-brand-400 dark:text-slate-400 pt-4">
            By signing in, you agree to manage your household responsibly
          </p>
        </div>

        {/* Additional Info */}
        <div className="mt-6 text-center">
          <p className="text-sm text-brand-600 dark:text-slate-300">
            Track finances • Build habits • Earn rewards
          </p>
        </div>
      </div>
    </div>
  );
};

export default Login;
