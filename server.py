# -------------------------------------------
# ---------------- Imports ------------------
#--------------------------------------------

import os
import re
import sys
import subprocess
from datetime import datetime
import json
import requests
from flask import Flask, request, jsonify, send_from_directory, Response
from flask_cors import CORS
from werkzeug.utils import secure_filename
from pymongo import MongoClient
import gridfs
from langchain.chains import RetrievalQA
from langchain.prompts import PromptTemplate
from retrieval import get_relevant_docs
from pathlib import Path
from dotenv import load_dotenv, find_dotenv


# -------------------------------------------
# ---------------- Load .env ----------------
#--------------------------------------------

env_path = find_dotenv()
if env_path:
    load_dotenv(env_path, override=True)

if env_path:
    print(f"Loaded environment from: {env_path}")
else:
    print("No .env file found by find_dotenv(); relying on OS environment variables.")


from common_fn import (
    execute_with_retry,
    groq_generate,
    groq_stt,
    groq_tts,
    filename_to_collection_name,
)
llm = groq_generate


#----------------------------------------------
# ---------------- Flask Setup ----------------
#----------------------------------------------

app = Flask(__name__)
CORS(app)  

# -----------------------------------------------------------------------
# ---------------- Configuration for Uploads & Collection folders ----------------
# -----------------------------------------------------------------------

#Generate the Upload Directory
UPLOAD_FOLDER = os.getenv("UPLOAD_FOLDER")
if not os.path.exists(UPLOAD_FOLDER):
    os.makedirs(UPLOAD_FOLDER)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER


#Generate the TTS Directory
TTS_OUTPUT_FOLDER = os.getenv("TTS_OUTPUT_FOLDER")
if not os.path.exists(TTS_OUTPUT_FOLDER):
    os.makedirs(TTS_OUTPUT_FOLDER)
app.config['TTS_OUTPUT_FOLDER'] = TTS_OUTPUT_FOLDER


# -----------------------------------------------
# ---------------- MongoDB Setup ----------------
# -----------------------------------------------

try:
    client = MongoClient(os.getenv("MONGODB_URL"))
    db = client[os.getenv("MONGO_DB")]
    files_collection = db["files"]
    fs = gridfs.GridFS(db, collection=os.getenv("GRIDFS_COLLECTION"))
    client.server_info()
    print("✅ MongoDB connection successful.")
except Exception as e:
    print(f"❌ Could not connect to MongoDB: {e}")
    client = None
    fs = None
    files_collection = None

# Expose shared DB objects so Blueprints can read them via current_app.config
app.config['GRIDFS'] = fs
app.config['FILES_COLLECTION'] = files_collection
app.config['MONGO_CLIENT'] = client

# Register QA Blueprint
from qa_routes import qa_bp
app.register_blueprint(qa_bp)


# -----------------------------------------------
# -------------- Utility helpers ----------------
# -----------------------------------------------


#---- Find a file and generate a safe folder for that file for storage ----
def resolve_file_context(file_name_req: str | None = None):
    """Return (file_doc, safe_folder_name) for downstream storage."""
    file_doc = None
    try:
        if file_name_req:
            file_doc = files_collection.find_one({"originalName": file_name_req})
        if not file_doc:
            file_doc = files_collection.find_one({}, sort=[("uploadDate", -1)])
    except Exception:
        file_doc = None

    folder_candidate = None
    if file_doc:
        folder_candidate = file_doc.get("folder") or file_doc.get("originalName")
    if not folder_candidate:
        folder_candidate = file_name_req or f"default-{int(datetime.utcnow().timestamp())}"
    safe_folder = secure_filename(os.path.splitext(folder_candidate)[0]) or "default"
    return file_doc, safe_folder


#---- Build a path to save files in collections folder ----
def build_collection_url(relative_path: str) -> str:
    normalized = relative_path.replace("\\", "/").lstrip("/")
    collections_folder = os.getenv("COLLECTIONS_FOLDER")
    return f"{collections_folder}/{normalized}"


