#!/usr/bin/env python3
"""方式が誤って「医」になっている試験を「前期」に修正する。"""
import json
import urllib.request

API_BASE = "https://medical-exam-worker.ryoxsakai.workers.dev"
EXAM_IDS = [70, 71, 73]  # 日本医科 2022/2021/2019


def api_request(url, data=None, method="GET"):
    headers = {"User-Agent": "curl/8.0"}
    if data is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    with urllib.request.urlopen(req) as resp:
        return json.load(resp), resp.status


def main():
    for exam_id in EXAM_IDS:
        payload = json.dumps({"schedule": "前期"}).encode("utf-8")
        result, status = api_request(
            f"{API_BASE}/api/exams/{exam_id}",
            data=payload,
            method="PUT",
        )
        exam = result.get("exam", {})
        print(f"exam {exam_id}: {status} -> {exam.get('university_name')} {exam.get('year')} {exam.get('schedule')}")


if __name__ == "__main__":
    main()
