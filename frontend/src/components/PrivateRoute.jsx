import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const PrivateRoute = ({ children }) => {
  const { user, loading, sessionError, retrySession, logout } = useAuth();

  if (loading) {
    return <div className="py-16 text-center">Loading...</div>;
  }

  if (sessionError) return <main className="mx-auto max-w-lg px-6 py-20 text-center">
    <h1 className="text-2xl font-extrabold">Let’s reconnect.</h1>
    <p role="alert" className="my-5 text-ink/65">{sessionError}</p>
    <button onClick={retrySession} className="rounded-xl bg-mesh-600 px-6 py-3 font-bold text-white">Try again</button>
    <button onClick={logout} className="ml-4 text-sm font-bold">Sign out</button>
  </main>;

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return children;
};

export default PrivateRoute;