#---- Serialize datetime objects for JSON encoding ----
def serialize_datetime(value):
    if isinstance(value, datetime):
        return value.isoformat() + ("Z" if value.tzinfo is None else "")
    return value


#---- Extract the helpful answer from a text response ----
def extract_helpful_answer(text):
    match = re.search(r"Helpful Answer:\s*(.*?)(?:\n\s*Question:|\Z)", text, re.DOTALL)
    if match:
        return match.group(1).strip()
    return text.strip()



# =============================================
# ---------------- Upload Page ----------------
# =============================================


@app.route('/api/upload', methods=['POST'])
def upload_file():
    if 'pdf' not in request.files:
        return jsonify({"error": "No file part in the request"}), 400

    file = request.files['pdf'] #Searches for the extension .pdf in user directoy. 
    if file.filename == '':
        return jsonify({"error": "No file selected for uploading"}), 400

    if file:
        filename = secure_filename(file.filename)
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(filepath)

        if client:
            # Check if file exists using the SECURE filename (to match what gets returned to client)
            existing_doc = files_collection.find_one({"originalName": filename})
            
            if existing_doc:
                print(f"File '{filename}' already exists in DB. Updating metadata (timestamp & status).")
                files_collection.update_one(
                    {"_id": existing_doc["_id"]},
                    {"$set": {
                        "uploadDate": datetime.utcnow(),
                        "processingStatus": "processing"
                    }}
                )
            else:
                import uuid
                new_file_id = str(uuid.uuid4())
                metadata = {
                    "file_id": new_file_id,
                    "filename": filename,
                    "board": "Unknown",
                    "subject": "Unknown",
                    "lesson": "Unknown",
                    "title": filename,
                    "uploadType": "user",
                    "createdAt": datetime.utcnow(),
                    "updatedAt": datetime.utcnow(),
                    "qdrantCollection": filename_to_collection_name(filename),
                    "originalName": filename,
                    "filePath": filepath,
                    "fileType": file.content_type,
                    "fileSize": os.path.getsize(filepath),
                    "uploadDate": datetime.utcnow(),
                    "processingStatus": "processing"
                }
                files_collection.insert_one(metadata)
        else:
            return jsonify({"error": "Database connection is not available."}), 500

        try:
            # ---- Run ingest.py ----
            print(f"Starting subprocess for ingest: {filepath}")
            subprocess.Popen([sys.executable, 'ingest1.py', filepath])

            # ---- Run summary.py ----
            print(f"Starting subprocess for Summary")
            subprocess.Popen([sys.executable, 'summary1.py'])

        except Exception as e:
            print(f"Error starting subprocess: {e}")
            return jsonify({"error": "Failed to start background processes"}), 500

        return jsonify({
            "message": f"File '{filename}' uploaded. Processing started (analysis + explanation).",
            "filename": filename,
            "status": "processing"
        }), 202



# ====================================================
# ------------------ Processing Status ---------------
# ====================================================

# ---- Checks if file processing is complete and mark it in completed in MongoDB ----
@app.route('/api/processing-status/<filename>', methods=['GET'])
def check_processing_status(filename):
    """Check if file processing is complete by looking for explanation in MongoDB."""
    try:
        if not client:
            return jsonify({"error": "Database connection is not available."}), 500
        
        # Find the file document
        file_doc = files_collection.find_one({"originalName": filename})
        
        if not file_doc:
            return jsonify({"status": "not_found", "message": "File not found"}), 404
        
        # Check if processing is completed fetch from mongodb
        status = file_doc.get("processingStatus", "processing")

        return jsonify({
            "status": status,
            "ready": status == "completed"
        })
            
    except Exception as e:
        return jsonify({"error": str(e)}), 500



# =============================================
# ---------- Hierarchical Page APIs ----------
# =============================================

