import os
import io
import traceback
from datetime import datetime
from dotenv import load_dotenv

from groq import Groq
from langchain.output_parsers import StructuredOutputParser, ResponseSchema
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain_community.document_loaders import PyPDFLoader

# -------------------------------------------
# ---------------- Load .env ----------------
# -------------------------------------------
load_dotenv(override=True)


# -------------------------------------------
# ---------------- Groq Setup ---------------
# -------------------------------------------
GROQ_API_KEYS_STR = os.getenv("GROQ_API_KEY", "")
if not GROQ_API_KEYS_STR:
    raise ValueError(
        "GROQ_API_KEY environment variable is required.\n"
        "Make sure you have added GROQ_API_KEY to a .env file.\n"
        "You can provide multiple keys separated by commas for rotation."
    )

GROQ_API_KEYS = [k.strip() for k in GROQ_API_KEYS_STR.split(',') if k.strip()]
if not GROQ_API_KEYS:
    raise ValueError("No valid GROQ_API_KEYs found after splitting by comma.")

print(f"Loaded {len(GROQ_API_KEYS)} Groq API keys.")

_current_key_index = 0

def get_current_groq_client():
    global _current_key_index
    return Groq(api_key=GROQ_API_KEYS[_current_key_index])

def rotate_key():
    global _current_key_index
    _current_key_index = (_current_key_index + 1) % len(GROQ_API_KEYS)
    print(f"Rotating to Groq API key index: {_current_key_index}")

def execute_with_retry(func, *args, **kwargs):
    """
    Execute a function that uses the Groq client.
    If it fails with a rate limit or auth error, rotate the key and retry.
    """
    global _current_key_index
    max_retries = len(GROQ_API_KEYS)
    last_exception = None
    
    for attempt in range(max_retries):
        try:
            client = get_current_groq_client()
            return func(client, *args, **kwargs)
        except Exception as e:
            print(f"Attempt {attempt + 1} failed with key index {_current_key_index}: {e}")
            last_exception = e
            rotate_key()
    raise last_exception or RuntimeError("All GROQ API key attempts failed with no exception recorded.")


def groq_generate(prompt, max_tokens=1200, is_json=False, temperature=0.4, model=None):
    def _do_generate(client, p, mt, temp, is_j, mod):
        kwargs = {
            "model": mod or os.getenv("SUMMARY_MODEL"),
            "messages": [{"role": "user", "content": p}],
            "temperature": temp,
            "max_completion_tokens": mt,
        }
        if is_j:
            kwargs["response_format"] = {"type": "json_object"}
        else:
            kwargs["top_p"] = 1
            
        response = client.chat.completions.create(**kwargs)
        return response.choices[0].message.content.strip()

    try:
        return execute_with_retry(_do_generate, prompt, max_tokens, temperature, is_json, model)
    except Exception as e:
        print(f"Error generating response after retries: {e}")
        return None

def groq_stt(audio_bytes, filename="audio.webm"):
    def _do_stt(client, a_bytes, fname):
        return client.audio.transcriptions.create(
            file=(fname, a_bytes),
            model=os.getenv("STT_MODEL", "distil-whisper-large-v3-en"),
            temperature=0
        )
    return execute_with_retry(_do_stt, audio_bytes, filename)

def groq_tts(text, voice=None, model=None, response_format="wav"):
    voice = voice or os.getenv("TTS_VOICE")
    model = model or os.getenv("TTS_MODEL")

    def _do_tts(client, txt, v, m, fmt):
        return client.audio.speech.create(
            model=m,
            voice=v,
            response_format=fmt,
            input=txt
        )
    
    response = execute_with_retry(_do_tts, text, voice, model, response_format)
    
    # helper to get bytes
    audio_data = b""
    if hasattr(response, "iter_bytes"):
        for chunk in response.iter_bytes():
            audio_data += chunk
    elif hasattr(response, "content"):
        audio_data = response.content or b""
    elif hasattr(response, "read"):
        audio_data = response.read()
        
    return audio_data


# =============================================================================
# TTS Chunking Configuration
# =============================================================================

# Target / max character counts per TTS chunk
# (Groq TTS has an input limit; keep chunks well within it)
TTS_CHUNK_TARGET_TOKENS = 120   # aim for this sentence-token size
TTS_CHUNK_MAX_TOKENS    = 180   # hard ceiling (sentence-token count)


