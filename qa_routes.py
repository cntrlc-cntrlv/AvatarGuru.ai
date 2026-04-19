# =============================================================================
# qa_routes.py
# Flask Blueprint — all Q&A chatbot endpoints
#   GET/POST /api/qa           — text-based RAG question answering
#   POST     /api/qa-voice     — speech-in, text+audio out (multilingual)
#   POST     /api/qa-tts       — convert answer text to audio (Groq Play.ai)
# =============================================================================

import os
import json
import traceback
from datetime import datetime

import requests
from flask import Blueprint, request, jsonify, current_app
from langchain.chains import RetrievalQA
from langchain.prompts import PromptTemplate
from langchain.llms.base import LLM
from typing import Any, List, Optional

from retrieval import get_relevant_docs
from common_fn import (
    execute_with_retry,
    groq_generate,
    groq_stt,
    groq_tts,
    filename_to_collection_name,
)

qa_bp = Blueprint("qa", __name__)


# ---------------------------------------------------------------------------
# LangChain wrapper for Groq (needed by RetrievalQA)
# ---------------------------------------------------------------------------
class GroqLLM(LLM):
    """LangChain-compatible wrapper around groq_generate."""

    def _call(self, prompt: str, stop: Optional[List[str]] = None) -> str:
        return groq_generate(prompt)

    @property
    def _identifying_params(self) -> dict:
        return {"name": "GroqLLM"}

    @property
    def _llm_type(self) -> str:
        return "groq"


# ---------------------------------------------------------------------------
# Shared QA prompt template (text Q&A and voice Q&A use the same rules)
# ---------------------------------------------------------------------------
QA_TEMPLATE = """
Use the context to explain the topic for a student using a clear, bulleted list.
Follow these style rules:
Rules for Pointers:
1. Every bullet point MUST start with a dash and a single space (Example: "- Item").
2. Do not use any indentation before the dash.
3. Ensure there is an empty line before starting a list.
- Use a short introductory sentence.
- Use bullet points for key features or steps.
- Use bold text **only** for the names of parts or specific terms.
- Keep the language simple and easy to memorize.
- Do not use a summary or conclusion at the end.


Context: {context}
Question: {question}
Answer:"""


def _build_rag_chain(retriever):
    """Return a RetrievalQA chain using the shared QA prompt."""
    prompt = PromptTemplate(
        template=QA_TEMPLATE,
        input_variables=["context", "question"]
    )
    return RetrievalQA.from_chain_type(
        llm=GroqLLM(),
        chain_type="stuff",
        retriever=retriever,
        return_source_documents=False,
        chain_type_kwargs={"prompt": prompt}
    )


def _resolve_collection_name(file_name: str) -> str:
    """
    Look up the Qdrant collection name from MongoDB (stored at ingest/preprocess time).
    1. Checks 'files' collection by originalName (user uploads).
    2. Checks 'lesson_contents' by title (preprocessed lessons).
    3. Falls back to deriving from the filename as a last resort.
    """
    try:
        # --- 1. User-uploaded files ---
        files_col = current_app.config.get("FILES_COLLECTION")
        if files_col is not None:
            doc = files_col.find_one({"originalName": file_name}, {"qdrantCollection": 1})
            if doc and doc.get("qdrantCollection"):
                return doc["qdrantCollection"]

        # --- 2. Preprocessed lessons (stored by preprocess.py) ---
        mongo_client = current_app.config.get("MONGO_CLIENT")
        if mongo_client is not None:
            _db = mongo_client[os.getenv("MONGO_DB")]
            lc_doc = _db["lesson_contents"].find_one({"title": file_name}, {"qdrantCollection": 1})
            if lc_doc and lc_doc.get("qdrantCollection"):
                return lc_doc["qdrantCollection"]

    except Exception as e:
        print(f"[QA] Collection name DB lookup failed: {e}")

    # --- 3. Last resort: derive from the filename ---
    print(f"[QA] Falling back to derived collection name for: '{file_name}'")
    return filename_to_collection_name(file_name)


