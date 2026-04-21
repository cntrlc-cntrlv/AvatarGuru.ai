import sys
import os
from dotenv import load_dotenv
from pymongo import MongoClient

from common_fn import load_and_chunk_pdf, ingest_into_qdrant

# -----------------------------
# Load environment variables
# -----------------------------
load_dotenv(override=True)


def ingest_document(file_path):
    """
    Loads a PDF, filters for the configured page range,
    ingests it into the Qdrant collection, and updates MongoDB
    with the confirmed collection name.
    """

    # -----------------------------
    # Configuration
    # -----------------------------
    COLLECTION_NAME = os.path.splitext(os.path.basename(file_path))[0].lower().replace(" ", "_")

    LESSON1_START_PAGE = int(os.getenv("START_PAGE"))
    LESSON1_END_PAGE   = int(os.getenv("END_PAGE"))

    print(f"🚀 Starting ingestion process for: {file_path}")
    print(f"🎯 Target Qdrant collection: '{COLLECTION_NAME}'")
    print(f"📑 Filtering for Lessons (Pages {LESSON1_START_PAGE}-{LESSON1_END_PAGE})")

    try:
        # -----------------------------
        # 1. Load PDF & chunk (via common_fn)
        # -----------------------------
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"File not found at: {file_path}")

        chunks = load_and_chunk_pdf(
            file_path,
            start_page=LESSON1_START_PAGE,
            end_page=LESSON1_END_PAGE,
            lesson_label="Lessons",
        )
        print(f"✅ Total pages loaded and chunked: {len(chunks)} chunks")

        if not chunks:
            print("⚠️ No chunks found in the specified page range. Aborting ingestion.")
            return

        # -----------------------------
        # 2. Ingest into Qdrant (via common_fn)
        # -----------------------------
        ingest_into_qdrant(chunks, COLLECTION_NAME)

        # -----------------------------
        # 3. Write confirmed collection name back to MongoDB
        # -----------------------------
        try:
            _mongo_client = MongoClient(os.getenv("MONGODB_URL"))
            _db = _mongo_client[os.getenv("MONGO_DB")]
            _files_col = _db["files"]
            _original_name = os.path.basename(file_path)
            _files_col.update_one(
                {"originalName": _original_name},
                {"$set": {"qdrantCollection": COLLECTION_NAME}},
            )
            print(f"✅ MongoDB updated: qdrantCollection='{COLLECTION_NAME}' for '{_original_name}'")
        except Exception as db_err:
            print(f"⚠️ Could not update MongoDB with qdrantCollection: {db_err}")

    except Exception as e:
        print(f"❌ Error during ingestion: {e}")


# -----------------------------
# CLI entry point
# -----------------------------
if __name__ == "__main__":
    if len(sys.argv) > 1:
        filepath_from_command = sys.argv[1]
        ingest_document(filepath_from_command)
    else:
        print("Error: Please provide the path to the PDF file.")
        print("Usage: python ingest1.py <path_to_your_file.pdf>")