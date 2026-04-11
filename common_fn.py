import os
import io
import traceback
from datetime import datetime
from dotenv import load_dotenv

import torch
import scipy.io.wavfile
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
    raise last_exception


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


# -----------------------------------------------------------------------------
# Parler TTS Setup (Local Model)
# -----------------------------------------------------------------------------
PARLER_TTS_MODEL_PATH = r"C:\ai4bharat\tts\models\parler_tts_mini_v1"

_tts_model = None
_tts_tokenizer = None

def load_parler_tts():
    """Lazy-load the Parler TTS model and tokenizer (once)."""
    global _tts_model, _tts_tokenizer
    if _tts_model is not None:
        return _tts_model, _tts_tokenizer

    print(f"🔊 Loading Parler TTS model from: {PARLER_TTS_MODEL_PATH}")
    from parler_tts import ParlerTTSForConditionalGeneration
    from transformers import AutoTokenizer

    device = "cuda:0" if torch.cuda.is_available() else "cpu"

    _tts_model = ParlerTTSForConditionalGeneration.from_pretrained(
        PARLER_TTS_MODEL_PATH
    ).to(device)
    _tts_tokenizer = AutoTokenizer.from_pretrained(PARLER_TTS_MODEL_PATH)

    print(f"✅ Parler TTS loaded on {device}")
    return _tts_model, _tts_tokenizer

def generate_audio_for_text(text, max_chars=2000):
    """
    Generate a WAV audio byte stream from text using Parler TTS.
    Returns (wav_bytes, sample_rate) or (None, None) on failure.
    """
    try:
        model, tokenizer = load_parler_tts()
        device = "cuda:0" if torch.cuda.is_available() else "cpu"

        description = (
            "A female speaker delivers a clear, calm, and engaging lecture "
            "in a neutral academic tone."
        )

        if len(text) > max_chars:
            text = text[:max_chars]

        desc_inputs = tokenizer(description, return_tensors="pt").to(device)
        text_inputs = tokenizer(text, return_tensors="pt").to(device)

        with torch.no_grad():
            generation = model.generate(
                input_ids=desc_inputs.input_ids,
                attention_mask=desc_inputs.attention_mask,
                prompt_input_ids=text_inputs.input_ids,
                prompt_attention_mask=text_inputs.attention_mask,
            )

        audio_arr = generation.cpu().numpy().squeeze()
        sample_rate = model.config.sampling_rate

        buf = io.BytesIO()
        scipy.io.wavfile.write(buf, rate=sample_rate, data=audio_arr)
        wav_bytes = buf.getvalue()

        print(f"🔊 Generated {len(wav_bytes)} bytes of audio ({len(text)} chars)")
        return wav_bytes, sample_rate

    except Exception as e:
        print(f"❌ Parler TTS generation failed: {e}")
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
        "model": "parler_tts_mini_v1",
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

        # --- Step 4: TTS Audio ---
        audio_meta = None
        try:
            wav_bytes, sample_rate = generate_audio_for_text(merged_summary)
            if wav_bytes:
                safe_name = secure_filename(os.path.splitext(pdf_basename)[0]) or "batch"
                audio_filename = f"{safe_name}_batch{batch_number}.wav"
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
