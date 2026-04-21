# =====================================================================================================
# preprocess.py — Full pipeline for preprocessed lessons
# =====================================================================================================
#
# This script processes a hardcoded PDF into a preprocessed lesson that appears under
# "Available Lessons" in the hierarchical page of the frontend.
#
# What it does:
#   1. Loads & chunks the PDF (filtered by page range)
#   2. Ingests chunks into Qdrant vector database (for QA retrieval)
#   3. Generates summary, links, keywords per batch (via Groq LLM)
#   4. Generates images per batch (via Serper image search)
#   5. Generates TTS audio per batch (via Parler TTS)
#   6. Stores everything in MongoDB:
#      - `available_lessons`  → lesson metadata (board, subject, lesson, title, file_id)
#      - `lesson_contents`    → full content (explanation, links, keywords, images, audio, batches)
#      - GridFS               → audio WAV files
#
# Usage:
#   python preprocess.py
#
# Configuration:
#   All settings come from .env (PREPROCESS_* variables)
# =====================================================================================================


# =====================================================================================================
# Imports
# =====================================================================================================
import os
import io
import sys
import uuid
import torch
import scipy.io.wavfile
from datetime import datetime
from dotenv import load_dotenv
from pymongo import MongoClient
import gridfs

from groq import Groq
from langchain_community.document_loaders import PyPDFLoader
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain.output_parsers import StructuredOutputParser, ResponseSchema

from common_fn import (
    groq_generate,
    generate_audio_for_text,
    store_audio_in_gridfs,
    build_prompt_summary,
    build_prompt_links,
    load_and_chunk_pdf,
    process_batch_pipeline,
    build_audio_meta,
    ingest_into_qdrant,
)

# Force override so updated .env values are used
dotenv_path = os.path.join(os.path.dirname(__file__), ".env")
load_dotenv(dotenv_path=dotenv_path, override=True)


# =====================================================================================================
# Configuration from .env
# =====================================================================================================
PREPROCESS_PDF_PATH = os.getenv("PREPROCESS_PDF_PATH", "")
PREPROCESS_BOARD = os.getenv("PREPROCESS_BOARD", "")
PREPROCESS_SUBJECT = os.getenv("PREPROCESS_SUBJECT", "")
PREPROCESS_LESSON = os.getenv("PREPROCESS_LESSON", "")
PREPROCESS_TITLE = os.getenv("PREPROCESS_TITLE", "")
PREPROCESS_START_PAGE = int(os.getenv("PREPROCESS_START_PAGE", "1"))
PREPROCESS_END_PAGE = int(os.getenv("PREPROCESS_END_PAGE", "20"))

# Collection name = <pdf_filename_stem>_<start_page>_<end_page>
# e.g. Hist.pdf + pages 12-15  →  hist_12_15
_pdf_stem = os.path.splitext(os.path.basename(PREPROCESS_PDF_PATH))[0].lower().replace(" ", "_")
PREPROCESS_COLLECTION_NAME = f"{_pdf_stem}_{PREPROCESS_START_PAGE}_{PREPROCESS_END_PAGE}"

# Validate required config
if not PREPROCESS_PDF_PATH or not os.path.exists(PREPROCESS_PDF_PATH):
    raise FileNotFoundError(
        f"PREPROCESS_PDF_PATH is not set or file does not exist: '{PREPROCESS_PDF_PATH}'\n"
        "Set it in .env to the full path of the PDF to preprocess."
    )
if not all([PREPROCESS_BOARD, PREPROCESS_SUBJECT, PREPROCESS_LESSON, PREPROCESS_TITLE]):
    raise ValueError(
        "Missing lesson metadata in .env. Please set:\n"
        "  PREPROCESS_BOARD, PREPROCESS_SUBJECT, PREPROCESS_LESSON, PREPROCESS_TITLE"
    )



# =====================================================================================================
# MongoDB Setup
# =====================================================================================================
mongo_client = MongoClient(os.getenv("MONGODB_URL"))
db = mongo_client[os.getenv("MONGO_DB")]
available_lessons_col = db["available_lessons"]
lesson_contents_col = db["lesson_contents"]

try:
    fs = gridfs.GridFS(db, collection=os.getenv("GRIDFS_COLLECTION", "tts_audio"))
    print("✅ GridFS ready for audio storage.")
except Exception as e:
    print(f"⚠️ GridFS init failed: {e}")
    fs = None


# =====================================================================================================
# Generate a stable file_id for this lesson (based on board+subject+lesson)
# =====================================================================================================
FILE_ID = f"{PREPROCESS_BOARD}_{PREPROCESS_SUBJECT}_{PREPROCESS_LESSON}".lower().replace(" ", "_")