# =============================================================================
# /api/qa  — Text-based RAG question answering
# =============================================================================
@qa_bp.route('/api/qa', methods=['POST'])
def ask_question():
    """Handle AI queries for the QA chatbot (text input)."""
    data = request.get_json()
    query = data.get('question', '')
    file_name = data.get('fileName', '')

    if not query:
        return jsonify({'error': 'No question provided'}), 400
    if not file_name:
        return jsonify({'error': 'No file name provided for context'}), 400

    collection_name = _resolve_collection_name(file_name)
    print(f"[QA] Using Qdrant collection: '{collection_name}' for file: '{file_name}'")

    try:
        retriever = get_relevant_docs(query, collection_name)
        qa = _build_rag_chain(retriever)
        response = qa.invoke({"query": query})
        final_answer = response['result'].strip()
        return jsonify({'response': final_answer})

    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


# =============================================================================
# /api/qa-voice  — Speech-in, text+audio out (multilingual)
# =============================================================================
@qa_bp.route('/api/qa-voice', methods=['POST'])
def qa_voice():
    """Transcribe audio, optionally translate, run RAG, synthesise TTS reply."""
    try:
        # --- 1. Validate inputs ---
        if 'audio' not in request.files:
            return jsonify({'error': 'No audio provided'}), 400

        audio_file = request.files['audio']
        file_name_ctx = request.form.get('fileName', '')
        if not file_name_ctx:
            return jsonify({'error': 'No file name provided for context'}), 400

        # Size guard (max 25 MB)
        audio_file.seek(0, os.SEEK_END)
        size_bytes = audio_file.tell()
        audio_file.seek(0)
        if size_bytes > 25 * 1024 * 1024:
            return jsonify({'error': 'Audio file too large (max 25MB)'}), 400

        # --- 2. Speech-to-Text ---
        try:
            audio_bytes = audio_file.read()
            stt_resp = groq_stt(audio_bytes)
            transcript = getattr(stt_resp, "text", "")
            detected_lang = getattr(stt_resp, "language", None)
        except Exception as e:
            print(f"[QA-VOICE] STT failed: {e}")
            return jsonify({'error': 'Speech transcription failed'}), 500

        if not transcript:
            return jsonify({'error': 'Empty transcription'}), 500

        print(f"[QA-VOICE] Detected language: {detected_lang}")
        print(f"[QA-VOICE] Transcript: {transcript}")

        # --- 3. Optional Translation ---
        translated_text = None
        if detected_lang and detected_lang.lower() != 'en':
            try:
                libre_url = os.getenv("TRANSLATE_MODEL")
                payload = {
                    "q": transcript,
                    "source": detected_lang,
                    "target": "en",
                    "format": "text"
                }
                r = requests.post(
                    libre_url,
                    headers={"Content-Type": "application/json"},
                    data=json.dumps(payload),
                    timeout=10
                )
                r.raise_for_status()
                translated_text = r.json().get('translatedText')
                print(f"[QA-VOICE] Translated → EN: {translated_text}")
            except Exception:
                translated_text = None

        effective_query = translated_text if translated_text else transcript

        # --- 4. Retrieval-Augmented QA ---
        collection_name = _resolve_collection_name(file_name_ctx)
        print(f"[QA-VOICE] Using Qdrant collection: '{collection_name}' for file: '{file_name_ctx}'")
        retriever = get_relevant_docs(effective_query, collection_name)
        qa = _build_rag_chain(retriever)
        qa_resp = qa.invoke({"query": effective_query})
        answer_text = qa_resp["result"].strip()
        print(f"[QA-VOICE] Answer: {answer_text}")

        # --- 5. TTS on the answer ---
        try:
            audio_data = groq_tts(answer_text)
            import base64
            audio_base64 = f"data:audio/wav;base64,{base64.b64encode(audio_data).decode()}" if audio_data else None
        except Exception as e:
            print(f"[QA-VOICE] TTS failed (non-fatal): {e}")
            audio_base64 = None

        return jsonify({
            "transcript": transcript,
            "response": answer_text,
            "audioUrl": audio_base64,
            "translated": translated_text,
            "language": detected_lang
        })

    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