# =============================================================================
# Sentence-Aware Text Chunking for TTS
# =============================================================================
import re
import numpy as np

def _split_into_sentences(text: str) -> list:
    """
    Split text into sentences using punctuation boundaries.
    Handles periods, exclamation marks, and question marks reliably.
    """
    # Normalise whitespace first
    text = re.sub(r'\s+', ' ', text.strip())
    # Split on sentence-ending punctuation followed by whitespace or end-of-string
    raw = re.split(r'(?<=[.!?])\s+', text)
    # Filter out empty strings
    return [s.strip() for s in raw if s.strip()]



# =============================================================================
# generate_audio_for_text — chunked pipeline using Groq TTS
# =============================================================================
import scipy.io.wavfile

def generate_audio_for_text(text: str, temp_chunk_dir: str = None):
    """
    Generate a WAV audio byte stream from text using the Groq TTS API.

    Steps:
      1. Cleans the text.
      2. Splits it into sentence-aware chunks (target ~120 tokens, max 180).
         A simple word-count approximation is used (no local tokenizer needed).
      3. Sends each chunk to groq_tts() and receives WAV bytes.
      4. Decodes each WAV blob into a numpy array via scipy.
      5. Concatenates all arrays and re-encodes to a single WAV byte stream.
      6. Returns (wav_bytes, sample_rate) or (None, None) on failure.

    Args:
        text           : Input text to convert to speech.
        temp_chunk_dir : Optional directory to save chunk WAV files for resume
                         support.  Pass a batch-specific path like
                         "outputs/batch1/" to enable caching.  If None,
                         chunking still happens in memory only.
    """
    try:
        # --- Step 1: Clean text ---
        clean = re.sub(r'\s+', ' ', text.strip())
        if not clean:
            print("⚠️ generate_audio_for_text received empty text — skipping.")
            return None, None

        # --- Step 2: Split into sentence-aware chunks ---
        # Use a lightweight word-count approximation (~0.75 words per token)
        # so we don't need a local tokenizer.
        def _approx_tokens(s):
            return max(1, len(s.split()))

        sentences = _split_into_sentences(clean)
        chunks = []
        current_sentences = []
        current_count = 0

        for sentence in sentences:
            s_tokens = _approx_tokens(sentence)
            if s_tokens > TTS_CHUNK_MAX_TOKENS:
                # Flush any accumulated chunk first
                if current_sentences:
                    chunks.append(' '.join(current_sentences))
                    current_sentences = []
                    current_count = 0
                # Break the long sentence at word boundary
                words = sentence.split()
                sub_words = []
                sub_count = 0
                for word in words:
                    wt = _approx_tokens(word)
                    if sub_count + wt > TTS_CHUNK_MAX_TOKENS and sub_words:
                        chunks.append(' '.join(sub_words))
                        sub_words = [word]
                        sub_count = wt
                    else:
                        sub_words.append(word)
                        sub_count += wt
                if sub_words:
                    chunks.append(' '.join(sub_words))
                continue

            if current_count + s_tokens > TTS_CHUNK_MAX_TOKENS and current_sentences:
                chunks.append(' '.join(current_sentences))
                current_sentences = [sentence]
                current_count = s_tokens
            else:
                current_sentences.append(sentence)
                current_count += s_tokens

        if current_sentences:
            chunks.append(' '.join(current_sentences))

        total_chunks = len(chunks)
        print(f"🔊 TTS: split into {total_chunks} chunk(s) for generation.")

        # --- Optional chunk directory for resume support ---
        if temp_chunk_dir:
            os.makedirs(temp_chunk_dir, exist_ok=True)

        # --- Step 3 + 4: Generate audio per chunk with retry + resume ---
        chunk_arrays = []
        final_sample_rate = None

        for idx, chunk_text in enumerate(chunks, start=1):
            chunk_label = f"chunk_{idx:03d}"
            chunk_file  = os.path.join(temp_chunk_dir, f"{chunk_label}.wav") if temp_chunk_dir else None

            print(f"   Generating chunk {idx}/{total_chunks}...")

            # --- Resume: skip if chunk file already exists ---
            if chunk_file and os.path.exists(chunk_file):
                print(f"   ↩️  {chunk_label} already exists — reusing cached file.")
                cached_rate, cached_arr = scipy.io.wavfile.read(chunk_file)
                chunk_arrays.append(cached_arr.astype(np.float32))
                if final_sample_rate is None:
                    final_sample_rate = cached_rate
                continue

            # --- Retry logic: try once, retry once on failure ---
            audio_arr = None
            sr = None
            for attempt in range(1, 3):  # attempt 1 and 2
                try:
                    wav_chunk = groq_tts(chunk_text, response_format="wav")
                    if not wav_chunk:
                        raise ValueError("groq_tts returned empty bytes")
                    # Decode WAV bytes to numpy array
                    sr, audio_arr = scipy.io.wavfile.read(io.BytesIO(wav_chunk))
                    audio_arr = audio_arr.astype(np.float32)
                    if final_sample_rate is None:
                        final_sample_rate = sr
                    break
                except Exception as chunk_err:
                    print(f"   ⚠️  Chunk {idx} attempt {attempt} failed: {chunk_err}")
                    if attempt == 2:
                        print(f"   ❌ Chunk {idx} failed after 2 attempts — skipping.")

            if audio_arr is None:
                continue  # log and continue with remaining chunks

            # --- Save chunk file if requested ---
            if chunk_file:
                try:
                    buf_c = io.BytesIO()
                    scipy.io.wavfile.write(buf_c, rate=final_sample_rate, data=audio_arr)
                    with open(chunk_file, 'wb') as cf:
                        cf.write(buf_c.getvalue())
                except Exception as save_err:
                    print(f"   ⚠️  Could not save chunk file: {save_err}")

            chunk_arrays.append(audio_arr)

        if not chunk_arrays:
            print("❌ No audio chunks were successfully generated.")
            return None, None

        # --- Step 5: Merge all chunk arrays in order ---
        # Ensure all arrays are 1-D before concatenation
        flat_arrays = [arr.flatten() for arr in chunk_arrays]
        merged_audio = np.concatenate(flat_arrays).astype(np.float32)

        # Normalise to [-1, 1] to avoid clipping artefacts at join points
        peak = np.max(np.abs(merged_audio))
        if peak > 0:
            merged_audio = merged_audio / peak

        # --- Step 6: Encode to WAV bytes ---
        buf = io.BytesIO()
        scipy.io.wavfile.write(buf, rate=final_sample_rate, data=merged_audio)
        wav_bytes = buf.getvalue()

        print(
            f"🔊 Merged {len(chunk_arrays)} chunk(s) → "
            f"{len(wav_bytes):,} bytes of audio ({len(clean)} chars)"
        )
        return wav_bytes, final_sample_rate

    except Exception as e:
        print(f"❌ Groq TTS generation failed: {e}")
        traceback.print_exc()
        return None, None

