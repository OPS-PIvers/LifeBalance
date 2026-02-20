import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { signInWithGoogle } from '@/services/authService';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/Button';
import toast from 'react-hot-toast';

const Login: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { user, householdId, loading: authLoading } = useAuth();
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
    try {
      await signInWithGoogle();
      toast.success('Successfully signed in!');
      // Redirect will happen automatically via useEffect above
    } catch (error: unknown) {
      console.error('Sign-in error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to sign in';
      toast.error(errorMessage);
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-slate-50 to-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-white/80 backdrop-blur-xl rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] ring-1 ring-black/5 p-10 space-y-8 transition-all duration-500">
          {/* Logo/Brand */}
          <div className="text-center">
            <div className="inline-flex items-center justify-center w-24 h-24 mb-6 relative group">
              <div className="absolute inset-0 bg-slate-200/50 rounded-2xl blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
              <img
                src="/lifebalance_icon.png"
                alt="LifeBalance"
                className="w-full h-full object-contain rounded-2xl shadow-sm relative z-10 transition-transform duration-500 group-hover:scale-[1.02]"
              />
            </div>
            <h1 className="text-3xl font-semibold tracking-tight text-slate-900 mb-2">LifeBalance</h1>
            <p className="text-slate-500 text-sm leading-relaxed max-w-xs mx-auto">
              Manage your household finances, habits, and goals with elegance.
            </p>
          </div>

          {/* Divider */}
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-200/60"></div>
            </div>
            <div className="relative flex justify-center text-xs uppercase tracking-widest">
              <span className="bg-white/50 backdrop-blur-sm px-3 text-slate-400 font-medium rounded-full">Sign in</span>
            </div>
          </div>

          {/* Google Sign-In Button */}
          <Button
            onClick={handleGoogleSignIn}
            disabled={loading}
            variant="secondary"
            size="lg"
            isLoading={loading}
            className="w-full text-slate-700 justify-center h-12 shadow-sm hover:shadow-md transition-all duration-300 border-slate-200/80 bg-white/60 backdrop-blur-sm group"
            leftIcon={
              !loading && (
                <svg className="w-5 h-5 mr-1 transition-transform group-hover:scale-110 duration-300" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
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
            {loading ? 'Signing in...' : 'Continue with Google'}
          </Button>

          {/* Footer */}
          <p className="text-center text-xs text-slate-400 pt-2 leading-relaxed">
            By signing in, you verify your household membership.
          </p>
        </div>

        {/* Additional Info */}
        <div className="mt-8 text-center space-y-2">
          <p className="text-sm font-medium text-slate-500 tracking-wide">
            Track finances • Build habits • Earn rewards
          </p>
          <div className="flex justify-center gap-2 mt-4">
             <div className="w-1.5 h-1.5 rounded-full bg-slate-300"></div>
             <div className="w-1.5 h-1.5 rounded-full bg-slate-300"></div>
             <div className="w-1.5 h-1.5 rounded-full bg-slate-300"></div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