# =====================================================================================================
# Output Schema
# =====================================================================================================
response_schemas = [
    ResponseSchema(name="links", description="Exactly 3 trusted https URLs."),
    ResponseSchema(name="keywords", description="Exactly 4 important multi-word key phrases."),
]

output_parser = StructuredOutputParser.from_response_schemas(response_schemas)
format_instructions = output_parser.get_format_instructions()







# =====================================================================================================
# Load + Chunk PDF — delegated to common_fn.load_and_chunk_pdf
# =====================================================================================================
# load_and_chunk_pdf is imported from common_fn. It supports optional page-range filtering.


# =====================================================================================================
# Ingest into Qdrant Vector Database
# =====================================================================================================
# ingest_into_qdrant is imported from common_fn and called directly in the main pipeline.




# =====================================================================================================
# Batch Processing (Summary + Images + Audio)
# Delegated to common_fn.process_batch_pipeline
# =====================================================================================================
# process_batch_pipeline is imported from common_fn and called directly in the main pipeline.
# It returns a list of batch dicts that this script then saves to MongoDB.


# =====================================================================================================
# Save to MongoDB (available_lessons + lesson_contents)
# =====================================================================================================
def save_to_mongodb(file_id, batches):
    """
    Save the preprocessed lesson to MongoDB so the frontend can find it.
    - `available_lessons` collection: metadata row for the hierarchical tree
    - `lesson_contents` collection: full content (summaries, images, audio, batches)
    """

    # ---- Combine all batch summaries into one explanation ----
    combined_explanation = " ".join(
        b["summary"] for b in batches if b.get("summary")
    ).strip()

    # ---- Collect all images ----
    all_images = []
    for b in batches:
        all_images.extend(b.get("images", []))
    all_images = list(dict.fromkeys(all_images))  # deduplicate

    # ---- Collect all links ----
    all_links = []
    for b in batches:
        for link in b.get("links", []):
            if link not in all_links:
                all_links.append(link)

    # ---- Collect all keywords ----
    all_keywords = []
    for b in batches:
        for kw in b.get("keywords", []):
            if kw not in all_keywords:
                all_keywords.append(kw)

    # ---- Collect all audio metadata ----
    all_audios = [b["audio"] for b in batches if b.get("audio")]

    # ---- 1. Upsert into `available_lessons` ----
    lesson_meta = {
        "file_id": file_id,
        "board": PREPROCESS_BOARD,
        "subject": PREPROCESS_SUBJECT,
        "lesson": PREPROCESS_LESSON,
        "title": PREPROCESS_TITLE,
        "createdAt": datetime.utcnow(),
        "updatedAt": datetime.utcnow(),
    }

    available_lessons_col.update_one(
        {"file_id": file_id},
        {"$set": lesson_meta},
        upsert=True
    )
    print(f"✅ Upserted lesson metadata in 'available_lessons': {file_id}")

    # ---- 2. Upsert into `lesson_contents` ----
    content_doc = {
        "file_id": file_id,
        "explanation": combined_explanation,
        "images": all_images,
        "links": all_links,
        "keywords": all_keywords,
        "audios": all_audios,
        "explanationBatches": batches,
        "processingStatus": "completed",
        "completedAt": datetime.utcnow(),
        "board": PREPROCESS_BOARD,
        "subject": PREPROCESS_SUBJECT,
        "lesson": PREPROCESS_LESSON,
        "title": PREPROCESS_TITLE,
        "pdfPath": PREPROCESS_PDF_PATH,
        "qdrantCollection": PREPROCESS_COLLECTION_NAME,
    }

    lesson_contents_col.update_one(
        {"file_id": file_id},
        {"$set": content_doc},
        upsert=True
    )
    print(f"✅ Upserted lesson content in 'lesson_contents': {file_id}")


# =====================================================================================================
# Check if already processed
# =====================================================================================================
def is_already_processed(file_id):
    """Check if this lesson already has complete data."""
    content = lesson_contents_col.find_one({"file_id": file_id})
    if not content:
        return False, "not_found"

    has_explanation = bool(content.get("explanation"))
    has_batches = bool(content.get("explanationBatches"))
    has_images = bool(content.get("images"))
    has_audio = bool(content.get("audios"))

    if has_explanation and has_batches and has_images and has_audio:
        return True, "complete"
    elif has_explanation and has_batches and has_images and not has_audio:
        return False, "missing_audio"
    elif has_explanation and has_batches and not has_images:
        return False, "missing_images"
    else:
        return False, "incomplete"


