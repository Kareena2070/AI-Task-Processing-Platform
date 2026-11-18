import { Routes, Route } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute';
import PublicRoute from './components/PublicRoute';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import DashboardPage from './pages/DashboardPage';
import TaskDetailsPage from './pages/TaskDetailsPage';

function NotFoundPlaceholder() {
  return (
    <main className="starter-container">
      <div className="starter-card">
        <h1>404 Not Found</h1>
        <p className="starter-subtitle">The requested route does not exist.</p>
      </div>
    </main>
  );
}

function App() {
  return (
    <Routes>
      {/* Public routes (accessible only when unauthenticated) */}
      <Route element={<PublicRoute />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
      </Route>

      {/* Protected routes (accessible only when authenticated) */}
      <Route element={<ProtectedRoute />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/tasks/:taskId" element={<TaskDetailsPage />} />
      </Route>

      {/* Fallback route */}
      <Route path="*" element={<NotFoundPlaceholder />} />
    </Routes>
  );
}

export default App;
