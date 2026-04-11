import { useState, useEffect, useMemo } from "react";
import {
  Upload,
  Loader2,
  AlertTriangle,
  ArrowDownAZ,
  ArrowUpAZ,
} from "lucide-react";
import { FileCard } from "./FileCard";
import {
  fetchUserUploadedFiles,
  type UserUploadedFile,
} from "@/lib/hierarchicalApi";

type SortOrder = "newest" | "oldest" | "name-asc" | "name-desc";

export function UserUploadedSection() {
  const [files, setFiles] = useState<UserUploadedFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<SortOrder>("newest");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await fetchUserUploadedFiles();
        if (!cancelled) setFiles(data);
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

  const sortedFiles = useMemo(() => {
    const copy = [...files];
    switch (sortOrder) {
      case "newest":
        return copy.sort(
          (a, b) =>
            new Date(b.uploaded_at).getTime() -
            new Date(a.uploaded_at).getTime(),
        );
      case "oldest":
        return copy.sort(
          (a, b) =>
            new Date(a.uploaded_at).getTime() -
            new Date(b.uploaded_at).getTime(),
        );
      case "name-asc":
        return copy.sort((a, b) => a.filename.localeCompare(b.filename));
      case "name-desc":
        return copy.sort((a, b) => b.filename.localeCompare(a.filename));
      default:
        return copy;
    }
  }, [files, sortOrder]);

  const sortOptions: { value: SortOrder; label: string }[] = [
    { value: "newest", label: "Newest first" },
    { value: "oldest", label: "Oldest first" },
    { value: "name-asc", label: "Name A→Z" },
    { value: "name-desc", label: "Name Z→A" },
  ];

  return (
    <section
      id="user-uploaded-section"
      className="rounded-3xl bg-gradient-to-br from-white via-sky-50/30 to-cyan-50/40 border border-sky-100/70 p-6 md:p-8 shadow-sm"
    >
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-500 to-cyan-600 flex items-center justify-center shadow-md shadow-sky-200">
            <Upload className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-gray-800 tracking-tight">
              Your Uploads
            </h2>
            <p className="text-xs text-gray-400">
              Files you've uploaded for study
            </p>
          </div>
        </div>

        {/* Sort selector */}
        {!loading && files.length > 0 && (
          <div className="sm:ml-auto flex items-center gap-2">
            {sortOrder.startsWith("name") ? (
              sortOrder === "name-asc" ? (
                <ArrowDownAZ className="w-4 h-4 text-sky-400" />
              ) : (
                <ArrowUpAZ className="w-4 h-4 text-sky-400" />
              )
            ) : null}
            <select
              id="upload-sort"
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value as SortOrder)}
              className="text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-sky-300 transition"
            >
              {sortOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* States */}
      {loading && (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-sky-400">
          <Loader2 className="w-8 h-8 animate-spin" />
          <p className="text-sm font-medium">Loading uploads…</p>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-3 py-8 px-4 rounded-xl bg-red-50 border border-red-200 text-red-600">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <div>
            <p className="font-semibold text-sm">Failed to load uploads</p>
            <p className="text-xs mt-0.5 opacity-80">{error}</p>
          </div>
        </div>
      )}

      {!loading && !error && files.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <Upload className="w-12 h-12 mx-auto mb-3 opacity-40" />
          <p className="font-medium">No uploads yet</p>
          <p className="text-sm mt-1">Upload a file to get started.</p>
        </div>
      )}

      {!loading && !error && sortedFiles.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {sortedFiles.map((file, index) => (
            <FileCard key={file.file_id} file={file} index={index} />
          ))}
        </div>
      )}
    </section>
  );
}
