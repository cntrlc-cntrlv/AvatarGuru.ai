# =============================================================================
# Imports
# =============================================================================
import os
import io
import torch
import scipy.io.wavfile
import traceback
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
)

# Load .env with override so updated values are always used
dotenv_path = os.path.join(os.path.dirname(__file__), ".env")
load_dotenv(dotenv_path=dotenv_path, override=True)


# =============================================================================
# MongoDB Setup
# =============================================================================
client = MongoClient(os.getenv("MONGODB_URL"))
db = client[os.getenv("MONGO_DB")]
collection = db["files"]

try:
    fs = gridfs.GridFS(db, collection=os.getenv("GRIDFS_COLLECTION", "tts_audio"))
    print("✅ GridFS ready for audio storage.")
except Exception as e:
    print(f"⚠️ GridFS init failed: {e}")
    fs = None


def get_latest_pdf_doc():
    """Return the most recently uploaded PDF document from MongoDB."""
    return collection.find_one({}, sort=[("uploadDate", -1)])




# =============================================================================
# Output Schema
# =============================================================================
response_schemas = [
    ResponseSchema(
        name="links",
        description="Exactly 3 trusted https URLs.",
    ),
    ResponseSchema(
        name="keywords",
        description="Exactly 4 important multi-word key phrases.",
    ),
]

output_parser = StructuredOutputParser.from_response_schemas(response_schemas)
format_instructions = output_parser.get_format_instructions()


# =============================================================================
# Prompt Builder




# =============================================================================
# Regenerate Audio for Existing Batches
# =============================================================================
def regenerate_audio_for_existing_batches(doc, pdf_basename):
    """Generate audio only for batches that already have summaries but no audio."""
    from werkzeug.utils import secure_filename

    existing_batches = doc.get("explanationBatches", [])

    collection.update_one(
        {"_id": doc["_id"]},
        {"$set": {"processingStatus": "processing"}},
    )

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
                safe_name = (
                    secure_filename(os.path.splitext(pdf_basename)[0])
                    or "summary"
                )
                audio_filename = f"{safe_name}_batch{batch_num}.wav"
                gridfs_id = store_audio_in_gridfs(
                    fs, wav_bytes, audio_filename, sample_rate
                )

                if gridfs_id:
                    audio_meta = build_audio_meta(gridfs_id, audio_filename)
                    collection.update_one(
                        {
                            "_id": doc["_id"],
                            "explanationBatches.batchNumber": batch_num,
                        },
                        {"$set": {"explanationBatches.$.audio": audio_meta}},
                    )
                    collection.update_one(
                        {"_id": doc["_id"]},
                        {"$push": {"audios": audio_meta}},
                    )
                    print(f"✅ Audio generated for existing batch {batch_num}")
        except Exception as e:
            print(f"⚠️ Audio generation failed for batch {batch_num}: {e}")

    collection.update_one(
        {"_id": doc["_id"]},
        {
            "$set": {
                "processingStatus": "completed",
                "completedAt": datetime.utcnow(),
            }
        },
    )
    print("🎉 Audio-only pass completed successfully.")


# =============================================================================
# MAIN PIPELINE
# =============================================================================
def main():
    print("🚀 Starting Summary Pipeline...")

    doc = get_latest_pdf_doc()
    if not doc:
        raise RuntimeError("No PDF found in MongoDB")

    pdf_path = os.path.normpath(doc["filePath"])
    pdf_basename = doc.get("originalName", os.path.basename(pdf_path))

    # -----------------------------------------------------------------
    # Check if content already exists (skip regeneration when possible)
    # -----------------------------------------------------------------
    existing_batches = doc.get("explanationBatches", [])

    if existing_batches:
        has_summaries = any(
            b.get("summary") for b in existing_batches if isinstance(b, dict)
        )
        has_images = any(
            b.get("images") for b in existing_batches if isinstance(b, dict)
        )
        has_audio = any(
            b.get("audio") for b in existing_batches if isinstance(b, dict)
        )

        if has_summaries and has_images and has_audio:
            print(
                "--- 😶‍🌫️ Summary, links, images, and audio already exist. "
                "Skipping generation. ---"
            )
            collection.update_one(
                {"_id": doc["_id"]},
                {
                    "$set": {
                        "processingStatus": "completed",
                        "completedAt": datetime.utcnow(),
                    }
                },
            )
            return

        if has_summaries and has_images and not has_audio:
            print(
                "--- 🔊 Summaries exist but audio missing. "
                "Generating audio for existing batches... ---"
            )
            regenerate_audio_for_existing_batches(doc, pdf_basename)
            return

        if has_summaries and not has_images:
            print(
                "--- ⚠️ Summaries exist but images missing. "
                "Full regeneration needed. ---"
            )
            # Fall through to full pipeline

    # -----------------------------------------------------------------
    # Full pipeline: generate summaries + images + audio
    # -----------------------------------------------------------------
    collection.update_one(
        {"_id": doc["_id"]},
        {"$set": {"processingStatus": "processing"}},
    )

    print("📑 Loading PDF and chunking...")
    chunks = load_and_chunk_pdf(pdf_path)

    if not chunks:
        raise RuntimeError("No valid chunks found in the loaded PDF.")

    print(f"📦 Total chunks: {len(chunks)}")

    # process_batch_pipeline returns a list of batch dicts; persist each to MongoDB
    batches = process_batch_pipeline(chunks, fs, pdf_basename)
    for batch_doc in batches:
        collection.update_one(
            {"_id": doc["_id"]},
            {"$push": {"explanationBatches": batch_doc}},
        )
        if batch_doc.get("audio"):
            collection.update_one(
                {"_id": doc["_id"]},
                {"$push": {"audios": batch_doc["audio"]}},
            )

    collection.update_one(
        {"_id": doc["_id"]},
        {
            "$set": {
                "processingStatus": "completed",
                "completedAt": datetime.utcnow(),
            }
        },
    )

    print("🎉 Summary pipeline completed successfully.")


if __name__ == "__main__":
    main()
