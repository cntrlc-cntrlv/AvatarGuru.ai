import os
import shutil
from huggingface_hub import snapshot_download

EMBEDDING_MODEL_NAME = os.getenv("EMBEDDING_MODEL", "BAAI/bge-base-en-v1.5")

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
