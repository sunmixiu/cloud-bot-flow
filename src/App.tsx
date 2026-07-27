import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Routes, Route, useLocation } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import { MainLayout } from "./components/layout/MainLayout";
import Index from "./pages/Index";
import ResourceManagement from "./pages/ResourceManagement";
import RealtimeMonitoring from "./pages/RealtimeMonitoring";
import PerformanceReports from "./pages/PerformanceReports";
import RobotTraining from "./pages/RobotTraining";
import RobotViewer from "./pages/RobotViewer";
import AlgorithmLibrary from "./pages/AlgorithmLibrary";
import SimulationLab from "./pages/SimulationLab";
import BuildPipeline from "./pages/BuildPipeline";
import Login from "./pages/Login";
import NotFound from "./pages/NotFound";

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
          </BrowserRouter>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
};

export default App;
