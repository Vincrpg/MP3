import os
import uuid
import threading
import time
from flask import Flask, request, jsonify, send_file, render_template_string
from flask_cors import CORS
import yt_dlp

app = Flask(__name__)
CORS(app)

DOWNLOAD_FOLDER = "downloads"
os.makedirs(DOWNLOAD_FOLDER, exist_ok=True)

# Store job status
jobs = {}

def cleanup_file(filepath, delay=300):
    """Delete file after delay seconds"""
    def _delete():
        time.sleep(delay)
        if os.path.exists(filepath):
            os.remove(filepath)
    threading.Thread(target=_delete, daemon=True).start()

def do_conversion(job_id, url, quality):
    try:
        jobs[job_id]["status"] = "downloading"
        output_path = os.path.join(DOWNLOAD_FOLDER, f"{job_id}.%(ext)s")

        ydl_opts = {
            "format": "bestaudio/best",
            "outtmpl": output_path,
            "postprocessors": [{
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": quality,
            }],
            "quiet": True,
            "no_warnings": True,
            "nocheckcertificate": True,
        }

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
            title = info.get("title", "audio")
            # sanitize title
            safe_title = "".join(c for c in title if c.isalnum() or c in " _-()[]").strip()[:80]

        mp3_path = os.path.join(DOWNLOAD_FOLDER, f"{job_id}.mp3")
        if os.path.exists(mp3_path):
            jobs[job_id]["status"] = "done"
            jobs[job_id]["filename"] = mp3_path
            jobs[job_id]["title"] = safe_title
            cleanup_file(mp3_path)
        else:
            jobs[job_id]["status"] = "error"
            jobs[job_id]["error"] = "MP3 não foi gerado."

    except Exception as e:
        jobs[job_id]["status"] = "error"
        jobs[job_id]["error"] = str(e)


@app.route("/")
def index():
    with open("index.html", "r", encoding="utf-8") as f:
        return f.read()

@app.route("/convert", methods=["POST"])
def convert():
    data = request.json
    url = data.get("url", "").strip()
    quality = data.get("quality", "192")

    if not url:
        return jsonify({"error": "URL inválida"}), 400

    if quality not in ["128", "192", "256", "320"]:
        quality = "192"

    job_id = str(uuid.uuid4())
    jobs[job_id] = {"status": "pending"}

    thread = threading.Thread(target=do_conversion, args=(job_id, url, quality))
    thread.daemon = True
    thread.start()

    return jsonify({"job_id": job_id})

@app.route("/status/<job_id>")
def status(job_id):
    job = jobs.get(job_id)
    if not job:
        return jsonify({"error": "Job não encontrado"}), 404
    return jsonify({
        "status": job["status"],
        "title": job.get("title", ""),
        "error": job.get("error", ""),
    })

@app.route("/download/<job_id>")
def download(job_id):
    job = jobs.get(job_id)
    if not job or job.get("status") != "done":
        return jsonify({"error": "Arquivo não disponível"}), 404

    filepath = job["filename"]
    title = job.get("title", "audio")

    if not os.path.exists(filepath):
        return jsonify({"error": "Arquivo expirou"}), 410

    return send_file(
        filepath,
        as_attachment=True,
        download_name=f"{title}.mp3",
        mimetype="audio/mpeg"
    )

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)