# =============================================================================
# /api/qa-tts  — Convert answer text to audio via Groq Play.ai
# =============================================================================
@qa_bp.route('/api/qa-tts', methods=['POST'])
def qa_tts():
    """Synthesise TTS for a given text, store in GridFS, return the audio ID."""
    # Import here to get the live objects from server context via app config
    from flask import current_app
    fs = current_app.config.get("GRIDFS")
    files_collection = current_app.config.get("FILES_COLLECTION")
    TTS_OUTPUT_FOLDER = current_app.config.get("TTS_OUTPUT_FOLDER")

    try:
        data = request.get_json(force=True)
        text = (data or {}).get('text', '').strip()
        model_qa = (data or {}).get('model', 'canopylabs/orpheus-v1-english')
        voice = (data or {}).get('voice', 'autumn')
        fmt = (data or {}).get('format', 'wav')

        if not text:
            return jsonify({"error": "No text provided"}), 400

        target_name = f"qa-tts-{int(datetime.utcnow().timestamp())}.{fmt}"

        try:
            audio_bytes = groq_tts(text, voice=voice, model=model_qa, response_format=fmt)
        except Exception as e:
            print(f"[QA-TTS] Error generating audio: {e}")
            return jsonify({"error": "QA TTS generation failed"}), 500

        if not audio_bytes:
            return jsonify({"error": "QA TTS returned no audio bytes."}), 502
        if fs is None:
            return jsonify({"error": "MongoDB GridFS is not available."}), 500

        qa_meta = {
            "created_at": datetime.utcnow(),
            "voice": voice,
            "model": model_qa,
            "format": fmt,
            "text": text,
        }
        try:
            gridfs_id = fs.put(
                audio_bytes,
                filename=target_name,
                contentType=f"audio/{fmt}",
                metadata=qa_meta
            )
        except Exception as e:
            return jsonify({"error": "Failed to store QA TTS in GridFS", "details": str(e)}), 500

        # --- Associate audio with the file doc in MongoDB ---
        file_name_req = (data or {}).get('fileName') or (data or {}).get('file_name')
        try:
            from werkzeug.utils import secure_filename
            file_doc = None
            if file_name_req and files_collection is not None:
                file_doc = files_collection.find_one({"originalName": file_name_req})
            if not file_doc and files_collection is not None:
                file_doc = files_collection.find_one({}, sort=[("uploadDate", -1)])

            folder_basename = (
                os.path.splitext(file_doc['originalName'])[0]
                if file_doc and file_doc.get('originalName')
                else file_name_req or f"unnamed-qa-{int(datetime.utcnow().timestamp())}"
            )
            safe_folder = secure_filename(folder_basename)
            local_folder = os.path.join(TTS_OUTPUT_FOLDER or "tts_collections", safe_folder)
            os.makedirs(local_folder, exist_ok=True)

            local_audio_path = os.path.join(local_folder, target_name)
            try:
                with open(local_audio_path, 'wb') as af:
                    af.write(audio_bytes)
            except Exception as e:
                print(f"[QA-TTS] Warning: failed to write audio locally: {e}")

            audio_meta_doc = {
                "type": "qa",
                "gridfs_id": gridfs_id,
                "filename": target_name,
                "contentType": f"audio/{fmt}",
                "created_at": datetime.utcnow(),
                "local_path": os.path.join(safe_folder, target_name)
            }
            if files_collection is not None:
                if file_doc:
                    files_collection.update_one({"_id": file_doc["_id"]}, {"$set": {"folder": safe_folder}})
                    files_collection.update_one({"_id": file_doc["_id"]}, {"$push": {"audios": audio_meta_doc}})
                else:
                    files_collection.insert_one({
                        "originalName": file_name_req or f"unnamed-qa-{int(datetime.utcnow().timestamp())}",
                        "uploadDate": datetime.utcnow(),
                        "folder": safe_folder,
                        "audios": [audio_meta_doc]
                    })
        except Exception as e:
            print(f"[QA-TTS] Warning: failed to associate audio with file doc: {e}")

        print(f"[QA-TTS] Stored QA TTS to GridFS: {gridfs_id}")
        return jsonify({"audioId": str(gridfs_id)})

    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500
