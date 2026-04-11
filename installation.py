HF_token = "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"
import os
from getpass import getpass
os.environ["HUGGINGFACEHUB_API_TOKEN"] = HF_token

import json
import torch
from transformers import AutoTokenizer, AutoModelForCausalLM, BitsAndBytesConfig 

model_name = "hexgrad/Kokoro-82M"


# bnb_config = BitsAndBytesConfig(
#     load_in_4bit=True,
#     bnb_4bit_use_double_quant=True,
#     bnb_4bit_quant_type="nf4",
#     bnb_4bit_compute_dtype=torch.bfloat16
# )

tokenizer=AutoTokenizer.from_pretrained(model_name, token=HF_token)
tokenizer.pad_token = tokenizer.eos_token

tts_model=AutoModelForCausalLM.from_pretrained(model_name, device_map = "auto", token=HF_token )  # config=bnb_config

tts_model.save_pretrained("C:/techai/program/model/tts")
tokenizer.save_pretrained("C:/techai/program/model/tts")

