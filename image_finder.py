# =====================================================
# ----------------------- Imports ---------------------
# =====================================================

import os
import json
import requests
from pymongo import MongoClient
from ratelimit import limits, sleep_and_retry
from dotenv import load_dotenv

load_dotenv()


# =====================================================
# ----------------------- Config ----------------------
# =====================================================


SERPER_API_KEY = os.getenv("SERPER_API_KEY")
SERPER_URL = os.getenv("SERPER_URL")

MONGO_URI = os.getenv("MONGO_URL")
DB_NAME = os.getenv("MONGO_DB")
COLLECTION_NAME = "files"

CALLS = int(os.getenv("CALLS"))
PERIOD = int(os.getenv("PERIOD"))



# =====================================================
# ------------------- MongoDB -------------------------
# =====================================================


def get_mongo_collection():
    client = MongoClient(MONGO_URI)
    db = client[DB_NAME]
    return db[COLLECTION_NAME]



# =====================================================
# ------------------- Serper Setup --------------------
# =====================================================


@sleep_and_retry
@limits(calls=CALLS, period=PERIOD)
def get_educational_images(keyword):
    """
    Fetch images from Serper.dev for a given keyword
    """
    payload = json.dumps({
        "q": f"{keyword} educational diagram",
        "num": 1,
        "autocorrect": True,
        "safe": "active",
        "gl": "in"
    })

    headers = {
        "X-API-KEY": SERPER_API_KEY,
        "Content-Type": "application/json"
    }

    try:
        response = requests.post(SERPER_URL, headers=headers, data=payload)
        response.raise_for_status()
        results = response.json()
        return [img["imageUrl"] for img in results.get("images", [])]
    except Exception as e:
        print(f"❌ Error fetching image for '{keyword}': {e}")
        return []



# =====================================================
# ------------------- Image Scraping ------------------
# =====================================================

def process_images_for_file(file_path, keywords):
    """
    Takes file_path and keywords list
    Fetches images and saves image URLs directly to MongoDB
    """

    if not keywords or not isinstance(keywords, list):
        print("❌ No keywords provided.")
        return []

    print(f"\n🖼️ Image Finder started for: {file_path}")
    print(f"🔑 Keywords received: {keywords}")

    all_images = []

    # Fetch images for each keyword
    for kw in keywords:
        imgs = get_educational_images(kw)
        if imgs:
            all_images.append(imgs[0])

    # Remove duplicates
    final_images = list(dict.fromkeys(all_images))
    print(f"✅ Total images found: {len(final_images)}")

    # Save directly to MongoDB
    try:
        collection = get_mongo_collection()
        result = collection.update_one(
            {"filePath": file_path},
            {"$set": {"images": final_images}}
        )

        if result.modified_count > 0:
            print("✅ Image URLs saved to MongoDB")
        else:
            print("ℹ️ Document not updated (already exists or not found)")

    except Exception as e:
        print(f"❌ MongoDB update error: {e}")

    return final_images


