"""Decode the independently validated pnpm test fixtures with ZXing-C++.

Install qa/requirements.txt into a Python virtual environment, then:
QR_SCAN_DIR=/absolute/empty/directory pnpm test
python qa/verify-native.py /absolute/empty/directory
"""
import json
import sys
from pathlib import Path

import zxingcpp
from PIL import Image

directory = Path(sys.argv[1])
cases = [json.loads(line) for line in (directory / 'manifest.jsonl').read_text().splitlines()]
failed = []
for case in cases:
    result = zxingcpp.read_barcode(Image.open(directory / case['file']), formats=zxingcpp.BarcodeFormat.QRCode)
    if result is None or result.text != case['expected']:
        failed.append(case['file'])
print(json.dumps({'decoder': 'ZXing-C++ 2.3.0', 'checked': len(cases), 'passed': len(cases)-len(failed), 'failed': failed}, indent=2))
sys.exit(bool(failed))
