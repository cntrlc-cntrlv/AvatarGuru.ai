/**
 * API service for connecting React frontend with Flask backend
 */

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

export interface UploadResponse {
  message: string;
  filename: string;
  status: string;
  fileId?: string;
}

export interface ProcessingStatus {
  status: "processing" | "completed" | "not_found";
  message: string;
  hasExplanation?: boolean;
}

export interface FileInfo {
  _id: string;
  filename: string;
  uploadDate: string;
  size: number;
}

export interface QAResponse {
  answer: string;
  sources?: string[];
}

export interface AssessmentQuestion {
  question: string;
}

export interface AssessmentFeedback {
  feedback: string;
  score: number; // 0-100: >=80 green, 50-79 yellow, <50 red
}

export interface TTSResponse {
  audio_url: string;
}

export interface LearningTTSResult {
  audioUrl: string;
  audioId: string;
  s3Url?: string;
  localPath?: string;
  videoUrl?: string | null;
  videoFilename?: string | null;
  videoError?: string;
}

export interface LipsyncVideoResponse {
  video_url: string | null;
  folder?: string;
  video_filename?: string;
  audio_key?: string | null;
  audio_url?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface ReferenceLink {
  title: string;
  url: string;
  description?: string;
}

export interface ExplanationBatch {
  batchNumber: number;
  summary: string;
  links: string[];
  keywords: string[];
  images: string[];
  audio_url?: string;
}

export interface BatchesResponse {
  batches: ExplanationBatch[];
  totalBatches: number;
  fileName: string;
  topLevelImages: string[];
}

class ApiService {
  private baseURL: string;

  constructor(baseURL: string = API_BASE_URL) {
    this.baseURL = baseURL;
  }

  private toAbsoluteUrl(url?: string | null): string | null {
    if (!url) {
      return null;
    }
    if (url.startsWith("http://") || url.startsWith("https://")) {
      return url;
    }
    const normalizedBase = this.baseURL.replace(/\/$/, "");
    const normalizedPath = url.startsWith("/") ? url : `/${url}`;
    return `${normalizedBase}${normalizedPath}`;
  }

  // Upload file
  async uploadFile(file: File): Promise<UploadResponse> {
    const formData = new FormData();
    formData.append("pdf", file);

    const response = await fetch(`${this.baseURL}/api/upload`, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || "Upload failed");
    }

    return response.json();
  }

  // Get uploaded files
  async getFiles(): Promise<FileInfo[]> {
    const response = await fetch(`${this.baseURL}/api/files`);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || "Failed to fetch files");
    }

    return response.json();
  }

  // Ask question
  async askQuestion(question: string): Promise<QAResponse> {
    const response = await fetch(`${this.baseURL}/api/qa`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ question }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || "Failed to get answer");
    }

    return response.json();
  }

  // Get text content
  async getText(fileId?: string): Promise<{
    text: string;
    images: string[];
    fileName?: string;
  }> {
    const url = fileId ? `${this.baseURL}/api/get_text?file_id=${encodeURIComponent(fileId)}` : `${this.baseURL}/api/get_text`;
    const response = await fetch(url);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || "Failed to fetch text");
    }

    const data = await response.json();
    return {
      text: data.script_text || "",
      images: data.images || [],
      fileName: data.fileName,
    };
  }

  // Get explanation batches for progressive display
  async getBatches(fileId?: string): Promise<BatchesResponse> {
    const url = fileId ? `${this.baseURL}/api/get_batches?file_id=${encodeURIComponent(fileId)}` : `${this.baseURL}/api/get_batches`;
    const response = await fetch(url);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || "Failed to fetch batches");
    }

    return response.json();
  }

  // Get reference links
  async getLinks(fileId?: string): Promise<ReferenceLink[]> {
    const url = fileId ? `${this.baseURL}/api/get_links?file_id=${encodeURIComponent(fileId)}` : `${this.baseURL}/api/get_links`;
    const response = await fetch(url);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || "Failed to fetch links");
    }

    const data = await response.json();
    const links = data.links || [];

    // Convert string links to ReferenceLink objects if needed
    return links.map((link: string | ReferenceLink) => {
      if (typeof link === "string") {
        return {
          title: this.extractTitleFromUrl(link),
          url: link,
          description: undefined,
        };
      }
      return link;
    });
  }

  private extractTitleFromUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname.replace("www.", "");
      const pathname = urlObj.pathname.split("/").pop() || "";

      if (pathname) {
        return pathname.replace(/[-_]/g, " ").replace(/\.[^/.]+$/, "");
      }
      return hostname;
    } catch {
      return url;
    }
  }

  // Generate assessment question
  async generateAssessment(
    type: "theoretical" | "mcq" = "theoretical",
    fileName?: string,
  ): Promise<AssessmentQuestion> {
    const params = new URLSearchParams({ type });
    if (fileName) params.append("fileName", fileName);
    const response = await fetch(
      `${this.baseURL}/api/assessment/generate?${params.toString()}`,
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || "Failed to generate assessment");
    }

    return response.json();
  }

  // Submit assessment answer
  async submitAssessment(
    question: string,
    answer: string,
    fileName?: string,
  ): Promise<AssessmentFeedback> {
    const response = await fetch(`${this.baseURL}/api/assessment/submit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        question,
        answer,
        ...(fileName ? { fileName } : {}),
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || "Failed to submit assessment");
    }

    return response.json();
  }

  // Text-to-Speech for Q&A
  async qaTTS(text: string): Promise<string> {
    const response = await fetch(`${this.baseURL}/api/qa-tts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || "TTS failed");
    }

    const data: TTSResponse = await response.json();
    return data.audio_url;
  }

  // Voice input for Q&A
  async qaVoice(audioFile: File): Promise<QAResponse> {
    const formData = new FormData();
    formData.append("audio", audioFile);

    const response = await fetch(`${this.baseURL}/api/qa-voice`, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || "Voice processing failed");
    }

    return response.json();
  }

  async getLatestLipsyncVideo(
    fileName?: string,
  ): Promise<LipsyncVideoResponse> {
    const params = new URLSearchParams();
    if (fileName) {
      params.append("fileName", fileName);
    }
    const query = params.toString() ? `?${params.toString()}` : "";
    const response = await fetch(`${this.baseURL}/api/lipsync/latest${query}`);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        errorData.error || errorData.message || "Failed to load lipsync video",
      );
    }

    const data: LipsyncVideoResponse = await response.json();
    data.video_url = this.toAbsoluteUrl(data.video_url);
    return data;
  }

  async generateLipsyncVideo(fileName?: string): Promise<LipsyncVideoResponse> {
    const response = await fetch(`${this.baseURL}/api/lipsync/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(fileName ? { fileName } : {}),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || "Failed to generate lipsync video");
    }

    const data: LipsyncVideoResponse = await response.json();
    data.video_url = this.toAbsoluteUrl(data.video_url);
    return data;
  }

  // Check processing status
  async checkProcessingStatus(filename: string): Promise<ProcessingStatus> {
    const response = await fetch(
      `${this.baseURL}/api/processing-status/${encodeURIComponent(filename)}`,
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || "Failed to check processing status");
    }

    return response.json();
  }

  // Test connection
  async testConnection(): Promise<boolean> {
    try {
      await this.getFiles();
      return true;
    } catch (error) {
      console.error("Backend connection test failed:", error);
      return false;
    }
  }
}

export const apiService = new ApiService();