def store_audio_in_gridfs(fs, wav_bytes, filename, sample_rate=None):
    """
    Store WAV audio bytes in MongoDB GridFS.
    Returns the GridFS ObjectId or None on failure.
    """
    if fs is None:
        print("⚠️ GridFS not available — skipping audio storage.")
        return None
    try:
        gridfs_id = fs.put(
            wav_bytes,
            filename=filename,
            contentType="audio/wav",
            metadata={
                "created_at": datetime.utcnow(),
                "model": "parler_tts_mini_v1",
                "sample_rate": sample_rate,
            },
        )
        print(f"✅ Audio stored in GridFS: {gridfs_id} ({filename})")
        return gridfs_id
    except Exception as e:
        print(f"❌ GridFS storage failed: {e}")
        return None

# -----------------------------------------------------------------------------
# Prompt Builder
# -----------------------------------------------------------------------------
def build_prompt_summary(input_text):
    return f"""
You are an expert educational content generator.

Task:
Generate a structured, student-friendly explanation of the given content.

Requirements:
- Use simple, clear language (suitable for school students)
- Maintain logical flow and coherence
- Break down complex ideas into easy explanations
- Highlight key concepts naturally within the explanation
- Avoid unnecessary repetition
- Do NOT include links or keywords

Output Format:
A well-structured paragraph explanation (5–8 sentences).

Content:
{input_text}
"""

def build_prompt_links(summary_text):
    return f"""Based on the following summary, generate:
1. Relevant learning resource links (articles, videos, documentation)
2. Important keywords for visual representation

Return JSON in this format:
{{
  "links": ["https://...", "https://...", "https://..."],
  "keywords": ["...", "...", "...", "..."]
}}

Summary:
{summary_text}"""


