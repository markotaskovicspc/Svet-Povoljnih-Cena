#!/usr/bin/env python3
"""Single outbound NTH worker; standard library only. Keep its SQLite journal local."""
import base64
import json
import os
import sqlite3
import time
import urllib.error
import urllib.request
from pathlib import Path


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def request_json(url, authorization, body):
    if not url.startswith("https://"):
        raise ValueError("HTTPS required")
    request = urllib.request.Request(url, data=json.dumps(body).encode(), headers={
        "Content-Type": "application/json", "Accept": "application/json", "Authorization": authorization,
    })
    with urllib.request.build_opener(NoRedirect).open(request, timeout=20) as response:
        return json.loads(response.read(1024 * 1024))


def submit(payload, base_url, authorization):
    try:
        reply = request_json(base_url.rstrip("/") + "/v1/omni-channel/message", authorization, payload)
        messages = reply.get("messages", [])
        if reply.get("resultCode") not in ("OK", "PARTIAL_OK") or len(messages) != 1:
            return {"outcome": "unknown"}
        message = messages[0]
        if message.get("destination", {}).get("phoneNumber") != payload["destinations"][0]["phoneNumber"]:
            return {"outcome": "unknown"}
        if message.get("status", {}).get("code") != "ACCEPTED":
            return {"outcome": "failed"}
        import uuid
        message_id = str(uuid.UUID(message["messageId"]))
        return {"outcome": "accepted", "messageId": message_id}
    except urllib.error.HTTPError as error:
        # 5xx/408 may follow an accepted write. Never retry such a message.
        return {"outcome": "failed" if 400 <= error.code < 500 and error.code != 408 else "unknown"}
    except Exception:
        return {"outcome": "unknown"}


def process_job(journal, job, send):
    existing = journal.execute("SELECT result FROM messages WHERE id=?", (job["id"],)).fetchone()
    if existing:
        # An interrupted submission remains unknown. Store the intent BEFORE
        # the network call and never re-submit it after a crash/reclaimed lease.
        return json.loads(existing[0]) if existing[0] else {"outcome": "unknown"}
    journal.execute("INSERT INTO messages(id) VALUES(?)", (job["id"],))
    journal.commit()
    result = send(job["payload"])
    journal.execute("UPDATE messages SET result=? WHERE id=?", (json.dumps(result), job["id"]))
    journal.commit()
    return result


def main():
    os.umask(0o077)
    url = os.environ["NTH_WORKER_APP_URL"].rstrip("/") + "/api/viber/worker"
    token = os.environ["NTH_WORKER_TOKEN"]
    if len(token) < 32:
        raise ValueError("Worker token too short")
    auth = "Basic " + base64.b64encode((os.environ["NTH_API_USERNAME"] + ":" + os.environ["NTH_API_PASSWORD"]).encode()).decode()
    path = Path(os.environ.get("NTH_WORKER_JOURNAL", "/var/lib/spc-nth/messages.sqlite"))
    path.parent.mkdir(parents=True, exist_ok=True)
    journal = sqlite3.connect(path)
    journal.execute("CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY, result TEXT)")
    journal.commit()
    campaigns_at = 0
    reports_at = 0
    while True:
        try:
            if time.monotonic() >= campaigns_at:
                request_json(url, "Bearer " + token, {"action": "campaigns"})
                campaigns_at = time.monotonic() + 60
            if time.monotonic() >= reports_at:
                reports = request_json(url, "Bearer " + token, {"action": "reports"}).get("jobs", [])
                for report in reports:
                    try:
                        status_url = os.environ.get("NTH_API_BASE_URL", "https://msg.mobile-gw.com:9000").rstrip("/") + "/v1/omni-channel/message/" + report["messageId"] + "/status"
                        req = urllib.request.Request(status_url, headers={"Authorization": auth, "Accept": "application/json"})
                        with urllib.request.build_opener(NoRedirect).open(req, timeout=15) as response:
                            statuses = json.load(response).get("messages", [])
                        code = next((entry.get("status", {}).get("code") for entry in statuses if entry.get("channel") == report.get("channel", "VIBER")), None)
                        outcome = "SEEN" if code == "SEEN" else "DELIVERED" if code == "DELIVERED" else "FAILED" if code in {"BLACKLISTED", "DELIVERY_FAILED", "ERROR", "EXPIRED", "INSUFFICIENT_FUNDS", "NO_ROUTE", "REJECTED", "USER_BLOCKED"} else None
                        if outcome:
                            request_json(url, "Bearer " + token, {"action": "delivery", "id": report["id"], "messageId": report["messageId"], "status": outcome})
                    except Exception:
                        print("NTH delivery report temporarily unavailable", flush=True)
                reports_at = time.monotonic() + 30
            job = request_json(url, "Bearer " + token, {"action": "claim"}).get("job")
            if job:
                result = process_job(journal, job, lambda payload: submit(payload, os.environ.get("NTH_API_BASE_URL", "https://msg.mobile-gw.com:9000"), auth))
                request_json(url, "Bearer " + token, {"action": "complete", "id": job["id"], **result})
                print("NTH job completed:", result["outcome"], flush=True)
                continue
        except Exception:
            # Never log credentials, numbers, bodies, or upstream error text.
            print("NTH worker poll/ack unavailable", flush=True)
        time.sleep(10)


if __name__ == "__main__":
    main()
