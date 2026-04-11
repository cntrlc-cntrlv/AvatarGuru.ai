import { useNavigate } from "react-router-dom";
import { FileText, Calendar, ArrowRight } from "lucide-react";
import { motion } from "framer-motion";
import type { UserUploadedFile } from "@/lib/hierarchicalApi";

interface FileCardProps {
  file: UserUploadedFile;
  index: number;
}

export function FileCard({ file, index }: FileCardProps) {
  const navigate = useNavigate();

  // Format date nicely
  const formattedDate = (() => {
    try {
      return new Intl.DateTimeFormat("en-IN", {
        year: "numeric",
        month: "short",
        day: "numeric",
      }).format(new Date(file.uploaded_at));
    } catch {
      return file.uploaded_at;
    }
  })();

  // Derive a file extension badge
  const ext = file.filename.split(".").pop()?.toUpperCase() || "FILE";

  // Accent colours by extension
  const extColors: Record<string, { bg: string; text: string; ring: string }> =
    {
      PDF: { bg: "bg-red-50", text: "text-red-500", ring: "ring-red-200" },
      DOC: { bg: "bg-blue-50", text: "text-blue-500", ring: "ring-blue-200" },
      DOCX: { bg: "bg-blue-50", text: "text-blue-500", ring: "ring-blue-200" },
      TXT: { bg: "bg-gray-50", text: "text-gray-500", ring: "ring-gray-200" },
      PPT: {
        bg: "bg-orange-50",
        text: "text-orange-500",
        ring: "ring-orange-200",
      },
      PPTX: {
        bg: "bg-orange-50",
        text: "text-orange-500",
        ring: "ring-orange-200",
      },
    };
  const extColor = extColors[ext] || {
    bg: "bg-violet-50",
    text: "text-violet-500",
    ring: "ring-violet-200",
  };

  return (
    <motion.button
      id={`file-card-${file.file_id}`}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06, duration: 0.35, ease: "easeOut" }}
      onClick={() => navigate(`/study/${file.file_id}`)}
      className="group relative w-full text-left rounded-2xl border border-gray-100 bg-white p-5 hover:shadow-lg hover:border-violet-200 transition-all duration-300 cursor-pointer"
    >
      {/* Glow effect on hover */}
      <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-violet-100/0 via-purple-50/0 to-fuchsia-50/0 group-hover:from-violet-100/30 group-hover:via-purple-50/20 group-hover:to-fuchsia-50/10 transition-all duration-300 pointer-events-none" />

      <div className="relative flex items-start gap-4">
        {/* Icon */}
        <div
          className={`shrink-0 w-12 h-12 rounded-xl ${extColor.bg} ring-1 ${extColor.ring} flex items-center justify-center`}
        >
          <FileText className={`w-5 h-5 ${extColor.text}`} />
        </div>

        {/* Details */}
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm text-gray-800 truncate group-hover:text-violet-700 transition-colors">
            {file.filename}
          </p>
          <div className="flex items-center gap-1.5 mt-1.5 text-xs text-gray-400">
            <Calendar className="w-3 h-3" />
            <span>{formattedDate}</span>
          </div>
          <span
            className={`mt-2 inline-block text-[10px] font-bold tracking-wider uppercase px-2 py-0.5 rounded-md ${extColor.bg} ${extColor.text}`}
          >
            {ext}
          </span>
        </div>

        {/* Arrow */}
        <ArrowRight className="w-4 h-4 text-gray-300 group-hover:text-violet-500 group-hover:translate-x-1 transition-all mt-1" />
      </div>
    </motion.button>
  );
}
