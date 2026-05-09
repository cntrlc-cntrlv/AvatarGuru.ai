import os
import shutil
from transformers import AutoTokenizer
from parler_tts import ParlerTTSForConditionalGeneration
from huggingface_hub import snapshot_download

TTS_MODEL_NAME = "parler-tts/parler-tts-mini-v1"
EMBEDDING_MODEL_NAME = os.getenv("EMBEDDING_MODEL", "BAAI/bge-base-en-v1.5")

TTS_DIR = "/models/tts"
EMBED_DIR = "/models/embedding"
CACHE_DIR = "/tmp/hf_cache"

# Ensure downloads don't bloat the container's root
os.environ["HF_HOME"] = CACHE_DIR
os.environ["HUGGINGFACE_HUB_CACHE"] = CACHE_DIR
os.makedirs(CACHE_DIR, exist_ok=True)

def is_empty(dir_path):
    if not os.path.exists(dir_path):
        return True
    return len(os.listdir(dir_path)) == 0

print("══════════════════════════════════════════════")
print("  AvatarGuru.ai — Checking ML Models")
print("══════════════════════════════════════════════")

if is_empty(TTS_DIR):
    print(f"Downloading TTS model '{TTS_MODEL_NAME}'...")
    os.makedirs(TTS_DIR, exist_ok=True)
    model = ParlerTTSForConditionalGeneration.from_pretrained(TTS_MODEL_NAME, cache_dir=CACHE_DIR)
    tokenizer = AutoTokenizer.from_pretrained(TTS_MODEL_NAME, cache_dir=CACHE_DIR)
    
    print(f"Saving TTS model to {TTS_DIR}...")
    model.save_pretrained(TTS_DIR)
    tokenizer.save_pretrained(TTS_DIR)
    print("✅ TTS model setup complete.")
else:
    print(f"✅ TTS model already exists in {TTS_DIR}.")

if is_empty(EMBED_DIR):
    print(f"Downloading Embedding model '{EMBEDDING_MODEL_NAME}'...")
    os.makedirs(EMBED_DIR, exist_ok=True)
    snapshot_download(repo_id=EMBEDDING_MODEL_NAME, local_dir=EMBED_DIR, cache_dir=CACHE_DIR)
    print("✅ Embedding model setup complete.")
else:
    print(f"✅ Embedding model already exists in {EMBED_DIR}.")

# Clean up the cache to free up space inside the container
if os.path.exists(CACHE_DIR):
    shutil.rmtree(CACHE_DIR)

print("══════════════════════════════════════════════")
print("  Models verified. Starting server...")
print("══════════════════════════════════════════════")
