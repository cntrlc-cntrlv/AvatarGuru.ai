import sys
import os
from dotenv import load_dotenv

# Using the updated libraries from ingest_test.py
from langchain_community.document_loaders import PyPDFLoader
from langchain.text_splitter import RecursiveCharacterTextSplitter
from qdrant_client import QdrantClient
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_qdrant import QdrantVectorStore

# -----------------------------
# Load environment variables
# -----------------------------
load_dotenv(override=True)

def ingest_document(file_path):
    """
    Loads a PDF, filters for Lessons, 
    and ingests it into the Qdrant collection.
    """
    
    # -----------------------------
    # Configuration (From ingest_test.py)
    # -----------------------------
    EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL")
    QDRANT_URL = os.getenv("QDRANT_URL")
    
    COLLECTION_NAME = os.path.splitext(os.path.basename(file_path))[0].lower().replace(" ", "_")
    
    # Lesson 1 page range (1-based)
    LESSON1_START_PAGE = int(os.getenv("START_PAGE"))
    LESSON1_END_PAGE = int(os.getenv("END_PAGE"))

    # Convert to 0-based indexing used by LangChain
    START_PAGE_IDX = LESSON1_START_PAGE - 1
    END_PAGE_IDX = LESSON1_END_PAGE - 1

    print(f"🚀 Starting ingestion process for: {file_path}")
    print(f"🎯 Target Qdrant collection: '{COLLECTION_NAME}'")
    print(f"📑 Filtering for Lessons (Pages {LESSON1_START_PAGE}-{LESSON1_END_PAGE})")

    try:
        # -----------------------------
        # 1. Load PDF (Dynamic Path)
        # -----------------------------
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"File not found at: {file_path}")

        loader = PyPDFLoader(file_path)
        documents = loader.load()
        print(f"✅ Total pages loaded from PDF: {len(documents)}")

        # -----------------------------
        # 2. Split into chunks
        # -----------------------------
        text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=500,
            chunk_overlap=50
        )
        chunks = text_splitter.split_documents(documents)
        print(f"✅ Total raw chunks created: {len(chunks)}")

        # -----------------------------
        # 3. Filter Lesson 1 chunks (Logic from ingest_test.py)
        # -----------------------------
        lesson1_chunks = []

        for idx, chunk in enumerate(chunks):
            page_num = chunk.metadata.get("page")

            # Check if chunk falls within the lesson page range
            if page_num is not None and START_PAGE_IDX <= page_num <= END_PAGE_IDX:
                # Add extra metadata
                chunk.metadata["lesson"] = "Lessons"
                chunk.metadata["chunk_index"] = idx
                lesson1_chunks.append(chunk)

        print("==============================")
        print(f"📊 Total Lesson chunks to ingest:    {len(lesson1_chunks)}")
        print("==============================")

        if not lesson1_chunks:
            print("⚠️ No chunks found in the specified page range. Aborting ingestion.")
            return

        # -----------------------------
        # 4. Load embedding model
        # -----------------------------
        embeddings = HuggingFaceEmbeddings(
            model_name=EMBEDDING_MODEL
        )
        print("✅ Embedding model loaded.")

        # -----------------------------
        # 5. Connect to Qdrant & Ingest
        # -----------------------------
        client = QdrantClient(url=QDRANT_URL)
        
        # Check if collection exists
        collections = [c.name for c in client.get_collections().collections]

        if COLLECTION_NAME not in collections:
            print(f"⚙️ Creating new collection '{COLLECTION_NAME}'...")
            QdrantVectorStore.from_documents(
                documents=lesson1_chunks,
                embedding=embeddings,
                url=QDRANT_URL,
                collection_name=COLLECTION_NAME
            )
        else:
            print(f"📦 Collection '{COLLECTION_NAME}' exists. Adding documents...")
            vectorstore = QdrantVectorStore(
                client=client,
                collection_name=COLLECTION_NAME,
                embedding=embeddings
            )
            vectorstore.add_documents(lesson1_chunks)

        print(f"✅ Ingestion complete! Data stored in collection '{COLLECTION_NAME}'.")

    except Exception as e:
        print(f"❌ Error during ingestion: {e}")

# -----------------------------
# CLI entry point (From ingest.py)
# -----------------------------
if __name__ == '__main__':
    if len(sys.argv) > 1:
        filepath_from_command = sys.argv[1]
        ingest_document(filepath_from_command)
    else:
        print("Error: Please provide the path to the PDF file.")
        print("Usage: python ingest.py <path_to_your_file.pdf>")