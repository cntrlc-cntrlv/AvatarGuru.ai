/**
 * API service for HierarchicalPage — Available Lessons & User Uploaded Files
 */

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AvailableLesson {
  board: string;
  subject: string;
  lesson: string;
  file_id: string;
  title: string;
}

export interface UserUploadedFile {
  file_id: string;
  filename: string;
  uploaded_at: string;
}

export interface LessonContent {
  script_text: string;
  images: string[];
  fileName: string;
}

// Hierarchical tree types (derived client-side)
export interface LessonNode {
  lesson: string;
  title: string;
  file_id: string;
}

export interface SubjectNode {
  subject: string;
  lessons: LessonNode[];
}

export interface BoardNode {
  board: string;
  subjects: SubjectNode[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Convert flat lesson list → hierarchical tree */
export function buildLessonTree(lessons: AvailableLesson[]): BoardNode[] {
  const boardMap = new Map<string, Map<string, LessonNode[]>>();

  for (const l of lessons) {
    if (!boardMap.has(l.board)) {
      boardMap.set(l.board, new Map());
    }
    const subjectMap = boardMap.get(l.board)!;
    if (!subjectMap.has(l.subject)) {
      subjectMap.set(l.subject, []);
    }
    subjectMap.get(l.subject)!.push({
      lesson: l.lesson,
      title: l.title,
      file_id: l.file_id,
    });
  }

  const tree: BoardNode[] = [];
  for (const [board, subjectMap] of boardMap) {
    const subjects: SubjectNode[] = [];
    for (const [subject, lessons] of subjectMap) {
      // Sort lessons naturally (L1, L2, L3…)
      lessons.sort((a, b) =>
        a.lesson.localeCompare(b.lesson, undefined, { numeric: true }),
      );
      subjects.push({ subject, lessons });
    }
    subjects.sort((a, b) => a.subject.localeCompare(b.subject));
    tree.push({ board, subjects });
  }

  // Sort boards naturally (9th, 10th…)
  tree.sort((a, b) =>
    a.board.localeCompare(b.board, undefined, { numeric: true }),
  );
  return tree;
}

// ─── API calls ───────────────────────────────────────────────────────────────

export async function fetchAvailableLessons(): Promise<AvailableLesson[]> {
  const res = await fetch(`${API_BASE_URL}/api/available-lessons`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error || "Failed to fetch available lessons");
  }
  return res.json();
}

export async function fetchUserUploadedFiles(): Promise<UserUploadedFile[]> {
  const res = await fetch(`${API_BASE_URL}/api/your-uploads`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as any).error || "Failed to fetch user uploaded files",
    );
  }
  return res.json();
}

export async function fetchLessonContent(
  fileId: string,
): Promise<LessonContent> {
  const res = await fetch(
    `${API_BASE_URL}/api/lesson-content/${encodeURIComponent(fileId)}`,
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error || "Failed to fetch lesson content");
  }
  return res.json();
}
