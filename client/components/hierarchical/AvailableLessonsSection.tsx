import { useState, useEffect, useMemo } from "react";
import { BookOpen, Loader2, AlertTriangle } from "lucide-react";
import { LessonTree } from "./LessonTree";
import {
  fetchAvailableLessons,
  buildLessonTree,
  type AvailableLesson,
  type BoardNode,
} from "@/lib/hierarchicalApi";

export function AvailableLessonsSection() {
  const [lessons, setLessons] = useState<AvailableLesson[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await fetchAvailableLessons();
        if (!cancelled) setLessons(data);
      } catch (err: any) {
        if (!cancelled) setError(err.message || "Something went wrong");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const tree: BoardNode[] = useMemo(() => buildLessonTree(lessons), [lessons]);

  return (
    <section
      id="available-lessons-section"
      className="rounded-3xl bg-gradient-to-br from-white via-violet-50/30 to-purple-50/40 border border-violet-100/70 p-6 md:p-8 shadow-sm"
    >
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-md shadow-violet-200">
          <BookOpen className="w-5 h-5 text-white" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-gray-800 tracking-tight">
            Available Lessons
          </h2>
          <p className="text-xs text-gray-400">Preprocessed & ready to study</p>
        </div>
      </div>

      {/* States */}
      {loading && (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-violet-400">
          <Loader2 className="w-8 h-8 animate-spin" />
          <p className="text-sm font-medium">Loading lessons…</p>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-3 py-8 px-4 rounded-xl bg-red-50 border border-red-200 text-red-600">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <div>
            <p className="font-semibold text-sm">Failed to load lessons</p>
            <p className="text-xs mt-0.5 opacity-80">{error}</p>
          </div>
        </div>
      )}

      {!loading && !error && tree.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <BookOpen className="w-12 h-12 mx-auto mb-3 opacity-40" />
          <p className="font-medium">No preprocessed lessons available</p>
          <p className="text-sm mt-1">
            Lessons will appear here once they are processed.
          </p>
        </div>
      )}

      {!loading && !error && tree.length > 0 && <LessonTree tree={tree} />}
    </section>
  );
}
