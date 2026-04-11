import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  ChevronRight,
  BookOpen,
  GraduationCap,
  FlaskConical,
  Search,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { BoardNode } from "@/lib/hierarchicalApi";

interface LessonTreeProps {
  tree: BoardNode[];
}

export function LessonTree({ tree }: LessonTreeProps) {
  const navigate = useNavigate();
  const [expandedBoards, setExpandedBoards] = useState<Set<string>>(new Set());
  const [expandedSubjects, setExpandedSubjects] = useState<Set<string>>(
    new Set(),
  );
  const [searchQuery, setSearchQuery] = useState("");

  // ── Filter tree by search ──────────────────────────────────────────────
  const filteredTree = useMemo(() => {
    if (!searchQuery.trim()) return tree;
    const q = searchQuery.toLowerCase();
    return tree
      .map((board) => ({
        ...board,
        subjects: board.subjects
          .map((subject) => ({
            ...subject,
            lessons: subject.lessons.filter(
              (l) =>
                l.title.toLowerCase().includes(q) ||
                l.lesson.toLowerCase().includes(q) ||
                subject.subject.toLowerCase().includes(q) ||
                board.board.toLowerCase().includes(q),
            ),
          }))
          .filter((s) => s.lessons.length > 0),
      }))
      .filter((b) => b.subjects.length > 0);
  }, [tree, searchQuery]);

  const toggleBoard = (board: string) => {
    setExpandedBoards((prev) => {
      const next = new Set(prev);
      next.has(board) ? next.delete(board) : next.add(board);
      return next;
    });
  };

  const toggleSubject = (key: string) => {
    setExpandedSubjects((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  // Board‑level colour palette
  const boardColors: Record<
    string,
    { bg: string; border: string; text: string; icon: string; accent: string }
  > = {};
  const palette = [
    {
      bg: "bg-violet-50",
      border: "border-violet-200",
      text: "text-violet-700",
      icon: "text-violet-500",
      accent: "bg-violet-500",
    },
    {
      bg: "bg-sky-50",
      border: "border-sky-200",
      text: "text-sky-700",
      icon: "text-sky-500",
      accent: "bg-sky-500",
    },
    {
      bg: "bg-emerald-50",
      border: "border-emerald-200",
      text: "text-emerald-700",
      icon: "text-emerald-500",
      accent: "bg-emerald-500",
    },
    {
      bg: "bg-amber-50",
      border: "border-amber-200",
      text: "text-amber-700",
      icon: "text-amber-500",
      accent: "bg-amber-500",
    },
    {
      bg: "bg-rose-50",
      border: "border-rose-200",
      text: "text-rose-700",
      icon: "text-rose-500",
      accent: "bg-rose-500",
    },
  ];
  filteredTree.forEach((b, i) => {
    boardColors[b.board] = palette[i % palette.length];
  });

  return (
    <div className="space-y-4">
      {/* Search bar */}
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          id="lesson-search"
          type="text"
          placeholder="Search lessons, subjects, boards…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-200 bg-white/80 backdrop-blur text-sm text-gray-700 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-400/50 focus:border-violet-300 transition"
        />
      </div>

      {/* Tree */}
      {filteredTree.length === 0 && (
        <div className="text-center py-12 text-gray-400">
          <BookOpen className="w-10 h-10 mx-auto mb-3 opacity-60" />
          <p className="font-medium">No lessons found</p>
          {searchQuery && (
            <p className="text-sm mt-1">Try a different search term</p>
          )}
        </div>
      )}

      <div className="space-y-3">
        {filteredTree.map((board) => {
          const colors = boardColors[board.board];
          const isOpen = expandedBoards.has(board.board);
          return (
            <div
              key={board.board}
              className={`rounded-2xl border ${colors.border} overflow-hidden transition-shadow hover:shadow-md`}
            >
              {/* Board header */}
              <button
                id={`board-${board.board}`}
                onClick={() => toggleBoard(board.board)}
                className={`w-full flex items-center gap-3 px-5 py-4 ${colors.bg} hover:brightness-[.97] transition-all`}
              >
                <div
                  className={`w-9 h-9 rounded-lg ${colors.accent} flex items-center justify-center shadow-sm`}
                >
                  <GraduationCap className="w-5 h-5 text-white" />
                </div>
                <span className={`font-semibold text-base ${colors.text}`}>
                  {board.board}
                </span>
                <span className="ml-auto text-xs font-medium text-gray-400">
                  {board.subjects.reduce((n, s) => n + s.lessons.length, 0)}{" "}
                  lessons
                </span>
                <ChevronRight
                  className={`w-4 h-4 ${colors.icon} transition-transform duration-300 ${isOpen ? "rotate-90" : ""}`}
                />
              </button>

              {/* Subjects */}
              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.25, ease: "easeInOut" }}
                    className="overflow-hidden"
                  >
                    <div className="px-3 pb-3 pt-1 space-y-2">
                      {board.subjects.map((subject) => {
                        const subjKey = `${board.board}::${subject.subject}`;
                        const isSubjOpen = expandedSubjects.has(subjKey);
                        return (
                          <div
                            key={subjKey}
                            className="rounded-xl bg-white border border-gray-100 overflow-hidden"
                          >
                            <button
                              id={`subject-${subjKey}`}
                              onClick={() => toggleSubject(subjKey)}
                              className="w-full flex items-center gap-2.5 px-4 py-3 hover:bg-gray-50 transition"
                            >
                              <FlaskConical className="w-4 h-4 text-gray-400" />
                              <span className="font-medium text-sm text-gray-700">
                                {subject.subject}
                              </span>
                              <span className="ml-auto text-[11px] font-medium text-gray-400">
                                {subject.lessons.length}
                              </span>
                              <ChevronRight
                                className={`w-3.5 h-3.5 text-gray-400 transition-transform duration-300 ${isSubjOpen ? "rotate-90" : ""}`}
                              />
                            </button>

                            <AnimatePresence initial={false}>
                              {isSubjOpen && (
                                <motion.div
                                  initial={{ height: 0, opacity: 0 }}
                                  animate={{ height: "auto", opacity: 1 }}
                                  exit={{ height: 0, opacity: 0 }}
                                  transition={{
                                    duration: 0.2,
                                    ease: "easeInOut",
                                  }}
                                  className="overflow-hidden"
                                >
                                  <ul className="px-4 pb-3 space-y-1">
                                    {subject.lessons.map((lesson) => (
                                      <li key={lesson.file_id}>
                                        <button
                                          id={`lesson-${lesson.file_id}`}
                                          onClick={() =>
                                            navigate(`/study/${lesson.file_id}`)
                                          }
                                          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left text-sm text-gray-600 hover:bg-violet-50 hover:text-violet-700 transition group"
                                        >
                                          <span className="w-6 h-6 rounded-md bg-gray-100 group-hover:bg-violet-100 flex items-center justify-center text-[10px] font-bold text-gray-400 group-hover:text-violet-500 transition">
                                            {lesson.lesson}
                                          </span>
                                          <span className="truncate">
                                            {lesson.title}
                                          </span>
                                          <ChevronRight className="w-3.5 h-3.5 ml-auto opacity-0 group-hover:opacity-100 text-violet-400 transition" />
                                        </button>
                                      </li>
                                    ))}
                                  </ul>
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                        );
                      })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </div>
  );
}
