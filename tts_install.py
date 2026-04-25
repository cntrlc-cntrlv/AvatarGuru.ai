"""
installation.py

Purpose:
    - Download Parler-TTS Mini model from HuggingFace
    - Save model + tokenizer DIRECTLY to the models folder
    - No files are stored in the default HuggingFace cache
    - This file should be run ONLY ONCE

After running this:
    ./models/parler_tts_mini_v1/ will contain all weights
"""

import os
import shutil
import torch
from transformers import AutoTokenizer
from parler_tts import ParlerTTSForConditionalGeneration

# -----------------------------
# Configuration
# -----------------------------

MODEL_NAME = "parler-tts/parler-tts-mini-v1"
MODELS_DIR = os.path.abspath("./models")
LOCAL_MODEL_DIR = os.path.join(MODELS_DIR, "parler_tts_mini_v1")
CACHE_DIR = os.path.join(MODELS_DIR, ".hf_cache")

# Force HuggingFace to use our models folder for all downloads
# This prevents any files from going to ~/.cache/huggingface/
os.environ["HF_HOME"] = MODELS_DIR
os.environ["HUGGINGFACE_HUB_CACHE"] = CACHE_DIR

# -----------------------------
# Create directories if not exist
# -----------------------------

os.makedirs(LOCAL_MODEL_DIR, exist_ok=True)
os.makedirs(CACHE_DIR, exist_ok=True)

print(f"Downloading model from Hugging Face...")
print(f"  Cache dir  : {CACHE_DIR}")
print(f"  Save dir   : {LOCAL_MODEL_DIR}")

# -----------------------------
# Load from HuggingFace
# (Downloads directly into our cache_dir inside models/)
# -----------------------------

model = ParlerTTSForConditionalGeneration.from_pretrained(
    MODEL_NAME,
    cache_dir=CACHE_DIR,
)
tokenizer = AutoTokenizer.from_pretrained(
    MODEL_NAME,
    cache_dir=CACHE_DIR,
)

print("Saving model locally...")

# -----------------------------
# Save clean pretrained files to the final directory
# -----------------------------

model.save_pretrained(LOCAL_MODEL_DIR)
tokenizer.save_pretrained(LOCAL_MODEL_DIR)

# -----------------------------
# Clean up: remove the temporary HuggingFace cache
# so only the final model files remain in models/
# -----------------------------

if os.path.exists(CACHE_DIR):
    shutil.rmtree(CACHE_DIR)
    print(f"Cleaned up temporary cache: {CACHE_DIR}")

print(f"Model successfully saved at: {LOCAL_MODEL_DIR}")
print("Installation complete.")

