import { Link } from "react-router-dom";
import { ArrowLeft, Library } from "lucide-react";
import { AvailableLessonsSection } from "@/components/hierarchical/AvailableLessonsSection";
import { UserUploadedSection } from "@/components/hierarchical/UserUploadedSection";

export function HierarchicalPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-[#F5F5F7] via-[#FAFAFE] to-[#F5F5F7]">
      {/* Top bar */}
      <div className="sticky top-0 z-40 backdrop-blur-lg bg-white/70 border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              to="/"
              className="w-9 h-9 rounded-xl bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition"
              title="Back to Home"
            >
              <ArrowLeft className="w-4 h-4 text-gray-600" />
            </Link>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-sm">
                <Library className="w-4 h-4 text-white" />
              </div>
              <h1 className="text-xl font-bold bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent tracking-tight">
                Study Library
              </h1>
            </div>
          </div>

          <Link
            to="/study"
            className="hidden sm:inline-flex px-5 py-2 bg-gradient-to-r from-violet-600 to-purple-600 text-white text-sm font-semibold rounded-full hover:shadow-lg hover:shadow-violet-200 transition-all"
          >
            Upload New
          </Link>
        </div>
      </div>

      {/* Main content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        <AvailableLessonsSection />
        <UserUploadedSection />
      </main>
    </div>
  );
}