# ---- Returns preprocessed available lessons from MongoDB ----
@app.route('/api/available-lessons', methods=['GET'])
def get_available_lessons():
    """Return all preprocessed lessons stored in 'available_lessons' collection."""
    if not client:
        return jsonify({"error": "Database connection is not available."}), 500
    try:
        lessons_collection = db["available_lessons"]
        lessons = list(lessons_collection.find(
            {},
            {"_id": 0, "board": 1, "subject": 1, "lesson": 1, "file_id": 1, "title": 1}
        ))
        return jsonify(lessons)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ---- Returns user uploaded files with detailed info for hierarchical page ----
@app.route('/api/your-uploads', methods=['GET'])
def get_files_detailed():
    """Return user uploaded files with file_id, filename, and upload date."""
    if not client:
        return jsonify({"error": "Database connection is not available."}), 500
    try:
        files = list(files_collection.find(
            {"uploadType": "user"},
            {"_id": 1, "file_id": 1, "filename": 1, "originalName": 1, "createdAt": 1, "uploadDate": 1}
        ).sort("createdAt", -1))

        result = []
        for f in files:
            result.append({
                "file_id": f.get("file_id") or str(f["_id"]),
                "filename": f.get("filename") or f.get("originalName", "Unknown"),
                "uploaded_at": serialize_datetime(f.get("createdAt") or f.get("uploadDate", ""))
            })
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ---- Returns lesson content by file_id ----
@app.route('/api/lesson-content/<file_id>', methods=['GET'])
def get_lesson_content(file_id):
    """Fetch lesson content (explanation, images) by file_id."""
    if not client:
        return jsonify({"error": "Database connection is not available."}), 500
    try:
        from bson import ObjectId as ObjId

        # First try user-uploaded files collection (match by _id)
        file_doc = None
        try:
            file_doc = files_collection.find_one({"_id": ObjId(file_id)})
        except Exception:
            pass

        # Then try available_lessons collection (match by file_id field)
        if not file_doc:
            lessons_collection = db["available_lessons"]
            lesson_doc = lessons_collection.find_one({"file_id": file_id})
            if lesson_doc:
                # The lesson references a file_id in files_collection or content collection
                # Try to load its content from a content collection
                content_collection = db["lesson_contents"]
                content_doc = content_collection.find_one({"file_id": file_id})
                if content_doc:
                    return jsonify({
                        "script_text": content_doc.get("explanation", "No content available."),
                        "images": content_doc.get("images", []),
                        "fileName": lesson_doc.get("title", "")
                    })
                # Fallback: return lesson metadata
                return jsonify({
                    "script_text": f"Lesson: {lesson_doc.get('title', 'Unknown')}",
                    "images": [],
                    "fileName": lesson_doc.get("title", "")
                })

        if not file_doc:
            return jsonify({"error": "File not found"}), 404

        # Extract text from explanationBatches
        batches = file_doc.get("explanationBatches", [])
        if not batches:
            return jsonify({
                "script_text": "No content available.",
                "images": file_doc.get("images", []),
                "fileName": file_doc.get("originalName", "")
            })

        texts = []
        all_images = list(file_doc.get("images", []))
        for batch in batches:
            if isinstance(batch, dict):
                s = batch.get("summary", "")
                if s:
                    texts.append(str(s).strip())
                # Also collect per-batch images
                batch_imgs = batch.get("images", [])
                if batch_imgs:
                    all_images.extend(batch_imgs)

        combined_text = " ".join([t for t in texts if t])

        return jsonify({
            "script_text": combined_text or "No content available.",
            "images": all_images,
            "fileName": file_doc.get("originalName", "")
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500




#=================================================
#---------------- Learning Page ------------------
#=================================================


# ---- Helper to fetch file or lesson document ----
def _get_file_context(file_id=None):
    if not file_id:
        return files_collection.find_one({}, sort=[("uploadDate", -1)])
    
    from bson import ObjectId as ObjId
    file_doc = None
    try:
        file_doc = files_collection.find_one({"_id": ObjId(file_id)})
    except Exception:
        pass
    
    if not file_doc:
        file_doc = files_collection.find_one({"file_id": file_id})
    
    if not file_doc:
        file_doc = files_collection.find_one({"originalName": file_id})

    if not file_doc:
        file_doc = db["lesson_contents"].find_one({"file_id": file_id})
        # If found in lesson_contents, make sure we return a mock 'originalName' for consistency
        if file_doc and 'title' in file_doc and 'originalName' not in file_doc:
             file_doc['originalName'] = file_doc['title']
    
    return file_doc

# ---- Fetch the summary of the pdf from MongoDB ----
@app.route("/api/get_text")
def get_text():
    """Return the selected uploaded pdf from MongoDB."""
    file_id = request.args.get('file_id')
    file_doc = _get_file_context(file_id) 

    if not file_doc:
        return jsonify({"script_text": "No content available."})

    batches = file_doc.get("explanationBatches", [])
    if not batches:
        return jsonify({"script_text": "No content available."})

    texts = []
    all_images = list(file_doc.get("images", []))
    for batch in batches:
        if isinstance(batch, dict):
            s = batch.get("summary", "")
            if s:
                texts.append(str(s).strip())
            batch_imgs = batch.get("images", [])
            if batch_imgs:
                all_images.extend(batch_imgs)

    combined_text = " ".join([t for t in texts if t])
    
    return jsonify({
        "script_text": combined_text or "No content available.",
        "images": all_images,
        "fileName": file_doc.get("originalName")
    })


# ---- Return batches individually for progressive display ----
@app.route("/api/get_batches")
def get_batches():
    """Return explanation batches as an ordered array for progressive display."""
    file_id = request.args.get('file_id')
    file_doc = _get_file_context(file_id)

    if not file_doc:
        return jsonify({"batches": [], "totalBatches": 0, "fileName": ""})

    raw_batches = file_doc.get("explanationBatches", [])
    top_images = file_doc.get("images", [])

    result_batches = []
    for batch in raw_batches:
        if isinstance(batch, dict):
            result_batches.append({
                "batchNumber": batch.get("batchNumber", 0),
                "summary": batch.get("summary", ""),
                "links": batch.get("links", []),
                "keywords": batch.get("keywords", []),
                "images": batch.get("images", []),
                "audio_url": batch.get("audio", {}).get("audio_url", None) if isinstance(batch.get("audio"), dict) else batch.get("audio_url", None),
            })

    result_batches.sort(key=lambda b: b.get("batchNumber", 0))

    return jsonify({
        "batches": result_batches,
        "totalBatches": len(result_batches),
        "fileName": file_doc.get("originalName", ""),
        "topLevelImages": top_images
    })


# ---- Fetch the links of the pdf from MongoDB ----
@app.route("/api/get_links")
def get_links():
    """Return the latest uploaded links from MongoDB."""
    file_id = request.args.get('file_id')
    file_doc = _get_file_context(file_id)

    if not file_doc:
        return jsonify({"links": []})

    batches = file_doc.get("explanationBatches", [])
    if not batches:
        return jsonify({"links": []})

    all_links = []
    def push_links(val):
        if not val:
            return
        if isinstance(val, list):
            for x in val:
                if isinstance(x, str):
                    all_links.append(x)
        elif isinstance(val, str):
            all_links.append(val)

    for batch in batches:
        if isinstance(batch, dict):
            push_links(batch.get("links"))

    return jsonify({"links": all_links})


# ---- Stream TTS audio from MongoDB GridFS by id ----
from bson import ObjectId

@app.route('/api/tts-audio/<audio_id>', methods=['GET'])
def get_tts_audio(audio_id):
    """Stream TTS audio from MongoDB GridFS by id."""
    try:
        if fs is None:
            return jsonify({"error": "MongoDB GridFS not available."}), 500
        audio_id = audio_id.strip()
        gridout = fs.get(ObjectId(audio_id))
        return Response(
            gridout.read(),
            mimetype=gridout.content_type or "audio/wav",
            headers={"Content-Disposition": f"inline; filename={gridout.filename}"}
        )
    except Exception as e:
        print("[TTS-AUDIO ERROR]", e)
        return jsonify({"error": "Audio not found"}), 404




# ====================================================
# ------------------- Q&A Page -----------------------
# ====================================================

# ---- Returns a list of all files in the directory ----
@app.route('/api/files', methods=['GET'])
def get_files():
    if not client:
        return jsonify({"error": "Database connection is not available."}), 500
    try:
        # Find all documents and only return the originalName field, sorted by date
        files = list(files_collection.find({}, {"_id": 0, "originalName": 1}).sort("uploadDate", -1))
        file_names = [f['originalName'] for f in files]
        return jsonify(file_names)
    except Exception as e:
        return jsonify({'error': str(e)}), 500



# =============================================================
# ---------------------- ASSESSMENT PAGE ----------------------
# =============================================================


# =============================================================================
# Assessment — Full-PDF Context
# Both generate_question and submit_answer feed the complete PDF text to the
# LLM so questions and evaluation are grounded in the whole document, not a
# single randomly-sampled chunk.
# =============================================================================

# Max characters of PDF text sent to the LLM.
# ~15 000 chars ≈ 10-12 pages of a typical school textbook.
ASSESSMENT_MAX_CHARS = 15_000


def _extract_pdf_text(pdf_path: str, max_chars: int = ASSESSMENT_MAX_CHARS) -> str:
    """
    Read a PDF and return up to max_chars of plain text.
    Used as the full context for both question generation and answer evaluation.
    """
    try:
        from langchain_community.document_loaders import PyPDFLoader
        loader = PyPDFLoader(pdf_path)
        docs = loader.load()
        full_text = " ".join(d.page_content for d in docs if d.page_content).strip()
        if len(full_text) > max_chars:
            full_text = full_text[:max_chars] + "..."
        print(f"[ASSESSMENT] Extracted {len(full_text)} chars from PDF: {pdf_path}")
        return full_text
    except Exception as e:
        print(f"[ASSESSMENT] PDF extraction failed: {e}")
        return ""


def _get_assessment_context(file_doc: dict) -> str:
    """
    Return the best available context text for a given file document.
    Priority: full PDF text → stored explanation batches (summaries).
    """
    pdf_path = file_doc.get("filePath", "")
    if pdf_path:
        text = _extract_pdf_text(pdf_path)
        if text:
            return text

    # Fallback: concatenate stored explanation summaries
    batches = file_doc.get("explanationBatches", [])
    fallback = " ".join(
        b.get("summary", "") for b in batches
        if isinstance(b, dict) and b.get("summary")
    ).strip()
    if fallback:
        print("[ASSESSMENT] Using stored summaries as context (PDF not available).")
    return fallback[:ASSESSMENT_MAX_CHARS]


# ----------------- Endpoint to generate question -----------------
@app.route('/api/assessment/generate', methods=['GET'])
def generate_question():
    try:
        if files_collection is None:
            return jsonify({"error": "Database not available"}), 500

        file_name = request.args.get('fileName', '')
        q_type    = request.args.get('type', 'theoretical')
        print(f"[ASSESSMENT] Generating {q_type} question for file: '{file_name}'")

        # Resolve file document
        if file_name:
            file_doc = files_collection.find_one({"originalName": file_name})
        else:
            file_doc = files_collection.find_one({}, sort=[("uploadDate", -1)])

        if not file_doc:
            return jsonify({"error": "No file found in database"}), 404

        # Get full PDF text as context
        context_text = _get_assessment_context(file_doc)
        if not context_text:
            return jsonify({"error": "No content available to generate a question"}), 404

        if q_type == 'mcq':
            template = f"""You are a tutor. Based on the following document content, create ONE multiple-choice question (MCQ)
that tests the student's understanding of a specific concept.

STRICT Format:
Question: [The question text]
A) [Option A text]
B) [Option B text]
C) [Option C text]
D) [Option D text]
Correct Answer: [Option X]
Explanation: [Explanation why it is correct]
Hint: [A helpful hint without giving away the answer]

Document Content: {context_text}
Question:"""
        else:
            template = f"""You are a tutor. Based on the following document content, create ONE clear and specific question
that tests the student's understanding of a key concept.

Document Content: {context_text}
Question:"""

        response = llm(template)
        if not response:
            return jsonify({"error": "LLM failed to generate a question. Try again."}), 500

        start_index = response.find("Question:")
        final_response = response[start_index + len("Question:"):].strip() if start_index != -1 else response.strip()

        return jsonify({"question": final_response})

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500




# ----------------- Endpoint to submit answer and generate feedback -----------------
@app.route('/api/assessment/submit', methods=['POST'])
def submit_answer():
    try:
        # Guard: DB must be available
        if files_collection is None:
            return jsonify({"error": "Database not available"}), 500

        # Read input from frontend first
        data = request.get_json()
        question = (data or {}).get("question", "")
        student_answer = (data or {}).get("answer", "")
        file_name = (data or {}).get("fileName", "")

        if not question or not student_answer:
            return jsonify({"error": "Both question and answer are required"}), 400

        # Fetch file document from MongoDB
        if file_name:
            file_doc = files_collection.find_one({"originalName": file_name})
        else:
            file_doc = files_collection.find_one({}, sort=[("uploadDate", -1)])

        if not file_doc:
            return jsonify({"error": "No file found in database"}), 404

        # Get full PDF text as context (shared helper, same as generate_question)
        context_text = _get_assessment_context(file_doc)

        prompt = f"""You are an AI tutor evaluating a student's answer.

Your response MUST include a Score line and structured feedback.

Response format (follow exactly):
Score: [0-100]

- **Status**: Correct / Partially Correct / Incorrect
- **What you got right**: [list correct points with dashes]
- **What to improve**: [list missing or wrong info with dashes]
- **Key Concept**: [one-sentence summary of the core fact]

Scoring guide:
- 80-100: Answer covers the main points accurately
- 50-79: Answer is partially correct with some gaps
- 0-49: Answer is mostly incorrect or missing key information

Rules:
- Every bullet must start with "- ".
- Use bold (**text**) only for key terms.
- Keep it encouraging and concise.

Document Context: {context_text}
Question: {question}
Student Answer: {student_answer}
Evaluation:"""

        evaluation = llm(prompt)

        if not evaluation:
            return jsonify({"error": "LLM failed to generate feedback. Try again."}), 500

        # Extract score from the response
        import re as _re
        score = 50  # sensible default
        score_match = _re.search(r'Score:\s*(\d+)', evaluation)
        if score_match:
            score = min(100, max(0, int(score_match.group(1))))

        # Strip the Score line from the user-visible feedback
        feedback_text = _re.sub(r'^Score:\s*\d+\s*\n?', '', evaluation, flags=_re.MULTILINE).strip()

        return jsonify({"feedback": feedback_text, "score": score})

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500



# =============================================================
# ------------------------ HTML Routing -----------------------
# =============================================================

@app.route('/collections/<path:filename>')
def serve_collections(filename):
    """Serve generated TTS audio assets under /collections."""
    collections_root = os.path.abspath(TTS_OUTPUT_FOLDER)
    return send_from_directory(collections_root, filename)




# =============================================================
# ------------------------ Run App ----------------------------
# =============================================================

if __name__ == '__main__':
    port = int(os.getenv("PORT", 5000))
    app.run(debug=True, host="0.0.0.0", port=port)