# =====================================================================================================
# MAIN PIPELINE
# =====================================================================================================
if __name__ == "__main__":

    print("=" * 70)
    print("🚀 Starting Preprocess Pipeline for Preprocessed Lessons")
    print("=" * 70)
    print(f"   PDF:        {PREPROCESS_PDF_PATH}")
    print(f"   Board:      {PREPROCESS_BOARD}")
    print(f"   Subject:    {PREPROCESS_SUBJECT}")
    print(f"   Lesson:     {PREPROCESS_LESSON}")
    print(f"   Title:      {PREPROCESS_TITLE}")
    print(f"   Pages:      {PREPROCESS_START_PAGE} – {PREPROCESS_END_PAGE}")
    print(f"   Qdrant:     {PREPROCESS_COLLECTION_NAME}")
    print(f"   File ID:    {FILE_ID}")
    print("=" * 70)

    # ---- Check if already processed ----
    already_done, status = is_already_processed(FILE_ID)

    if already_done:
        print("--- 😶‍🌫️ This lesson is already fully processed. Skipping. ---")
        print("    Delete the entry from 'lesson_contents' and 'available_lessons' to reprocess.")
        sys.exit(0)

    if status == "missing_audio":
        # Summaries + images exist but audio is missing → generate audio only
        print("--- 🔊 Summaries exist but audio missing. Generating audio for existing batches... ---")

        content = lesson_contents_col.find_one({"file_id": FILE_ID})
        existing_batches = content.get("explanationBatches", [])
        from werkzeug.utils import secure_filename

        new_audios = []
        for batch in existing_batches:
            if not isinstance(batch, dict) or batch.get("audio"):
                continue

            batch_num = batch.get("batchNumber", 0)
            summary_text = batch.get("summary", "")
            if not summary_text:
                continue

            try:
                wav_bytes, sample_rate = generate_audio_for_text(summary_text)
                if wav_bytes:
                    safe_name = secure_filename(
                        os.path.splitext(os.path.basename(PREPROCESS_PDF_PATH))[0]
                    ) or "preprocess"
                    audio_filename = f"{safe_name}_batch{batch_num}.wav"
                    gridfs_id = store_audio_in_gridfs(fs, wav_bytes, audio_filename, sample_rate)

                    if gridfs_id:
                        audio_meta = build_audio_meta(gridfs_id, audio_filename)
                        # Update the specific batch
                        lesson_contents_col.update_one(
                            {"file_id": FILE_ID, "explanationBatches.batchNumber": batch_num},
                            {"$set": {"explanationBatches.$.audio": audio_meta}}
                        )
                        new_audios.append(audio_meta)
                        print(f"✅ Audio generated for batch {batch_num}")
            except Exception as e:
                print(f"⚠️ Audio generation disabled/failed for batch {batch_num}: {e}")

        if new_audios:
            lesson_contents_col.update_one(
                {"file_id": FILE_ID},
                {
                    "$push": {"audios": {"$each": new_audios}},
                    "$set": {"completedAt": datetime.utcnow()},
                }
            )

        print("🎉 Audio-only pass completed successfully.")
        sys.exit(0)


    # ---- FULL PIPELINE ----
    print("\n📑 Step 1: Loading PDF and filtering pages...")
    chunks = load_and_chunk_pdf(
        PREPROCESS_PDF_PATH,
        start_page=PREPROCESS_START_PAGE,
        end_page=PREPROCESS_END_PAGE,
        lesson_label=PREPROCESS_TITLE
    )

    if not chunks:
        raise RuntimeError(
            f"No chunks found in pages {PREPROCESS_START_PAGE}–{PREPROCESS_END_PAGE}. "
            "Check PREPROCESS_START_PAGE and PREPROCESS_END_PAGE in .env."
        )

    # Skip the first chunk (usually contains page header / lesson title metadata)
    if len(chunks) > 1:
        print(f"🔹 Skipping first chunk (index 0). Proceeding with {len(chunks) - 1} chunks.")
        chunks = chunks[1:]
    else:
        print("⚠️ Only 1 chunk found; using it despite skip rule.")

    print(f"📦 Total chunks after skip: {len(chunks)}")

    # ---- Ingest into Qdrant ----
    print("\n📥 Step 2: Ingesting into Qdrant vector database...")
    try:
        ingest_into_qdrant(chunks, PREPROCESS_COLLECTION_NAME)
    except Exception as e:
        print(f"⚠️ Qdrant ingestion failed (non-fatal, continuing): {e}")

    # ---- Generate summaries + images + audio via shared pipeline ----
    print("✍️ Step 3: Generating summaries, images, and audio...")
    batches = process_batch_pipeline(chunks, fs, os.path.basename(PREPROCESS_PDF_PATH))

    if not batches:
        raise RuntimeError("No valid batches generated.")

    # ---- Save to MongoDB ----
    print("\n💾 Step 4: Saving to MongoDB...")
    save_to_mongodb(FILE_ID, batches)

    print("\n" + "=" * 70)
    print("🎉 Preprocess pipeline completed successfully!")
    print(f"   Lesson '{PREPROCESS_TITLE}' is now available in the frontend.")
    print("=" * 70)