# -----------------------------------------------------------------------------
# Filename → Qdrant Collection Name
# -----------------------------------------------------------------------------
def filename_to_collection_name(filename: str) -> str:
    """
    Derive a safe Qdrant collection name from any filename or title.
    E.g. 'My PDF File.pdf' → 'my_pdf_file'
         "Shivaji's Childhood" → 'shivaji's_childhood'
    """
    return os.path.splitext(os.path.basename(filename))[0].lower().replace(" ", "_")


# -----------------------------------------------------------------------------
# Image Finder (shared between summary1.py and preprocess.py)
# -----------------------------------------------------------------------------
def image_finder(keywords: list) -> list:
    """Fetch one image per keyword using the educational image search service."""
    try:
        from image_finder import get_educational_images
    except ImportError:
        return []
    if not keywords or not isinstance(keywords, list):
        return []
    all_images = []
    for kw in keywords:
        imgs = get_educational_images(kw)
        if imgs:
            all_images.append(imgs[0])
    return list(dict.fromkeys(all_images))


# -----------------------------------------------------------------------------
# Build Audio Metadata Dict (shared between summary1.py and preprocess.py)
# -----------------------------------------------------------------------------
def build_audio_meta(gridfs_id, audio_filename: str) -> dict:
    """Return the standard audio metadata dict stored on every batch document."""
    return {
        "gridfs_id": gridfs_id,
        "filename": audio_filename,
        "contentType": "audio/wav",
        "audio_url": f"/api/tts-audio/{gridfs_id}",
        "created_at": datetime.utcnow(),
        "model": os.getenv("TTS_MODEL", "groq-tts"),
    }


# -----------------------------------------------------------------------------
# Output Schema (shared between summary1.py and preprocess.py)
# -----------------------------------------------------------------------------
_response_schemas = [
    ResponseSchema(name="links", description="Exactly 3 trusted https URLs."),
    ResponseSchema(name="keywords", description="Exactly 4 important multi-word key phrases."),
]
_output_parser = StructuredOutputParser.from_response_schemas(_response_schemas)


