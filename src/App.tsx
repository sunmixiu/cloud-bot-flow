import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Routes, Route, useLocation } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import { lazy, Suspense } from "react";
import { MainLayout } from "./components/layout/MainLayout";

const Index = lazy(() => import("./pages/Index"));
const ResourceManagement = lazy(() => import("./pages/ResourceManagement"));
const RealtimeMonitoring = lazy(() => import("./pages/RealtimeMonitoring"));
const PerformanceReports = lazy(() => import("./pages/PerformanceReports"));
const RobotTraining = lazy(() => import("./pages/RobotTraining"));
const RobotViewer = lazy(() => import("./pages/RobotViewer"));
const AlgorithmLibrary = lazy(() => import("./pages/AlgorithmLibrary"));
const SimulationLab = lazy(() => import("./pages/SimulationLab"));
const BuildPipeline = lazy(() => import("./pages/BuildPipeline"));
const Login = lazy(() => import("./pages/Login"));
const NotFound = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient();

const RequireAuth = ({ children }: { children: React.ReactNode }) => {
  const location = useLocation();
  const isAuthenticated = localStorage.getItem("isAuthenticated") === "true";

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return children;
};

const App = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <Suspense fallback={<div className="grid min-h-screen place-items-center bg-background text-sm text-muted-foreground">正在加载平台模块…</div>}>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="*" element={
                <RequireAuth>
                  <MainLayout>
                    <Routes>
                      <Route path="/" element={<Index />} />
                      <Route path="/resources/*" element={<ResourceManagement />} />
                      <Route path="/monitoring" element={<RealtimeMonitoring />} />
                      <Route path="/reports" element={<PerformanceReports />} />
                      <Route path="/training" element={<RobotTraining />} />
                      <Route path="/viewer" element={<RobotViewer />} />
                      <Route path="/algorithm-library" element={<AlgorithmLibrary />} />
                      <Route path="/build-pipeline" element={<BuildPipeline />} />
                      <Route path="/simulation" element={<SimulationLab />} />
                      {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
                      <Route path="*" element={<NotFound />} />
                    </Routes>
                  </MainLayout>
                </RequireAuth>
              } />
            </Routes>
            </Suspense>
          </BrowserRouter>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
};

export default App;
