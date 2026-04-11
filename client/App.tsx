import "./global.css";

import { Toaster } from "@/components/ui/toaster";
import { createRoot } from "react-dom/client";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Navigation } from "@/components/Navigation";
import { Footer } from "@/components/Footer";
import { Home } from "./pages/Home";
import { StudyPage } from "./pages/Study";
import { HierarchicalPage } from "./pages/HierarchicalPage";
import NotFound from "./pages/NotFound";
import { useEffect } from "react";

const queryClient = new QueryClient();

const App = () => {
  // Clear localStorage on page load/refresh
  useEffect(() => {
    localStorage.clear();
    console.log("🗑️ localStorage cleared on page load");
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route
              path="/"
              element={
                <div className="flex flex-col min-h-screen">
                  <Navigation />
                  <main className="flex-1">
                    <Home />
                  </main>
                  <Footer />
                </div>
              }
            />
            <Route path="/study" element={<StudyPage />} />
            <Route path="/study/:fileId" element={<StudyPage />} />
            <Route path="/library" element={<HierarchicalPage />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

createRoot(document.getElementById("root")!).render(<App />);