# -----------------------------------------------------------------------------
# Batch Pipeline (Summary + Links/Keywords + Images + Audio)
# Shared between summary1.py and preprocess.py.
# Returns a list of batch-document dicts.  The caller is responsible for
# persisting them to MongoDB.
# -----------------------------------------------------------------------------
def process_batch_pipeline(chunks, fs, pdf_basename: str, batch_size: int = 10) -> list:
    """
    Process text chunks in batches:
      1. Per-chunk summary generation (Groq LLM)
      2. Links + keywords generation (Groq LLM, JSON mode)
      3. Image retrieval
      4. TTS audio generation (Parler TTS) + GridFS storage

    Returns a list of batch dicts ready to be stored in MongoDB.
    """
    from werkzeug.utils import secure_filename

    total_chunks = len(chunks)
    all_batches = []

    for batch_start in range(0, total_chunks, batch_size):
        batch_chunks = chunks[batch_start: batch_start + batch_size]
        batch_number = (batch_start // batch_size) + 1

        print(f"🚀 Processing Batch {batch_number}")

        # --- Step 1: Summaries ---
        batch_summaries = []
        for chunk in batch_chunks:
            prompt_step1 = build_prompt_summary(chunk.page_content)
            summary_text = groq_generate(prompt_step1, is_json=False)
            if summary_text:
                batch_summaries.append(summary_text)

        merged_summary = " ".join(batch_summaries).strip()
        if not merged_summary:
            continue

        # --- Step 2: Links + Keywords ---
        prompt_step2 = build_prompt_links(merged_summary)
        response_step2 = groq_generate(prompt_step2, is_json=True)
        try:
            parsed = _output_parser.parse(response_step2)
            links = parsed.get("links", [])
            keywords = parsed.get("keywords", [])[:4]
        except Exception:
            print("⚠️ Invalid JSON — skipping links/keywords")
            links = []
            keywords = []

        # --- Step 3: Images ---
        try:
            batch_images = image_finder(keywords)
        except Exception as e:
            print(f"⚠️ Image generation failed for batch {batch_number}: {e}")
            batch_images = []

        # --- Step 4: TTS Audio (chunked pipeline) ---
        # [CHANGED] generate_audio_for_text now splits text into sentence-aware
        # chunks internally.  We pass a batch-specific temp_chunk_dir so that
        # individual chunk WAVs are persisted for resume support.
        audio_meta = None
        try:
            safe_name = secure_filename(os.path.splitext(pdf_basename)[0]) or "batch"
            audio_filename = f"{safe_name}_batch{batch_number}.wav"

            # Build the chunk cache directory: outputs/<safe_name>_batch<N>/
            chunk_dir = os.path.join("outputs", f"{safe_name}_batch{batch_number}")

            print(f"🎙️ Generating audio for batch {batch_number} (chunked pipeline)...")
            wav_bytes, sample_rate = generate_audio_for_text(
                merged_summary,
                temp_chunk_dir=chunk_dir,
            )
            if wav_bytes:
                gridfs_id = store_audio_in_gridfs(fs, wav_bytes, audio_filename, sample_rate)
                if gridfs_id:
                    audio_meta = build_audio_meta(gridfs_id, audio_filename)
        except Exception as e:
            print(f"⚠️ Audio generation failed for batch {batch_number}: {e}")
            audio_meta = None

        batch_document = {
            "batchNumber": batch_number,
            "summary": merged_summary,
            "links": links,
            "keywords": keywords,
            "images": batch_images,
            "createdAt": datetime.utcnow(),
        }
        if audio_meta:
            batch_document["audio"] = audio_meta

        all_batches.append(batch_document)
        print(f"✅ Batch {batch_number} complete.")

    return all_batches


# -----------------------------------------------------------------------------
# Load & Chunk PDF  (shared utility)
# -----------------------------------------------------------------------------
def load_and_chunk_pdf(pdf_path: str, start_page: int = None, end_page: int = None,
                       chunk_size: int = 500, chunk_overlap: int = 50,
                       lesson_label: str = "Lessons") -> list:
    """
    Load a PDF and split it into overlapping chunks.
    Optionally filter to a 1-based page range [start_page, end_page].
    Returns a list of LangChain Document objects.
    """
    loader = PyPDFLoader(pdf_path)
    documents = loader.load()

    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap
    )
    chunks = text_splitter.split_documents(documents)

    if start_page is not None and end_page is not None:
        start_idx = start_page - 1
        end_idx = end_page - 1
        filtered = []
        for idx, chunk in enumerate(chunks):
            page_num = chunk.metadata.get("page")
            if page_num is not None and start_idx <= page_num <= end_idx:
                chunk.metadata["chunk_index"] = idx
                chunk.metadata["lesson"] = lesson_label
                filtered.append(chunk)
        return filtered
    else:
        for idx, chunk in enumerate(chunks):
            chunk.metadata["chunk_index"] = idx
        return chunks


# -----------------------------------------------------------------------------
# Ingest into Qdrant Vector Database  (shared utility)
# -----------------------------------------------------------------------------
def ingest_into_qdrant(chunks: list, collection_name: str) -> None:
    """
    Embed and store document chunks in a Qdrant collection.
    Creates the collection if it does not exist; appends otherwise.

    Args:
        chunks:          List of LangChain Document objects to ingest.
        collection_name: Target Qdrant collection name.
    """
    from langchain_huggingface import HuggingFaceEmbeddings
    from langchain_qdrant import QdrantVectorStore
    from qdrant_client import QdrantClient

    EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL")
    QDRANT_URL = os.getenv("QDRANT_URL")

    print(f"📥 Ingesting {len(chunks)} chunks into Qdrant collection: '{collection_name}'")

    embeddings = HuggingFaceEmbeddings(model_name=EMBEDDING_MODEL)
    client = QdrantClient(url=QDRANT_URL)
    existing_collections = [c.name for c in client.get_collections().collections]

    if collection_name not in existing_collections:
        print(f"⚙️ Creating new collection '{collection_name}'...")
        QdrantVectorStore.from_documents(
            documents=chunks,
            embedding=embeddings,
            url=QDRANT_URL,
            collection_name=collection_name,
        )
    else:
        print(f"📦 Collection '{collection_name}' exists. Adding documents...")
        vectorstore = QdrantVectorStore(
            client=client,
            collection_name=collection_name,
            embedding=embeddings,
        )
        vectorstore.add_documents(chunks)

    print(f"✅ Qdrant ingestion complete for '{collection_name}'.")
